import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bridge.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../bridge.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMeterTools } from './meters.js';

const mockedSendCommand = vi.mocked(sendCommand);

function captureTools() {
  const tools: Record<string, { handler: (...args: unknown[]) => unknown }> = {};
  const mockServer = {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: (...args: unknown[]) => unknown) => {
      tools[name] = { handler };
    }),
  } as unknown as McpServer;
  registerMeterTools(mockServer);
  return tools;
}

describe('meter tools', () => {
  let tools: ReturnType<typeof captureTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    tools = captureTools();
  });

  describe('read_track_meters', () => {
    it('returns dB meter values', async () => {
      const meterData = {
        trackIndex: 0,
        peakL: -6.2,
        peakR: -5.8,
        rmsL: -12.1,
        rmsR: -11.9,
      };

      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: meterData,
        timestamp: Date.now(),
      });

      const result = await tools['read_track_meters'].handler({ trackIndex: 0 });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(meterData, null, 2) }],
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('read_track_meters', { trackIndex: 0 });
    });

    it('returns error when track not found', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: false,
        error: 'Track 99 not found',
        timestamp: Date.now(),
      });

      const result = await tools['read_track_meters'].handler({ trackIndex: 99 });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: Track 99 not found' }],
        isError: true,
      });
    });
  });

  describe('read_track_spectrum', () => {
    const spectrumData = {
      trackIndex: 0,
      fftSize: 4096,
      sampleRate: 44100,
      binCount: 2048,
      frequencyResolution: 44100 / 4096,
      peakDb: -6,
      rmsDb: -12,
      bins: new Array(2048).fill(-120),
    };

    it('returns 1/3-octave bands without the raw bins', async () => {
      mockedSendCommand.mockResolvedValue({ id: 'test', success: true, data: spectrumData, timestamp: Date.now() });

      const result = (await tools['read_track_spectrum'].handler({ trackIndex: 0 })) as { content: { text: string }[] };
      const out = JSON.parse(result.content[0].text);
      expect(out.bins).toBeUndefined();
      expect(out.binCount).toBeUndefined();
      expect(out.peakDb).toBe(-6);
      expect(out.bands.at(-1).hz).toBe(16000);
      expect(mockedSendCommand).toHaveBeenCalledWith('read_track_spectrum', { trackIndex: 0, fftSize: 4096 });
    });

    it('returns the raw bins with includeBins', async () => {
      mockedSendCommand.mockResolvedValue({ id: 'test', success: true, data: spectrumData, timestamp: Date.now() });

      const result = (await tools['read_track_spectrum'].handler({ trackIndex: 0, includeBins: true })) as { content: { text: string }[] };
      expect(JSON.parse(result.content[0].text).bins).toHaveLength(2048);
    });

    it('passes custom fftSize', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: { bins: [] },
        timestamp: Date.now(),
      });

      await tools['read_track_spectrum'].handler({ trackIndex: 0, fftSize: 8192 });
      expect(mockedSendCommand).toHaveBeenCalledWith('read_track_spectrum', { trackIndex: 0, fftSize: 8192 });
    });

    it('returns error when analyzer not installed', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: false,
        error: "MCP Spectrum Analyzer JSFX not found. Run 'reaper-mcp setup' to install it.",
        timestamp: Date.now(),
      });

      const result = await tools['read_track_spectrum'].handler({ trackIndex: 0 });
      expect(result).toEqual({
        content: [{ type: 'text', text: "Error: MCP Spectrum Analyzer JSFX not found. Run 'reaper-mcp setup' to install it." }],
        isError: true,
      });
    });
  });
});
