import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bridge.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../bridge.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSelectionTools } from './selection.js';

const mockedSendCommand = vi.mocked(sendCommand);

function captureTools() {
  const tools: Record<string, { handler: (...args: unknown[]) => unknown }> = {};
  const mockServer = {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: (...args: unknown[]) => unknown) => {
      tools[name] = { handler };
    }),
  } as unknown as McpServer;
  registerSelectionTools(mockServer);
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

describe('selection tools', () => {
  let tools: ReturnType<typeof captureTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    tools = captureTools();
  });

  it('registers all 3 selection tools', () => {
    expect(tools['get_selected_tracks']).toBeDefined();
    expect(tools['get_time_selection']).toBeDefined();
    expect(tools['set_time_selection']).toBeDefined();
  });

  describe('get_selected_tracks', () => {
    it('returns selected tracks', async () => {
      const data = { tracks: [{ index: 0, name: 'Vocals' }, { index: 2, name: 'Bass' }], total: 2 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['get_selected_tracks'].handler({});
      expect(mockedSendCommand).toHaveBeenCalledWith('get_selected_tracks');
      expectSuccess(result, data);
    });

    it('returns empty when no tracks selected', async () => {
      const data = { tracks: [], total: 0 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['get_selected_tracks'].handler({});
      expectSuccess(result, data);
    });

    it('returns error on failure', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('No project open'));
      const result = await tools['get_selected_tracks'].handler({});
      expectError(result, 'No project open');
    });
  });

  describe('get_time_selection', () => {
    it('returns time selection', async () => {
      const data = { start: 10.5, end: 25.0, length: 14.5, empty: false };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['get_time_selection'].handler({});
      expect(mockedSendCommand).toHaveBeenCalledWith('get_time_selection');
      expectSuccess(result, data);
    });

    it('returns empty selection', async () => {
      const data = { start: 0, end: 0, length: 0, empty: true };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['get_time_selection'].handler({});
      expectSuccess(result, data);
    });
  });

  describe('set_time_selection', () => {
    it('sets time selection', async () => {
      mockedSendCommand.mockResolvedValue(successResponse({ success: true, start: 5, end: 15 }));

      const result = await tools['set_time_selection'].handler({ start: 5, end: 15 });
      expect(mockedSendCommand).toHaveBeenCalledWith('set_time_selection', { start: 5, end: 15 });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Time selection set: 5s - 15s' }],
      });
    });

    it('returns error on failure', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('end must be greater than start'));
      const result = await tools['set_time_selection'].handler({ start: 15, end: 5 });
      expectError(result, 'end must be greater than start');
    });
  });
});
