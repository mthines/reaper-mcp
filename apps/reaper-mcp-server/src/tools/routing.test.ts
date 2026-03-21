import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bridge.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../bridge.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerRoutingTools } from './routing.js';

const mockedSendCommand = vi.mocked(sendCommand);

function captureTools() {
  const tools: Record<string, { handler: (...args: unknown[]) => unknown }> = {};
  const mockServer = {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: (...args: unknown[]) => unknown) => {
      tools[name] = { handler };
    }),
  } as unknown as McpServer;
  registerRoutingTools(mockServer);
  return tools;
}

describe('routing tools', () => {
  let tools: ReturnType<typeof captureTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    tools = captureTools();
  });

  describe('get_track_routing', () => {
    it('returns sends, receives, and folder info', async () => {
      const routingData = {
        trackIndex: 2,
        sends: [
          {
            destTrackIndex: 5,
            destTrackName: 'Master Bus',
            volume: 0,
            pan: 0,
            muted: false,
          },
        ],
        receives: [
          {
            srcTrackIndex: 1,
            srcTrackName: 'Kick',
            volume: -3,
            pan: 0,
            muted: false,
          },
        ],
        parentTrackIndex: 0,
        isFolder: false,
        folderDepth: 1,
      };

      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: routingData,
        timestamp: Date.now(),
      });

      const result = await tools['get_track_routing'].handler({ trackIndex: 2 });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(routingData, null, 2) }],
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('get_track_routing', { trackIndex: 2 });
    });

    it('returns empty sends and receives for isolated track', async () => {
      const routingData = {
        trackIndex: 0,
        sends: [],
        receives: [],
        parentTrackIndex: -1,
        isFolder: false,
        folderDepth: 0,
      };

      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: routingData,
        timestamp: Date.now(),
      });

      const result = await tools['get_track_routing'].handler({ trackIndex: 0 });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(routingData, null, 2) }],
      });
    });

    it('identifies folder tracks correctly', async () => {
      const routingData = {
        trackIndex: 3,
        sends: [],
        receives: [],
        parentTrackIndex: -1,
        isFolder: true,
        folderDepth: 1,
      };

      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: routingData,
        timestamp: Date.now(),
      });

      const result = await tools['get_track_routing'].handler({ trackIndex: 3 });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(routingData, null, 2) }],
      });
    });

    it('returns error when track not found', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: false,
        error: 'Track 99 not found',
        timestamp: Date.now(),
      });

      const result = await tools['get_track_routing'].handler({ trackIndex: 99 });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: Track 99 not found' }],
        isError: true,
      });
    });
  });
});
