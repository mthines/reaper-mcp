import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, lstat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { classifySource, installExtension, removeExtension, scaffoldExtension } from './extension-cli.js';
import { discoverExtensions, loadExtensions } from './extensions.js';

let work: string;
let root: string;

async function makeExtension(name: string, extra: Record<string, unknown> = {}) {
  const dir = join(work, 'src', name);
  await mkdir(join(dir, 'node_modules', 'dep'), { recursive: true });
  await mkdir(join(dir, '.git'), { recursive: true });
  await writeFile(join(dir, 'reaper-mcp-extension.json'), JSON.stringify({ name, version: '1.0.0', apiVersion: 1, main: 'index.mjs', ...extra }));
  await writeFile(join(dir, 'index.mjs'), 'export default { register(api) { api.tool("ping", "p", {}, async () => api.json({ pong: true })); } };');
  await writeFile(join(dir, 'node_modules', 'dep', 'big.js'), 'x');
  return dir;
}

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'extcli-'));
  root = join(work, 'installed');
});
afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

describe('installing extensions', () => {
  it('copies a folder into the extensions folder without node_modules or .git, and the copy loads', async () => {
    const src = await makeExtension('copied');
    const r = await installExtension(src, { root, mode: 'copy' });
    expect(r).toMatchObject({ ok: true, name: 'copied', dir: join(root, 'copied') });
    expect((await readdir(join(root, 'copied'))).sort()).toEqual(['index.mjs', 'reaper-mcp-extension.json']);
    const [s] = await loadExtensions(new McpServer({ name: 't', version: '0' }), root);
    expect(s).toMatchObject({ name: 'copied', status: 'loaded', tools: ['copied_ping'] });
  });

  it('a linked extension follows its working copy', async () => {
    const src = await makeExtension('linked');
    await installExtension(src, { root, mode: 'link' });
    expect((await lstat(join(root, 'linked'))).isSymbolicLink()).toBe(true);
    await writeFile(join(src, 'index.mjs'), 'export default { register(api) { api.tool("newer", "n", {}, async () => api.json({})); } };');
    const [s] = await loadExtensions(new McpServer({ name: 't', version: '0' }), root);
    expect(s.tools).toEqual(['linked_newer']);
  });

  it('refuses a folder with an invalid manifest and installs nothing', async () => {
    const src = await makeExtension('badapi', { apiVersion: 7 });
    const r = await installExtension(src, { root, mode: 'copy' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('apiVersion');
    expect(await discoverExtensions(root)).toEqual([]);
  });

  it('refuses to replace an installed extension unless forced', async () => {
    const src = await makeExtension('twice');
    await installExtension(src, { root, mode: 'copy' });
    const again = await installExtension(src, { root, mode: 'copy' });
    expect(!again.ok && again.error).toContain('--force');
    expect((await installExtension(src, { root, mode: 'copy', force: true })).ok).toBe(true);
  });

  it('refuses something that is not a folder', async () => {
    const r = await installExtension(join(work, 'nope'), { root, mode: 'copy' });
    expect(!r.ok && r.error).toContain('not a folder');
  });
});

describe('removing extensions', () => {
  it('removing a copy deletes it', async () => {
    await installExtension(await makeExtension('gone'), { root, mode: 'copy' });
    expect(await removeExtension('gone', root)).toEqual({ ok: true, wasLink: false });
    expect(await discoverExtensions(root)).toEqual([]);
  });

  it('removing a link leaves the linked working copy untouched', async () => {
    const src = await makeExtension('keepme');
    await installExtension(src, { root, mode: 'link' });
    expect(await removeExtension('keepme', root)).toEqual({ ok: true, wasLink: true });
    expect(await readFile(join(src, 'index.mjs'), 'utf8')).toContain('register');
  });

  it('refuses a name that could point outside the folder, and one that is not installed', async () => {
    for (const bad of ['../x', '/etc', 'a/b', '']) expect((await removeExtension(bad, root)).ok).toBe(false);
    const r = await removeExtension('ghost', root);
    expect(!r.ok && r.error).toContain('not installed');
  });
});

describe('scaffolding a new extension', () => {
  it('writes an extension that is valid and loads, with a working example tool', async () => {
    const r = await scaffoldExtension('my-synth', work);
    expect(r.ok).toBe(true);
    await installExtension(join(work, 'my-synth'), { root, mode: 'link' });
    const [s] = await loadExtensions(new McpServer({ name: 't', version: '0' }), root);
    expect(s).toMatchObject({ name: 'my-synth', status: 'loaded', tools: ['my_synth_hello'] });
  });

  it('refuses an invalid name and a folder that already has files', async () => {
    expect((await scaffoldExtension('Bad Name', work)).ok).toBe(false);
    await mkdir(join(work, 'taken'));
    await writeFile(join(work, 'taken', 'x'), '');
    expect((await scaffoldExtension('taken', work)).ok).toBe(false);
  });
});

describe('what extension add accepts', () => {
  it('tells git URLs, folders and clone extension names apart', async () => {
    const src = await makeExtension('somewhere');
    const clone = join(work, 'clone');
    await mkdir(join(clone, 'extensions', 'vital'), { recursive: true });
    await writeFile(join(clone, 'extensions', 'vital', 'reaper-mcp-extension.json'), '{}');
    expect(classifySource('https://github.com/x/y', null).kind).toBe('git');
    expect(classifySource('git@github.com:x/y.git', null).kind).toBe('git');
    expect(classifySource(src, null).kind).toBe('path');
    expect(classifySource('vital', clone)).toEqual({ kind: 'clone', path: join(clone, 'extensions', 'vital') });
    expect(classifySource('vital', null).kind).toBe('unknown');
    expect(classifySource('nothing', clone).kind).toBe('unknown');
  });
});
