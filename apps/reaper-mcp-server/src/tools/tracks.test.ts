import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bridge.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../bridge.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTrackTools } from './tracks.js';

const mockedSendCommand = vi.mocked(sendCommand);

function captureTools() {
  const tools: Record<string, { handler: (...args: unknown[]) => unknown }> = {};
  const mockServer = {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: (...args: unknown[]) => unknown) => {
      tools[name] = { handler };
    }),
  } as unknown as McpServer;
  registerTrackTools(mockServer);
  return tools;
}

describe('track tools', () => {
  let tools: ReturnType<typeof captureTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    tools = captureTools();
  });

  describe('list_tracks', () => {
    it('returns track list on success', async () => {
      const trackData = [
        { index: 0, name: 'Drums', volume: -6, pan: 0, mute: false, solo: false, fxCount: 2 },
        { index: 1, name: 'Bass', volume: -8, pan: 0, mute: false, solo: false, fxCount: 1 },
      ];

      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: trackData,
        timestamp: Date.now(),
      });

      const result = await tools['list_tracks'].handler({});
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(trackData, null, 2) }],
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('list_tracks');
    });

    it('returns error on failure', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: false,
        error: 'No project open',
        timestamp: Date.now(),
      });

      const result = await tools['list_tracks'].handler({});
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: No project open' }],
        isError: true,
      });
    });
  });

  describe('get_track_properties', () => {
    it('returns track properties with FX list', async () => {
      const trackProps = {
        index: 0,
        name: 'Drums',
        volume: -6,
        fxList: [{ index: 0, name: 'ReaEQ', enabled: true, preset: '' }],
      };

      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: trackProps,
        timestamp: Date.now(),
      });

      const result = await tools['get_track_properties'].handler({ trackIndex: 0 });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(trackProps, null, 2) }],
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('get_track_properties', { trackIndex: 0 });
    });
  });

  describe('set_track_property', () => {
    it('sends correct params for volume', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: { success: true },
        timestamp: Date.now(),
      });

      const result = await tools['set_track_property'].handler({ trackIndex: 0, property: 'volume', value: -6 });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Set track 0 volume = -6' }],
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('set_track_property', { trackIndex: 0, property: 'volume', value: -6 });
    });

    it('returns error when track not found', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: false,
        error: 'Track 99 not found',
        timestamp: Date.now(),
      });

      const result = await tools['set_track_property'].handler({ trackIndex: 99, property: 'volume', value: 0 });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: Track 99 not found' }],
        isError: true,
      });
    });
  });
});
