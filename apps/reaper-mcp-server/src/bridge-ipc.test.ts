/**
 * The whole mcp_bridge.lua, run in real Lua 5.4 (wasmoon) against the fake
 * ReaScript API, driven only through its file-IPC contract: write
 * command_{id}.json + _notify, let one defer tick run, read response_{id}.json.
 * Nothing here reaches into the bridge's internals, so tests survive refactors.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LuaFactory, type LuaEngine } from 'wasmoon';

const REAPER_DIR = join(__dirname, '../../../reaper');
const FAKE_SRC = readFileSync(join(__dirname, '__fixtures__/fake_reaper.lua'), 'utf8');
const SCRIPTS = '/reaper/Scripts/';
const BRIDGE_DIR = `${SCRIPTS}mcp_bridge_data/`;
const LIBS = ['mcp_plan_lib.lua', 'mcp_actions_lib.lua', 'mcp_tracks_lib.lua', 'mcp_project_lib.lua', 'mcp_items_lib.lua'];

interface BridgeResponse {
  id: string;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

interface Bridge {
  send(type: string, params?: Record<string, unknown>): Promise<BridgeResponse>;
}

let engine: LuaEngine | undefined;

afterEach(() => {
  engine?.global.close();
  engine = undefined;
});

/**
 * Boot the bridge against a fake REAPER. `spec` is a Lua table literal for
 * new_fake{}; `playState` is GetPlayState()'s bitmask (1 play, 2 pause, 4 record).
 */
async function startBridge(spec = '{}', playState = 0): Promise<Bridge> {
  const factory = new LuaFactory();
  await factory.mountFile(`${SCRIPTS}mcp_bridge.lua`, readFileSync(join(REAPER_DIR, 'mcp_bridge.lua'), 'utf8'));
  for (const lib of LIBS) await factory.mountFile(SCRIPTS + lib, readFileSync(join(REAPER_DIR, lib), 'utf8'));
  await factory.mountFile(`${BRIDGE_DIR}.keep`, '');

  const lua = await factory.createEngine();
  engine = lua;
  await lua.doString(FAKE_SRC);
  await lua.doString(`
    local api = new_fake(${spec})
    api.GetResourcePath = function() return "/reaper" end
    api.GetPlayState = function() return ${playState} end
    api.GetPlayPosition = function() return api.GetCursorPosition() end
    api.GetProjectPath = function() return "/reaper/projects" end
    api.get_ini_file = function() return "/reaper/reaper.ini" end -- absent: no web UI, no window
    api.time_precise = os.clock
    api.defer = function(fn) next_tick = fn end
    -- Any API the scenario doesn't care about (ExtState, console, atexit, ...) is a no-op.
    reaper = setmetatable(api, { __index = function() return function() end end })
    dofile("${SCRIPTS}mcp_bridge.lua")
  `);

  let seq = 0;
  return {
    async send(type, params = {}) {
      const id = `t${++seq}`;
      const command = JSON.stringify({ id, type, params });
      lua.global.set('CMD', command);
      const response: string | null = await lua.doString(`
        local f = assert(io.open("${BRIDGE_DIR}command_${id}.json", "w")); f:write(CMD); f:close()
        f = assert(io.open("${BRIDGE_DIR}_notify", "w")); f:write("${id}\\n"); f:close()
        next_tick()
        f = io.open("${BRIDGE_DIR}response_${id}.json", "r")
        if not f then return nil end
        local body = f:read("a"); f:close()
        return body
      `);
      expect(response, `bridge answered ${type}`).toBeTruthy();
      return JSON.parse(response as string) as BridgeResponse;
    },
  };
}

describe('mcp_bridge.lua over file IPC', () => {
  it('answers each command with a response carrying the same id', async () => {
    const bridge = await startBridge();
    const res = await bridge.send('get_project_info');
    expect(res).toMatchObject({ id: 't1', success: true });
  });

  it('rejects an unknown command type without crashing the loop', async () => {
    const bridge = await startBridge();
    const bad = await bridge.send('no_such_command');
    expect(bad.success).toBe(false);
    expect(bad.error).toMatch(/unknown command type/i);

    const next = await bridge.send('get_project_info');
    expect(next.success).toBe(true);
  });

  describe('time signature', () => {
    // 7/8 at 96 BPM: numerator, denominator and tempo are all distinct, so a
    // swapped or shifted value can't pass by coincidence (4/4 at 120 would hide it).
    const SEVEN_EIGHT = '{ project = { tempo = 96, num = 7, den = 8 } }';

    it('get_project_info reports the project time signature and tempo separately', async () => {
      const { data } = await (await startBridge(SEVEN_EIGHT)).send('get_project_info');
      expect(data).toMatchObject({ tempo: 96, timeSignatureNumerator: 7, timeSignatureDenominator: 8 });
    });

    it('get_transport_state reports the project time signature and tempo separately', async () => {
      const { data } = await (await startBridge(SEVEN_EIGHT)).send('get_transport_state');
      expect(data).toMatchObject({ tempo: 96, timeSignatureNumerator: 7, timeSignatureDenominator: 8 });
    });

    it('get_tempo_map falls back to the project time signature when there are no markers', async () => {
      const { data } = await (await startBridge(SEVEN_EIGHT)).send('get_tempo_map');
      expect(data?.markers).toEqual([expect.objectContaining({ bpm: 96, timeSigNumerator: 7, timeSigDenominator: 8 })]);
    });
  });

  it('get_project_info reports the session it is looking at', async () => {
    const bridge = await startBridge('{ tracks = { { name = "Kick" }, { name = "Snare" } }, cursor = 12.5 }');
    const { data } = await bridge.send('get_project_info');
    expect(data).toMatchObject({ trackCount: 2, cursorPosition: 12.5, sampleRate: 44100, isPlaying: false });
  });

  it.each([
    [0, { playing: false, paused: false, recording: false }],
    [1, { playing: true, paused: false, recording: false }],
    [2, { playing: false, paused: true, recording: false }],
    [5, { playing: true, paused: false, recording: true }],
  ])('get_transport_state decodes play state %i', async (playState, expected) => {
    const { data } = await (await startBridge('{}', playState)).send('get_transport_state');
    expect(data).toMatchObject(expected);
  });
});
