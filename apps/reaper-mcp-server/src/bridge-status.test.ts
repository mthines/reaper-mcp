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

interface Entry { n: number; t: number; c: string; ok: boolean; s?: string; p?: string; e?: string }
type Row = [number, number, number, number, number];
interface History { v: number; size: number; b: Row[] }
interface LongHistory { v: number; tiers: Array<{ size: number; b: Row[] }> }
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

/** Files left in the bridge folder by an earlier run, keyed by name (the restart tests). */
async function startBridge(setup = '', files: Record<string, string> = {}) {
  const factory = new LuaFactory();
  await factory.mountFile(`${SCRIPTS}mcp_bridge.lua`, readFileSync(join(REAPER_DIR, 'mcp_bridge.lua'), 'utf8'));
  for (const lib of LIBS) await factory.mountFile(SCRIPTS + lib, readFileSync(join(REAPER_DIR, lib), 'utf8'));
  await factory.mountFile(`${BRIDGE_DIR}.keep`, '');
  for (const [name, content] of Object.entries(files)) await factory.mountFile(BRIDGE_DIR + name, content);
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
    api.DeleteExtState = function(s, k) ext[s .. "/" .. k] = nil end
    api.atexit = function(fn) on_exit = fn end
    ${setup}
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
    async ext(key: string): Promise<string | null> {
      return (await lua.doString(`return ext["MCPBridge/${key}"]`)) ?? null;
    },
    /** REAPER quits (or the script stops): runs the bridge's atexit handler. */
    async exit() {
      await lua.doString('on_exit()');
    },
    async file(name: string): Promise<string | null> {
      return (await lua.doString(`
        local f = io.open("${BRIDGE_DIR}${name}", "r")
        if not f then return nil end
        local body = f:read("a"); f:close()
        return body
      `)) ?? null;
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

// REAPER's EnumInstalledFX(i) -> ok, name, ident; false past the end
const INSTALLED = `
  local installed = { { "VST3: Pro-Q 3 (FabFilter)", "Pro-Q 3.vst3" }, { "JS: Dynamics/1175_compressor", "Dynamics/1175_compressor" }, { "AU: Helix Native (Line 6)", "" }, { "JS: 3o.gfxlib.jsfx-inc", "3o.gfxlib.jsfx-inc" }, { "VST3i: Kontakt 7 (Native Instruments) (64 out)", "" } }
  api.EnumInstalledFX = function(i)
    local fx = installed[i + 1]
    if not fx then return false end
    return true, fx[1], fx[2]
  end
`;

describe('installed FX', () => {
  it('lists what REAPER has installed, not the FX browser folders', async () => {
    const bridge = await startBridge(INSTALLED);
    const res = (await bridge.send('list_available_fx')) as { success: boolean; data?: { fxList: Array<{ name: string; type: string; path: string }>; total: number; source: string } };
    expect(res.data).toMatchObject({ total: 4, source: 'reaper' });
    expect(res.data?.fxList[0]).toEqual({ name: 'VST3: Pro-Q 3 (FabFilter)', type: 'VST3', path: 'Pro-Q 3.vst3' });

    const au = (await bridge.send('list_available_fx', { category: 'au' })) as { data?: { fxList: Array<{ name: string }> } };
    expect(au.data?.fxList.map((f) => f.name)).toEqual(['AU: Helix Native (Line 6)']);
  });

  it('says so when this REAPER cannot enumerate FX', async () => {
    const bridge = await startBridge('api.EnumInstalledFX = false');
    const res = (await bridge.send('list_available_fx')) as { data?: { total: number; source: string; warning?: string } };
    expect(res.data).toMatchObject({ total: 0, source: 'none' });
    expect(res.data?.warning).toMatch(/6\.37/);
  });

  it('publishes the installed list for the status page', async () => {
    const bridge = await startBridge(INSTALLED);
    await bridge.status();
    const feed = JSON.parse((await bridge.ext('installed')) as string);
    expect(feed).toEqual({
      v: 1,
      supported: true,
      fx: [
        { n: 'VST3: Pro-Q 3 (FabFilter)', t: 'VST3' },
        { n: 'JS: Dynamics/1175_compressor', t: 'JS' },
        { n: 'AU: Helix Native (Line 6)', t: 'AU' },
        { n: 'VST3i: Kontakt 7 (Native Instruments) (64 out)', t: 'VST3' },
      ],
    });
  });
});

describe('FX used in the project', () => {
  it('counts each plugin across the project, by its own name', async () => {
    const bridge = await startBridge(`
      api.tracks[1].fx = { { name = "VST3: Pro-Q 3 (FabFilter)" }, { name = "ReaComp" }, { name = "VST3: Pro-Q 3 (FabFilter)" } }
      -- a renamed instance still counts under the plugin's own name
      api.TrackFX_GetNamedConfigParm = function(tr, i, key)
        if key == "fx_name" and tr.fx[i + 1].name == "ReaComp" then return true, "VST: ReaComp (Cockos)" end
        return false, ""
      end
    `);
    await bridge.status();
    expect(JSON.parse((await bridge.ext('used')) as string)).toEqual({
      v: 1,
      fx: [
        { n: 'VST3: Pro-Q 3 (FabFilter)', c: 2 },
        { n: 'VST: ReaComp (Cockos)', c: 1 },
      ],
    });
  });
});

describe('persistent history', () => {
  const json = async <T,>(bridge: Awaited<ReturnType<typeof startBridge>>, key: string) =>
    JSON.parse((await bridge.ext(key)) as string) as T;
  const total = (rows: Row[]) => rows.reduce((sum, r) => sum + r[1], 0);

  it('survives a bridge restart', async () => {
    const first = await startBridge();
    await first.send('get_project_info', {}, A);
    await first.send('list_tracks', {}, A);
    await first.send('no_such_command', {}, A);
    await first.exit();
    const files = {
      'history_log.jsonl': (await first.file('history_log.jsonl')) as string,
      'history.json': (await first.file('history.json')) as string,
    };
    engine?.global.close();
    engine = undefined;

    const second = await startBridge('', files);
    const { recent } = await second.status();
    expect(recent.map((e) => [e.n, e.c, e.ok])).toEqual([
      [3, 'no_such_command', false],
      [2, 'list_tracks', true],
      [1, 'get_project_info', true],
    ]);
    // The saved log is published when the page asks for it, echoing the request
    await second.set('log_want', '111');
    await second.status();
    const log = await json<{ req: string; entries: Entry[] }>(second, 'log');
    expect(log.req).toBe('111');
    expect(log.entries.map((e) => e.n)).toEqual([3, 2, 1]);
    expect(total((await json<History>(second, 'history')).b)).toBe(3);
    const long = await json<LongHistory>(second, 'history_long');
    expect(long.tiers.map((t) => [t.size, total(t.b)])).toEqual([[60000, 3], [600000, 3]]);

    // Numbering continues, so the page can tell new entries from the saved ones
    await second.send('list_tracks', {}, A);
    expect((await second.status()).recent[0].n).toBe(4);
  });

  it('drops persisted history past retention and caps the saved log', async () => {
    const now = Date.now();
    const day = 24 * 3600 * 1000;
    const old = { n: 1, t: now - 8 * day, c: 'list_tracks', ms: 1, ok: true };
    const lines = [old, ...Array.from({ length: 1200 }, (_, i) => ({ n: i + 2, t: now - 60_000 + i, c: 'list_tracks', ms: 1, ok: true }))];
    const bucket = (size: number, t: number): Row => [Math.floor(t / size), 5, 0, 0, 10];
    const history = {
      v: 1,
      tiers: [
        { size: 10000, b: [bucket(10000, now - 2 * 3600 * 1000), bucket(10000, now - 60_000)] },
        { size: 60000, b: [bucket(60000, now - 2 * day), bucket(60000, now - 60_000)] },
        { size: 600000, b: [bucket(600000, now - 8 * day), bucket(600000, now - 6 * day)] },
      ],
    };
    const bridge = await startBridge('', {
      'history_log.jsonl': lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
      'history.json': JSON.stringify(history),
    });
    await bridge.set('log_want', '1');
    await bridge.status();

    const log = await json<{ entries: Entry[] }>(bridge, 'log');
    expect(log.entries).toHaveLength(1000);
    expect(log.entries[0].n).toBe(1201);
    expect(log.entries.every((e) => e.t > now - 7 * day)).toBe(true);
    // The file is compacted to what is kept
    expect(((await bridge.file('history_log.jsonl')) as string).trim().split('\n')).toHaveLength(1000);

    expect(total((await json<History>(bridge, 'history')).b)).toBe(5);
    const long = await json<LongHistory>(bridge, 'history_long');
    expect(long.tiers.map((t) => [t.size, total(t.b)])).toEqual([[60000, 5], [600000, 5]]);
  });

  it('keeps numbering after a week without REAPER, when the saved log has expired', async () => {
    const old = { n: 800, t: Date.now() - 8 * 24 * 3600 * 1000, c: 'list_tracks', ms: 1, ok: true };
    const bridge = await startBridge('', {
      'history_log.jsonl': JSON.stringify(old) + '\n',
      'history.json': JSON.stringify({ v: 1, seq: 800, tiers: [] }),
    });
    await bridge.send('list_tracks', {}, A);
    expect((await bridge.status()).recent.map((e) => e.n)).toEqual([801]);
  });

  it('publishes the saved log only when asked', async () => {
    const bridge = await startBridge();
    await bridge.send('list_tracks', {}, A);
    await bridge.status();
    expect(await bridge.ext('log')).toBeNull();
  });
});
