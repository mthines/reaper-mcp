import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bridge.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../bridge.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMidiTools } from './midi.js';

const mockedSendCommand = vi.mocked(sendCommand);

function captureTools() {
  const tools: Record<string, { handler: (...args: unknown[]) => unknown }> = {};
  const mockServer = {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: (...args: unknown[]) => unknown) => {
      tools[name] = { handler };
    }),
  } as unknown as McpServer;
  registerMidiTools(mockServer);
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

describe('midi tools', () => {
  let tools: ReturnType<typeof captureTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    tools = captureTools();
  });

  it('registers all 12 midi tools', () => {
    const expectedTools = [
      'create_midi_item', 'list_midi_items', 'get_midi_notes',
      'insert_midi_note', 'insert_midi_notes', 'edit_midi_note',
      'delete_midi_note', 'get_midi_cc', 'insert_midi_cc',
      'delete_midi_cc', 'get_midi_item_properties', 'set_midi_item_properties',
    ];
    for (const name of expectedTools) {
      expect(tools[name]).toBeDefined();
    }
  });

  describe('create_midi_item', () => {
    it('sends create_midi_item command', async () => {
      const data = { trackIndex: 0, itemIndex: 0, position: 0, length: 4 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['create_midi_item'].handler({
        trackIndex: 0, startPosition: 0, endPosition: 4,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('create_midi_item', {
        trackIndex: 0, startPosition: 0, endPosition: 4,
      });
      expectSuccess(result, data);
    });

    it('returns error on failure', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Track not found'));

      const result = await tools['create_midi_item'].handler({
        trackIndex: 99, startPosition: 0, endPosition: 4,
      });
      expectError(result, 'Track not found');
    });
  });

  describe('list_midi_items', () => {
    it('sends list_midi_items command', async () => {
      const data = { trackIndex: 0, items: [], total: 0 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['list_midi_items'].handler({ trackIndex: 0 });
      expect(mockedSendCommand).toHaveBeenCalledWith('list_midi_items', { trackIndex: 0 });
      expectSuccess(result, data);
    });

    it('returns items with note and CC counts', async () => {
      const data = {
        trackIndex: 0,
        items: [
          { itemIndex: 0, position: 0, length: 4, noteCount: 12, ccCount: 3, muted: false },
          { itemIndex: 1, position: 4, length: 8, noteCount: 0, ccCount: 0, muted: true },
        ],
        total: 2,
      };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['list_midi_items'].handler({ trackIndex: 0 });
      expectSuccess(result, data);
    });

    it('returns error on failure', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Track 99 not found'));
      const result = await tools['list_midi_items'].handler({ trackIndex: 99 });
      expectError(result, 'Track 99 not found');
    });
  });

  describe('get_midi_notes', () => {
    it('sends get_midi_notes command', async () => {
      const data = { trackIndex: 0, itemIndex: 0, notes: [], total: 0 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['get_midi_notes'].handler({ trackIndex: 0, itemIndex: 0 });
      expect(mockedSendCommand).toHaveBeenCalledWith('get_midi_notes', {
        trackIndex: 0, itemIndex: 0,
      });
      expectSuccess(result, data);
    });

    it('returns notes with full details', async () => {
      const data = {
        trackIndex: 0, itemIndex: 0, total: 2,
        notes: [
          { noteIndex: 0, pitch: 60, velocity: 100, startPosition: 0, duration: 1, channel: 0, selected: false, muted: false },
          { noteIndex: 1, pitch: 64, velocity: 80, startPosition: 1, duration: 0.5, channel: 9, selected: true, muted: false },
        ],
      };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['get_midi_notes'].handler({ trackIndex: 0, itemIndex: 0 });
      expectSuccess(result, data);
    });

    it('returns error for invalid item', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Item 5 not found on track 0'));
      const result = await tools['get_midi_notes'].handler({ trackIndex: 0, itemIndex: 5 });
      expectError(result, 'Item 5 not found on track 0');
    });
  });

  describe('insert_midi_note', () => {
    it('sends insert_midi_note command with defaults', async () => {
      const data = { success: true, noteCount: 1 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['insert_midi_note'].handler({
        trackIndex: 0, itemIndex: 0, pitch: 60, velocity: 100,
        startPosition: 0, duration: 1,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('insert_midi_note', {
        trackIndex: 0, itemIndex: 0, pitch: 60, velocity: 100,
        startPosition: 0, duration: 1, channel: 0,
      });
      expectSuccess(result, data);
    });

    it('passes explicit channel', async () => {
      mockedSendCommand.mockResolvedValue(successResponse({ success: true, noteCount: 1 }));

      await tools['insert_midi_note'].handler({
        trackIndex: 0, itemIndex: 0, pitch: 36, velocity: 127,
        startPosition: 0, duration: 0.5, channel: 9,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('insert_midi_note', {
        trackIndex: 0, itemIndex: 0, pitch: 36, velocity: 127,
        startPosition: 0, duration: 0.5, channel: 9,
      });
    });

    it('handles boundary pitch values (0 and 127)', async () => {
      mockedSendCommand.mockResolvedValue(successResponse({ success: true, noteCount: 1 }));

      await tools['insert_midi_note'].handler({
        trackIndex: 0, itemIndex: 0, pitch: 0, velocity: 1,
        startPosition: 0, duration: 0.25,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('insert_midi_note', expect.objectContaining({
        pitch: 0, velocity: 1,
      }));
    });

    it('returns error on failure', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Item has no active MIDI take'));
      const result = await tools['insert_midi_note'].handler({
        trackIndex: 0, itemIndex: 0, pitch: 60, velocity: 100,
        startPosition: 0, duration: 1,
      });
      expectError(result, 'Item has no active MIDI take');
    });
  });

  describe('insert_midi_notes', () => {
    it('sends insert_midi_notes command with notes JSON', async () => {
      const notes = JSON.stringify([
        { pitch: 60, velocity: 100, startPosition: 0, duration: 1, channel: 0 },
        { pitch: 64, velocity: 100, startPosition: 0, duration: 1, channel: 0 },
      ]);
      const data = { success: true, inserted: 2, noteCount: 2 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['insert_midi_notes'].handler({
        trackIndex: 0, itemIndex: 0, notes,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('insert_midi_notes', {
        trackIndex: 0, itemIndex: 0, notes,
      });
      expectSuccess(result, data);
    });

    it('sends single-note array', async () => {
      const notes = JSON.stringify([{ pitch: 60, velocity: 100, startPosition: 0, duration: 1 }]);
      const data = { success: true, inserted: 1, noteCount: 1 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['insert_midi_notes'].handler({
        trackIndex: 0, itemIndex: 0, notes,
      });
      expectSuccess(result, data);
    });

    it('returns error on failure', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Failed to parse notes JSON array'));
      const result = await tools['insert_midi_notes'].handler({
        trackIndex: 0, itemIndex: 0, notes: 'invalid',
      });
      expectError(result, 'Failed to parse notes JSON array');
    });
  });

  describe('edit_midi_note', () => {
    it('sends edit_midi_note command for pitch change', async () => {
      const data = { success: true, noteIndex: 0 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['edit_midi_note'].handler({
        trackIndex: 0, itemIndex: 0, noteIndex: 0, pitch: 72,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('edit_midi_note', {
        trackIndex: 0, itemIndex: 0, noteIndex: 0, pitch: 72,
        velocity: undefined, startPosition: undefined, duration: undefined, channel: undefined,
      });
      expectSuccess(result, data);
    });

    it('sends edit with multiple fields', async () => {
      const data = { success: true, noteIndex: 3 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      await tools['edit_midi_note'].handler({
        trackIndex: 0, itemIndex: 0, noteIndex: 3,
        pitch: 64, velocity: 110, startPosition: 2.0, duration: 0.5, channel: 1,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('edit_midi_note', {
        trackIndex: 0, itemIndex: 0, noteIndex: 3,
        pitch: 64, velocity: 110, startPosition: 2.0, duration: 0.5, channel: 1,
      });
    });

    it('sends edit with only duration', async () => {
      const data = { success: true, noteIndex: 0 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      await tools['edit_midi_note'].handler({
        trackIndex: 0, itemIndex: 0, noteIndex: 0, duration: 2.0,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('edit_midi_note', {
        trackIndex: 0, itemIndex: 0, noteIndex: 0,
        pitch: undefined, velocity: undefined, startPosition: undefined, duration: 2.0, channel: undefined,
      });
    });

    it('returns error on failure', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Note index 99 out of range'));
      const result = await tools['edit_midi_note'].handler({
        trackIndex: 0, itemIndex: 0, noteIndex: 99, pitch: 60,
      });
      expectError(result, 'Note index 99 out of range');
    });
  });

  describe('delete_midi_note', () => {
    it('sends delete_midi_note command', async () => {
      const data = { success: true, noteCount: 0 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['delete_midi_note'].handler({
        trackIndex: 0, itemIndex: 0, noteIndex: 0,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('delete_midi_note', {
        trackIndex: 0, itemIndex: 0, noteIndex: 0,
      });
      expectSuccess(result, data);
    });

    it('returns error for out-of-range note', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Note index 10 out of range (item has 5 notes)'));
      const result = await tools['delete_midi_note'].handler({
        trackIndex: 0, itemIndex: 0, noteIndex: 10,
      });
      expectError(result, 'Note index 10 out of range (item has 5 notes)');
    });
  });

  describe('get_midi_cc', () => {
    it('sends get_midi_cc command with optional filter', async () => {
      const data = { trackIndex: 0, itemIndex: 0, events: [], total: 0 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['get_midi_cc'].handler({
        trackIndex: 0, itemIndex: 0, ccNumber: 1,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('get_midi_cc', {
        trackIndex: 0, itemIndex: 0, ccNumber: 1,
      });
      expectSuccess(result, data);
    });

    it('sends get_midi_cc without filter (all CCs)', async () => {
      const data = {
        trackIndex: 0, itemIndex: 0, total: 2,
        events: [
          { ccIndex: 0, ccNumber: 1, value: 64, position: 0, channel: 0 },
          { ccIndex: 1, ccNumber: 7, value: 100, position: 1, channel: 0 },
        ],
      };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['get_midi_cc'].handler({
        trackIndex: 0, itemIndex: 0,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('get_midi_cc', {
        trackIndex: 0, itemIndex: 0, ccNumber: undefined,
      });
      expectSuccess(result, data);
    });

    it('returns error on failure', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Item has no active MIDI take'));
      const result = await tools['get_midi_cc'].handler({ trackIndex: 0, itemIndex: 0 });
      expectError(result, 'Item has no active MIDI take');
    });
  });

  describe('insert_midi_cc', () => {
    it('sends insert_midi_cc command with default channel', async () => {
      const data = { success: true, ccCount: 1 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['insert_midi_cc'].handler({
        trackIndex: 0, itemIndex: 0, ccNumber: 1, value: 64, position: 0,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('insert_midi_cc', {
        trackIndex: 0, itemIndex: 0, ccNumber: 1, value: 64, position: 0, channel: 0,
      });
      expectSuccess(result, data);
    });

    it('sends insert_midi_cc with explicit channel', async () => {
      mockedSendCommand.mockResolvedValue(successResponse({ success: true, ccCount: 1 }));

      await tools['insert_midi_cc'].handler({
        trackIndex: 0, itemIndex: 0, ccNumber: 64, value: 127, position: 2, channel: 9,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('insert_midi_cc', {
        trackIndex: 0, itemIndex: 0, ccNumber: 64, value: 127, position: 2, channel: 9,
      });
    });

    it('returns error on failure', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Track 0 not found'));
      const result = await tools['insert_midi_cc'].handler({
        trackIndex: 0, itemIndex: 0, ccNumber: 1, value: 64, position: 0,
      });
      expectError(result, 'Track 0 not found');
    });
  });

  describe('delete_midi_cc', () => {
    it('sends delete_midi_cc command', async () => {
      const data = { success: true, ccCount: 0 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['delete_midi_cc'].handler({
        trackIndex: 0, itemIndex: 0, ccIndex: 0,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('delete_midi_cc', {
        trackIndex: 0, itemIndex: 0, ccIndex: 0,
      });
      expectSuccess(result, data);
    });

    it('returns error for out-of-range CC index', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('CC index 5 out of range (item has 3 CC events)'));
      const result = await tools['delete_midi_cc'].handler({
        trackIndex: 0, itemIndex: 0, ccIndex: 5,
      });
      expectError(result, 'CC index 5 out of range (item has 3 CC events)');
    });
  });

  describe('get_midi_item_properties', () => {
    it('returns midi item properties', async () => {
      const data = {
        trackIndex: 0, itemIndex: 0, position: 0, length: 4,
        noteCount: 10, ccCount: 5, muted: false, loopSource: true,
      };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['get_midi_item_properties'].handler({
        trackIndex: 0, itemIndex: 0,
      });
      expectSuccess(result, data);
    });

    it('returns error for non-MIDI item', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Active take is not MIDI'));
      const result = await tools['get_midi_item_properties'].handler({
        trackIndex: 0, itemIndex: 0,
      });
      expectError(result, 'Active take is not MIDI');
    });
  });

  describe('set_midi_item_properties', () => {
    it('sends set_midi_item_properties with mute', async () => {
      const data = { success: true, trackIndex: 0, itemIndex: 0 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['set_midi_item_properties'].handler({
        trackIndex: 0, itemIndex: 0, mute: 1,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('set_midi_item_properties', {
        trackIndex: 0, itemIndex: 0, mute: 1,
        position: undefined, length: undefined, loopSource: undefined,
      });
      expectSuccess(result, data);
    });

    it('sends set_midi_item_properties with all fields', async () => {
      const data = { success: true, trackIndex: 0, itemIndex: 0 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      await tools['set_midi_item_properties'].handler({
        trackIndex: 0, itemIndex: 0, position: 2, length: 8, mute: 0, loopSource: 1,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('set_midi_item_properties', {
        trackIndex: 0, itemIndex: 0, position: 2, length: 8, mute: 0, loopSource: 1,
      });
    });

    it('returns error on failure', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Track 0 not found'));
      const result = await tools['set_midi_item_properties'].handler({
        trackIndex: 0, itemIndex: 0, mute: 1,
      });
      expectError(result, 'Track 0 not found');
    });
  });
});
