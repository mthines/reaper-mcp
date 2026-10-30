/**
 * get_fx_preset_list in mcp_bridge.lua, run in real Lua (wasmoon) against the fake ReaScript API.
 * Listing loads every preset to read its name, so the FX must end up exactly as it started.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LuaFactory, type LuaEngine } from 'wasmoon';

const REAPER_DIR = join(__dirname, '../../../reaper');
const FAKE_SRC = readFileSync(join(__dirname, '__fixtures__/fake_reaper.lua'), 'utf8');
const SCRIPTS = '/reaper/Scripts/';
const BRIDGE_DIR = `${SCRIPTS}mcp_bridge_data/`;
const LIBS = ['mcp_plan_lib.lua', 'mcp_actions_lib.lua', 'mcp_tracks_lib.lua', 'mcp_project_lib.lua', 'mcp_items_lib.lua', 'mcp_envelopes_lib.lua', 'mcp_edit_views_lib.lua'];

let engine: LuaEngine | undefined;
afterEach(() => {
  engine?.global.close();
  engine = undefined;
});

interface PresetList { total: number; truncated?: boolean; presets: { index: number; name: string }[] }
interface FxState { preset: number; params: number[]; chunk: string; loads: number }

// One FX with `count` presets; preset i sets every param to i / count and the chunk to "preset-i"
async function startBridge(count: number, start: { preset: number; params: number[]; chunk: string }) {
  const factory = new LuaFactory();
  await factory.mountFile(`${SCRIPTS}mcp_bridge.lua`, readFileSync(join(REAPER_DIR, 'mcp_bridge.lua'), 'utf8'));
  for (const lib of LIBS) await factory.mountFile(SCRIPTS + lib, readFileSync(join(REAPER_DIR, lib), 'utf8'));
  await factory.mountFile(`${BRIDGE_DIR}.keep`, '');
  const lua = await factory.createEngine();
  engine = lua;
  await lua.doString(FAKE_SRC);
  await lua.doString(`
    local api = new_fake({ tracks = { { name = "Synth" } } })
    api.GetResourcePath = function() return "/reaper" end
    api.GetProjectPath = function() return "/reaper/projects" end
    api.get_ini_file = function() return "/reaper/reaper.ini" end
    api.GetPlayState = function() return 0 end
    api.GetExtState = function() return "" end
    api.time_precise = os.clock
    api.defer = function(fn) next_tick = fn end
    reaper = setmetatable(api, { __index = function() return function() end end })
    dofile("${SCRIPTS}mcp_bridge.lua")

    fx = { preset = ${start.preset}, chunk = "${start.chunk}", params = {}, loads = 0 }
    ${start.params.map((v, i) => `fx.params[${i}] = ${v}`).join('; ')}
    local n = ${count}
    reaper.TrackFX_GetPresetIndex = function() return fx.preset, n end
    reaper.TrackFX_GetPreset = function() return true, fx.preset >= 0 and ("Preset " .. fx.preset) or "" end
    reaper.TrackFX_SetPresetByIndex = function(_, _, i)
      fx.loads = fx.loads + 1
      if i < 0 then i = 0 end -- REAPER: -1 loads the default preset, not the previous state
      fx.preset = i
      fx.chunk = "preset-" .. i
      for p in pairs(fx.params) do fx.params[p] = i / n end
      return true
    end
    reaper.TrackFX_GetNumParams = function() return #fx.params + 1 end
    reaper.TrackFX_GetParamNormalized = function(_, _, p) return fx.params[p] end
    reaper.TrackFX_SetParamNormalized = function(_, _, p, v) fx.params[p] = v; return true end
    reaper.TrackFX_GetNamedConfigParm = function(_, _, k) if k == "vst_chunk" then return true, fx.chunk end return false, "" end
    reaper.TrackFX_SetNamedConfigParm = function(_, _, k, v) if k == "vst_chunk" then fx.chunk = v end return true end
  `);
  return {
    async list(): Promise<PresetList> {
      const body: string = await lua.doString(`
        local f = assert(io.open("${BRIDGE_DIR}command_p.json", "w"))
        f:write('{"id":"p","type":"get_fx_preset_list","params":{"trackIndex":0,"fxIndex":0}}'); f:close()
        f = assert(io.open("${BRIDGE_DIR}_notify", "w")); f:write("p\\n"); f:close()
        next_tick()
        f = assert(io.open("${BRIDGE_DIR}response_p.json", "r"))
        local body = f:read("a"); f:close()
        return body
      `);
      const res = JSON.parse(body) as { success: boolean; error?: string; data: PresetList };
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    async state(): Promise<FxState> {
      return JSON.parse(await lua.doString(`
        local params = {}
        for p = 0, #fx.params do params[#params + 1] = fx.params[p] end
        return string.format('{"preset":%d,"chunk":"%s","loads":%d,"params":[%s]}',
          fx.preset, fx.chunk, fx.loads, table.concat(params, ","))
      `)) as FxState;
    },
  };
}

describe('get_fx_preset_list', () => {
  it('lists every preset and puts back the settings when no preset was active', async () => {
    const bridge = await startBridge(4, { preset: -1, params: [0.9, 0.1], chunk: 'tweaked' });
    const list = await bridge.list();
    expect(list.presets.map((p) => p.name)).toEqual(['Preset 0', 'Preset 1', 'Preset 2', 'Preset 3']);

    const state = await bridge.state();
    expect(state.params).toEqual([0.9, 0.1]);
    expect(state.chunk).toBe('tweaked');
  });

  it('keeps tweaks made after loading a preset', async () => {
    const bridge = await startBridge(4, { preset: 2, params: [0.7, 0.3], chunk: 'preset-2-tweaked' });
    await bridge.list();

    const state = await bridge.state();
    expect(state.preset).toBe(2);
    expect(state.params).toEqual([0.7, 0.3]);
    expect(state.chunk).toBe('preset-2-tweaked');
  });

  it('does not cycle through huge generic program lists', async () => {
    const bridge = await startBridge(2048, { preset: 0, params: [0.5], chunk: 'kit' });
    const list = await bridge.list();
    expect(list).toMatchObject({ total: 2048, truncated: true, presets: [] });
    expect((await bridge.state()).loads).toBe(0);
  });
});
