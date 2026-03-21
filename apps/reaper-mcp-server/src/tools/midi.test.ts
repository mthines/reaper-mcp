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
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: true, data, timestamp: Date.now(),
      });

      const result = await tools['create_midi_item'].handler({
        trackIndex: 0, startPosition: 0, endPosition: 4,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('create_midi_item', {
        trackIndex: 0, startPosition: 0, endPosition: 4,
      });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      });
    });

    it('returns error on failure', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: false, error: 'Track not found', timestamp: Date.now(),
      });

      const result = await tools['create_midi_item'].handler({
        trackIndex: 99, startPosition: 0, endPosition: 4,
      });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: Track not found' }],
        isError: true,
      });
    });
  });

  describe('list_midi_items', () => {
    it('sends list_midi_items command', async () => {
      const data = { trackIndex: 0, items: [], total: 0 };
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: true, data, timestamp: Date.now(),
      });

      const result = await tools['list_midi_items'].handler({ trackIndex: 0 });
      expect(mockedSendCommand).toHaveBeenCalledWith('list_midi_items', { trackIndex: 0 });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      });
    });
  });

  describe('get_midi_notes', () => {
    it('sends get_midi_notes command', async () => {
      const data = { trackIndex: 0, itemIndex: 0, notes: [], total: 0 };
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: true, data, timestamp: Date.now(),
      });

      const result = await tools['get_midi_notes'].handler({ trackIndex: 0, itemIndex: 0 });
      expect(mockedSendCommand).toHaveBeenCalledWith('get_midi_notes', {
        trackIndex: 0, itemIndex: 0,
      });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      });
    });
  });

  describe('insert_midi_note', () => {
    it('sends insert_midi_note command with defaults', async () => {
      const data = { success: true, noteCount: 1 };
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: true, data, timestamp: Date.now(),
      });

      const result = await tools['insert_midi_note'].handler({
        trackIndex: 0, itemIndex: 0, pitch: 60, velocity: 100,
        startPosition: 0, duration: 1,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('insert_midi_note', {
        trackIndex: 0, itemIndex: 0, pitch: 60, velocity: 100,
        startPosition: 0, duration: 1, channel: 0,
      });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      });
    });

    it('passes explicit channel', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: true, data: { success: true, noteCount: 1 }, timestamp: Date.now(),
      });

      await tools['insert_midi_note'].handler({
        trackIndex: 0, itemIndex: 0, pitch: 36, velocity: 127,
        startPosition: 0, duration: 0.5, channel: 9,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('insert_midi_note', {
        trackIndex: 0, itemIndex: 0, pitch: 36, velocity: 127,
        startPosition: 0, duration: 0.5, channel: 9,
      });
    });
  });

  describe('insert_midi_notes', () => {
    it('sends insert_midi_notes command with notes JSON', async () => {
      const notes = JSON.stringify([
        { pitch: 60, velocity: 100, startPosition: 0, duration: 1, channel: 0 },
        { pitch: 64, velocity: 100, startPosition: 0, duration: 1, channel: 0 },
      ]);
      const data = { success: true, inserted: 2, noteCount: 2 };
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: true, data, timestamp: Date.now(),
      });

      const result = await tools['insert_midi_notes'].handler({
        trackIndex: 0, itemIndex: 0, notes,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('insert_midi_notes', {
        trackIndex: 0, itemIndex: 0, notes,
      });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      });
    });
  });

  describe('edit_midi_note', () => {
    it('sends edit_midi_note command', async () => {
      const data = { success: true, noteIndex: 0 };
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: true, data, timestamp: Date.now(),
      });

      const result = await tools['edit_midi_note'].handler({
        trackIndex: 0, itemIndex: 0, noteIndex: 0, pitch: 72,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('edit_midi_note', {
        trackIndex: 0, itemIndex: 0, noteIndex: 0, pitch: 72,
        velocity: undefined, startPosition: undefined, duration: undefined, channel: undefined,
      });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      });
    });
  });

  describe('delete_midi_note', () => {
    it('sends delete_midi_note command', async () => {
      const data = { success: true, noteCount: 0 };
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: true, data, timestamp: Date.now(),
      });

      const result = await tools['delete_midi_note'].handler({
        trackIndex: 0, itemIndex: 0, noteIndex: 0,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('delete_midi_note', {
        trackIndex: 0, itemIndex: 0, noteIndex: 0,
      });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      });
    });
  });

  describe('get_midi_cc', () => {
    it('sends get_midi_cc command with optional filter', async () => {
      const data = { trackIndex: 0, itemIndex: 0, events: [], total: 0 };
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: true, data, timestamp: Date.now(),
      });

      const result = await tools['get_midi_cc'].handler({
        trackIndex: 0, itemIndex: 0, ccNumber: 1,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('get_midi_cc', {
        trackIndex: 0, itemIndex: 0, ccNumber: 1,
      });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      });
    });
  });

  describe('insert_midi_cc', () => {
    it('sends insert_midi_cc command', async () => {
      const data = { success: true, ccCount: 1 };
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: true, data, timestamp: Date.now(),
      });

      const result = await tools['insert_midi_cc'].handler({
        trackIndex: 0, itemIndex: 0, ccNumber: 1, value: 64, position: 0,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('insert_midi_cc', {
        trackIndex: 0, itemIndex: 0, ccNumber: 1, value: 64, position: 0, channel: 0,
      });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      });
    });
  });

  describe('delete_midi_cc', () => {
    it('sends delete_midi_cc command', async () => {
      const data = { success: true, ccCount: 0 };
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: true, data, timestamp: Date.now(),
      });

      const result = await tools['delete_midi_cc'].handler({
        trackIndex: 0, itemIndex: 0, ccIndex: 0,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('delete_midi_cc', {
        trackIndex: 0, itemIndex: 0, ccIndex: 0,
      });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      });
    });
  });

  describe('get_midi_item_properties', () => {
    it('returns midi item properties', async () => {
      const data = {
        trackIndex: 0, itemIndex: 0, position: 0, length: 4,
        noteCount: 10, ccCount: 5, muted: false, loopSource: true,
      };
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: true, data, timestamp: Date.now(),
      });

      const result = await tools['get_midi_item_properties'].handler({
        trackIndex: 0, itemIndex: 0,
      });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      });
    });
  });

  describe('set_midi_item_properties', () => {
    it('sends set_midi_item_properties command', async () => {
      const data = { success: true, trackIndex: 0, itemIndex: 0 };
      mockedSendCommand.mockResolvedValue({
        id: 'test', success: true, data, timestamp: Date.now(),
      });

      const result = await tools['set_midi_item_properties'].handler({
        trackIndex: 0, itemIndex: 0, mute: 1,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('set_midi_item_properties', {
        trackIndex: 0, itemIndex: 0, mute: 1,
        position: undefined, length: undefined, loopSource: undefined,
      });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      });
    });
  });
});
