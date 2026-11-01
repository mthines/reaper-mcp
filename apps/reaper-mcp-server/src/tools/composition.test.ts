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
  it('parses the file and reports its tempo and the events it leaves out, without applying the tempo', async () => {
    const path = join(dir, 'song.mid');
    writeFileSync(path, smf([
      [[0, 0xff, 0x51, 3, 0x09, 0x27, 0xc0]], // 100 BPM
      [[0, ...name('Bass')], [0, 0x90, 36, 100], [960, 0x80, 36, 0]],
      [[0, ...name('Lead')], [0, 0xe0, 0, 64], [480, 0x90, 72, 90], [480, 0x80, 72, 0]],
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
    expect(res.file.notImported).toEqual({ pitchBend: 1 });
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
    expect((await tool('detect_key')({ trackIndex: -1, source: 'midi' })).content[0].text).toMatch(/master track holds no MIDI/);
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

describe('detect_key with itemIndex', () => {
  it("reads the key over the item's own range", async () => {
    let profileRange: Record<string, unknown> = {};
    sendCommandMock.mockImplementation(async (type, params) => {
      if ((type as string) === '_item_range') return ok({ startTime: 8, endTime: 16 });
      if ((type as string) === '_midi_pitch_profile') {
        profileRange = params as Record<string, unknown>;
        return ok({ chroma: C_MAJOR, notes: 12, midiItems: 1, audioItems: 0 });
      }
      return ok({});
    });
    const res = json(await tool('detect_key')({ trackIndex: 2, itemIndex: 1 }));
    expect(res.key).toBe('C major');
    expect(profileRange).toMatchObject({ startTime: 8, endTime: 16 });
  });

  it('refuses an item on the master or together with a time range', async () => {
    expect((await tool('detect_key')({ trackIndex: -1, itemIndex: 0 })).content[0].text).toMatch(/master holds no items/);
    expect((await tool('detect_key')({ trackIndex: 0, itemIndex: 0, startTime: 2 })).content[0].text).toMatch(/not both/);
  });
});

describe('detect_chords', () => {
  const tri = (...pcs: number[]) => Array.from({ length: 12 }, (_, i) => (pcs.includes(i) ? 4 : 0));
  const grid = (n: number, start = 0) => Array.from({ length: n }, (_, i) => ({ start: start + i * 2, end: start + i * 2 + 2, bar: i + 1, beat: 1 }));

  it('reads the chords of a MIDI track bar by bar, with the key, roman numerals and bass notes', async () => {
    sendCommandMock.mockImplementation(async (type) => (type as string) === '_chord_grid'
      ? ok({ startTime: 0, endTime: 8, segments: grid(4), notes: 30, midiItems: 1, audioItems: 0,
        profiles: [tri(9, 0, 4), tri(2, 5, 9), tri(4, 8, 11), tri(9, 0, 4)], bass: [45, 50, 56, 45] })
      : ok({}));
    const res = json(await tool('detect_chords')({ trackIndex: 0 }));
    expect(res).toMatchObject({ source: 'midi', per: 'bar', startTime: 0, endTime: 8, progression: 'Am Dm E/Ab Am', total: 4, hasMore: false });
    expect(res.key.key).toBe('A minor');
    expect(res.chords[0]).toMatchObject({ chord: 'Am', roman: 'i', bar: 1, bassMidi: 33 });
    expect(res.chords[1]).toMatchObject({ chord: 'Dm', roman: 'iv' });
    expect(res.chords[2]).toMatchObject({ chord: 'E/Ab', roman: 'V', bass: 'Ab', bassMidi: 32 });
  });

  it('pages through the chord spans', async () => {
    sendCommandMock.mockImplementation(async (type) => (type as string) === '_chord_grid'
      ? ok({ startTime: 0, endTime: 8, segments: grid(4), notes: 30, profiles: [tri(9, 0, 4), tri(5, 9, 0), tri(0, 4, 7), tri(7, 11, 2)], bass: [-1, -1, -1, -1] })
      : ok({}));
    const res = json(await tool('detect_chords')({ trackIndex: 0, offset: 1, limit: 2 }));
    expect(res.chords.map((c: { chord: string }) => c.chord)).toEqual(['F', 'C']);
    expect(res).toMatchObject({ total: 4, offset: 1, hasMore: true });
  });

  it('renders the audio and reads each bar from the sidecar when the track has no MIDI', async () => {
    const chroma = vi.fn().mockResolvedValue({ chroma: tri(2, 6, 9, 7, 11), durationSeconds: 4, frames: 40, segments: [tri(2, 6, 9), tri(7, 11, 2)] });
    vi.mocked(getSidecarClient).mockReturnValue({ isAvailable: () => true, chroma } as never);
    sendCommandMock.mockImplementation(async (type) => {
      if ((type as string) === '_chord_grid') return ok({ startTime: 10, endTime: 14, segments: grid(2, 10), notes: 0 });
      if (type === 'render_track_to_wav') return ok({ wavPath: join(dir, 'missing-render.wav'), trackName: 'Gtr', durationSeconds: 4 });
      return ok({});
    });
    const res = json(await tool('detect_chords')({ trackIndex: 1, itemIndex: 3 }));
    expect(res).toMatchObject({ source: 'audio', name: 'Gtr', itemIndex: 3, progression: 'D G' });
    // The sidecar is asked for the bars relative to the render's start
    expect(chroma.mock.calls[0][0].segments).toEqual([[0, 2], [2, 4]]);
  });

  it('cuts an audio file into bars at its tempo, ending at the file end', async () => {
    const chroma = vi.fn().mockResolvedValue({ chroma: tri(0, 4, 7, 5, 9), durationSeconds: 5, frames: 50,
      segments: [tri(0, 4, 7), tri(5, 9, 0), tri(0, 4, 7), new Array(12).fill(0)] });
    vi.mocked(getSidecarClient).mockReturnValue({ isAvailable: () => true, chroma } as never);
    const res = json(await tool('detect_chords')({ path: join(dir, 'song.wav'), bpm: 120, endTime: 8 }));
    expect(chroma.mock.calls[0][0].segments).toEqual([[0, 2], [2, 4], [4, 6], [6, 8]]);
    // The file is 5 s long: the bar starting at 6 s is past its end
    expect(res).toMatchObject({ source: 'file', name: 'song.wav', per: 'bar', startTime: 0, endTime: 5, progression: 'C F C' });
    expect(res.chords[2]).toMatchObject({ start: 4, end: 5, bar: 3 });
  });

  const installed = async () => ({ installed: true, message: '' });
  const missing = async () => ({ installed: false, message: 'The chord model is not installed. Run: reaper-mcp setup-sidecar --with-chords' });

  it('reads a rendered track with the chord model when it is installed, with sevenths, slash chords and the key from the chords', async () => {
    // The model's segments are relative to the render; the bars start at 10 s
    const chords = vi.fn().mockResolvedValue({ durationSeconds: 8, vocabulary: 'submission', seconds: 2.1, segments: [
      { start: 0, end: 2.2, label: 'A:min7' }, { start: 2.2, end: 4, label: 'D:min' },
      { start: 4, end: 6, label: 'E:7/3' }, { start: 6, end: 8, label: 'N' },
    ] });
    const chroma = vi.fn();
    vi.mocked(getSidecarClient).mockReturnValue({ isAvailable: () => true, chordsStatus: installed, chords, chroma } as never);
    sendCommandMock.mockImplementation(async (type) => {
      if ((type as string) === '_chord_grid') return ok({ startTime: 10, endTime: 18, segments: grid(4, 10), notes: 0 });
      if (type === 'render_track_to_wav') return ok({ wavPath: join(dir, 'missing-render.wav'), trackName: 'Gtr', durationSeconds: 8 });
      return ok({});
    });
    const res = json(await tool('detect_chords')({ trackIndex: 1 }));
    expect(chroma).not.toHaveBeenCalled();
    expect(res).toMatchObject({ source: 'audio', engine: 'model', progression: 'Am7 Dm E7/Ab', startTime: 10 });
    expect(res.key.key).toBe('A minor');
    expect(res.chords[0]).toMatchObject({ chord: 'Am7', quality: 'm7', roman: 'i7', start: 10, end: 12, score: 1 });
    expect(res.chords[2]).toMatchObject({ chord: 'E7/Ab', bass: 'Ab', roman: 'V7' });
    expect(res.chords[3]).toMatchObject({ chord: 'N', start: 16 });
    expect(res.modelHint).toBeUndefined();
  });

  it('asks the model for a file range in file seconds and maps its chords onto the bars', async () => {
    const chords = vi.fn().mockResolvedValue({ durationSeconds: 4, vocabulary: 'submission', seconds: 1, segments: [
      { start: 30, end: 32, label: 'C:maj' }, { start: 32, end: 34, label: 'G:maj' },
    ] });
    vi.mocked(getSidecarClient).mockReturnValue({ isAvailable: () => true, chordsStatus: installed, chords } as never);
    const res = json(await tool('detect_chords')({ path: join(dir, 'song.wav'), startTime: 30, endTime: 34, bpm: 120 }));
    expect(chords.mock.calls[0][0]).toMatchObject({ startTime: 30, endTime: 34 });
    expect(res).toMatchObject({ source: 'file', engine: 'model', progression: 'C G', startTime: 30, endTime: 34 });
    expect(res.chords[1]).toMatchObject({ start: 32, end: 34, bar: 2, chord: 'G' });
  });

  it('falls back to the templates without the model and says how to install it; engine "model" refuses instead', async () => {
    const chroma = vi.fn().mockResolvedValue({ chroma: tri(0, 4, 7), durationSeconds: 2, frames: 20, segments: [tri(0, 4, 7)] });
    vi.mocked(getSidecarClient).mockReturnValue({ isAvailable: () => true, chordsStatus: missing, chroma } as never);
    const file = join(dir, 'song.wav');
    const auto = json(await tool('detect_chords')({ path: file, endTime: 2 }));
    expect(auto).toMatchObject({ engine: 'template', progression: 'C' });
    expect(auto.modelHint).toMatch(/--with-chords/);
    const forced = await tool('detect_chords')({ path: file, endTime: 2, engine: 'model' });
    expect(forced.isError).toBe(true);
    expect(forced.content[0].text).toMatch(/--with-chords/);
  });

  it('keeps MIDI notes on the templates, and engine "model" renders a MIDI track instead', async () => {
    const chords = vi.fn().mockResolvedValue({ durationSeconds: 2, vocabulary: 'submission', seconds: 1, segments: [{ start: 0, end: 2, label: 'G:maj' }] });
    vi.mocked(getSidecarClient).mockReturnValue({ isAvailable: () => true, chordsStatus: installed, chords } as never);
    sendCommandMock.mockImplementation(async (type, params) => {
      if ((type as string) === '_chord_grid') {
        const midi = (params as { midi?: boolean }).midi;
        return ok({ startTime: 0, endTime: 2, segments: grid(1), notes: midi ? 3 : 0, ...(midi ? { profiles: [tri(9, 0, 4)], bass: [-1] } : {}) });
      }
      if (type === 'render_track_to_wav') return ok({ wavPath: join(dir, 'missing-render.wav'), trackName: 'Keys', durationSeconds: 2 });
      return ok({});
    });
    expect(json(await tool('detect_chords')({ trackIndex: 0 }))).toMatchObject({ source: 'midi', engine: 'template', progression: 'Am' });
    expect(chords).not.toHaveBeenCalled();
    expect(json(await tool('detect_chords')({ trackIndex: 0, engine: 'model' }))).toMatchObject({ source: 'audio', engine: 'model', progression: 'G' });
    expect((await tool('detect_chords')({ trackIndex: 0, engine: 'model', source: 'midi' })).content[0].text).toMatch(/reads audio/);
  });

  it('says what is missing: a source, the sidecar for audio, MIDI notes, or too fine a grid', async () => {
    expect((await tool('detect_chords')({})).content[0].text).toMatch(/exactly one of trackIndex or path/);
    expect((await tool('detect_chords')({ trackIndex: 0, itemIndex: 0, endTime: 3 })).content[0].text).toMatch(/not both/);
    vi.mocked(getSidecarClient).mockReturnValue({ isAvailable: () => false } as never);
    sendCommandMock.mockResolvedValue(ok({ startTime: 0, endTime: 4, segments: grid(2), notes: 0 }));
    expect((await tool('detect_chords')({ trackIndex: 0 })).content[0].text).toMatch(/sidecar/);
    expect((await tool('detect_chords')({ trackIndex: 0, source: 'midi' })).content[0].text).toMatch(/no MIDI notes/);
    vi.mocked(getSidecarClient).mockReturnValue({ isAvailable: () => true } as never);
    const fine = await tool('detect_chords')({ path: join(dir, 'song.wav'), windowSeconds: 0.1 });
    expect(fine.content[0].text).toMatch(/More than 4000 segments/);
    sendCommandMock.mockResolvedValue(fail('track 9 not found'));
    expect((await tool('detect_chords')({ trackIndex: 9 })).content[0].text).toMatch(/track 9 not found/);
  });
});
