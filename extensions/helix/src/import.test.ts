import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setPreset, slotOf, type ImportDriver } from './import.js';

let lib: string;
let work: string;
const slot = (setlist: number, preset: number) => join(lib, `#SETLIST${setlist}`, `#PRESET${String(preset).padStart(3, '0')}`);
const read = (p: string) => readFile(p, 'utf8');

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'helix-'));
  lib = join(work, 'lib');
  await mkdir(join(lib, '#SETLIST2'), { recursive: true });
  await mkdir(join(lib, '#SETLIST3'), { recursive: true });
  await writeFile(slot(2, 7), 'keep-me');
  await writeFile(slot(2, 8), 'old-new-preset');
  await writeFile(join(lib, '#SETLIST2', '.nodes'), 'index-1');
  await writeFile(join(work, 'p.hlx'), '{}');
});

const run = (driver: ImportDriver, expect_ = { setlist: 2, preset: 8 }) =>
  setPreset({ hlxPath: join(work, 'p.hlx'), libraryDir: lib, backupRoot: join(work, 'bak'), driver, expectSlot: expect_, settleMs: 300 });

describe('setPreset', () => {
  it('accepts an import that changed exactly the expected slot and its index', async () => {
    const r = await run({ importFile: async () => { await writeFile(slot(2, 8), 'new'); await writeFile(join(lib, '#SETLIST2', '.nodes'), 'index-2'); return { ok: true }; } });
    expect(r).toMatchObject({ ok: true, slot: { setlist: 2, preset: 8 } });
    expect(await read(slot(2, 8))).toBe('new');
  });

  it('rolls back an import that overwrote a different slot', async () => {
    const r = await run({ importFile: async () => { await writeFile(slot(2, 7), 'clobbered'); return { ok: true }; } });
    expect(r).toMatchObject({ ok: false, rolledBack: true, error: expect.stringContaining('landed in setlist 2 preset 7') });
    expect(await read(slot(2, 7))).toBe('keep-me');
  });

  it('rolls back an import that changed several slots, including a new file', async () => {
    const r = await run({ importFile: async () => { await writeFile(slot(2, 8), 'x'); await writeFile(slot(3, 1), 'stray'); return { ok: true }; } });
    expect(r).toMatchObject({ ok: false, rolledBack: true, error: expect.stringContaining('2 preset slots') });
    expect(await read(slot(2, 8))).toBe('old-new-preset');
    await expect(read(slot(3, 1))).rejects.toThrow();
  });

  it('reports an import that changed nothing, leaving the library alone', async () => {
    const r = await run({ importFile: async () => ({ ok: true }) });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('changed no preset slot') });
    expect(await read(slot(2, 8))).toBe('old-new-preset');
  });

  it('reports a driver failure and undoes anything it touched first', async () => {
    const r = await run({ importFile: async () => { await writeFile(slot(2, 8), 'half'); return { ok: false, error: 'window not found' }; } });
    expect(r).toMatchObject({ ok: false, rolledBack: true, error: expect.stringContaining('window not found') });
    expect(await read(slot(2, 8))).toBe('old-new-preset');
  });
});

describe('slotOf', () => {
  it('reads setlist and preset numbers and ignores index files', () => {
    expect(slotOf('#SETLIST2/#PRESET008')).toEqual({ setlist: 2, preset: 8 });
    expect(slotOf('#SETLIST2/.nodes')).toBeUndefined();
  });
});
