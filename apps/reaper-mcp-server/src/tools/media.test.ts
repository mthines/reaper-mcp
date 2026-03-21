import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bridge.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../bridge.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMediaTools } from './media.js';

const mockedSendCommand = vi.mocked(sendCommand);

function captureTools() {
  const tools: Record<string, { handler: (...args: unknown[]) => unknown }> = {};
  const mockServer = {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: (...args: unknown[]) => unknown) => {
      tools[name] = { handler };
    }),
  } as unknown as McpServer;
  registerMediaTools(mockServer);
  return tools;
}

describe('media tools', () => {
  let tools: ReturnType<typeof captureTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    tools = captureTools();
  });

  it('registers all 10 media tools', () => {
    const expectedTools = [
      'list_media_items', 'get_media_item_properties', 'set_media_item_properties',
      'split_media_item', 'delete_media_item', 'move_media_item',
      'trim_media_item', 'add_stretch_marker', 'get_stretch_markers',
      'delete_stretch_marker',
    ];
    for (const name of expectedTools) {
      expect(tools[name]).toBeDefined();
    }
  });

  describe('list_media_items', () => {
    it('sends list_media_items command', async () => {
      const data = { trackIndex: 0, items: [], total: 0 };
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: true, data, timestamp: Date.now(),
      });

      const result = await tools['list_media_items'].handler({ trackIndex: 0 });
      expect(mockedSendCommand).toHaveBeenCalledWith('list_media_items', { trackIndex: 0 });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      });
    });

    it('returns error on failure', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: false, error: 'Track not found', timestamp: Date.now(),
      });

      const result = await tools['list_media_items'].handler({ trackIndex: 99 });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: Track not found' }],
        isError: true,
      });
    });
  });

  describe('get_media_item_properties', () => {
    it('returns item properties', async () => {
      const data = {
        trackIndex: 0, itemIndex: 0, position: 0, length: 10,
        name: 'Guitar', volume: 0, muted: false,
      };
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: true, data, timestamp: Date.now(),
      });

      const result = await tools['get_media_item_properties'].handler({
        trackIndex: 0, itemIndex: 0,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('get_media_item_properties', {
        trackIndex: 0, itemIndex: 0,
      });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      });
    });
  });

  describe('set_media_item_properties', () => {
    it('sends set command with partial properties', async () => {
      const data = { success: true, trackIndex: 0, itemIndex: 0 };
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: true, data, timestamp: Date.now(),
      });

      const result = await tools['set_media_item_properties'].handler({
        trackIndex: 0, itemIndex: 0, volume: -6, mute: 1,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('set_media_item_properties', {
        trackIndex: 0, itemIndex: 0, volume: -6, mute: 1,
        position: undefined, length: undefined,
        fadeInLength: undefined, fadeOutLength: undefined, playRate: undefined,
      });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      });
    });
  });

  describe('split_media_item', () => {
    it('sends split command', async () => {
      const data = {
        success: true,
        leftItem: { position: 0, length: 5 },
        rightItem: { position: 5, length: 5 },
      };
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: true, data, timestamp: Date.now(),
      });

      const result = await tools['split_media_item'].handler({
        trackIndex: 0, itemIndex: 0, position: 5,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('split_media_item', {
        trackIndex: 0, itemIndex: 0, position: 5,
      });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      });
    });
  });

  describe('delete_media_item', () => {
    it('sends delete command', async () => {
      const data = { success: true, trackIndex: 0, itemIndex: 0 };
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: true, data, timestamp: Date.now(),
      });

      const result = await tools['delete_media_item'].handler({
        trackIndex: 0, itemIndex: 0,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('delete_media_item', {
        trackIndex: 0, itemIndex: 0,
      });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      });
    });
  });

  describe('move_media_item', () => {
    it('sends move command with new position and track', async () => {
      const data = { success: true, position: 10, trackIndex: 2 };
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: true, data, timestamp: Date.now(),
      });

      const result = await tools['move_media_item'].handler({
        trackIndex: 0, itemIndex: 0, newPosition: 10, newTrackIndex: 2,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('move_media_item', {
        trackIndex: 0, itemIndex: 0, newPosition: 10, newTrackIndex: 2,
      });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      });
    });
  });

  describe('trim_media_item', () => {
    it('sends trim command', async () => {
      const data = { success: true, position: 1, length: 8 };
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: true, data, timestamp: Date.now(),
      });

      const result = await tools['trim_media_item'].handler({
        trackIndex: 0, itemIndex: 0, trimStart: 1, trimEnd: 1,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('trim_media_item', {
        trackIndex: 0, itemIndex: 0, trimStart: 1, trimEnd: 1,
      });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      });
    });
  });

  describe('add_stretch_marker', () => {
    it('sends add_stretch_marker command', async () => {
      const data = { success: true, markerIndex: 0, position: 1, sourcePosition: 1.5, totalMarkers: 1 };
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: true, data, timestamp: Date.now(),
      });

      const result = await tools['add_stretch_marker'].handler({
        trackIndex: 0, itemIndex: 0, position: 1, sourcePosition: 1.5,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('add_stretch_marker', {
        trackIndex: 0, itemIndex: 0, position: 1, sourcePosition: 1.5,
      });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      });
    });
  });

  describe('get_stretch_markers', () => {
    it('sends get_stretch_markers command', async () => {
      const data = { trackIndex: 0, itemIndex: 0, markers: [], total: 0 };
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: true, data, timestamp: Date.now(),
      });

      const result = await tools['get_stretch_markers'].handler({
        trackIndex: 0, itemIndex: 0,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('get_stretch_markers', {
        trackIndex: 0, itemIndex: 0,
      });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      });
    });
  });

  describe('delete_stretch_marker', () => {
    it('sends delete_stretch_marker command', async () => {
      const data = { success: true, totalMarkers: 0 };
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: true, data, timestamp: Date.now(),
      });

      const result = await tools['delete_stretch_marker'].handler({
        trackIndex: 0, itemIndex: 0, markerIndex: 0,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('delete_stretch_marker', {
        trackIndex: 0, itemIndex: 0, markerIndex: 0,
      });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      });
    });
  });
});
