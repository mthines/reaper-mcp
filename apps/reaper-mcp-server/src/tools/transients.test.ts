/**
 * Vitest unit tests for tools/transients.ts (detect_transients, create_transient_automation).
 * The sidecar and unlink are mocked; the bridge is a small fake holding one envelope's points.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bridge.js', () => ({ sendCommand: vi.fn() }));
vi.mock('../sidecar.js', () => ({ getSidecarClient: vi.fn() }));
vi.mock('node:fs/promises', () => ({ unlink: vi.fn() }));

import { sendCommand } from '../bridge.js';
import { getSidecarClient } from '../sidecar.js';
import { unlink } from 'node:fs/promises';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTransientTools, pulsePoints, type PulseOptions, type Transient } from './transients.js';

const sendCommandMock = sendCommand as unknown as ReturnType<typeof vi.fn>;
const getSidecarClientMock = getSidecarClient as unknown as ReturnType<typeof vi.fn>;
const unlinkMock = unlink as unknown as ReturnType<typeof vi.fn>;

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };
type ToolCallback = (params: Record<string, unknown>) => Promise<ToolResult>;

function tool(name: string): ToolCallback {
  const tools: Record<string, ToolCallback> = {};
  registerTransientTools({
    tool: (n: string, _d: string, _s: unknown, cb: ToolCallback) => { tools[n] = cb; },
  } as unknown as McpServer);
  return tools[name];
}

const json = (r: ToolResult) => JSON.parse(r.content[0].text);

/** Hits in file time, as the sidecar reports them */
const HITS: Transient[] = [
  { time: 0.5, strength: 1, band: 'low', peakDb: -1 },
  { time: 1.0, strength: 0.4, band: 'high', peakDb: -9 },
  { time: 1.5, strength: 0.9, band: 'low', peakDb: -2 },
  { time: 2.0, strength: 0.7, band: 'mid', peakDb: -4 },
];

function sidecar(available = true) {
  const client = {
    isAvailable: vi.fn().mockReturnValue(available),
    transients: vi.fn().mockImplementation(async () => ({
      durationSeconds: 3,
      count: HITS.length,
      bandCounts: { low: 2, mid: 1, high: 1 },
      tempo: { bpm: 120, confidence: 0.9 },
      transients: structuredClone(HITS),
    })),
  };
  getSidecarClientMock.mockReturnValue(client);
  return client;
}

/** A fake bridge: renders, and one envelope (track 7, envelope 0) that keeps its points */
let envelope: { time: number; value: number; shape?: number }[] = [];
function bridge() {
  sendCommandMock.mockImplementation(async (type: string, params: Record<string, unknown>) => {
    const ok = (data: unknown) => ({ id: 'r', success: true, timestamp: 0, data });
    if (type === 'render_track_to_wav') {
      return ok({ trackIndex: params['trackIndex'], trackName: 'Drums', wavPath: '/tmp/drums.wav', durationSeconds: 3, sampleRate: 44100, channelCount: 2 });
    }
    if (type === '_log_result') return ok({});
    if (params['trackIndex'] !== 7 || params['envelopeIndex'] !== 0) {
      return { id: 'r', success: false, timestamp: 0, error: 'Envelope index 3 out of range (track has 1 envelopes)' };
    }
    if (type === 'remove_envelope_points') {
      const before = envelope.length;
      const kept = envelope.filter((p) => p.time < (params['timeStart'] as number) || p.time >= (params['timeEnd'] as number));
      // REAPER never deletes an envelope's last point
      envelope = kept.length ? kept : envelope.slice(0, 1);
      return ok({ deletedPoints: before - envelope.length, totalPoints: envelope.length });
    }
    if (type === 'get_envelope_points') return ok({ points: envelope.slice(0, 1), total: envelope.length });
    if (type === 'edit_envelope_points') {
      const [{ index, ...fields }] = JSON.parse(params['points'] as string);
      envelope[index] = { ...envelope[index], ...fields };
      return ok({ editedPoints: 1 });
    }
    if (type === 'insert_envelope_points') {
      const points = JSON.parse(params['points'] as string);
      envelope = [...envelope, ...points].sort((a, b) => a.time - b.time);
      return ok({ insertedPoints: points.length, totalPoints: envelope.length });
    }
    throw new Error(`unexpected command ${type}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  envelope = [];
  unlinkMock.mockResolvedValue(undefined);
  bridge();
});

describe('detect_transients', () => {
  it('reports the hits of a file in project time when the file sits later in the project', async () => {
    sidecar();
    const data = json(await tool('detect_transients')({ path: '/songs/master.mp3', filePosition: 10 }));

    expect(data.transients.map((t: Transient) => t.time)).toEqual([10.5, 11, 11.5, 12]);
    expect(data).toMatchObject({ path: '/songs/master.mp3', startTime: 10, endTime: 13, total: 4, tempo: { bpm: 120 } });
  });

  it('keeps only the strong hits of the chosen bands', async () => {
    sidecar();
    const data = json(await tool('detect_transients')({ path: '/a.wav', minStrength: 0.6, bands: ['low'] }));

    expect(data.transients.map((t: Transient) => t.time)).toEqual([0.5, 1.5]);
    expect(data).toMatchObject({ detected: 4, total: 2 });
  });

  it('pages through the hits and summarises sections', async () => {
    sidecar();
    const data = json(await tool('detect_transients')({ path: '/a.wav', offset: 1, limit: 2, sectionSeconds: 1 }));

    expect(data.transients.map((t: Transient) => t.time)).toEqual([1, 1.5]);
    expect(data.hasMore).toBe(true);
    expect(data.sections[0]).toEqual({ start: 0, end: 1, count: 1, meanStrength: 1 });
    expect(data.sections[1]).toMatchObject({ start: 1, end: 2, count: 2 });
  });

  it('renders a track over the range, reports hits from the range start and deletes the render', async () => {
    sidecar();
    const data = json(await tool('detect_transients')({ trackIndex: 3, startTime: 30, endTime: 33 }));

    expect(data).toMatchObject({ trackIndex: 3, trackName: 'Drums', startTime: 30, endTime: 33 });
    expect(data.transients[0].time).toBe(30.5);
    expect(unlinkMock).toHaveBeenCalledWith('/tmp/drums.wav');
  });

  it('refuses a call with both a track and a file, or neither', async () => {
    sidecar();
    expect((await tool('detect_transients')({ trackIndex: 1, path: '/a.wav' })).isError).toBe(true);
    const neither = await tool('detect_transients')({});
    expect(neither.isError).toBe(true);
    expect(neither.content[0].text).toContain('exactly one of trackIndex or path');
  });

  it('says how to install the sidecar when it is missing', async () => {
    sidecar(false);
    const result = await tool('detect_transients')({ path: '/a.wav' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('setup-sidecar');
  });
});

const PULSE: PulseOptions = { baseValue: 0, peakValue: 1, scaleByStrength: true, attackMs: 0, holdMs: 20, decayMs: 100, decayShape: 3 };

describe('pulsePoints', () => {
  it('jumps to each hit\'s level, holds, then decays back to the base', () => {
    const points = pulsePoints([{ time: 1, strength: 0.5, band: 'low' }], PULSE, 0);

    expect(points).toEqual([
      { time: 0, value: 0, shape: 1 },
      { time: 1, value: 0.5, shape: 0 },
      { time: 1.02, value: 0.5, shape: 3 },
      { time: 1.12, value: 0, shape: 1 },
    ]);
  });

  it('cuts a pulse short at its current level when the next hit comes first', () => {
    const points = pulsePoints([
      { time: 1, strength: 1, band: 'low' },
      { time: 1.07, strength: 1, band: 'low' },
    ], { ...PULSE, decayShape: 0 }, 0);

    const cut = points.find((p) => p.time > 1.02 && p.time < 1.07);
    expect(cut?.shape).toBe(1);
    expect(cut?.value).toBeCloseTo(0.5, 1); // about halfway down a 100 ms linear decay
    expect(points.filter((p) => p.time > 1.07 && p.time < 1.12 && p.value === 0)).toEqual([]);
  });

  it('reaches peakValue on every hit when strength scaling is off, between custom base and peak', () => {
    const points = pulsePoints(HITS, { ...PULSE, baseValue: 0.2, peakValue: 0.8, scaleByStrength: false }, 0);
    const levels = points.filter((p) => p.value !== 0.2).map((p) => p.value);
    expect(new Set(levels)).toEqual(new Set([0.8]));
  });

  it('starts each pulse from the base when there is an attack', () => {
    const points = pulsePoints([{ time: 1, strength: 1, band: 'mid' }], { ...PULSE, attackMs: 50 }, 0);
    expect(points.slice(1, 3)).toEqual([
      { time: 0.95, value: 0, shape: 0 },
      { time: 1, value: 1, shape: 0 },
    ]);
  });
});

describe('create_transient_automation', () => {
  it('writes one pulse per hit onto the envelope, replacing what was in the range', async () => {
    sidecar();
    envelope = [{ time: 1.2, value: 0.3 }, { time: 60, value: 0.3 }];

    const data = json(await tool('create_transient_automation')({
      path: '/songs/master.mp3', targetTrack: 7, envelopeIndex: 0, bands: ['low'],
    }));

    expect(data).toMatchObject({ hits: 2, deletedPoints: 1 });
    // The point outside the range stays; the old one inside is gone
    expect(envelope.some((p) => p.time === 60)).toBe(true);
    expect(envelope.some((p) => p.time === 1.2)).toBe(false);
    // Full flash on the 0.5 s kick, 0.9 on the 1.5 s kick, back to 0 after each
    expect(envelope.find((p) => p.time === 0.5)?.value).toBe(1);
    expect(envelope.find((p) => p.time === 1.5)?.value).toBe(0.9);
    expect(envelope.filter((p) => p.time > 1.5 && p.time < 60).at(-1)?.value).toBe(0);
  });

  it('leaves no stale point beside the first pulse when the envelope had only its default point', async () => {
    sidecar();
    envelope = [{ time: 0, value: 0.25, shape: 5 }];

    const data = json(await tool('create_transient_automation')({ path: '/a.wav', targetTrack: 7, envelopeIndex: 0 }));

    expect(envelope.filter((p) => p.time === 0)).toEqual([{ time: 0, value: 0, shape: 1 }]);
    expect(data.insertedPoints).toBe(envelope.length);
  });

  it('returns the points without writing on a dry run', async () => {
    sidecar();
    const data = json(await tool('create_transient_automation')({
      path: '/a.wav', targetTrack: 7, envelopeIndex: 0, dryRun: true,
    }));

    expect(data.dryRun).toBe(true);
    expect(data.pointCount).toBe(data.points.length);
    expect(data.points.length).toBeGreaterThan(4);
    expect(envelope).toEqual([]);
  });

  it('refuses when no hit is left after filtering and writes nothing', async () => {
    sidecar();
    const result = await tool('create_transient_automation')({
      path: '/a.wav', targetTrack: 7, envelopeIndex: 0, minStrength: 1, bands: ['high'],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No hits left');
    expect(envelope).toEqual([]);
  });

  it('passes on the bridge\'s refusal for an unknown envelope', async () => {
    sidecar();
    const result = await tool('create_transient_automation')({ path: '/a.wav', targetTrack: 7, envelopeIndex: 3 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('out of range');
  });
});
