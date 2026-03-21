import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bridge.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../bridge.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTempoTools } from './tempo.js';

const mockedSendCommand = vi.mocked(sendCommand);

function captureTools() {
  const tools: Record<string, { handler: (...args: unknown[]) => unknown }> = {};
  const mockServer = {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: (...args: unknown[]) => unknown) => {
      tools[name] = { handler };
    }),
  } as unknown as McpServer;
  registerTempoTools(mockServer);
  return tools;
}

function successResponse(data: unknown) {
  return { id: 'test', success: true, data, timestamp: Date.now() };
}

function errorResponse(error: string) {
  return { id: 'test', success: false, error, timestamp: Date.now() };
}

describe('tempo tools', () => {
  let tools: ReturnType<typeof captureTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    tools = captureTools();
  });

  it('registers get_tempo_map tool', () => {
    expect(tools['get_tempo_map']).toBeDefined();
  });

  describe('get_tempo_map', () => {
    it('returns tempo map points', async () => {
      const data = {
        points: [
          { index: 0, position: 0, beatPosition: 0, tempo: 120, timeSignatureNumerator: 4, timeSignatureDenominator: 4, linearTempo: false },
          { index: 1, position: 30, beatPosition: 60, tempo: 140, timeSignatureNumerator: 4, timeSignatureDenominator: 4, linearTempo: false },
          { index: 2, position: 60, beatPosition: 130, tempo: 140, timeSignatureNumerator: 3, timeSignatureDenominator: 4, linearTempo: false },
        ],
        total: 3,
      };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['get_tempo_map'].handler({});
      expect(mockedSendCommand).toHaveBeenCalledWith('get_tempo_map');
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      });
    });

    it('returns single tempo point for simple projects', async () => {
      const data = {
        points: [
          { index: 0, position: 0, beatPosition: 0, tempo: 120, timeSignatureNumerator: 4, timeSignatureDenominator: 4, linearTempo: false },
        ],
        total: 1,
      };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['get_tempo_map'].handler({});
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      });
    });

    it('returns error on failure', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Some error'));
      const result = await tools['get_tempo_map'].handler({});
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: Some error' }],
        isError: true,
      });
    });
  });
});
