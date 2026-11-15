/**
 * The shared read-only LoreKit token (reaper/mcp_prefs_lib.lua) in real Lua (wasmoon): driven through the ExtState keys the
 * page reads and writes (`lorekit_tokens`, `tokens_req`) and observed through the file in the config folder.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultFlagsDir } from './flags.js';
import { LuaFactory, type LuaEngine } from 'wasmoon';

const LIB = readFileSync(join(__dirname, '../../../reaper/mcp_prefs_lib.lua'), 'utf8');
const DIR = '/home/me/.config/reaper-mcp/';
const FILE = `${DIR}lorekit.json`;
const FLAGS_FILE = `${DIR}flags.json`;
const CONTROL = 'abc123';
const hex = (s: string) => Buffer.from(s, 'utf8').toString('hex');

let engine: LuaEngine | undefined;
afterEach(() => {
  engine?.global.close();
  engine = undefined;
});

async function start(file?: string, dir: string | null = DIR, flagsFile?: string) {
  const factory = new LuaFactory();
  await factory.mountFile('/lib/mcp_prefs_lib.lua', LIB);
  await factory.mountFile(`${DIR}.keep`, '');
  if (file !== undefined) await factory.mountFile(FILE, file);
  if (flagsFile !== undefined) await factory.mountFile(FLAGS_FILE, flagsFile);
  const lua = await factory.createEngine();
  engine = lua;
  await lua.doString(`
    ext = {}
    local api = {
      GetExtState = function(s, k) return ext[s .. "/" .. k] or "" end,
      SetExtState = function(s, k, v) ext[s .. "/" .. k] = v end,
      DeleteExtState = function(s, k) ext[s .. "/" .. k] = nil end,
      RecursiveCreateDirectory = function() return 1 end,
    }
    prefs = dofile("/lib/mcp_prefs_lib.lua")
    prefs.init({
      api = api, section = "MCPBridge", dir = ${dir === null ? 'nil' : `"${dir}"`},
      encode = function(t)
        local function enc(v)
          if type(v) == "string" then return string.format("%q", v) end
          if type(v) ~= "table" then return tostring(v) end
          local keys, out = {}, {}
          for k in pairs(v) do keys[#keys + 1] = k end
          table.sort(keys)
          for _, k in ipairs(keys) do out[#out + 1] = string.format("%q:%s", k, enc(v[k])) end
          return "{" .. table.concat(out, ",") .. "}"
        end
        return enc(t)
      end,
      decode = function(text)
        if not text:match("^%s*{") then error("not json") end
        local t = {}
        for k, v in text:gmatch('"([^"]+)":"([^"]*)"') do t[k] = v end
        return t
      end,
      read_file = function(path) local f = io.open(path, "r"); if not f then return nil end; local c = f:read("a"); f:close(); return c end,
      token = function() return "${CONTROL}" end,
    })
  `);
  let id = 0;
  const read = async (key: string) => ((await lua.doString(`return ext["${key}"]`)) as string | null) ?? null;
  return {
    poll: () => lua.doString('prefs.poll()'),
    async published() {
      const raw = await read('MCPBridge/lorekit_tokens');
      return raw ? (JSON.parse(raw) as { read?: string; publish?: string; req?: string; ok?: boolean; error?: string; writable: boolean }) : null;
    },
    async request(read: string, token = CONTROL) {
      const req = `r${++id}`;
      lua.global.set('REQ', `${req}-${token}-${hex(read)}`);
      await lua.doString('ext["MCPBridge/tokens_req"] = REQ; prefs.poll()');
      return req;
    },
    async flagsPublished() {
      const raw = await read('MCPBridge/flag_overrides');
      return raw ? (JSON.parse(raw) as { overrides?: Record<string, string>; req?: string; ok?: boolean; error?: string; writable: boolean }) : null;
    },
    async requestFlags(overrides: unknown, token = CONTROL) {
      const req = `f${++id}`;
      lua.global.set('FREQ', `${req}-${token}-${hex(typeof overrides === 'string' ? overrides : JSON.stringify(overrides))}`);
      await lua.doString('ext["MCPBridge/flags_req"] = FREQ; prefs.poll()');
      return req;
    },
    async flagsFile(): Promise<string | null> {
      return ((await lua.doString(`local f = io.open("${FLAGS_FILE}", "r"); if not f then return nil end; local c = f:read("a"); f:close(); return c`)) as string | null) ?? null;
    },
    /** What the CLI does: write flags.json behind the bridge's back */
    async writeFlagsFile(text: string) {
      lua.global.set('FTEXT', text);
      await lua.doString(`local f = io.open("${FLAGS_FILE}", "w"); f:write(FTEXT); f:close()`);
    },
    /** About two seconds of the defer loop */
    async idle(ticks = 60) {
      await lua.doString(`for _ = 1, ${ticks} do prefs.poll() end`);
    },
    async file(): Promise<string | null> {
      return ((await lua.doString(`local f = io.open("${FILE}", "r"); if not f then return nil end; local c = f:read("a"); f:close(); return c`)) as string | null) ?? null;
    },
  };
}

describe('shared read-only LoreKit token', () => {
  it('publishes the token already in the file when the bridge starts', async () => {
    const prefs = await start('{"readToken":"lk_ro_read"}');
    await prefs.poll();
    expect(await prefs.published()).toMatchObject({ read: 'lk_ro_read', writable: true });
  });

  it('publishes nothing when there is no file yet', async () => {
    const prefs = await start();
    await prefs.poll();
    expect((await prefs.published())?.read).toBeUndefined();
  });

  it('keeps the token a page sends in the file and answers with it', async () => {
    const prefs = await start();
    await prefs.poll();
    const id = await prefs.request('lk_ro_new');
    expect(await prefs.published()).toMatchObject({ req: id, ok: true, read: 'lk_ro_new' });
    expect(await prefs.file()).toContain('lk_ro_new');
  });

  it('removes the token when the page sends it empty', async () => {
    const prefs = await start('{"readToken":"lk_ro_read"}');
    await prefs.poll();
    await prefs.request('');
    expect((await prefs.published())?.read).toBeUndefined();
    expect(await prefs.file()).not.toContain('lk_ro_read');
  });

  it('refuses a write token and never lets it reach the file or the web interface', async () => {
    const prefs = await start('{"readToken":"lk_ro_read"}');
    await prefs.poll();
    await prefs.request('lk_rw_secret');
    const p = await prefs.published();
    expect(p).toMatchObject({ ok: false, read: 'lk_ro_read' });
    expect(JSON.stringify(p)).not.toContain('lk_rw_secret');
    expect(await prefs.file()).not.toContain('lk_rw_secret');
  });

  it('takes a write token an earlier version kept out of the file, and never publishes it', async () => {
    const prefs = await start('{"publishToken":"lk_rw_old","readToken":"lk_ro_read"}');
    await prefs.poll();
    const p = await prefs.published();
    expect(p?.read).toBe('lk_ro_read');
    expect(JSON.stringify(p)).not.toContain('lk_rw_old');
    expect(await prefs.file()).not.toContain('lk_rw_old');
    expect(await prefs.file()).toContain('lk_ro_read');
  });

  it('ignores a request without this run’s control token', async () => {
    const prefs = await start('{"readToken":"lk_ro_read"}');
    await prefs.poll();
    await prefs.request('lk_ro_evil', 'wrong');
    expect((await prefs.published())?.read).toBe('lk_ro_read');
    expect(await prefs.file()).toContain('lk_ro_read');
  });

  it('says it cannot keep the token when there is no home folder', async () => {
    const prefs = await start(undefined, null);
    await prefs.poll();
    expect((await prefs.published())?.writable).toBe(false);
    await prefs.request('lk_ro_x');
    expect(await prefs.published()).toMatchObject({ ok: false });
  });
});

describe('where the config folder is', () => {
  const dirOf = async (env: Record<string, string>, windows = false) => {
    const factory = new LuaFactory();
    await factory.mountFile('/lib/mcp_prefs_lib.lua', LIB);
    const lua = await factory.createEngine();
    engine = lua;
    lua.global.set('ENV', env);
    lua.global.set('WIN', windows);
    return (await lua.doString('return dofile("/lib/mcp_prefs_lib.lua").default_dir(function(k) return ENV[k] end, WIN)')) as string | null;
  };

  it('follows XDG_CONFIG_HOME, else ~/.config', async () => {
    expect(await dirOf({ XDG_CONFIG_HOME: '/x', HOME: '/home/me' })).toBe('/x/reaper-mcp/');
    expect(await dirOf({ HOME: '/home/me' })).toBe('/home/me/.config/reaper-mcp/');
    expect(await dirOf({})).toBeNull();
  });

  it('is the folder the reaper-mcp CLI reads flags.json from', async () => {
    const cases: [Record<string, string>, boolean][] = [
      [{ XDG_CONFIG_HOME: '/x', HOME: '/home/me' }, false],
      [{ XDG_CONFIG_HOME: '/x', APPDATA: '/appdata', HOME: '/home/me' }, true],
      [{ APPDATA: '/appdata' }, true],
    ];
    for (const [env, windows] of cases) {
      const fromLua = (await dirOf(env, windows))!.replace(/\/$/, '');
      expect(fromLua).toBe(defaultFlagsDir(env, windows ? 'win32' : 'darwin').replace(/\\/g, '/'));
    }
  });

  it('uses %APPDATA% on Windows', async () => {
    expect(await dirOf({ APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, true)).toBe('C:/Users/me/AppData/Roaming/reaper-mcp/');
  });
});


describe('shared feature-flag overrides', () => {
  it('publishes the overrides already in flags.json when the bridge starts', async () => {
    const prefs = await start(undefined, DIR, '{"new-panel":"on"}');
    await prefs.poll();
    expect(await prefs.flagsPublished()).toMatchObject({ overrides: { 'new-panel': 'on' }, writable: true });
  });

  it('publishes no overrides when there is no file', async () => {
    const prefs = await start();
    await prefs.poll();
    expect((await prefs.flagsPublished())?.overrides).toBeUndefined();
  });

  it('keeps the overrides a page sends in flags.json and answers with them', async () => {
    const prefs = await start();
    await prefs.poll();
    const id = await prefs.requestFlags({ 'new-panel': 'on', 'other-flag': 'b' });
    expect(await prefs.flagsPublished()).toMatchObject({ req: id, ok: true, overrides: { 'new-panel': 'on', 'other-flag': 'b' } });
    expect(await prefs.flagsFile()).toContain('"new-panel":"on"');
  });

  it('empties flags.json when the page sends no overrides', async () => {
    const prefs = await start(undefined, DIR, '{"new-panel":"on"}');
    await prefs.poll();
    await prefs.requestFlags({});
    const p = await prefs.flagsPublished();
    expect(p).toMatchObject({ ok: true });
    expect(p?.overrides).toBeUndefined();
    expect((await prefs.flagsFile())?.trim()).toBe('{}');
  });

  it('picks up an override the CLI wrote to the file, within a couple of seconds', async () => {
    const prefs = await start();
    await prefs.poll();
    await prefs.writeFlagsFile('{"new-panel":"on"}');
    await prefs.idle(10);
    expect((await prefs.flagsPublished())?.overrides).toBeUndefined();
    await prefs.idle(60);
    expect((await prefs.flagsPublished())?.overrides).toEqual({ 'new-panel': 'on' });
  });

  it('refuses a map that is not flag keys to plain variants, and leaves the file alone', async () => {
    const prefs = await start(undefined, DIR, '{"new-panel":"on"}');
    await prefs.poll();
    for (const bad of ['{"Bad Key":"on"}', '{"new-panel":""}', '{"x":"a\u0001b"}', 'not json', '']) {
      await prefs.requestFlags(bad);
      expect(await prefs.flagsPublished()).toMatchObject({ ok: false, overrides: { 'new-panel': 'on' } });
    }
    expect(await prefs.flagsFile()).toContain('new-panel');
  });

  it('ignores a request without this run’s control token', async () => {
    const prefs = await start(undefined, DIR, '{"new-panel":"on"}');
    await prefs.poll();
    await prefs.requestFlags({ evil: 'on' }, 'wrong');
    expect((await prefs.flagsPublished())?.overrides).toEqual({ 'new-panel': 'on' });
  });

  it('says it cannot keep overrides when there is no home folder', async () => {
    const prefs = await start(undefined, null);
    await prefs.poll();
    expect((await prefs.flagsPublished())?.writable).toBe(false);
    await prefs.requestFlags({ 'new-panel': 'on' });
    expect(await prefs.flagsPublished()).toMatchObject({ ok: false });
  });
});
