/**
 * Vitest unit tests for tools/offline.ts (analyze_track_offline, analyze_audio_file,
 * measure_track_alignment). The bridge, the sidecar and unlink are mocked.
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

function sidecar(available = true) {
  const client = {
    isAvailable: vi.fn().mockReturnValue(available),
    analyzeAudio: vi.fn().mockResolvedValue(structuredClone(ANALYSIS)),
    align: vi.fn().mockResolvedValue({ delaySamples: 37, delayMs: 0.839, correlation: 0.93, polarityInverted: true }),
  };
  getSidecarClientMock.mockReturnValue(client);
  return client;
}

let renders = 0;
function renderOk() {
  sendCommandMock.mockImplementation(async (_type: string, params: { trackIndex: number }) => ({
    id: 'r', success: true, timestamp: 0,
    data: { trackIndex: params.trackIndex, trackName: `T${params.trackIndex}`, wavPath: `/tmp/r${renders++}.wav`, durationSeconds: 5, sampleRate: 44100, channelCount: 2 },
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

    expect(sendCommandMock).toHaveBeenCalledTimes(1);
    expect(sendCommandMock).toHaveBeenCalledWith('render_track_to_wav',
      expect.objectContaining({ trackIndex: -1, startTime: 60, endTime: 180 }), expect.any(Number));
    expect(client.analyzeAudio).toHaveBeenCalledWith({ path: '/tmp/r0.wav', sectionSeconds: 10 });
    const data = JSON.parse(result.content[0].text);
    expect(data).toMatchObject({ trackIndex: -1, trackName: 'T-1', startTime: 60, endTime: 180 });
    expect(data.loudness.integratedLufs).toBe(-9.8);
    expect(data.loudness.sections[0]).toMatchObject({ start: 60, end: 70 });
    expect(unlinkMock).toHaveBeenCalledWith('/tmp/r0.wav');
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
    expect(sendCommandMock).not.toHaveBeenCalled();
    expect(client.analyzeAudio).toHaveBeenCalledWith({ path: '/refs/song.wav', startTime: 30, sectionSeconds: 10 });
    expect(JSON.parse(result.content[0].text).loudness.sections[0].start).toBe(30);
  });
});

describe('measure_track_alignment', () => {
  it('renders both tracks over the same range and suggests the offset that aligns them', async () => {
    const client = sidecar();
    renderOk();

    const result = await tool('measure_track_alignment')({ referenceTrack: 30, trackIndex: 31, startTime: 12, durationSeconds: 5, maxLagMs: 10 });

    const renderCalls = sendCommandMock.mock.calls.map(([, p]) => p as Record<string, number>);
    expect(renderCalls.map((p) => [p['trackIndex'], p['startTime'], p['endTime']])).toEqual([[30, 12, 17], [31, 12, 17]]);
    expect(client.align).toHaveBeenCalledWith({ referencePath: '/tmp/r0.wav', path: '/tmp/r1.wav', maxLagMs: 10 });
    const data = JSON.parse(result.content[0].text);
    expect(data).toMatchObject({ delaySamples: 37, polarityInverted: true, suggestedPlayOffsetMs: -0.839, suggestedPhase: 1, referenceName: 'T30', trackName: 'T31' });
    expect(unlinkMock).toHaveBeenCalledWith('/tmp/r0.wav');
    expect(unlinkMock).toHaveBeenCalledWith('/tmp/r1.wav');
  });

  it('suggests absolute settings that include the track\'s current offset and polarity', async () => {
    const client = sidecar();
    sendCommandMock
      .mockResolvedValueOnce({ id: 'r', success: true, timestamp: 0, data: { trackName: 'Top', wavPath: '/tmp/a.wav' } })
      .mockResolvedValueOnce({ id: 'r', success: true, timestamp: 0, data: { trackName: 'Bottom', wavPath: '/tmp/b.wav', playOffsetMs: 2, phaseInverted: true } });
    client.align.mockResolvedValue({ delaySamples: 0, delayMs: 0, correlation: 0.97, polarityInverted: false });

    const data = JSON.parse((await tool('measure_track_alignment')({ referenceTrack: 1, trackIndex: 2, startTime: 0 })).content[0].text);

    // Already aligned: re-measuring keeps what the track has instead of resetting it
    expect(data).toMatchObject({ currentPlayOffsetMs: 2, currentPhaseInverted: true, suggestedPlayOffsetMs: 2, suggestedPhase: 1 });
  });

  it('cleans up the first render when the second fails', async () => {
    sidecar();
    sendCommandMock
      .mockResolvedValueOnce({ id: 'r', success: true, timestamp: 0, data: { trackName: 'A', wavPath: '/tmp/a.wav' } })
      .mockResolvedValueOnce({ id: 'r', success: false, timestamp: 0, error: 'Track 99 not found' });
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
