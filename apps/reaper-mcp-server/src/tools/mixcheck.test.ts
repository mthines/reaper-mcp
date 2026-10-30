/**
 * Behaviour of the mix-check tools (analyze_loudness_curve, analyze_stereo_bands,
 * measure_masking, separate_stems) as the agent sees it. REAPER is a small fake bridge
 * (renders, project info, stem insertion); the sidecar returns fixed analyses.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bridge.js', () => ({ sendCommand: vi.fn() }));
vi.mock('../sidecar.js', () => ({ getSidecarClient: vi.fn() }));
vi.mock('node:fs/promises', () => ({ unlink: vi.fn() }));

import { sendCommand } from '../bridge.js';
import { getSidecarClient } from '../sidecar.js';
import { unlink } from 'node:fs/promises';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMixcheckTools, MAX_MASKING_SECONDS } from './mixcheck.js';

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };
type ToolCallback = (params: Record<string, unknown>) => Promise<ToolResult>;

const schemas: Record<string, Record<string, { description?: string }>> = {};

function tool(name: string): ToolCallback {
  const tools: Record<string, ToolCallback> = {};
  registerMixcheckTools({
    tool: (n: string, _d: string, s: Record<string, { description?: string }>, cb: ToolCallback) => { tools[n] = cb; schemas[n] = s; },
  } as unknown as McpServer);
  return tools[name];
}

const json = (r: ToolResult) => JSON.parse(r.content[0].text);

/** What the fake REAPER holds: track names, rendered files still on disk, inserted tracks. */
let reaper: { names: string[]; rendered: string[]; ranges: [number, number][]; onDisk: Set<string>; inserted: { name: string; position: number }[]; insertFails: boolean };

function fakeBridge() {
  vi.mocked(sendCommand).mockImplementation(async (type: string, params: Record<string, unknown> = {}) => {
    const ok = (data: unknown) => ({ id: 'x', success: true, timestamp: 0, data });
    if (type === 'render_track_to_wav') {
      const path = `/tmp/render${reaper.rendered.length}.wav`;
      reaper.rendered.push(path);
      reaper.ranges.push([params['startTime'] as number, params['endTime'] as number]);
      reaper.onDisk.add(path);
      const i = params['trackIndex'] as number;
      return ok({ trackIndex: i, trackName: i === -1 ? 'Master' : reaper.names[i], wavPath: path });
    }
    if (type === 'get_project_info') return ok({ name: 'Song', path: '/music/Song/Media' });
    if (type === 'insert_stem_tracks') {
      if (reaper.insertFails) return { id: 'x', success: false, timestamp: 0, error: 'file not found: /x.wav' };
      const files = JSON.parse(params['files'] as string) as { name: string }[];
      for (const f of files) reaper.inserted.push({ name: f.name, position: params['position'] as number });
      return ok({ folderIndex: 3, folderName: params['folderName'], tracks: files.map((f, k) => ({ trackIndex: 4 + k, name: f.name })) });
    }
    return ok({});
  });
}

function sidecar(overrides: Record<string, unknown> = {}) {
  const client = {
    isAvailable: () => true,
    loudnessCurve: async () => ({
      integratedLufs: -9.5, truePeakDbtp: -0.6, loudnessRangeLu: 4.2, plrDb: 8.9,
      shortTerm: { step: 1, lufs: [-14, -12, -8, -8, -13] },
      loudest: { start: 2, end: 5, lufs: -8 }, quietest: { start: 0, end: 3, lufs: -14 },
      overTarget: [{ start: 1.5, end: 6, maxLufs: -8 }], overTargetSeconds: 4.5, startTime: 0,
    }),
    stereoBands: async () => ({
      bands: [{ band: 'low', correlation: -0.8, worst: -0.95, negativeShare: 0.9, sideToMidDb: 3 }, { band: 'mid', correlation: 0.4 }],
      flags: ['low end out of phase (correlation -0.80): it cancels in mono'], startTime: 0,
    }),
    masking: async ({ tracks }: { tracks: { name: string }[] }) => ({
      bandsHz: [63, 100, 160],
      tracks: tracks.map((t) => t.name),
      pairs: [
        { a: tracks[0].name, b: tracks[1].name, scores: [0.1, 0.9, 0.4], overall: 0.47 },
        { a: tracks[0].name, b: tracks[2].name, scores: [0, 0, 0.3], overall: 0.1 },
        { a: tracks[1].name, b: tracks[2].name, scores: [0.7, 0.8, 0.9], overall: 0.8 },
      ],
      conflicts: [{ a: tracks[0].name, b: tracks[1].name, hz: 100, score: 0.9, suggestion: `cut ${tracks[1].name} around 100 Hz` }],
    }),
    separationStatus: async () => ({ installed: true, message: '' }),
    separate: async (p: { outDir: string; stems?: string[] }) => ({
      model: 'htdemucs', sampleRate: 44100, device: 'mps', seconds: 20, processingSeconds: 8,
      outDir: p.outDir,
      stems: (p.stems ?? ['drums', 'bass', 'other', 'vocals']).map((s) => ({ stem: s, path: `${p.outDir}/${s}.wav`, peakDbfs: -3, lufs: -18 })),
    }),
    ...overrides,
  };
  vi.mocked(getSidecarClient).mockReturnValue(client as unknown as ReturnType<typeof getSidecarClient>);
}

beforeEach(() => {
  vi.clearAllMocks();
  reaper = { names: ['Kick', 'Bass', 'Keys', 'Bass'], rendered: [], ranges: [], onDisk: new Set(), inserted: [], insertFails: false };
  vi.mocked(unlink).mockImplementation(async (p) => { reaper.onDisk.delete(String(p)); });
  fakeBridge();
  sidecar();
});

describe('analyze_loudness_curve', () => {
  it('reports a track\'s loudest window and spans over target in project time, and deletes the render', async () => {
    const r = json(await tool('analyze_loudness_curve')({ trackIndex: -1, startTime: 60, endTime: 120, targetLufs: -14 }));
    expect(r.trackName).toBe('Master');
    expect(r.startTime).toBe(60);
    expect(r.loudest).toEqual({ start: 62, end: 65, lufs: -8 });
    expect(r.overTarget[0]).toMatchObject({ start: 61.5, end: 66 });
    expect(r.targetLufs).toBe(-14);
    expect(reaper.onDisk.size).toBe(0);
  });

  it('reads a file as-is: times stay in the file\'s own seconds and nothing is rendered', async () => {
    const r = json(await tool('analyze_loudness_curve')({ path: '/refs/song.wav' }));
    expect(r.path).toBe('/refs/song.wav');
    expect(r.loudest.start).toBe(2);
    expect(reaper.rendered).toEqual([]);
  });

  it('refuses a call naming both a track and a file, or neither, without rendering', async () => {
    expect((await tool('analyze_loudness_curve')({ trackIndex: 0, path: '/a.wav' })).isError).toBe(true);
    const neither = await tool('analyze_loudness_curve')({});
    expect(neither.isError).toBe(true);
    expect(neither.content[0].text).toMatch(/trackIndex or path/);
    expect(reaper.rendered).toEqual([]);
  });

  it('refuses a range over the cap without rendering', async () => {
    const r = await tool('analyze_loudness_curve')({ trackIndex: 0, startTime: 0, endTime: 1000 });
    expect(r.content[0].text).toMatch(/max 900 s/);
    expect(reaper.rendered).toEqual([]);
  });

  it('says how to install the sidecar when it is missing', async () => {
    sidecar({ isAvailable: () => false });
    const r = await tool('analyze_loudness_curve')({ trackIndex: 0 });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/setup-sidecar/);
  });
});

describe('analyze_stereo_bands', () => {
  it('returns each band and the out-of-phase low end flag', async () => {
    const r = json(await tool('analyze_stereo_bands')({ trackIndex: 1 }));
    expect(r.trackName).toBe('Bass');
    expect(r.bands[0]).toMatchObject({ band: 'low', correlation: -0.8 });
    expect(r.flags[0]).toMatch(/low end out of phase/);
  });

  it('passes the sidecar\'s refusal of a mono file on, and still deletes the render', async () => {
    sidecar({ stereoBands: async () => { throw new Error('Needs a stereo source'); } });
    const r = await tool('analyze_stereo_bands')({ trackIndex: 0 });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/stereo/);
    expect(reaper.onDisk.size).toBe(0);
  });
});

describe('measure_masking', () => {
  it('ranks pairs by how much they mask, names their worst bands, and tells same-named tracks apart', async () => {
    const r = json(await tool('measure_masking')({ tracks: [0, 1, 3], startTime: 30 }));
    expect(r.tracks.map((t: { name: string }) => t.name)).toEqual(['Kick', 'Bass', 'Bass (4)']);
    expect(r.pairs[0]).toMatchObject({ a: 'Bass', b: 'Bass (4)', overall: 0.8 });
    expect(r.pairs[0].worstBands[0]).toEqual({ hz: 160, score: 0.9 });
    expect(r.pairs[1].worstBands.map((b: { hz: number }) => b.hz)).toEqual([100, 160, 63]);
    expect(r.conflicts[0].suggestion).toMatch(/cut Bass around 100 Hz/);
    expect(r.endTime).toBe(50);
    expect(reaper.onDisk.size).toBe(0);
  });

  it('says nothing masks when there is no conflict', async () => {
    sidecar({ masking: async () => ({ bandsHz: [100], tracks: ['Kick', 'Keys'], pairs: [], conflicts: [] }) });
    const r = json(await tool('measure_masking')({ tracks: [0, 2], startTime: 0 }));
    expect(r.note).toMatch(/nothing masks/);
  });

  it('refuses a repeated track before rendering anything', async () => {
    const r = await tool('measure_masking')({ tracks: [1, 1], startTime: 0 });
    expect(r.isError).toBe(true);
    expect(reaper.rendered).toEqual([]);
  });

  it('deletes every render when the analysis fails', async () => {
    sidecar({ masking: async () => { throw new Error('Sample rates differ: 44100 vs 48000'); } });
    const r = await tool('measure_masking')({ tracks: [0, 1, 2], startTime: 0, durationSeconds: MAX_MASKING_SECONDS });
    expect(r.content[0].text).toMatch(/Sample rates differ/);
    expect(reaper.rendered).toHaveLength(3);
    expect(reaper.onDisk.size).toBe(0);
  });
});

describe('separate_stems', () => {
  it('writes stems under the project\'s Stems folder and inserts them after the track, lined up with the range', async () => {
    const r = json(await tool('separate_stems')({ trackIndex: 2, startTime: 30, endTime: 50, insertTracks: true }));
    expect(r.outDir).toMatch(/^\/music\/Song\/Media\/Stems\/Keys-\d{8}-\d{6}$/);
    expect(r.stems.map((s: { stem: string }) => s.stem)).toEqual(['drums', 'bass', 'other', 'vocals']);
    expect(r.inserted.folderName).toBe('Keys stems');
    expect(reaper.inserted).toEqual(['Drums', 'Bass', 'Other', 'Vocals'].map((name) => ({ name, position: 30 })));
    expect(reaper.onDisk.size).toBe(0);
  });

  it('places a file\'s stems at filePosition + startTime', async () => {
    await tool('separate_stems')({ path: '/refs/song.flac', startTime: 10, endTime: 40, filePosition: 5, insertTracks: true, outDir: '/out' });
    expect(reaper.inserted[0].position).toBe(15);
    expect(reaper.rendered).toEqual([]);
  });

  it('writes only the stems asked for, and inserts nothing without insertTracks', async () => {
    const r = json(await tool('separate_stems')({ path: '/a.wav', stems: ['vocals'], outDir: '/out' }));
    expect(r.stems).toEqual([{ stem: 'vocals', path: '/out/vocals.wav', peakDbfs: -3, lufs: -18 }]);
    expect(reaper.inserted).toEqual([]);
  });

  it('refuses a guitar stem from the 4-stem model before rendering', async () => {
    const r = await tool('separate_stems')({ trackIndex: 0, model: 'htdemucs', stems: ['guitar'] });
    expect(r.content[0].text).toMatch(/htdemucs_6s/);
    expect(reaper.rendered).toEqual([]);
  });

  it('keeps the written stems and warns when inserting them fails', async () => {
    reaper.insertFails = true;
    const r = await tool('separate_stems')({ path: '/a.wav', outDir: '/out', insertTracks: true });
    expect(r.isError).toBeUndefined();
    const data = json(r);
    expect(data.stems).toHaveLength(4);
    expect(data.warning).toMatch(/inserting them failed: file not found/);
  });

  it('says how to install Demucs when it is missing, before rendering anything', async () => {
    sidecar({ separationStatus: async () => ({ installed: false, message: 'Stem separation is not installed. Run: reaper-mcp setup-sidecar --with-separation' }) });
    const r = await tool('separate_stems')({ trackIndex: 0 });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/--with-separation/);
    expect(reaper.rendered).toEqual([]);
  });

  it('splits the first 60 s of a track when no endTime is given, as its schema says', async () => {
    await tool('separate_stems')({ trackIndex: 0, startTime: 10 });
    expect(schemas['separate_stems']['endTime'].description).toContain('startTime + 60');
    expect(reaper.ranges).toEqual([[10, 70]]);
  });
});
