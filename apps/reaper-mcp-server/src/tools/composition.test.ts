/**
 * What the composition tools answer the agent: quantize/transform/import through a
 * stubbed bridge, detect_key from a MIDI pitch profile or sidecar chroma. MIDI files
 * are real files in a temp dir.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../bridge.js', () => ({ sendCommand: vi.fn() }));
vi.mock('../sidecar.js', () => ({ getSidecarClient: vi.fn() }));

import { sendCommand } from '../bridge.js';
import { getSidecarClient } from '../sidecar.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCompositionTools } from './composition.js';
import { smf, name } from '../__fixtures__/smf-builder.js';

const sendCommandMock = vi.mocked(sendCommand);
type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };
type ToolCallback = (params: Record<string, unknown>) => Promise<ToolResult>;

function tool(n: string): ToolCallback {
  const tools: Record<string, ToolCallback> = {};
  registerCompositionTools({ tool: (t: string, _d: string, _s: unknown, cb: ToolCallback) => { tools[t] = cb; } } as unknown as McpServer);
  return tools[n];
}
const json = (r: ToolResult) => JSON.parse(r.content[0].text);
const ok = (data: unknown) => ({ id: 't', success: true, data, timestamp: 0 });
const fail = (error: string) => ({ id: 't', success: false, error, timestamp: 0 });

const dir = mkdtempSync(join(tmpdir(), 'composition-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// C major triad, weighted: C, E, G long, plus a short D and F
const C_MAJOR = [4, 0.1, 1, 0.1, 3, 1, 0.1, 3.5, 0.1, 1, 0.1, 0.5];

beforeEach(() => {
  sendCommandMock.mockReset().mockResolvedValue(ok({}));
  vi.mocked(getSidecarClient).mockReset();
});

describe('quantize_midi / transform_midi', () => {
  it('returns the bridge result for a quantize and sends the note selection as JSON', async () => {
    sendCommandMock.mockImplementation(async (_type, params) =>
      ok({ notes: JSON.parse(String((params as { notes: string }).notes)).length, moved: 2, maxShiftBeats: 0.1 }));
    const res = await tool('quantize_midi')({ trackIndex: 0, itemIndex: 0, grid: 0.25, notes: [0, 2] });
    expect(res.isError).toBeUndefined();
    expect(json(res)).toEqual({ notes: 2, moved: 2, maxShiftBeats: 0.1 });
  });

  it('passes a refusal through as an error', async () => {
    sendCommandMock.mockResolvedValue(fail('1 note(s) would leave the MIDI range 0-127 when transposed by 12 — nothing changed'));
    const res = await tool('transform_midi')({ trackIndex: 0, itemIndex: 0, transpose: 12 });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('nothing changed');
  });
});

describe('import_midi_file', () => {
  it('parses the file and reports its tempo without applying it', async () => {
    const path = join(dir, 'song.mid');
    writeFileSync(path, smf([
      [[0, 0xff, 0x51, 3, 0x09, 0x27, 0xc0]], // 100 BPM
      [[0, ...name('Bass')], [0, 0x90, 36, 100], [960, 0x80, 36, 0]],
      [[0, ...name('Lead')], [480, 0x90, 72, 90], [480, 0x80, 72, 0]],
    ]));
    let sent: Record<string, unknown> = {};
    sendCommandMock.mockImplementation(async (_t, params) => {
      sent = params as Record<string, unknown>;
      return ok({ position: 2, lengthBeats: 2, items: [{ trackIndex: 1, itemIndex: 0, name: 'song.mid', notes: 2, cc: 0 }] });
    });
    const res = json(await tool('import_midi_file')({ path, trackIndex: 1, position: 2 }));
    expect(res.items[0].notes).toBe(2);
    expect(res.file).toMatchObject({ name: 'song.mid', tracks: 2, notes: 2, tempo: 100 });
    expect(res.note).toMatch(/not applied/);
    // What REAPER is asked to write: both tracks, in quarter notes
    expect(JSON.parse(String(sent.tracks))).toEqual([
      { name: 'Bass', notes: [[0, 2, 0, 36, 100]], cc: [] },
      { name: 'Lead', notes: [[1, 1, 0, 72, 90]], cc: [] },
    ]);
    expect(sent.lengthQN).toBe(2);
  });

  it('refuses a file that is not MIDI, or holds no notes, without touching REAPER', async () => {
    const wav = join(dir, 'a.wav');
    writeFileSync(wav, 'RIFF');
    expect((await tool('import_midi_file')({ path: wav })).content[0].text).toMatch(/Not a MIDI file/);
    const bad = join(dir, 'bad.mid');
    writeFileSync(bad, 'not midi at all');
    expect((await tool('import_midi_file')({ path: bad })).content[0].text).toMatch(/not a MIDI file.*nothing changed/);
    const empty = join(dir, 'empty.mid');
    writeFileSync(empty, smf([[[0, ...name('Conductor')]]]));
    expect((await tool('import_midi_file')({ path: empty })).content[0].text).toMatch(/no notes/);
    expect((await tool('import_midi_file')({ path: join(dir, 'missing.mid') })).content[0].text).toMatch(/Cannot read/);
    expect(sendCommandMock.mock.calls.filter(([t]) => t === 'import_midi_file')).toHaveLength(0);
  });
});

describe('detect_key', () => {
  it('names the key of a MIDI track from its notes', async () => {
    sendCommandMock.mockImplementation(async (type) =>
      (type as string) === '_midi_pitch_profile' ? ok({ chroma: C_MAJOR, notes: 40, midiItems: 2, audioItems: 0 }) : ok({}));
    const res = json(await tool('detect_key')({ trackIndex: 3 }));
    expect(res).toMatchObject({ trackIndex: 3, source: 'midi', key: 'C major', relative: 'A minor', notes: 40 });
    expect(res.confidence).toBeGreaterThan(0.25);
    expect(res.alternatives).toHaveLength(3);
  });

  it('falls back to rendering the audio when the track has no MIDI notes', async () => {
    const chroma = vi.fn().mockResolvedValue({ chroma: [0.3, 0.1, 0.5, 0.1, 0.2, 0.4, 0.1, 0.6, 0.1, 1, 0.2, 0.1], durationSeconds: 30, frames: 300 });
    vi.mocked(getSidecarClient).mockReturnValue({ isAvailable: () => true, chroma } as never);
    sendCommandMock.mockImplementation(async (type) => {
      if ((type as string) === '_midi_pitch_profile') return ok({ chroma: new Array(12).fill(0), notes: 0, midiItems: 0, audioItems: 3 });
      if (type === 'render_track_to_wav') return ok({ wavPath: join(dir, 'missing-render.wav'), trackName: 'Gtr', durationSeconds: 30 });
      return ok({});
    });
    const res = json(await tool('detect_key')({ trackIndex: 1, endTime: 30 }));
    expect(res).toMatchObject({ source: 'audio', name: 'Gtr', key: 'A minor' });
    expect(chroma).toHaveBeenCalledOnce();
  });

  it('says what is missing: a source, the sidecar for audio, or pitched content', async () => {
    expect((await tool('detect_key')({})).content[0].text).toMatch(/exactly one of trackIndex or path/);
    vi.mocked(getSidecarClient).mockReturnValue({ isAvailable: () => false } as never);
    sendCommandMock.mockResolvedValue(ok({ chroma: new Array(12).fill(0), notes: 0, midiItems: 0, audioItems: 1 }));
    expect((await tool('detect_key')({ trackIndex: 0 })).content[0].text).toMatch(/sidecar/);
    expect((await tool('detect_key')({ trackIndex: 0, source: 'midi' })).content[0].text).toMatch(/no MIDI notes/);
    vi.mocked(getSidecarClient).mockReturnValue({ isAvailable: () => true, chroma: async () => ({ chroma: new Array(12).fill(0), durationSeconds: 5, frames: 0 }) } as never);
    const silent = await tool('detect_key')({ path: join(dir, 'quiet.wav') });
    expect(silent.isError).toBe(true);
    expect(silent.content[0].text).toMatch(/No pitched content/);
  });
});
