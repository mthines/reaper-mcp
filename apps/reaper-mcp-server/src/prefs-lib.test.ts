/**
 * Shared LoreKit tokens (reaper/mcp_prefs_lib.lua) in real Lua (wasmoon): driven through the ExtState keys the
 * page reads and writes (`lorekit_tokens`, `tokens_req`) and observed through the file in the config folder.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LuaFactory, type LuaEngine } from 'wasmoon';

const LIB = readFileSync(join(__dirname, '../../../reaper/mcp_prefs_lib.lua'), 'utf8');
const DIR = '/home/me/.config/reaper-mcp/';
const FILE = `${DIR}lorekit.json`;
const CONTROL = 'abc123';
const hex = (s: string) => Buffer.from(s, 'utf8').toString('hex');

let engine: LuaEngine | undefined;
afterEach(() => {
  engine?.global.close();
  engine = undefined;
});

async function start(file?: string, dir: string | null = DIR) {
  const factory = new LuaFactory();
  await factory.mountFile('/lib/mcp_prefs_lib.lua', LIB);
  await factory.mountFile(`${DIR}.keep`, '');
  if (file !== undefined) await factory.mountFile(FILE, file);
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
        local keys, out = {}, {}
        for k in pairs(t) do keys[#keys + 1] = k end
        table.sort(keys)
        for _, k in ipairs(keys) do
          local v = t[k]
          out[#out + 1] = string.format("%q:%s", k, type(v) == "string" and string.format("%q", v) or tostring(v))
        end
        return "{" .. table.concat(out, ",") .. "}"
      end,
      decode = function(text)
        local t = {}
        for k, v in text:gmatch('"([%w]+)":"([^"]*)"') do t[k] = v end
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
    async request(read: string, publish: string, token = CONTROL) {
      const req = `r${++id}`;
      lua.global.set('REQ', `${req}-${token}-${hex(read)}-${hex(publish)}`);
      await lua.doString('ext["MCPBridge/tokens_req"] = REQ; prefs.poll()');
      return req;
    },
    async file(): Promise<string | null> {
      return ((await lua.doString(`local f = io.open("${FILE}", "r"); if not f then return nil end; local c = f:read("a"); f:close(); return c`)) as string | null) ?? null;
    },
  };
}

describe('shared LoreKit tokens', () => {
  it('publishes the tokens already in the file when the bridge starts', async () => {
    const prefs = await start('{"publishToken":"lk_rw_pub","readToken":"lk_ro_read"}');
    await prefs.poll();
    expect(await prefs.published()).toMatchObject({ read: 'lk_ro_read', publish: 'lk_rw_pub', writable: true });
  });

  it('publishes nothing when there is no file yet', async () => {
    const prefs = await start();
    await prefs.poll();
    const p = await prefs.published();
    expect(p?.read).toBeUndefined();
    expect(p?.publish).toBeUndefined();
  });

  it('keeps the tokens a page sends in the file and answers with them', async () => {
    const prefs = await start();
    await prefs.poll();
    const id = await prefs.request('lk_ro_new', 'lk_rw_new');
    expect(await prefs.published()).toMatchObject({ req: id, ok: true, read: 'lk_ro_new', publish: 'lk_rw_new' });
    expect(await prefs.file()).toContain('lk_ro_new');
    expect(await prefs.file()).toContain('lk_rw_new');
  });

  it('removes a token when the page sends it empty, and keeps the other', async () => {
    const prefs = await start('{"publishToken":"lk_rw_pub","readToken":"lk_ro_read"}');
    await prefs.poll();
    await prefs.request('lk_ro_read', '');
    const p = await prefs.published();
    expect(p?.publish).toBeUndefined();
    expect(p?.read).toBe('lk_ro_read');
    expect(await prefs.file()).not.toContain('lk_rw_pub');
  });

  it('ignores a request without this run’s control token', async () => {
    const prefs = await start('{"readToken":"lk_ro_read"}');
    await prefs.poll();
    await prefs.request('lk_ro_evil', '', 'wrong');
    expect((await prefs.published())?.read).toBe('lk_ro_read');
    expect(await prefs.file()).toContain('lk_ro_read');
  });

  it('refuses a token with whitespace and changes nothing', async () => {
    const prefs = await start('{"readToken":"lk_ro_read"}');
    await prefs.poll();
    await prefs.request('lk_ro bad', '');
    expect(await prefs.published()).toMatchObject({ ok: false, read: 'lk_ro_read' });
  });

  it('says it cannot keep tokens when there is no home folder', async () => {
    const prefs = await start(undefined, null);
    await prefs.poll();
    expect((await prefs.published())?.writable).toBe(false);
    await prefs.request('lk_ro_x', '');
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

  it('uses %APPDATA% on Windows', async () => {
    expect(await dirOf({ APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, true)).toBe('C:/Users/me/AppData/Roaming/reaper-mcp/');
  });
});
