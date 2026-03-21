import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bridge.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../bridge.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAnalysisTools } from './analysis.js';

const mockedSendCommand = vi.mocked(sendCommand);

function captureTools() {
  const tools: Record<string, { handler: (...args: unknown[]) => unknown }> = {};
  const mockServer = {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: (...args: unknown[]) => unknown) => {
      tools[name] = { handler };
    }),
  } as unknown as McpServer;
  registerAnalysisTools(mockServer);
  return tools;
}

describe('analysis tools', () => {
  let tools: ReturnType<typeof captureTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    tools = captureTools();
  });

  describe('read_track_lufs', () => {
    it('returns LUFS measurement data', async () => {
      const lufsData = {
        trackIndex: 0,
        integrated: -18.5,
        shortTerm: -16.2,
        momentary: -14.8,
        truePeakL: -1.2,
        truePeakR: -1.5,
        duration: 30.0,
      };

      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: lufsData,
        timestamp: Date.now(),
      });

      const result = await tools['read_track_lufs'].handler({ trackIndex: 0 });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(lufsData, null, 2) }],
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('read_track_lufs', { trackIndex: 0 });
    });

    it('returns error when track not found', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: false,
        error: 'Track 99 not found',
        timestamp: Date.now(),
      });

      const result = await tools['read_track_lufs'].handler({ trackIndex: 99 });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: Track 99 not found' }],
        isError: true,
      });
    });

    it('returns error when JSFX cannot be inserted', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: false,
        error: "MCP LUFS Meter JSFX not found. Run 'reaper-mcp setup' to install it.",
        timestamp: Date.now(),
      });

      const result = await tools['read_track_lufs'].handler({ trackIndex: 0 });
      expect(result).toEqual({
        content: [{ type: 'text', text: "Error: MCP LUFS Meter JSFX not found. Run 'reaper-mcp setup' to install it." }],
        isError: true,
      });
    });

    it('returns error when no audio data yet', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: false,
        error: 'LUFS meter not producing data yet. Ensure audio is playing.',
        timestamp: Date.now(),
      });

      const result = await tools['read_track_lufs'].handler({ trackIndex: 0 });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: LUFS meter not producing data yet. Ensure audio is playing.' }],
        isError: true,
      });
    });
  });

  describe('read_track_correlation', () => {
    it('returns correlation measurement data', async () => {
      const correlationData = {
        trackIndex: 1,
        correlation: 0.82,
        stereoWidth: 1.1,
        midLevel: -12.3,
        sideLevel: -18.7,
      };

      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: correlationData,
        timestamp: Date.now(),
      });

      const result = await tools['read_track_correlation'].handler({ trackIndex: 1 });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(correlationData, null, 2) }],
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('read_track_correlation', { trackIndex: 1 });
    });

    it('returns correlation of -1 for perfectly out-of-phase signal', async () => {
      const correlationData = {
        trackIndex: 0,
        correlation: -1.0,
        stereoWidth: 2.0,
        midLevel: -150,
        sideLevel: -6.0,
      };

      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: correlationData,
        timestamp: Date.now(),
      });

      const result = await tools['read_track_correlation'].handler({ trackIndex: 0 });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(correlationData, null, 2) }],
      });
    });

    it('returns error when track not found', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: false,
        error: 'Track 5 not found',
        timestamp: Date.now(),
      });

      const result = await tools['read_track_correlation'].handler({ trackIndex: 5 });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: Track 5 not found' }],
        isError: true,
      });
    });

    it('returns error when JSFX cannot be inserted', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: false,
        error: "MCP Correlation Meter JSFX not found. Run 'reaper-mcp setup' to install it.",
        timestamp: Date.now(),
      });

      const result = await tools['read_track_correlation'].handler({ trackIndex: 0 });
      expect(result).toEqual({
        content: [{ type: 'text', text: "Error: MCP Correlation Meter JSFX not found. Run 'reaper-mcp setup' to install it." }],
        isError: true,
      });
    });
  });

  describe('read_track_crest', () => {
    it('returns crest factor measurement data', async () => {
      const crestData = {
        trackIndex: 2,
        crestFactor: 14.5,
        peakLevel: -3.2,
        rmsLevel: -17.7,
      };

      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: crestData,
        timestamp: Date.now(),
      });

      const result = await tools['read_track_crest'].handler({ trackIndex: 2 });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(crestData, null, 2) }],
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('read_track_crest', { trackIndex: 2 });
    });

    it('returns low crest factor for heavily compressed signal', async () => {
      const crestData = {
        trackIndex: 0,
        crestFactor: 3.2,
        peakLevel: -6.0,
        rmsLevel: -9.2,
      };

      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: crestData,
        timestamp: Date.now(),
      });

      const result = await tools['read_track_crest'].handler({ trackIndex: 0 });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(crestData, null, 2) }],
      });
    });

    it('returns error when track not found', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: false,
        error: 'Track 10 not found',
        timestamp: Date.now(),
      });

      const result = await tools['read_track_crest'].handler({ trackIndex: 10 });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: Track 10 not found' }],
        isError: true,
      });
    });

    it('returns error when JSFX cannot be inserted', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: false,
        error: "MCP Crest Factor Meter JSFX not found. Run 'reaper-mcp setup' to install it.",
        timestamp: Date.now(),
      });

      const result = await tools['read_track_crest'].handler({ trackIndex: 0 });
      expect(result).toEqual({
        content: [{ type: 'text', text: "Error: MCP Crest Factor Meter JSFX not found. Run 'reaper-mcp setup' to install it." }],
        isError: true,
      });
    });
  });
});
