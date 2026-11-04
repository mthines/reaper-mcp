import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const h = vi.hoisted(() => ({ bridgeDir: '', sendCommand: vi.fn() }));
vi.mock('./bridge.js', () => ({
  sendCommand: h.sendCommand,
  ensureBridgeDir: async () => h.bridgeDir,
}));

import { checkExtensions, discoverExtensions, loadExtensions } from './extensions.js';
import { TOOL_CATEGORIES } from './tools/categories.js';

type Registered = { handler: (args: Record<string, unknown>, extra: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }> };
const registered = (s: McpServer) => (s as unknown as { _registeredTools: Record<string, Registered> })._registeredTools;
const callTool = (s: McpServer, name: string, args: Record<string, unknown> = {}) => registered(s)[name].handler(args, {});

let root: string;

/** Install an extension folder: a manifest plus an ES module as its main file. */
async function install(name: string, mainSource: string, manifest: Record<string, unknown> = {}, files: Record<string, string> = {}) {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'reaper-mcp-extension.json'),
    JSON.stringify({ name, version: '1.0.0', apiVersion: 1, main: 'index.mjs', ...manifest }),
  );
  await writeFile(join(dir, 'index.mjs'), mainSource);
  for (const [f, body] of Object.entries(files)) await writeFile(join(dir, f), body);
  return dir;
}

const ECHO = `export default { register(api) {
  api.tool('echo', 'Echo back', { word: api.z.string() }, async ({ word }) => api.json({ word }));
  api.tool('remote', 'Ask the extension Lua', {}, async () => api.reply(await api.call('hello', { n: 2 })));
  api.tool('boom', 'Always throws', {}, async () => { throw new Error('it broke'); });
  api.describeCategory('Echo tools for tests');
} };`;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ext-root-'));
  h.bridgeDir = await mkdtemp(join(tmpdir(), 'ext-bridge-'));
  h.sendCommand.mockReset();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(h.bridgeDir, { recursive: true, force: true });
});

describe('loading extensions', () => {
  it('registers an extension\'s tools under its name and answers calls', async () => {
    await install('demo-ext', ECHO);
    const server = new McpServer({ name: 't', version: '0' });
    const [status] = await loadExtensions(server, root);
    expect(status).toMatchObject({ name: 'demo-ext', status: 'loaded', tools: ['demo_ext_echo', 'demo_ext_remote', 'demo_ext_boom'] });
    const res = await callTool(server, 'demo_ext_echo', { word: 'hi' });
    expect(JSON.parse(res.content[0].text)).toEqual({ word: 'hi' });
  });

  it('describes the tools as a category named after the extension', async () => {
    await install('demo-cat', ECHO);
    await loadExtensions(new McpServer({ name: 't', version: '0' }), root);
    expect(TOOL_CATEGORIES['demo-cat']).toMatchObject({ description: 'Echo tools for tests', tools: expect.arrayContaining(['demo_cat_echo']) });
    delete TOOL_CATEGORIES['demo-cat'];
  });

  it('turns a throwing tool into an error result the agent can read', async () => {
    await install('demo-boom', ECHO);
    const server = new McpServer({ name: 't', version: '0' });
    await loadExtensions(server, root);
    const res = await callTool(server, 'demo_boom_boom');
    expect(res).toMatchObject({ isError: true });
    expect(res.content[0].text).toBe('Error: it broke');
  });

  it('sends api.call() to the bridge as an extension_call and returns its data', async () => {
    await install('demo-call', ECHO);
    h.sendCommand.mockResolvedValue({ success: true, data: { greeting: 'hello' } });
    const server = new McpServer({ name: 't', version: '0' });
    await loadExtensions(server, root);
    const res = await callTool(server, 'demo_call_remote');
    expect(JSON.parse(res.content[0].text)).toEqual({ greeting: 'hello' });
    expect(h.sendCommand).toHaveBeenCalledWith('extension_call', { extension: 'demo-call', command: 'hello', paramsJson: '{"n":2}' }, undefined);
  });

  it('shows a bridge refusal as an Error result', async () => {
    await install('demo-refuse', ECHO);
    h.sendCommand.mockResolvedValue({ success: false, error: "extension 'demo-refuse' has no Lua command 'hello'" });
    const server = new McpServer({ name: 't', version: '0' });
    await loadExtensions(server, root);
    const res = await callTool(server, 'demo_refuse_remote');
    expect(res).toMatchObject({ isError: true });
    expect(res.content[0].text).toContain("no Lua command 'hello'");
  });

  it('puts the extension\'s Lua file where the bridge reads it, and updates it when it changes', async () => {
    const dir = await install('luaext', ECHO, { lua: 'handlers.lua' }, { 'handlers.lua': 'return { a = function() return {} end }' });
    await loadExtensions(new McpServer({ name: 't', version: '0' }), root);
    const dest = join(h.bridgeDir, 'extensions', 'luaext', 'handlers.lua');
    expect(await readFile(dest, 'utf8')).toBe('return { a = function() return {} end }');
    await writeFile(join(dir, 'handlers.lua'), 'return { b = function() return {} end }');
    await loadExtensions(new McpServer({ name: 't', version: '0' }), root);
    expect(await readFile(dest, 'utf8')).toBe('return { b = function() return {} end }');
  });
});

describe('extensions that cannot load', () => {
  it('skips one that throws in register(), removes the tools it had added, and still loads the others', async () => {
    await install('a-bad', `export default { register(api) {
      api.tool('first', 'ok', {}, async () => api.json({}));
      throw new Error('register blew up');
    } };`);
    await install('b-good', ECHO);
    const server = new McpServer({ name: 't', version: '0' });
    const statuses = await loadExtensions(server, root);
    expect(statuses.map((s) => [s.name, s.status])).toEqual([['a-bad', 'skipped'], ['b-good', 'loaded']]);
    expect(statuses[0].reason).toContain('register blew up');
    expect(Object.keys(registered(server))).not.toContain('a_bad_first');
    expect(Object.keys(registered(server))).toContain('b_good_echo');
  });

  it('skips one that registers the same tool twice', async () => {
    await install('dupe', `export default { register(api) {
      api.tool('x', 'one', {}, async () => api.json({}));
      api.tool('x', 'two', {}, async () => api.json({}));
    } };`);
    const server = new McpServer({ name: 't', version: '0' });
    const [s] = await loadExtensions(server, root);
    expect(s.status).toBe('skipped');
    expect(s.reason).toContain('already registered');
    expect(Object.keys(registered(server))).not.toContain('dupe_x');
  });

  it('skips one written for another API version and says so', async () => {
    await install('future', ECHO, { apiVersion: 99 });
    const [s] = await loadExtensions(new McpServer({ name: 't', version: '0' }), root);
    expect(s).toMatchObject({ name: 'future', status: 'skipped' });
    expect(s.reason).toContain('apiVersion');
  });

  it('skips a folder with no manifest, an unparsable one, and one whose folder name differs from its name', async () => {
    await mkdir(join(root, 'empty'));
    await mkdir(join(root, 'broken'));
    await writeFile(join(root, 'broken', 'reaper-mcp-extension.json'), '{ nope');
    await install('renamed', ECHO, { name: 'other-name' });
    const byName = Object.fromEntries((await loadExtensions(new McpServer({ name: 't', version: '0' }), root)).map((s) => [s.name, s]));
    expect(byName['empty'].reason).toContain('no reaper-mcp-extension.json');
    expect(byName['broken'].reason).toContain('not valid JSON');
    expect(byName['renamed'].reason).toContain('must match the manifest name');
    expect(Object.values(byName).every((s) => s.status === 'skipped')).toBe(true);
  });

  it('skips one whose main file is missing, suggesting it was not built', async () => {
    await install('unbuilt', ECHO, { main: 'dist/index.mjs' });
    const [s] = await loadExtensions(new McpServer({ name: 't', version: '0' }), root);
    expect(s.status).toBe('skipped');
    expect(s.reason).toContain('is the extension built');
  });

  it('skips one whose main is a symlink pointing outside its folder', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'ext-outside-'));
    await writeFile(join(outside, 'evil.mjs'), 'globalThis.__evil = true; export default { register() {} };');
    const dir = await install('sneaky', ECHO);
    await rm(join(dir, 'index.mjs'));
    await symlink(join(outside, 'evil.mjs'), join(dir, 'index.mjs'));
    const [s] = await loadExtensions(new McpServer({ name: 't', version: '0' }), root);
    expect(s.status).toBe('skipped');
    expect(s.reason).toContain('outside the extension folder');
    expect((globalThis as Record<string, unknown>)['__evil']).toBeUndefined();
    await rm(outside, { recursive: true, force: true });
  });

  it('skips one whose main has no register function', async () => {
    await install('noreg', 'export default { hello: 1 };');
    const [s] = await loadExtensions(new McpServer({ name: 't', version: '0' }), root);
    expect(s.reason).toContain('register(api)');
  });
});

describe('discovering extensions', () => {
  it('finds nothing when the extensions folder does not exist', async () => {
    expect(await discoverExtensions(join(root, 'nope'))).toEqual([]);
  });

  it('follows a symlinked extension folder (a linked working copy)', async () => {
    const work = await mkdtemp(join(tmpdir(), 'ext-work-'));
    await mkdir(join(work, 'linked'));
    await writeFile(join(work, 'linked', 'reaper-mcp-extension.json'), JSON.stringify({ name: 'linked', version: '0.1.0', apiVersion: 1, main: 'index.mjs' }));
    await writeFile(join(work, 'linked', 'index.mjs'), ECHO);
    await symlink(join(work, 'linked'), join(root, 'linked'));
    const [found] = await discoverExtensions(root);
    expect(found.manifest?.name).toBe('linked');
    const server = new McpServer({ name: 't', version: '0' });
    const [s] = await loadExtensions(server, root);
    expect(s.status).toBe('loaded');
    await rm(work, { recursive: true, force: true });
  });
});

describe('checkExtensions (doctor rows)', () => {
  it('reports nothing when no extension is installed', async () => {
    expect(await checkExtensions(root)).toEqual([]);
  });

  it('marks a valid extension ok and one with a missing entry file failed, saying what is missing', async () => {
    await install('good', ECHO);
    const dir = await install('unbuilt', ECHO);
    await rm(join(dir, 'index.mjs'));
    const checks = await checkExtensions(root);
    expect(checks.find((c) => c.label === 'good')).toMatchObject({ status: 'ok' });
    expect(checks.find((c) => c.label === 'unbuilt')).toMatchObject({ status: 'fail' });
    expect(checks.find((c) => c.label === 'unbuilt')?.detail).toContain('index.mjs');
  });

  it('fails an extension whose manifest is broken, with the reason', async () => {
    const dir = join(root, 'broken');
    await mkdir(dir);
    await writeFile(join(dir, 'reaper-mcp-extension.json'), '{nope');
    expect(await checkExtensions(root)).toEqual([
      expect.objectContaining({ label: 'broken', status: 'fail', detail: expect.stringContaining('not valid JSON') }),
    ]);
  });
});
