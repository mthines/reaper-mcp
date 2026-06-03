/**
 * Vitest unit tests for tools/aesthetics.ts
 *
 * Mock strategy:
 *   - vi.mock('../bridge.js')  — intercept sendCommand
 *   - vi.mock('../sidecar.js') — intercept getSidecarClient
 *   - vi.mock('node:fs/promises') — intercept unlink (verify cleanup)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — hoisted
// ---------------------------------------------------------------------------

vi.mock('../bridge.js', () => ({
  sendCommand: vi.fn(),
}));

vi.mock('../sidecar.js', () => ({
  getSidecarClient: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  unlink: vi.fn(),
}));

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn().mockReturnValue('test-uuid-1234'),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { sendCommand } from '../bridge.js';
import { getSidecarClient } from '../sidecar.js';
import { unlink } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAestheticsTools } from './aesthetics.js';

const sendCommandMock = sendCommand as unknown as ReturnType<typeof vi.fn>;
const getSidecarClientMock = getSidecarClient as unknown as ReturnType<typeof vi.fn>;
const unlinkMock = unlink as unknown as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_WAV_PATH = '/tmp/mcp_aes_testuuid12340000.wav';

function makeMockSidecar(available = true, scores?: object) {
  const defaultScores = {
    CE: 5.15,
    CU: 5.78,
    PC: 2.15,
    PQ: 7.22,
    durationSeconds: 5.0,
    modelVersion: 'facebook/audiobox-aesthetics',
  };
  return {
    isAvailable: vi.fn().mockReturnValue(available),
    analyze: vi.fn().mockResolvedValue(scores ?? defaultScores),
    shutdown: vi.fn(),
  };
}

function makeRenderSuccess(wavPath = MOCK_WAV_PATH) {
  return {
    success: true,
    data: {
      trackIndex: 0,
      trackName: 'Kick',
      wavPath,
      durationSeconds: 5.0,
      sampleRate: 44100,
      channelCount: 2,
    },
  };
}

// ---------------------------------------------------------------------------
// Tool invocation helper — registers tools and calls them directly
// ---------------------------------------------------------------------------

type ToolCallback = (params: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;

function getToolCallback(toolName: string): ToolCallback {
  const registeredTools: Record<string, ToolCallback> = {};
  const mockServer = {
    tool: (name: string, _description: string, _schema: unknown, callback: ToolCallback) => {
      registeredTools[name] = callback;
    },
  } as unknown as McpServer;

  registerAestheticsTools(mockServer);

  const cb = registeredTools[toolName];
  if (!cb) throw new Error(`Tool ${toolName} not registered`);
  return cb;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('analyze_track_aesthetics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    unlinkMock.mockResolvedValue(undefined);
  });

  // -------------------------------------------------------------------------
  // Test 1: Success path
  // -------------------------------------------------------------------------

  it('returns 4 scores on success', async () => {
    const sidecar = makeMockSidecar(true);
    getSidecarClientMock.mockReturnValue(sidecar);
    sendCommandMock.mockResolvedValue(makeRenderSuccess());

    const cb = getToolCallback('analyze_track_aesthetics');
    const res = await cb({ trackIndex: 0, durationSeconds: 5 });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.productionQuality).toBe(7.22);
    expect(data.productionComplexity).toBe(2.15);
    expect(data.contentEnjoyment).toBe(5.15);
    expect(data.contentUsefulness).toBe(5.78);
    expect(data.trackName).toBe('Kick');
    expect(data.modelVersion).toBe('facebook/audiobox-aesthetics');
  });

  // -------------------------------------------------------------------------
  // Test 2: Sidecar not available
  // -------------------------------------------------------------------------

  it('returns isError when sidecar is not installed', async () => {
    const sidecar = makeMockSidecar(false);
    getSidecarClientMock.mockReturnValue(sidecar);

    const cb = getToolCallback('analyze_track_aesthetics');
    const res = await cb({ trackIndex: 0 });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('setup-sidecar');
    expect(res.content[0].text).toContain('not installed');
  });

  // -------------------------------------------------------------------------
  // Test 3: Render error — sendCommand returns failure
  // -------------------------------------------------------------------------

  it('returns isError when render fails', async () => {
    const sidecar = makeMockSidecar(true);
    getSidecarClientMock.mockReturnValue(sidecar);
    sendCommandMock.mockResolvedValue({ success: false, error: 'Track 999 not found' });

    const cb = getToolCallback('analyze_track_aesthetics');
    const res = await cb({ trackIndex: 999 });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Render failed');
    expect(res.content[0].text).toContain('Track 999 not found');
  });

  // -------------------------------------------------------------------------
  // Test 4: Audio too short — sidecar throws
  // -------------------------------------------------------------------------

  it('returns isError when sidecar reports audio too short', async () => {
    const sidecar = makeMockSidecar(true);
    sidecar.analyze.mockRejectedValue(new Error('Audio too short: 0.30s (minimum 0.5s)'));
    getSidecarClientMock.mockReturnValue(sidecar);
    sendCommandMock.mockResolvedValue(makeRenderSuccess());

    const cb = getToolCallback('analyze_track_aesthetics');
    const res = await cb({ trackIndex: 0 });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Audio too short');
  });

  // -------------------------------------------------------------------------
  // Test 5: Cleanup on sidecar error — unlink called in finally
  // -------------------------------------------------------------------------

  it('calls unlink in finally even when sidecar throws', async () => {
    const sidecar = makeMockSidecar(true);
    sidecar.analyze.mockRejectedValue(new Error('Inference failed'));
    getSidecarClientMock.mockReturnValue(sidecar);
    sendCommandMock.mockResolvedValue(makeRenderSuccess(MOCK_WAV_PATH));

    const cb = getToolCallback('analyze_track_aesthetics');
    const res = await cb({ trackIndex: 0 });

    expect(res.isError).toBe(true);
    // unlink should have been called with the wav path
    expect(unlinkMock).toHaveBeenCalledWith(MOCK_WAV_PATH);
  });

  // -------------------------------------------------------------------------
  // Test 6: Cleanup on success — unlink also called on happy path
  // -------------------------------------------------------------------------

  it('calls unlink after successful analysis', async () => {
    const sidecar = makeMockSidecar(true);
    getSidecarClientMock.mockReturnValue(sidecar);
    sendCommandMock.mockResolvedValue(makeRenderSuccess(MOCK_WAV_PATH));

    const cb = getToolCallback('analyze_track_aesthetics');
    await cb({ trackIndex: 0, durationSeconds: 5 });

    expect(unlinkMock).toHaveBeenCalledWith(MOCK_WAV_PATH);
  });

  // -------------------------------------------------------------------------
  // Test 7: Correct time bounds passed to sendCommand and sidecar
  // -------------------------------------------------------------------------

  it('passes explicit startTime/endTime through correctly', async () => {
    const sidecar = makeMockSidecar(true);
    getSidecarClientMock.mockReturnValue(sidecar);
    sendCommandMock.mockResolvedValue(makeRenderSuccess());

    const cb = getToolCallback('analyze_track_aesthetics');
    await cb({ trackIndex: 2, startTime: 10, endTime: 15 });

    expect(sendCommandMock).toHaveBeenCalledWith('render_track_to_wav', expect.objectContaining({
      trackIndex: 2,
      startTime: 10,
      endTime: 15,
    }));
    expect(sidecar.analyze).toHaveBeenCalledWith(expect.any(String), 10, 15);
  });
});
