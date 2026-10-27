/**
 * The status feed and page settings of mcp_bridge.lua, run in real Lua (wasmoon) against the fake
 * ReaScript API with an in-memory ExtState — the channel the web status page reads and writes.
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

interface Entry { c: string; ok: boolean; s?: string; p?: string; e?: string }
interface Session { id: string; dir?: string; client?: string; commands: number; errors: number; ended?: boolean }
interface Status {
  commands: number;
  recent: Entry[];
  sessions: Session[];
  settings: { paused: boolean; readonly: boolean; openOnStart: boolean };
  health: { sws: boolean; jsfx: boolean; outdated: boolean };
}

let engine: LuaEngine | undefined;
afterEach(() => {
  engine?.global.close();
  engine = undefined;
});

async function startBridge() {
  const factory = new LuaFactory();
  await factory.mountFile(`${SCRIPTS}mcp_bridge.lua`, readFileSync(join(REAPER_DIR, 'mcp_bridge.lua'), 'utf8'));
  for (const lib of LIBS) await factory.mountFile(SCRIPTS + lib, readFileSync(join(REAPER_DIR, lib), 'utf8'));
  await factory.mountFile(`${BRIDGE_DIR}.keep`, '');
  const lua = await factory.createEngine();
  engine = lua;
  await lua.doString(FAKE_SRC);
  await lua.doString(`
    local api = new_fake({ tracks = { { name = "Kick" } } })
    ext = {}
    api.GetResourcePath = function() return "/reaper" end
    api.GetPlayState = function() return 0 end
    api.GetProjectPath = function() return "/reaper/projects" end
    api.get_ini_file = function() return "/reaper/reaper.ini" end
    api.time_precise = os.clock
    api.defer = function(fn) next_tick = fn end
    api.CF_GetSWSVersion = false -- no SWS installed
    api.GetExtState = function(s, k) return ext[s .. "/" .. k] or "" end
    api.SetExtState = function(s, k, v) ext[s .. "/" .. k] = v end
    reaper = setmetatable(api, { __index = function() return function() end end })
    dofile("${SCRIPTS}mcp_bridge.lua")
  `);

  let seq = 0;
  const tick = () => lua.doString('next_tick()');
  return {
    async send(type: string, params: Record<string, unknown> = {}, session?: Record<string, string>) {
      const id = `t${++seq}`;
      lua.global.set('CMD', JSON.stringify({ id, type, params, ...session }));
      const body: string = await lua.doString(`
        local f = assert(io.open("${BRIDGE_DIR}command_${id}.json", "w")); f:write(CMD); f:close()
        f = assert(io.open("${BRIDGE_DIR}_notify", "w")); f:write("${id}\\n"); f:close()
        next_tick()
        f = assert(io.open("${BRIDGE_DIR}response_${id}.json", "r"))
        local body = f:read("a"); f:close()
        return body
      `);
      return JSON.parse(body) as { success: boolean; error?: string };
    },
    async set(key: string, value: string) {
      lua.global.set('V', value);
      await lua.doString(`ext["MCPBridge/${key}"] = V`);
    },
    async status(): Promise<Status> {
      // Publishing is throttled to 5/s; wait it out so the next tick publishes
      await new Promise((r) => setTimeout(r, 250));
      await tick();
      return JSON.parse(await lua.doString('return ext["MCPBridge/status"]')) as Status;
    },
  };
}

const A = { sessionId: 'sess-a', sessionDir: '/work/song-a', sessionClient: 'claude-code' };
const B = { sessionId: 'sess-b', sessionDir: '/work/song-b' };

describe('bridge status feed', () => {
  it('groups commands by the session that sent them', async () => {
    const bridge = await startBridge();
    await bridge.send('get_project_info', {}, A);
    await bridge.send('list_tracks', {}, A);
    await bridge.send('no_such_command', {}, B);

    const { sessions, recent } = await bridge.status();
    expect(sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sess-a', dir: '/work/song-a', client: 'claude-code', commands: 2, errors: 0 }),
      expect.objectContaining({ id: 'sess-b', commands: 1, errors: 1 }),
    ]));
    expect(recent.map((e) => e.s)).toEqual(['sess-b', 'sess-a', 'sess-a']);
  });

  it('keeps an idle session alive from its ping and marks it ended on goodbye', async () => {
    const bridge = await startBridge();
    await bridge.send('_session', {}, A);
    const first = await bridge.status();
    expect(first.commands).toBe(0); // pings aren't logged as commands
    expect(first.sessions).toEqual([expect.objectContaining({ id: 'sess-a', commands: 0 })]);

    await bridge.send('_session', { ended: 1 }, A);
    const { sessions } = await bridge.status();
    expect(sessions[0].ended).toBe(true);
  });

  it('captures request params for the details drawer', async () => {
    const bridge = await startBridge();
    await bridge.send('get_track_properties', { trackIndex: 0 }, A);
    const { recent } = await bridge.status();
    expect(JSON.parse(recent[0].p as string)).toEqual({ trackIndex: 0 });
  });
});

describe('bridge settings from the status page', () => {
  it('pause rejects agent commands but still answers internal ones', async () => {
    const bridge = await startBridge();
    await bridge.set('cfg_paused', '1');
    const res = await bridge.send('get_project_info', {}, A);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/paused by user/i);
    expect((await bridge.send('_session', {}, A)).success).toBe(true);

    await bridge.set('cfg_paused', '0');
    expect((await bridge.send('get_project_info', {}, A)).success).toBe(true);
  });

  it('read-only mode allows inspection and blocks edits', async () => {
    const bridge = await startBridge();
    await bridge.set('cfg_readonly', '1');
    expect((await bridge.send('list_tracks')).success).toBe(true);
    const edit = await bridge.send('set_track_property', { trackIndex: 0, property: 'mute', value: 1 });
    expect(edit.success).toBe(false);
    expect(edit.error).toMatch(/read-only mode/i);

    const { settings } = await bridge.status();
    expect(settings).toMatchObject({ readonly: true, paused: false });
  });

  it('reports setup health', async () => {
    const { health } = await (await startBridge()).status();
    // The fake has no SWS and no Effects/reaper-mcp/ JSFX
    expect(health).toMatchObject({ sws: false, jsfx: false, outdated: false });
  });
});
