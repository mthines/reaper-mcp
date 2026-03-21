import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bridge.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../bridge.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMarkerTools } from './markers.js';

const mockedSendCommand = vi.mocked(sendCommand);

function captureTools() {
  const tools: Record<string, { handler: (...args: unknown[]) => unknown }> = {};
  const mockServer = {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: (...args: unknown[]) => unknown) => {
      tools[name] = { handler };
    }),
  } as unknown as McpServer;
  registerMarkerTools(mockServer);
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

describe('marker tools', () => {
  let tools: ReturnType<typeof captureTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    tools = captureTools();
  });

  it('registers all 6 marker/region tools', () => {
    const expected = ['list_markers', 'list_regions', 'add_marker', 'add_region', 'delete_marker', 'delete_region'];
    for (const name of expected) {
      expect(tools[name]).toBeDefined();
    }
  });

  describe('list_markers', () => {
    it('returns markers', async () => {
      const data = {
        markers: [
          { index: 0, name: 'Intro', position: 0, color: 0 },
          { index: 1, name: 'Chorus', position: 30.5, color: 16777471 },
        ],
        total: 2,
      };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['list_markers'].handler({});
      expect(mockedSendCommand).toHaveBeenCalledWith('list_markers');
      expectSuccess(result, data);
    });

    it('returns empty markers list', async () => {
      const data = { markers: [], total: 0 };
      mockedSendCommand.mockResolvedValue(successResponse(data));
      const result = await tools['list_markers'].handler({});
      expectSuccess(result, data);
    });
  });

  describe('list_regions', () => {
    it('returns regions', async () => {
      const data = {
        regions: [
          { index: 0, name: 'Verse 1', start: 10, end: 30, color: 0 },
          { index: 1, name: 'Chorus', start: 30, end: 50, color: 0 },
        ],
        total: 2,
      };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['list_regions'].handler({});
      expect(mockedSendCommand).toHaveBeenCalledWith('list_regions');
      expectSuccess(result, data);
    });
  });

  describe('add_marker', () => {
    it('adds marker with name', async () => {
      const data = { success: true, index: 3, position: 15, name: 'Bridge' };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['add_marker'].handler({ position: 15, name: 'Bridge' });
      expect(mockedSendCommand).toHaveBeenCalledWith('add_marker', { position: 15, name: 'Bridge', color: undefined });
      expectSuccess(result, data);
    });

    it('adds marker without name', async () => {
      const data = { success: true, index: 0, position: 5, name: '' };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      await tools['add_marker'].handler({ position: 5 });
      expect(mockedSendCommand).toHaveBeenCalledWith('add_marker', { position: 5, name: undefined, color: undefined });
    });
  });

  describe('add_region', () => {
    it('adds region', async () => {
      const data = { success: true, index: 0, start: 10, end: 30, name: 'Verse' };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['add_region'].handler({ start: 10, end: 30, name: 'Verse' });
      expect(mockedSendCommand).toHaveBeenCalledWith('add_region', { start: 10, end: 30, name: 'Verse', color: undefined });
      expectSuccess(result, data);
    });

    it('returns error on failure', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('end must be greater than start'));
      const result = await tools['add_region'].handler({ start: 30, end: 10, name: 'Bad' });
      expectError(result, 'end must be greater than start');
    });
  });

  describe('delete_marker', () => {
    it('deletes marker', async () => {
      mockedSendCommand.mockResolvedValue(successResponse({ success: true, markerIndex: 2 }));

      const result = await tools['delete_marker'].handler({ markerIndex: 2 });
      expect(mockedSendCommand).toHaveBeenCalledWith('delete_marker', { markerIndex: 2 });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Deleted marker 2' }],
      });
    });

    it('returns error for missing marker', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Marker 99 not found'));
      const result = await tools['delete_marker'].handler({ markerIndex: 99 });
      expectError(result, 'Marker 99 not found');
    });
  });

  describe('delete_region', () => {
    it('deletes region', async () => {
      mockedSendCommand.mockResolvedValue(successResponse({ success: true, regionIndex: 1 }));

      const result = await tools['delete_region'].handler({ regionIndex: 1 });
      expect(mockedSendCommand).toHaveBeenCalledWith('delete_region', { regionIndex: 1 });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Deleted region 1' }],
      });
    });

    it('returns error for missing region', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Region 99 not found'));
      const result = await tools['delete_region'].handler({ regionIndex: 99 });
      expectError(result, 'Region 99 not found');
    });
  });
});
