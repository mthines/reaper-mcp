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
    it('returns parameter list without filters (backward compatible)', async () => {
      const paramData = {
        trackIndex: 0,
        fxIndex: 0,
        fxName: 'VST: ReaEQ (Cockos)',
        parameterCount: 2,
        matchedCount: 2,
        returned: 2,
        offset: 0,
        hasMore: false,
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
      expect(mockedSendCommand).toHaveBeenCalledWith('get_fx_parameters', {
        trackIndex: 0, fxIndex: 0,
        namePattern: undefined, changedOnly: undefined, offset: undefined, limit: undefined,
      });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(paramData, null, 2) }],
      });
    });

    it('passes optional filter params to sendCommand', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: {
          trackIndex: 0, fxIndex: 0, fxName: 'ReaEQ', parameterCount: 50,
          matchedCount: 5, returned: 5, offset: 0, hasMore: false, parameters: [],
        },
        timestamp: Date.now(),
      });

      await tools['get_fx_parameters'].handler({
        trackIndex: 0, fxIndex: 0, namePattern: 'Gain', changedOnly: true, offset: 0, limit: 10,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('get_fx_parameters', {
        trackIndex: 0, fxIndex: 0, namePattern: 'Gain', changedOnly: true, offset: 0, limit: 10,
      });
    });

    it('handles pagination metadata in response', async () => {
      const paramData = {
        trackIndex: 0, fxIndex: 0, fxName: 'VST3: Pro-Q 4',
        parameterCount: 500, matchedCount: 12, returned: 5, offset: 0, hasMore: true,
        parameters: [
          { index: 23, name: 'Band 1 Gain', value: 0.6, formattedValue: '+2.5 dB', minValue: 0, maxValue: 1 },
        ],
      };

      mockedSendCommand.mockResolvedValue({
        id: 'test', success: true, data: paramData, timestamp: Date.now(),
      });

      const result = await tools['get_fx_parameters'].handler({
        trackIndex: 0, fxIndex: 0, changedOnly: true, limit: 5,
      });
      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      expect(parsed.hasMore).toBe(true);
      expect(parsed.matchedCount).toBe(12);
      expect(parsed.returned).toBe(5);
    });
  });

  describe('analyze_fx', () => {
    it('sends correct params', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: {
          trackIndex: 0, fxIndex: 0, fxName: 'VST: ReaEQ (Cockos)',
          presetName: '', parameterCount: 50, notableParamCount: 3,
          pluginType: 'eq', eqBands: [], notableParams: [],
        },
        timestamp: Date.now(),
      });

      const result = await tools['analyze_fx'].handler({ trackIndex: 0, fxIndex: 0 });
      expect(mockedSendCommand).toHaveBeenCalledWith('analyze_fx', { trackIndex: 0, fxIndex: 0 });
      expect(result).toEqual({
        content: [{ type: 'text', text: expect.stringContaining('ReaEQ') }],
      });
    });

    it('returns error on failure', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: false, error: 'Track 99 not found', timestamp: Date.now(),
      });

      const result = await tools['analyze_fx'].handler({ trackIndex: 99, fxIndex: 0 });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: Track 99 not found' }],
        isError: true,
      });
    });

    it('returns EQ analysis for EQ plugins', async () => {
      const analysisData = {
        trackIndex: 0, fxIndex: 0, fxName: 'VST3: Pro-Q 4 (FabFilter)',
        presetName: 'Custom', parameterCount: 552, notableParamCount: 1,
        pluginType: 'eq',
        eqBands: [
          { bandIndex: 0, enabled: true, frequency: '100 Hz', gain: '-3.0 dB', q: '1.41', shape: 'Bell', paramIndices: [0, 1, 2, 3] },
          { bandIndex: 2, enabled: true, frequency: '3.00 kHz', gain: '+2.5 dB', q: '2.00', shape: 'Bell', paramIndices: [46, 47, 48, 49] },
        ],
        notableParams: [{ index: 500, name: 'Output Gain', value: 0.55, formattedValue: '+1.0 dB' }],
      };

      mockedSendCommand.mockResolvedValue({
        id: 'test', success: true, data: analysisData, timestamp: Date.now(),
      });

      const result = await tools['analyze_fx'].handler({ trackIndex: 0, fxIndex: 0 });
      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      expect(parsed.pluginType).toBe('eq');
      expect(parsed.eqBands).toHaveLength(2);
      expect(parsed.eqBands[0].frequency).toBe('100 Hz');
    });

    it('returns compressor analysis for compressor plugins', async () => {
      const analysisData = {
        trackIndex: 1, fxIndex: 0, fxName: 'VST3: Pro-C 2 (FabFilter)',
        presetName: '', parameterCount: 80, notableParamCount: 2,
        pluginType: 'compressor',
        compressorSettings: {
          threshold: { index: 0, name: 'Threshold', value: 0.3, formattedValue: '-18.0 dB' },
          ratio: { index: 1, name: 'Ratio', value: 0.4, formattedValue: '4.0:1' },
          attack: { index: 2, name: 'Attack', value: 0.2, formattedValue: '5.0 ms' },
          release: { index: 3, name: 'Release', value: 0.5, formattedValue: '100 ms' },
        },
        notableParams: [
          { index: 10, name: 'Style', value: 0.3, formattedValue: 'Vocal' },
        ],
      };

      mockedSendCommand.mockResolvedValue({
        id: 'test', success: true, data: analysisData, timestamp: Date.now(),
      });

      const result = await tools['analyze_fx'].handler({ trackIndex: 1, fxIndex: 0 });
      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      expect(parsed.pluginType).toBe('compressor');
      expect(parsed.compressorSettings.threshold.formattedValue).toBe('-18.0 dB');
      expect(parsed.compressorSettings.ratio.formattedValue).toBe('4.0:1');
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
