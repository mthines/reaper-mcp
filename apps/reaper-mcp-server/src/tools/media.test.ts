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

function successResponse(data: unknown) {
  return { id: 'test', success: true, data, timestamp: Date.now() };
}

function errorResponse(error: string) {
  return { id: 'test', success: false, error, timestamp: Date.now() };
}

function expectSuccess(result: unknown, data: unknown) {
  expect(result).toEqual({
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  });
}

function expectError(result: unknown, error: string) {
  expect(result).toEqual({
    content: [{ type: 'text', text: `Error: ${error}` }],
    isError: true,
  });
}

describe('media tools', () => {
  let tools: ReturnType<typeof captureTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    tools = captureTools();
  });

  it('registers all 11 media tools', () => {
    const expectedTools = [
      'list_media_items', 'get_media_item_properties', 'set_media_item_properties',
      'set_media_items_properties',
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
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['list_media_items'].handler({ trackIndex: 0 });
      expect(mockedSendCommand).toHaveBeenCalledWith('list_media_items', { trackIndex: 0 });
      expectSuccess(result, data);
    });

    it('returns items with full details', async () => {
      const data = {
        trackIndex: 0, total: 2,
        items: [
          { itemIndex: 0, position: 0, length: 10, name: 'Guitar', volume: -3.2, muted: false, fadeInLength: 0.01, fadeOutLength: 0.05, playRate: 1.0, isMidi: false, takeName: 'Guitar.wav' },
          { itemIndex: 1, position: 12, length: 4, name: 'Melody', volume: 0, muted: true, fadeInLength: 0, fadeOutLength: 0, playRate: 1.0, isMidi: true, takeName: 'Melody' },
        ],
      };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['list_media_items'].handler({ trackIndex: 0 });
      expectSuccess(result, data);
    });

    it('returns error on failure', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Track not found'));

      const result = await tools['list_media_items'].handler({ trackIndex: 99 });
      expectError(result, 'Track not found');
    });
  });

  describe('get_media_item_properties', () => {
    it('returns item properties', async () => {
      const data = {
        trackIndex: 0, itemIndex: 0, position: 0, length: 10,
        name: 'Guitar', volume: 0, volumeRaw: 1.0, muted: false,
        fadeInLength: 0, fadeOutLength: 0, fadeInShape: 0, fadeOutShape: 0,
        playRate: 1.0, pitch: 0, startOffset: 0, loopSource: false,
        isMidi: false, takeName: 'Guitar.wav', sourceFile: '/path/to/guitar.wav', locked: false,
      };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['get_media_item_properties'].handler({
        trackIndex: 0, itemIndex: 0,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('get_media_item_properties', {
        trackIndex: 0, itemIndex: 0,
      });
      expectSuccess(result, data);
    });

    it('returns error for invalid item', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Item index 5 out of range'));
      const result = await tools['get_media_item_properties'].handler({
        trackIndex: 0, itemIndex: 5,
      });
      expectError(result, 'Item index 5 out of range');
    });
  });

  describe('set_media_item_properties', () => {
    it('sends set command with partial properties', async () => {
      const data = { success: true, trackIndex: 0, itemIndex: 0 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['set_media_item_properties'].handler({
        trackIndex: 0, itemIndex: 0, volume: -6, mute: 1,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('set_media_item_properties', {
        trackIndex: 0, itemIndex: 0, volume: -6, mute: 1,
        position: undefined, length: undefined,
        fadeInLength: undefined, fadeOutLength: undefined, playRate: undefined,
      });
      expectSuccess(result, data);
    });

    it('sends set command with all properties', async () => {
      const data = { success: true, trackIndex: 0, itemIndex: 0 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      await tools['set_media_item_properties'].handler({
        trackIndex: 0, itemIndex: 0,
        position: 1, length: 8, volume: -3, mute: 0,
        fadeInLength: 0.01, fadeOutLength: 0.05, playRate: 1.5,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('set_media_item_properties', {
        trackIndex: 0, itemIndex: 0,
        position: 1, length: 8, volume: -3, mute: 0,
        fadeInLength: 0.01, fadeOutLength: 0.05, playRate: 1.5,
      });
    });

    it('returns error on failure', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Track 0 not found'));
      const result = await tools['set_media_item_properties'].handler({
        trackIndex: 0, itemIndex: 0, volume: -6,
      });
      expectError(result, 'Track 0 not found');
    });
  });

  describe('set_media_items_properties (batch)', () => {
    it('sends batch set command with native array', async () => {
      const data = { success: true, edited: 2, total: 2 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const items = [
        { trackIndex: 0, itemIndex: 0, volume: -3 },
        { trackIndex: 1, itemIndex: 0, mute: 1, fadeInLength: 0.01 },
      ];
      const result = await tools['set_media_items_properties'].handler({ items });
      expect(mockedSendCommand).toHaveBeenCalledWith('set_media_items_properties', { items });
      expectSuccess(result, data);
    });

    it('returns error on failure', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Failed to parse items array'));
      const result = await tools['set_media_items_properties'].handler({
        items: [{ trackIndex: 0, itemIndex: 0, volume: -3 }],
      });
      expectError(result, 'Failed to parse items array');
    });
  });

  describe('load/performance reference', () => {
    it('dispatches set_media_items_properties with 100 items', async () => {
      const items = Array.from({ length: 100 }, (_, i) => ({
        trackIndex: i % 10,
        itemIndex: Math.floor(i / 10),
        volume: -6,
      }));
      const data = { success: true, edited: 100, total: 100 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['set_media_items_properties'].handler({ items });
      expect(mockedSendCommand).toHaveBeenCalledWith('set_media_items_properties', { items });
      const calledWith = mockedSendCommand.mock.calls[0][1] as { items: unknown[] };
      expect(Array.isArray(calledWith.items)).toBe(true);
      expect(calledWith.items).toHaveLength(100);
      expectSuccess(result, data);
    });

    it('dispatches set_media_items_properties with 500 items', async () => {
      const items = Array.from({ length: 500 }, (_, i) => ({
        trackIndex: i % 20,
        itemIndex: Math.floor(i / 20),
        mute: i % 2,
        volume: -3,
        fadeInLength: 0.01,
        fadeOutLength: 0.01,
      }));
      const data = { success: true, edited: 500, total: 500 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      await tools['set_media_items_properties'].handler({ items });
      const calledWith = mockedSendCommand.mock.calls[0][1] as { items: unknown[] };
      expect(Array.isArray(calledWith.items)).toBe(true);
      expect(calledWith.items).toHaveLength(500);
    });

    it('passes each item object as a plain object (not a string)', async () => {
      const items = Array.from({ length: 50 }, (_, i) => ({
        trackIndex: 0,
        itemIndex: i,
        volume: -6,
      }));
      mockedSendCommand.mockResolvedValue(successResponse({ success: true, edited: 50, total: 50 }));

      await tools['set_media_items_properties'].handler({ items });
      const calledWith = mockedSendCommand.mock.calls[0][1] as { items: unknown[] };
      // Verify elements are plain objects, not strings
      expect(typeof calledWith.items[0]).toBe('object');
      expect(typeof calledWith.items[0]).not.toBe('string');
    });
  });

  describe('split_media_item', () => {
    it('sends split command', async () => {
      const data = {
        success: true,
        leftItem: { position: 0, length: 5 },
        rightItem: { position: 5, length: 5 },
      };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['split_media_item'].handler({
        trackIndex: 0, itemIndex: 0, position: 5,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('split_media_item', {
        trackIndex: 0, itemIndex: 0, position: 5,
      });
      expectSuccess(result, data);
    });

    it('returns error for out-of-bounds split position', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Split position 50 is outside item bounds'));
      const result = await tools['split_media_item'].handler({
        trackIndex: 0, itemIndex: 0, position: 50,
      });
      expectError(result, 'Split position 50 is outside item bounds');
    });
  });

  describe('delete_media_item', () => {
    it('sends delete command', async () => {
      const data = { success: true, trackIndex: 0, itemIndex: 0 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['delete_media_item'].handler({
        trackIndex: 0, itemIndex: 0,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('delete_media_item', {
        trackIndex: 0, itemIndex: 0,
      });
      expectSuccess(result, data);
    });

    it('returns error on failure', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Failed to delete item'));
      const result = await tools['delete_media_item'].handler({
        trackIndex: 0, itemIndex: 0,
      });
      expectError(result, 'Failed to delete item');
    });
  });

  describe('move_media_item', () => {
    it('sends move command with new position and track', async () => {
      const data = { success: true, position: 10, trackIndex: 2 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['move_media_item'].handler({
        trackIndex: 0, itemIndex: 0, newPosition: 10, newTrackIndex: 2,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('move_media_item', {
        trackIndex: 0, itemIndex: 0, newPosition: 10, newTrackIndex: 2,
      });
      expectSuccess(result, data);
    });

    it('sends move with only new position', async () => {
      const data = { success: true, position: 10, trackIndex: 0 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      await tools['move_media_item'].handler({
        trackIndex: 0, itemIndex: 0, newPosition: 10,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('move_media_item', {
        trackIndex: 0, itemIndex: 0, newPosition: 10, newTrackIndex: undefined,
      });
    });

    it('sends move with only new track', async () => {
      const data = { success: true, position: 0, trackIndex: 3 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      await tools['move_media_item'].handler({
        trackIndex: 0, itemIndex: 0, newTrackIndex: 3,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('move_media_item', {
        trackIndex: 0, itemIndex: 0, newPosition: undefined, newTrackIndex: 3,
      });
    });

    it('returns error for invalid destination track', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Destination track 99 not found'));
      const result = await tools['move_media_item'].handler({
        trackIndex: 0, itemIndex: 0, newTrackIndex: 99,
      });
      expectError(result, 'Destination track 99 not found');
    });
  });

  describe('trim_media_item', () => {
    it('sends trim command with both trims', async () => {
      const data = { success: true, position: 1, length: 8 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['trim_media_item'].handler({
        trackIndex: 0, itemIndex: 0, trimStart: 1, trimEnd: 1,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('trim_media_item', {
        trackIndex: 0, itemIndex: 0, trimStart: 1, trimEnd: 1,
      });
      expectSuccess(result, data);
    });

    it('sends trim with only trimStart', async () => {
      const data = { success: true, position: 2, length: 8 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      await tools['trim_media_item'].handler({
        trackIndex: 0, itemIndex: 0, trimStart: 2,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('trim_media_item', {
        trackIndex: 0, itemIndex: 0, trimStart: 2, trimEnd: undefined,
      });
    });

    it('sends trim with only trimEnd', async () => {
      const data = { success: true, position: 0, length: 8 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      await tools['trim_media_item'].handler({
        trackIndex: 0, itemIndex: 0, trimEnd: 2,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('trim_media_item', {
        trackIndex: 0, itemIndex: 0, trimStart: undefined, trimEnd: 2,
      });
    });

    it('returns error when trim would result in zero length', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Trim would result in zero or negative length'));
      const result = await tools['trim_media_item'].handler({
        trackIndex: 0, itemIndex: 0, trimStart: 5, trimEnd: 5,
      });
      expectError(result, 'Trim would result in zero or negative length');
    });
  });

  describe('add_stretch_marker', () => {
    it('sends add_stretch_marker command with source position', async () => {
      const data = { success: true, markerIndex: 0, position: 1, sourcePosition: 1.5, totalMarkers: 1 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['add_stretch_marker'].handler({
        trackIndex: 0, itemIndex: 0, position: 1, sourcePosition: 1.5,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('add_stretch_marker', {
        trackIndex: 0, itemIndex: 0, position: 1, sourcePosition: 1.5,
      });
      expectSuccess(result, data);
    });

    it('sends without sourcePosition (uses default)', async () => {
      const data = { success: true, markerIndex: 0, position: 2, sourcePosition: 2, totalMarkers: 1 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      await tools['add_stretch_marker'].handler({
        trackIndex: 0, itemIndex: 0, position: 2,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('add_stretch_marker', {
        trackIndex: 0, itemIndex: 0, position: 2, sourcePosition: undefined,
      });
    });

    it('returns error on failure', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Item has no active take'));
      const result = await tools['add_stretch_marker'].handler({
        trackIndex: 0, itemIndex: 0, position: 1,
      });
      expectError(result, 'Item has no active take');
    });
  });

  describe('get_stretch_markers', () => {
    it('sends get_stretch_markers command', async () => {
      const data = { trackIndex: 0, itemIndex: 0, markers: [], total: 0 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['get_stretch_markers'].handler({
        trackIndex: 0, itemIndex: 0,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('get_stretch_markers', {
        trackIndex: 0, itemIndex: 0,
      });
      expectSuccess(result, data);
    });

    it('returns markers with details', async () => {
      const data = {
        trackIndex: 0, itemIndex: 0, total: 2,
        markers: [
          { index: 0, position: 1.0, sourcePosition: 1.0 },
          { index: 1, position: 3.0, sourcePosition: 2.5 },
        ],
      };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['get_stretch_markers'].handler({ trackIndex: 0, itemIndex: 0 });
      expectSuccess(result, data);
    });

    it('returns error on failure', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Item has no active take'));
      const result = await tools['get_stretch_markers'].handler({ trackIndex: 0, itemIndex: 0 });
      expectError(result, 'Item has no active take');
    });
  });

  describe('delete_stretch_marker', () => {
    it('sends delete_stretch_marker command', async () => {
      const data = { success: true, totalMarkers: 0 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['delete_stretch_marker'].handler({
        trackIndex: 0, itemIndex: 0, markerIndex: 0,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('delete_stretch_marker', {
        trackIndex: 0, itemIndex: 0, markerIndex: 0,
      });
      expectSuccess(result, data);
    });

    it('returns error for out-of-range marker', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Marker index 5 out of range'));
      const result = await tools['delete_stretch_marker'].handler({
        trackIndex: 0, itemIndex: 0, markerIndex: 5,
      });
      expectError(result, 'Marker index 5 out of range');
    });
  });
});
