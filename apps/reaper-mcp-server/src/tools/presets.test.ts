import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bridge.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../bridge.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerPresetTools } from './presets.js';

const mockedSendCommand = vi.mocked(sendCommand);

function captureTools() {
  const tools: Record<string, { handler: (...args: unknown[]) => unknown }> = {};
  const mockServer = {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: (...args: unknown[]) => unknown) => {
      tools[name] = { handler };
    }),
  } as unknown as McpServer;
  registerPresetTools(mockServer);
  return tools;
}

describe('preset tools', () => {
  let tools: ReturnType<typeof captureTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    tools = captureTools();
  });

  describe('get_fx_preset_list', () => {
    it('returns list of presets', async () => {
      const presetData = {
        trackIndex: 0,
        fxIndex: 0,
        presets: [
          { index: 0, name: 'Default' },
          { index: 1, name: 'Bright Boost' },
          { index: 2, name: 'Low Cut' },
        ],
        total: 3,
      };

      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: presetData,
        timestamp: Date.now(),
      });

      const result = await tools['get_fx_preset_list'].handler({ trackIndex: 0, fxIndex: 0 });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(presetData, null, 2) }],
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('get_fx_preset_list', { trackIndex: 0, fxIndex: 0 });
    });

    it('returns empty list when FX has no presets', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: { trackIndex: 0, fxIndex: 1, presets: [], total: 0 },
        timestamp: Date.now(),
      });

      const result = await tools['get_fx_preset_list'].handler({ trackIndex: 0, fxIndex: 1 });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify({ trackIndex: 0, fxIndex: 1, presets: [], total: 0 }, null, 2) }],
      });
    });

    it('returns error when track not found', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: false,
        error: 'Track 99 not found',
        timestamp: Date.now(),
      });

      const result = await tools['get_fx_preset_list'].handler({ trackIndex: 99, fxIndex: 0 });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: Track 99 not found' }],
        isError: true,
      });
    });
  });

  describe('set_fx_preset', () => {
    it('applies preset and returns success message', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: { success: true, trackIndex: 0, fxIndex: 0, presetName: 'Bright Boost' },
        timestamp: Date.now(),
      });

      const result = await tools['set_fx_preset'].handler({
        trackIndex: 0,
        fxIndex: 0,
        presetName: 'Bright Boost',
      });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Applied preset "Bright Boost" to FX 0 on track 0' }],
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('set_fx_preset', {
        trackIndex: 0,
        fxIndex: 0,
        presetName: 'Bright Boost',
      });
    });

    it('returns error when preset not found', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: false,
        error: 'Preset not found: NonExistentPreset',
        timestamp: Date.now(),
      });

      const result = await tools['set_fx_preset'].handler({
        trackIndex: 0,
        fxIndex: 0,
        presetName: 'NonExistentPreset',
      });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: Preset not found: NonExistentPreset' }],
        isError: true,
      });
    });
  });
});
