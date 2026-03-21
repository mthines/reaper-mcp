import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bridge.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../bridge.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerEnvelopeTools } from './envelopes.js';

const mockedSendCommand = vi.mocked(sendCommand);

function captureTools() {
  const tools: Record<string, { handler: (...args: unknown[]) => unknown }> = {};
  const mockServer = {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: (...args: unknown[]) => unknown) => {
      tools[name] = { handler };
    }),
  } as unknown as McpServer;
  registerEnvelopeTools(mockServer);
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

describe('envelope tools', () => {
  let tools: ReturnType<typeof captureTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    tools = captureTools();
  });

  it('registers all 9 envelope tools', () => {
    const expected = [
      'get_track_envelopes', 'get_envelope_points', 'insert_envelope_point', 'delete_envelope_point',
      'create_track_envelope', 'set_envelope_properties', 'clear_envelope', 'remove_envelope_points',
      'insert_envelope_points',
    ];
    for (const name of expected) {
      expect(tools[name]).toBeDefined();
    }
  });

  describe('get_track_envelopes', () => {
    it('returns track envelopes', async () => {
      const data = {
        trackIndex: 0,
        envelopes: [
          { index: 0, name: 'Volume', pointCount: 5, active: true, visible: true, armed: false },
          { index: 1, name: 'Pan', pointCount: 2, active: true, visible: false, armed: false },
        ],
        total: 2,
      };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['get_track_envelopes'].handler({ trackIndex: 0 });
      expect(mockedSendCommand).toHaveBeenCalledWith('get_track_envelopes', { trackIndex: 0 });
      expectSuccess(result, data);
    });

    it('returns empty list for track with no envelopes', async () => {
      const data = { trackIndex: 1, envelopes: [], total: 0 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['get_track_envelopes'].handler({ trackIndex: 1 });
      expectSuccess(result, data);
    });

    it('returns error for invalid track', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Track 99 not found'));
      const result = await tools['get_track_envelopes'].handler({ trackIndex: 99 });
      expectError(result, 'Track 99 not found');
    });
  });

  describe('get_envelope_points', () => {
    it('returns envelope points', async () => {
      const data = {
        trackIndex: 0, envelopeIndex: 0, envelopeName: 'Volume',
        points: [
          { pointIndex: 0, time: 0, value: 1.0, shape: 0, tension: 0, selected: false },
          { pointIndex: 1, time: 5.5, value: 0.5, shape: 0, tension: 0, selected: true },
        ],
        returned: 2, total: 2, offset: 0, hasMore: false,
      };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['get_envelope_points'].handler({
        trackIndex: 0, envelopeIndex: 0,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('get_envelope_points', {
        trackIndex: 0, envelopeIndex: 0, offset: undefined, limit: undefined,
      });
      expectSuccess(result, data);
    });

    it('supports pagination', async () => {
      const data = {
        trackIndex: 0, envelopeIndex: 0, envelopeName: 'Volume',
        points: [{ pointIndex: 10, time: 20, value: 0.8, shape: 0, tension: 0, selected: false }],
        returned: 1, total: 50, offset: 10, hasMore: true,
      };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['get_envelope_points'].handler({
        trackIndex: 0, envelopeIndex: 0, offset: 10, limit: 1,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('get_envelope_points', {
        trackIndex: 0, envelopeIndex: 0, offset: 10, limit: 1,
      });
      expectSuccess(result, data);
    });

    it('returns error for invalid envelope', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Envelope 5 not found'));
      const result = await tools['get_envelope_points'].handler({ trackIndex: 0, envelopeIndex: 5 });
      expectError(result, 'Envelope 5 not found');
    });
  });

  describe('insert_envelope_point', () => {
    it('inserts point with defaults', async () => {
      const data = { success: true, trackIndex: 0, envelopeIndex: 0, time: 10, value: 0.75, totalPoints: 3 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['insert_envelope_point'].handler({
        trackIndex: 0, envelopeIndex: 0, time: 10, value: 0.75,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('insert_envelope_point', {
        trackIndex: 0, envelopeIndex: 0, time: 10, value: 0.75, shape: undefined, tension: undefined,
      });
      expectSuccess(result, data);
    });

    it('inserts point with shape and tension', async () => {
      const data = { success: true, trackIndex: 0, envelopeIndex: 0, time: 5, value: 1.0, totalPoints: 4 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      await tools['insert_envelope_point'].handler({
        trackIndex: 0, envelopeIndex: 0, time: 5, value: 1.0, shape: 5, tension: 0.5,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('insert_envelope_point', {
        trackIndex: 0, envelopeIndex: 0, time: 5, value: 1.0, shape: 5, tension: 0.5,
      });
    });

    it('returns error on failure', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Failed to insert envelope point'));
      const result = await tools['insert_envelope_point'].handler({
        trackIndex: 0, envelopeIndex: 0, time: 10, value: 0.5,
      });
      expectError(result, 'Failed to insert envelope point');
    });
  });

  describe('delete_envelope_point', () => {
    it('deletes point', async () => {
      mockedSendCommand.mockResolvedValue(successResponse({ success: true, totalPoints: 4 }));

      const result = await tools['delete_envelope_point'].handler({
        trackIndex: 0, envelopeIndex: 0, pointIndex: 2,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('delete_envelope_point', {
        trackIndex: 0, envelopeIndex: 0, pointIndex: 2,
      });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Deleted envelope point 2' }],
      });
    });

    it('returns error for out-of-range point', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Point 99 not found'));
      const result = await tools['delete_envelope_point'].handler({
        trackIndex: 0, envelopeIndex: 0, pointIndex: 99,
      });
      expectError(result, 'Point 99 not found');
    });
  });

  describe('create_track_envelope', () => {
    it('creates a built-in envelope by name', async () => {
      const data = { trackIndex: 0, envelopeIndex: 0, name: 'Volume', pointCount: 0 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['create_track_envelope'].handler({
        trackIndex: 0, envelopeName: 'Volume',
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('create_track_envelope', {
        trackIndex: 0, envelopeName: 'Volume', fxIndex: undefined, paramIndex: undefined,
      });
      expectSuccess(result, data);
    });

    it('creates an FX parameter envelope', async () => {
      const data = { trackIndex: 0, envelopeIndex: 2, name: 'ReaEQ / Freq-Band 1', pointCount: 0 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['create_track_envelope'].handler({
        trackIndex: 0, fxIndex: 0, paramIndex: 1,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('create_track_envelope', {
        trackIndex: 0, envelopeName: undefined, fxIndex: 0, paramIndex: 1,
      });
      expectSuccess(result, data);
    });

    it('returns error for missing params', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Must provide either envelopeName or fxIndex+paramIndex'));
      const result = await tools['create_track_envelope'].handler({ trackIndex: 0 });
      expectError(result, 'Must provide either envelopeName or fxIndex+paramIndex');
    });

    it('returns error for invalid track', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Track 99 not found'));
      const result = await tools['create_track_envelope'].handler({ trackIndex: 99, envelopeName: 'Volume' });
      expectError(result, 'Track 99 not found');
    });
  });

  describe('set_envelope_properties', () => {
    it('sets envelope properties', async () => {
      const data = {
        trackIndex: 0, envelopeIndex: 0, name: 'Volume',
        active: true, visible: true, armed: true,
      };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['set_envelope_properties'].handler({
        trackIndex: 0, envelopeIndex: 0, armed: true,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('set_envelope_properties', {
        trackIndex: 0, envelopeIndex: 0, active: undefined, visible: undefined, armed: true,
      });
      expectSuccess(result, data);
    });

    it('returns error for invalid envelope', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Envelope index 5 out of range'));
      const result = await tools['set_envelope_properties'].handler({
        trackIndex: 0, envelopeIndex: 5, visible: false,
      });
      expectError(result, 'Envelope index 5 out of range');
    });
  });

  describe('clear_envelope', () => {
    it('clears all envelope points', async () => {
      const data = { trackIndex: 0, envelopeIndex: 0, deletedPoints: 10, totalPoints: 0 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['clear_envelope'].handler({ trackIndex: 0, envelopeIndex: 0 });
      expect(mockedSendCommand).toHaveBeenCalledWith('clear_envelope', { trackIndex: 0, envelopeIndex: 0 });
      expectSuccess(result, data);
    });

    it('returns error for invalid envelope', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Envelope index 3 out of range'));
      const result = await tools['clear_envelope'].handler({ trackIndex: 0, envelopeIndex: 3 });
      expectError(result, 'Envelope index 3 out of range');
    });
  });

  describe('remove_envelope_points', () => {
    it('removes points in a time range', async () => {
      const data = { trackIndex: 0, envelopeIndex: 0, timeStart: 5, timeEnd: 15, deletedPoints: 3, totalPoints: 7 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['remove_envelope_points'].handler({
        trackIndex: 0, envelopeIndex: 0, timeStart: 5, timeEnd: 15,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('remove_envelope_points', {
        trackIndex: 0, envelopeIndex: 0, timeStart: 5, timeEnd: 15,
      });
      expectSuccess(result, data);
    });

    it('returns error for invalid envelope', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Envelope index 5 out of range'));
      const result = await tools['remove_envelope_points'].handler({
        trackIndex: 0, envelopeIndex: 5, timeStart: 0, timeEnd: 10,
      });
      expectError(result, 'Envelope index 5 out of range');
    });
  });

  describe('insert_envelope_points', () => {
    it('batch inserts multiple points', async () => {
      const data = { trackIndex: 0, envelopeIndex: 0, insertedPoints: 3, totalPoints: 5 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const points = JSON.stringify([
        { time: 0, value: 0.5 },
        { time: 5, value: 1.0, shape: 1 },
        { time: 10, value: 0.75, shape: 5, tension: 0.3 },
      ]);
      const result = await tools['insert_envelope_points'].handler({
        trackIndex: 0, envelopeIndex: 0, points,
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('insert_envelope_points', {
        trackIndex: 0, envelopeIndex: 0, points,
      });
      expectSuccess(result, data);
    });

    it('returns error for invalid envelope', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Envelope index 5 out of range'));
      const result = await tools['insert_envelope_points'].handler({
        trackIndex: 0, envelopeIndex: 5, points: '[]',
      });
      expectError(result, 'Envelope index 5 out of range');
    });
  });
});
