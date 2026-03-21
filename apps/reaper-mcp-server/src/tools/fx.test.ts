import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bridge.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../bridge.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerFxTools } from './fx.js';

const mockedSendCommand = vi.mocked(sendCommand);

function captureTools() {
  const tools: Record<string, { handler: (...args: unknown[]) => unknown }> = {};
  const mockServer = {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: (...args: unknown[]) => unknown) => {
      tools[name] = { handler };
    }),
  } as unknown as McpServer;
  registerFxTools(mockServer);
  return tools;
}

describe('fx tools', () => {
  let tools: ReturnType<typeof captureTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    tools = captureTools();
  });

  describe('add_fx', () => {
    it('sends fxName and trackIndex', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: { fxIndex: 0, fxName: 'VST: ReaEQ (Cockos)', trackIndex: 0 },
        timestamp: Date.now(),
      });

      const result = await tools['add_fx'].handler({ trackIndex: 0, fxName: 'ReaEQ' });
      expect(mockedSendCommand).toHaveBeenCalledWith('add_fx', { trackIndex: 0, fxName: 'ReaEQ', position: -1 });
      expect(result).toEqual({
        content: [{ type: 'text', text: expect.stringContaining('ReaEQ') }],
      });
    });

    it('returns error when FX not found', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: false,
        error: 'FX not found: NonexistentPlugin',
        timestamp: Date.now(),
      });

      const result = await tools['add_fx'].handler({ trackIndex: 0, fxName: 'NonexistentPlugin' });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: FX not found: NonexistentPlugin' }],
        isError: true,
      });
    });
  });

  describe('remove_fx', () => {
    it('sends correct params', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: { success: true },
        timestamp: Date.now(),
      });

      const result = await tools['remove_fx'].handler({ trackIndex: 0, fxIndex: 1 });
      expect(mockedSendCommand).toHaveBeenCalledWith('remove_fx', { trackIndex: 0, fxIndex: 1 });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Removed FX 1 from track 0' }],
      });
    });
  });

  describe('get_fx_parameters', () => {
    it('returns parameter list', async () => {
      const paramData = {
        trackIndex: 0,
        fxIndex: 0,
        parameterCount: 2,
        parameters: [
          { index: 0, name: 'Gain', value: 0.5, formattedValue: '0.0 dB', minValue: 0, maxValue: 1 },
          { index: 1, name: 'Frequency', value: 0.3, formattedValue: '1000 Hz', minValue: 0, maxValue: 1 },
        ],
      };

      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: paramData,
        timestamp: Date.now(),
      });

      const result = await tools['get_fx_parameters'].handler({ trackIndex: 0, fxIndex: 0 });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(paramData, null, 2) }],
      });
    });
  });

  describe('set_fx_parameter', () => {
    it('sends correct params', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: { success: true },
        timestamp: Date.now(),
      });

      const result = await tools['set_fx_parameter'].handler({ trackIndex: 0, fxIndex: 0, paramIndex: 1, value: 0.75 });
      expect(mockedSendCommand).toHaveBeenCalledWith('set_fx_parameter', {
        trackIndex: 0, fxIndex: 0, paramIndex: 1, value: 0.75,
      });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Set FX 0 param 1 = 0.75' }],
      });
    });

    it('returns error on failure', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: false,
        error: 'Failed to set param 5 on FX 0',
        timestamp: Date.now(),
      });

      const result = await tools['set_fx_parameter'].handler({ trackIndex: 0, fxIndex: 0, paramIndex: 5, value: 0.5 });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: Failed to set param 5 on FX 0' }],
        isError: true,
      });
    });
  });

  describe('set_fx_enabled', () => {
    it('enables FX', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: true, data: { success: true, trackIndex: 0, fxIndex: 1, enabled: true }, timestamp: Date.now(),
      });

      const result = await tools['set_fx_enabled'].handler({ trackIndex: 0, fxIndex: 1, enabled: 1 });
      expect(mockedSendCommand).toHaveBeenCalledWith('set_fx_enabled', { trackIndex: 0, fxIndex: 1, enabled: 1 });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'FX 1 on track 0 enabled' }],
      });
    });

    it('disables FX', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: true, data: { success: true, trackIndex: 0, fxIndex: 0, enabled: false }, timestamp: Date.now(),
      });

      const result = await tools['set_fx_enabled'].handler({ trackIndex: 0, fxIndex: 0, enabled: 0 });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'FX 0 on track 0 disabled' }],
      });
    });

    it('returns error for invalid FX', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: false, error: 'FX 5 not found (track has 2 FX)', timestamp: Date.now(),
      });

      const result = await tools['set_fx_enabled'].handler({ trackIndex: 0, fxIndex: 5, enabled: 1 });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: FX 5 not found (track has 2 FX)' }],
        isError: true,
      });
    });
  });

  describe('set_fx_offline', () => {
    it('sets FX offline', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: true, data: { success: true, trackIndex: 0, fxIndex: 0, offline: true }, timestamp: Date.now(),
      });

      const result = await tools['set_fx_offline'].handler({ trackIndex: 0, fxIndex: 0, offline: 1 });
      expect(mockedSendCommand).toHaveBeenCalledWith('set_fx_offline', { trackIndex: 0, fxIndex: 0, offline: 1 });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'FX 0 on track 0 set offline' }],
      });
    });

    it('sets FX online', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: true, data: { success: true, trackIndex: 0, fxIndex: 0, offline: false }, timestamp: Date.now(),
      });

      const result = await tools['set_fx_offline'].handler({ trackIndex: 0, fxIndex: 0, offline: 0 });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'FX 0 on track 0 set online' }],
      });
    });

    it('returns error for invalid FX', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: false, error: 'Track 99 not found', timestamp: Date.now(),
      });

      const result = await tools['set_fx_offline'].handler({ trackIndex: 99, fxIndex: 0, offline: 1 });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: Track 99 not found' }],
        isError: true,
      });
    });
  });
});
