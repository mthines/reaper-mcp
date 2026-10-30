/**
 * Snapshots on the status page: mcp_bridge.lua + mcp_snapshots_ui_lib.lua run in real Lua (wasmoon)
 * against the fake ReaScript API, driven only through the ExtState keys the page reads and writes
 * (`snap_seen`, `snap_req`, `snapshots`) and observed through the project, the files and the status feed.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LuaFactory, type LuaEngine } from 'wasmoon';

const REAPER_DIR = join(__dirname, '../../../reaper');
const FAKE_SRC = readFileSync(join(__dirname, '__fixtures__/fake_reaper.lua'), 'utf8');
const SCRIPTS = '/reaper/Scripts/';
const SNAP_DIR = '/reaper/projects/.reaper-mcp/snapshots/';
const LIBS = [
  'mcp_plan_lib.lua', 'mcp_actions_lib.lua', 'mcp_tracks_lib.lua', 'mcp_project_lib.lua',
  'mcp_items_lib.lua', 'mcp_edit_views_lib.lua', 'mcp_snapshots_ui_lib.lua',
];

interface Listed { name: string; description: string; timestamp: number; trackCount?: number; scoped: boolean; fullChunk: boolean }
interface Published {
  v: number;
  storage: string;
  current?: string;
  snapshots: Listed[];
  result?: { id: string; op: string; name: string; ok: boolean; error?: string; tracksRestored?: number };
}
interface Entry { n: number; c: string; ok: boolean; e?: string; src?: string }

let engine: LuaEngine | undefined;
afterEach(() => {
  engine?.global.close();
  engine = undefined;
});

const hex = (s: string) => Buffer.from(s, 'utf8').toString('hex');

/** A snapshot as the bridge's snapshot_save wrote it before metadata-first saves: description after mixerState */
const LEGACY_SCOPED = JSON.stringify({
  timestamp: 1761800000000,
  name: 'mix-A',
  mixerState: { version: 2, scoped: true, fullChunk: true, tracks: [{ index: 0, name: 'Kick', chunkB64: Buffer.from('<TRACK\nNAME "Kick"\nVOLPAN 0.5 0\n>\n').toString('base64') }] },
  description: 'Wide chorus',
});

/** A whole-mixer, param-value snapshot that sets the Kick to 0.5 (linear) */
const PARAMS_B = JSON.stringify({
  name: 'mix-B',
  description: 'Quieter kick',
  timestamp: 1761800100000,
  mixerState: { version: 2, fullChunk: false, tracks: [{ index: 0, name: 'Kick', volume: 0.5, pan: 0, mute: false, solo: false, fx: [], sends: [] }] },
});

async function startBridge(files: Record<string, string> = {}) {
  const factory = new LuaFactory();
  await factory.mountFile(`${SCRIPTS}mcp_bridge.lua`, readFileSync(join(REAPER_DIR, 'mcp_bridge.lua'), 'utf8'));
  for (const lib of LIBS) await factory.mountFile(SCRIPTS + lib, readFileSync(join(REAPER_DIR, lib), 'utf8'));
  await factory.mountFile(`${SCRIPTS}mcp_bridge_data/.keep`, '');
  await factory.mountFile(`${SNAP_DIR}.keep`, '');
  for (const [name, content] of Object.entries(files)) await factory.mountFile(SNAP_DIR + name, content);
  const lua = await factory.createEngine();
  engine = lua;
  await lua.doString(FAKE_SRC);
  lua.global.set('SEEDED', Object.keys(files).map((n) => SNAP_DIR + n));
  await lua.doString(`
    local api = new_fake({ tracks = { { name = "Kick" } } })
    ext, clock = {}, 100
    -- Files the snapshot folder holds: seeded ones plus any the bridge writes (wasmoon has no directory listing)
    known = {}
    for _, p in ipairs(SEEDED) do known[p] = true end
    local real_open = io.open
    io.open = function(path, mode)
      local f, err = real_open(path, mode)
      if f and mode and mode:find("[wa]") then known[path] = true end
      return f, err
    end
    api.EnumerateFiles = function(dir, i)
      if dir ~= "${SNAP_DIR}" or i < 0 then return nil end
      local names = {}
      for path in pairs(known) do
        local f = real_open(path, "r")
        if f then f:close(); if path:sub(1, #dir) == dir then names[#names + 1] = path:sub(#dir + 1) end end
      end
      table.sort(names)
      return names[i + 1]
    end
    api.GetResourcePath = function() return "/reaper" end
    api.GetPlayState = function() return 0 end
    api.GetProjectPath = function() return "/reaper/projects" end
    api.get_ini_file = function() return "/reaper/reaper.ini" end
    api.time_precise = function() return clock end
    api.defer = function(fn) next_tick = fn end
    api.CF_GetSWSVersion = false
    api.GetExtState = function(s, k) return ext[s .. "/" .. k] or "" end
    api.SetExtState = function(s, k, v) ext[s .. "/" .. k] = v end
    api.DeleteExtState = function(s, k) ext[s .. "/" .. k] = nil end
    api.atexit = function(fn) on_exit = fn end
    reaper = setmetatable(api, { __index = function() return function() end end })
    reaper.SetMediaTrackInfo_Value(api.GetTrack(0, 0), "D_VOL", 1) -- unity
    dofile("${SCRIPTS}mcp_bridge.lua")
  `);

  let pings = 0;
  let reqs = 0;
  const tick = async (seconds = 0.05) => {
    await lua.doString(`clock = clock + ${seconds}; next_tick()`);
  };
  const ext = async (key: string): Promise<string | null> => (await lua.doString(`return ext["${key}"]`)) ?? null;
  const set = async (key: string, value: string | null) => {
    if (value === null) return void (await lua.doString(`ext["${key}"] = nil`));
    lua.global.set('V', value);
    await lua.doString(`ext["${key}"] = V`);
  };
  const status = async () => {
    await tick(1.1); // the heartbeat forces a status publish
    return JSON.parse((await ext('MCPBridge/status')) ?? '{}') as { recent: Entry[]; control: { token: string; snapshots?: boolean } };
  };
  return {
    tick,
    ext,
    set,
    status,
    /** An agent's command, through the command file the MCP server writes */
    async send(type: string, params: Record<string, unknown>) {
      const id = `a${++reqs}`;
      lua.global.set('CMD', JSON.stringify({ id, type, params }));
      await lua.doString(`
        local f = assert(io.open("${SCRIPTS}mcp_bridge_data/command_${id}.json", "w")); f:write(CMD); f:close()
        f = assert(io.open("${SCRIPTS}mcp_bridge_data/_notify", "w")); f:write("${id}\\n"); f:close()
      `);
      await tick();
    },
    /** The page has the Snapshots view open: it pings on every poll */
    async ping(seconds = 0.5) {
      await set('MCPBridge/snap_seen', String(++pings));
      await tick(seconds);
    },
    async published(): Promise<Published | null> {
      const raw = await ext('MCPBridge/snapshots');
      return raw ? (JSON.parse(raw) as Published) : null;
    },
    /** What the page sends for a restore or save */
    async request(op: string, name: string, description = '', token?: string) {
      const t = token ?? (await status()).control.token;
      const id = String(++reqs);
      await set('MCPBridge/snap_req', `${id}-${t}-${op}-${hex(name)}${description ? `-${hex(description)}` : ''}`);
      await tick();
      return id;
    },
    async kickVolume(): Promise<number> {
      return (await lua.doString('return reaper.GetMediaTrackInfo_Value(reaper.GetTrack(0, 0), "D_VOL")')) as number;
    },
    async undo(): Promise<string[]> {
      return (await lua.doString('return table.concat(reaper.undo, "|")')).split('|').filter(Boolean);
    },
    async file(name: string): Promise<string | null> {
      return (await lua.doString(`local f = io.open("${SNAP_DIR}${name}", "r"); if not f then return nil end; local b = f:read("a"); f:close(); return b`)) ?? null;
    },
  };
}

describe('snapshot list for the status page', () => {
  it('lists each snapshot once the page asks, reading description and track count after mixerState too', async () => {
    const bridge = await startBridge({ 'mix-A.json': LEGACY_SCOPED, 'mix-B.json': PARAMS_B });
    await bridge.tick();
    expect(await bridge.published()).toBeNull(); // nothing published until the page opens the view
    expect((await bridge.status()).control.snapshots).toBe(true);

    await bridge.ping();
    const list = await bridge.published();
    expect(list).toMatchObject({ v: 1, storage: 'project' });
    expect(list?.snapshots).toEqual([
      { name: 'mix-B', description: 'Quieter kick', timestamp: 1761800100000, trackCount: 1, scoped: false, fullChunk: false },
      { name: 'mix-A', description: 'Wide chorus', timestamp: 1761800000000, trackCount: 1, scoped: true, fullChunk: true },
    ]);
  });

  it('is not republished while nothing changed, and is when the folder changes', async () => {
    const bridge = await startBridge({ 'mix-A.json': LEGACY_SCOPED });
    await bridge.ping();
    expect((await bridge.published())?.snapshots).toHaveLength(1);

    await bridge.set('MCPBridge/snapshots', null);
    await bridge.ping(2);
    await bridge.ping(2);
    expect(await bridge.published()).toBeNull();

    // Another tool (an agent, the quick-save action) adds a file while the page watches
    await engine?.doString(`local f = io.open("${SNAP_DIR}mix-B.json", "w"); f:write(${JSON.stringify(PARAMS_B)}); f:close()`);
    await bridge.ping(2);
    expect((await bridge.published())?.snapshots.map((s) => s.name)).toEqual(['mix-B', 'mix-A']);
  });
});

describe('snapshot list after an agent saves', () => {
  it('shows an agent re-saving a snapshot even when the new file is the same size', async () => {
    const bridge = await startBridge();
    await bridge.ping();
    await bridge.send('snapshot_save', { name: 'mix-C', description: 'aaaa' });
    await bridge.ping(2);
    expect((await bridge.published())?.snapshots.map((s) => s.description)).toEqual(['aaaa']);

    await bridge.send('snapshot_save', { name: 'mix-C', description: 'bbbb' });
    await bridge.ping(2);
    expect((await bridge.published())?.snapshots.map((s) => s.description)).toEqual(['bbbb']);
  });
});

describe('snapshot restore from the status page', () => {
  it('restores through the command path: logged as from the page, one undo point, marked current', async () => {
    const bridge = await startBridge({ 'mix-B.json': PARAMS_B });
    expect(await bridge.kickVolume()).toBe(1);
    const id = await bridge.request('restore', 'mix-B');

    expect(await bridge.kickVolume()).toBe(0.5);
    expect(await bridge.undo()).toEqual(["MCP: Restore snapshot 'mix-B'"]);
    const published = await bridge.published();
    expect(published?.result).toMatchObject({ id, op: 'restore', name: 'mix-B', ok: true, tracksRestored: 1 });
    expect(published?.current).toBe('mix-B');
    const { recent } = await bridge.status();
    expect(recent[0]).toMatchObject({ c: 'snapshot_restore', ok: true, src: 'page' });
  });

  it('does nothing for a request without the per-run token', async () => {
    const bridge = await startBridge({ 'mix-B.json': PARAMS_B });
    await bridge.request('restore', 'mix-B', '', 'deadbeef');
    expect(await bridge.kickVolume()).toBe(1);
    expect(await bridge.undo()).toEqual([]);
    expect((await bridge.status()).recent).toEqual([]);
    expect(await bridge.ext('MCPBridge/snap_req')).toBeNull(); // consumed, not retried
  });

  it('reports a snapshot that is not there', async () => {
    const bridge = await startBridge();
    await bridge.request('restore', 'mix-Z');
    expect((await bridge.published())?.result).toMatchObject({ ok: false, error: 'Snapshot not found: mix-Z' });
  });
});

describe('snapshot save from the status page', () => {
  it('saves name and description with the metadata ahead of mixerState, and lists it', async () => {
    const bridge = await startBridge();
    const description = 'Más brillo; 2/3 & "wide"';
    const id = await bridge.request('save', 'mix-C', description);

    const content = (await bridge.file('mix-C.json')) ?? '';
    expect(JSON.parse(content)).toMatchObject({ name: 'mix-C', description, trackCount: 1 });
    expect(content.indexOf('"description"')).toBeLessThan(content.indexOf('"mixerState"'));
    expect(content.indexOf('"trackCount"')).toBeLessThan(content.indexOf('"mixerState"'));

    const published = await bridge.published();
    expect(published?.result).toMatchObject({ id, op: 'save', name: 'mix-C', ok: true });
    expect(published?.snapshots).toEqual([expect.objectContaining({ name: 'mix-C', description, trackCount: 1, scoped: false })]);
    expect((await bridge.status()).recent[0]).toMatchObject({ c: 'snapshot_save', ok: true, src: 'page' });
  });
});

describe('snapshot requests refused by the page settings', () => {
  it.each([
    ['read-only', 'cfg_readonly', /Read-only mode is on/],
    ['paused', 'cfg_paused', /Paused by user/],
  ])('refuses restore and save while %s, changing nothing', async (_label, key, error) => {
    const bridge = await startBridge({ 'mix-B.json': PARAMS_B });
    const token = (await bridge.status()).control.token;
    await bridge.set(`MCPBridge/${key}`, '1');

    await bridge.request('restore', 'mix-B', '', token);
    expect(await bridge.kickVolume()).toBe(1);
    expect((await bridge.published())?.result).toMatchObject({ op: 'restore', ok: false, error: expect.stringMatching(error) });

    await bridge.request('save', 'mix-C', '', token);
    expect(await bridge.file('mix-C.json')).toBeNull();
    expect((await bridge.published())?.result).toMatchObject({ op: 'save', ok: false, error: expect.stringMatching(error) });
    expect(await bridge.undo()).toEqual([]);
  });
});
