/**
 * Vitest unit tests for tools/offline.ts (analyze_track_offline, analyze_audio_file,
 * measure_track_alignment, verify_edit). The bridge, the sidecar and unlink are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bridge.js', () => ({ sendCommand: vi.fn() }));
vi.mock('../sidecar.js', () => ({ getSidecarClient: vi.fn() }));
vi.mock('node:fs/promises', () => ({ unlink: vi.fn() }));

import { sendCommand } from '../bridge.js';
import { getSidecarClient } from '../sidecar.js';
import { unlink } from 'node:fs/promises';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerOfflineTools, MAX_OFFLINE_SECONDS } from './offline.js';

const sendCommandMock = sendCommand as unknown as ReturnType<typeof vi.fn>;
const getSidecarClientMock = getSidecarClient as unknown as ReturnType<typeof vi.fn>;
const unlinkMock = unlink as unknown as ReturnType<typeof vi.fn>;

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };
type ToolCallback = (params: Record<string, unknown>) => Promise<ToolResult>;

function tool(name: string): ToolCallback {
  const tools: Record<string, ToolCallback> = {};
  registerOfflineTools({
    tool: (n: string, _d: string, _s: unknown, cb: ToolCallback) => { tools[n] = cb; },
  } as unknown as McpServer);
  return tools[name];
}

const ANALYSIS = {
  loudness: { integratedLufs: -9.8, loudnessRangeLu: 5.1, truePeakDbtp: -0.4, sections: [{ start: 0, end: 10, lufs: -10.2 }] },
  spectrum: { bandBalanceDb: { bass: -4 } },
};

const VERIFY = {
  verdict: 'ok',
  expect: 'identical',
  sampleRate: 44100,
  checks: {
    discontinuity: { verdict: 'ok', score: 4.4, referenceScore: 4.4, atSeconds: 1.2 },
    null: { verdict: 'ok', delayMs: 4, gainDb: -3, polarityInverted: false, residualDb: -118.1 },
  },
};

function sidecar(available = true) {
  const client = {
    isAvailable: vi.fn().mockReturnValue(available),
    analyzeAudio: vi.fn().mockResolvedValue(structuredClone(ANALYSIS)),
    verifyEdit: vi.fn().mockResolvedValue(structuredClone(VERIFY)),
    align: vi.fn().mockResolvedValue({ delaySamples: 37, delayMs: 0.839, correlation: 0.93, polarityInverted: true }),
  };
  getSidecarClientMock.mockReturnValue(client);
  return client;
}

let renders = 0;
const wavFor = (trackIndex: number, extra: Record<string, unknown> = {}) =>
  ({ trackIndex, trackName: `T${trackIndex}`, wavPath: `/tmp/r${renders++}.wav`, durationSeconds: 5, sampleRate: 44100, channelCount: 2, ...extra });
/** A bridge that renders one track per render_track_to_wav and many per render_tracks_to_wav */
function renderOk(extra: Record<string, unknown> = {}) {
  sendCommandMock.mockImplementation(async (type: string, params: { trackIndex: number; trackIndices: number[] }) => ({
    id: 'r', success: true, timestamp: 0,
    data: type === 'render_tracks_to_wav'
      ? { tracks: params.trackIndices.map((t) => wavFor(t, extra)), rendered: params.trackIndices.length, cached: 0 }
      : wavFor(params.trackIndex, extra),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  renders = 0;
  unlinkMock.mockResolvedValue(undefined);
});

describe('analyze_track_offline', () => {
  it('renders the range once, analyzes it and reports sections in project time', async () => {
    const client = sidecar();
    renderOk();

    const result = await tool('analyze_track_offline')({ trackIndex: -1, startTime: 60, endTime: 180, sectionSeconds: 10 });

    expect(sendCommandMock.mock.calls.filter(([type]) => type === 'render_track_to_wav')).toHaveLength(1);
    expect(sendCommandMock).toHaveBeenCalledWith('render_track_to_wav',
      expect.objectContaining({ trackIndex: -1, startTime: 60, endTime: 180 }), expect.any(Number));
    expect(client.analyzeAudio).toHaveBeenCalledWith({ path: '/tmp/r0.wav', sectionSeconds: 10 });
    // …and logs a compact result for the bridge status page
    const logged = sendCommandMock.mock.calls.find(([type]) => type === '_log_result');
    expect(logged?.[1]).toMatchObject({ command: 'analyze_track_offline', ok: 1 });
    expect(JSON.parse(logged?.[1].r as string)).toMatchObject({ lufs: -9.8, lra: 5.1, tp: -0.4, sections: [[60, 70, -10.2]] });
    const data = JSON.parse(result.content[0].text);
    expect(data).toMatchObject({ trackIndex: -1, trackName: 'T-1', startTime: 60, endTime: 180 });
    expect(data.loudness.integratedLufs).toBe(-9.8);
    expect(data.loudness.sections[0]).toMatchObject({ start: 60, end: 70 });
    expect(unlinkMock).toHaveBeenCalledWith('/tmp/r0.wav');
  });

  it('leaves a render the bridge keeps in its cache alone, so the next analysis can reuse it', async () => {
    sidecar();
    renderOk({ cacheOwned: true });
    const result = await tool('analyze_track_offline')({ trackIndex: 3, startTime: 0, durationSeconds: 30 });
    expect(result.isError).toBeUndefined();
    expect(unlinkMock).not.toHaveBeenCalled();
  });

  it('passes a reference file through', async () => {
    const client = sidecar();
    renderOk();
    await tool('analyze_track_offline')({ trackIndex: 2, durationSeconds: 30, referencePath: '/refs/song.wav', referenceStartTime: 45 });
    expect(client.analyzeAudio).toHaveBeenCalledWith(expect.objectContaining({ referencePath: '/refs/song.wav', referenceStartTime: 45 }));
  });

  it('refuses a range over the limit without rendering', async () => {
    sidecar();
    const result = await tool('analyze_track_offline')({ trackIndex: 0, startTime: 0, endTime: MAX_OFFLINE_SECONDS + 1 });
    expect(result.isError).toBe(true);
    expect(sendCommandMock).not.toHaveBeenCalled();
  });

  it('says how to install the sidecar when it is missing', async () => {
    sidecar(false);
    const result = await tool('analyze_track_offline')({ trackIndex: 0 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('setup-sidecar');
  });

  it('deletes the render even when the analysis fails', async () => {
    const client = sidecar();
    client.analyzeAudio.mockRejectedValue(new Error('Analysis failed: boom'));
    renderOk();
    const result = await tool('analyze_track_offline')({ trackIndex: 0 });
    expect(result.isError).toBe(true);
    expect(unlinkMock).toHaveBeenCalledWith('/tmp/r0.wav');
  });
});

describe('analyze_audio_file', () => {
  it('analyzes a file without touching REAPER', async () => {
    const client = sidecar();
    const result = await tool('analyze_audio_file')({ path: '/refs/song.wav', startTime: 30, sectionSeconds: 10 });
    expect(sendCommandMock.mock.calls.map(([type]) => type)).toEqual(['_log_result']); // only the status page's log
    expect(client.analyzeAudio).toHaveBeenCalledWith({ path: '/refs/song.wav', startTime: 30, sectionSeconds: 10 });
    expect(JSON.parse(result.content[0].text).loudness.sections[0].start).toBe(30);
  });
});

describe('measure_track_alignment', () => {
  it('renders both tracks over the same range and suggests the offset that aligns them', async () => {
    const client = sidecar();
    renderOk();

    const result = await tool('measure_track_alignment')({ referenceTrack: 30, trackIndex: 31, startTime: 12, durationSeconds: 5, maxLagMs: 10 });

    // One render pass for both tracks, not two
    const renderCalls = sendCommandMock.mock.calls.filter(([type]) => String(type).startsWith('render_')).map(([type, p]) => [type, p as Record<string, unknown>]);
    expect(renderCalls).toHaveLength(1);
    expect(renderCalls[0][0]).toBe('render_tracks_to_wav');
    expect(renderCalls[0][1]).toMatchObject({ trackIndices: [30, 31], startTime: 12, endTime: 17 });
    expect(client.align).toHaveBeenCalledWith({ referencePath: '/tmp/r0.wav', path: '/tmp/r1.wav', maxLagMs: 10 });
    const data = JSON.parse(result.content[0].text);
    expect(data).toMatchObject({ delaySamples: 37, polarityInverted: true, suggestedPlayOffsetMs: -0.839, suggestedPhase: 1, referenceName: 'T30', trackName: 'T31' });
    expect(unlinkMock).toHaveBeenCalledWith('/tmp/r0.wav');
    expect(unlinkMock).toHaveBeenCalledWith('/tmp/r1.wav');
  });

  it('suggests absolute settings that include the track\'s current offset and polarity', async () => {
    const client = sidecar();
    sendCommandMock.mockResolvedValueOnce({ id: 'r', success: true, timestamp: 0, data: { rendered: 2, cached: 0, tracks: [
      { trackName: 'Top', wavPath: '/tmp/a.wav' },
      { trackName: 'Bottom', wavPath: '/tmp/b.wav', playOffsetMs: 2, phaseInverted: true },
    ] } });
    client.align.mockResolvedValue({ delaySamples: 0, delayMs: 0, correlation: 0.97, polarityInverted: false });

    const data = JSON.parse((await tool('measure_track_alignment')({ referenceTrack: 1, trackIndex: 2, startTime: 0 })).content[0].text);

    // Already aligned: re-measuring keeps what the track has instead of resetting it
    expect(data).toMatchObject({ currentPlayOffsetMs: 2, currentPhaseInverted: true, suggestedPlayOffsetMs: 2, suggestedPhase: 1 });
  });

  it('makes no suggestion when the tracks barely correlate', async () => {
    const client = sidecar();
    renderOk();
    client.align.mockResolvedValue({ delaySamples: -434, delayMs: -9.841, correlation: 0.01, polarityInverted: false });
    const data = JSON.parse((await tool('measure_track_alignment')({ referenceTrack: 1, trackIndex: 2, startTime: 0 })).content[0].text);
    expect(data.suggestedPlayOffsetMs).toBeUndefined();
    expect(data.suggestedPhase).toBeUndefined();
    expect(data.warning).toContain('below 0.3');
  });

  it('logs a silent window as a refused call with the sidecar\'s reason', async () => {
    const client = sidecar();
    renderOk();
    const reason = 'The reference and track are silent in this window; pick a range where both play';
    client.align.mockResolvedValue({ delaySamples: null, delayMs: null, correlation: null, polarityInverted: null, error: reason });
    await tool('measure_track_alignment')({ referenceTrack: 1, trackIndex: 2, startTime: 0 });
    const logged = sendCommandMock.mock.calls.find(([type]) => type === '_log_result');
    expect(logged?.[1]).toMatchObject({ command: 'measure_track_alignment', ok: 0, e: reason });
    expect(logged?.[1]).not.toHaveProperty('r');
  });

  it('reports a refused render and analyzes nothing', async () => {
    const client = sidecar();
    sendCommandMock.mockResolvedValueOnce({ id: 'r', success: false, timestamp: 0, error: 'Track 99 not found' });
    const result = await tool('measure_track_alignment')({ referenceTrack: 1, trackIndex: 99, startTime: 0 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Track 99 not found');
    expect(client.align).not.toHaveBeenCalled();
  });

  it('renders one track at a time on a bridge that predates the multi-track render, and cleans up when the second fails', async () => {
    sidecar();
    sendCommandMock.mockImplementation(async (type: string, params: { trackIndex?: number }) => {
      if (type === 'render_tracks_to_wav') return { id: 'r', success: false, timestamp: 0, error: 'Unknown command type: render_tracks_to_wav' };
      if (params.trackIndex === 99) return { id: 'r', success: false, timestamp: 0, error: 'Track 99 not found' };
      return { id: 'r', success: true, timestamp: 0, data: { trackName: 'A', wavPath: '/tmp/a.wav' } };
    });
    const result = await tool('measure_track_alignment')({ referenceTrack: 1, trackIndex: 99, startTime: 0 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Track 99 not found');
    expect(unlinkMock).toHaveBeenCalledWith('/tmp/a.wav');
  });

  it('refuses measuring a track against itself', async () => {
    sidecar();
    const result = await tool('measure_track_alignment')({ referenceTrack: 4, trackIndex: 4, startTime: 0 });
    expect(result.isError).toBe(true);
    expect(sendCommandMock).not.toHaveBeenCalled();
  });
});

describe('verify_edit', () => {
  it('compares the edited track with a reference track and returns the verdict per check', async () => {
    sidecar();
    renderOk();

    const result = await tool('verify_edit')({ trackIndex: 31, referenceTrack: 30, startTime: 12, durationSeconds: 5 });

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data).toMatchObject({
      verdict: 'ok',
      trackName: 'T31',
      referenceName: 'T30',
      startTime: 12,
      endTime: 17,
      checks: { null: { delayMs: 4, gainDb: -3, residualDb: -118.1 }, discontinuity: { verdict: 'ok' } },
    });
    // Both renders are temporary files and are cleaned up
    expect(unlinkMock).toHaveBeenCalledTimes(2);
  });

  it('compares against a file from before the edit and leaves that file alone', async () => {
    sidecar();
    renderOk();

    const result = await tool('verify_edit')({ trackIndex: 5, referencePath: '/bounces/before.wav', startTime: 0 });

    const data = JSON.parse(result.content[0].text);
    expect(data).toMatchObject({ verdict: 'ok', referencePath: '/bounces/before.wav', trackName: 'T5' });
    expect(unlinkMock).not.toHaveBeenCalledWith('/bounces/before.wav');
    expect(unlinkMock).toHaveBeenCalledTimes(1);
  });

  it('passes a fail through with where the click is', async () => {
    const client = sidecar();
    renderOk();
    client.verifyEdit.mockResolvedValue({
      verdict: 'fail',
      expect: 'identical',
      sampleRate: 44100,
      checks: { discontinuity: { verdict: 'fail', score: 13.5, referenceScore: 4.4, atSeconds: 1.5 }, null: { verdict: 'fail', residualDb: -21 } },
    });

    const data = JSON.parse((await tool('verify_edit')({ trackIndex: 2, referenceTrack: 1, startTime: 0 })).content[0].text);

    expect(data.verdict).toBe('fail');
    expect(data.checks.discontinuity).toMatchObject({ verdict: 'fail', atSeconds: 1.5 });
  });

  it('reports where a click is in project time, not time into the rendered window', async () => {
    const client = sidecar();
    renderOk();
    client.verifyEdit.mockResolvedValue({
      verdict: 'fail',
      expect: 'identical',
      sampleRate: 44100,
      checks: { discontinuity: { verdict: 'fail', score: 13.5, referenceScore: 4.4, atSeconds: 1.5 }, null: { verdict: 'ok' } },
    });

    const data = JSON.parse((await tool('verify_edit')({ trackIndex: 2, referenceTrack: 1, startTime: 12, durationSeconds: 5 })).content[0].text);

    expect(data.checks.discontinuity.atSeconds).toBe(13.5);
    expect(data).toMatchObject({ startTime: 12, endTime: 17 });
  });

  it('shows up in the bridge page log, for a verdict and for a refusal', async () => {
    sidecar();
    renderOk();
    await tool('verify_edit')({ trackIndex: 2, referenceTrack: 1, startTime: 0 });
    await tool('verify_edit')({ trackIndex: 2, referenceTrack: 2, startTime: 0 });

    const logged = sendCommandMock.mock.calls.filter(([type]) => type === '_log_result').map(([, p]) => p as Record<string, unknown>);
    expect(logged.map((l) => [l['command'], l['ok']])).toEqual([['verify_edit', 1], ['verify_edit', 0]]);
    expect(String(logged[1]['e'])).toMatch(/must differ/);
  });

  it('refuses without a reference, with two, or against the track itself, and renders nothing', async () => {
    sidecar();
    const verify = tool('verify_edit');

    const none = await verify({ trackIndex: 2, startTime: 0 });
    const both = await verify({ trackIndex: 2, referenceTrack: 1, referencePath: '/a.wav', startTime: 0 });
    const same = await verify({ trackIndex: 2, referenceTrack: 2, startTime: 0 });

    for (const refused of [none, both, same]) expect(refused.isError).toBe(true);
    expect(none.content[0].text).toMatch(/exactly one of referenceTrack/);
    expect(same.content[0].text).toMatch(/must differ/);
    expect(sendCommandMock.mock.calls.filter(([type]) => String(type).startsWith('render_'))).toHaveLength(0);
  });

  it('turns a silent window into an error with the sidecar\'s reason', async () => {
    const client = sidecar();
    renderOk();
    client.verifyEdit.mockResolvedValue({ error: 'The reference is silent over this range' });

    const result = await tool('verify_edit')({ trackIndex: 2, referenceTrack: 1, startTime: 0 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('The reference is silent over this range');
    expect(unlinkMock).toHaveBeenCalledTimes(2);
  });

  it('says how to install the sidecar when it is missing', async () => {
    sidecar(false);
    const result = await tool('verify_edit')({ trackIndex: 2, referenceTrack: 1, startTime: 0 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/setup-sidecar/);
  });

  it('deletes the renders even when the sidecar fails', async () => {
    const client = sidecar();
    renderOk();
    client.verifyEdit.mockRejectedValue(new Error('Verification failed: boom'));

    const result = await tool('verify_edit')({ trackIndex: 2, referenceTrack: 1, startTime: 0 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/boom/);
    expect(unlinkMock).toHaveBeenCalledTimes(2);
  });
});
