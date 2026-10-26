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

describe('tempo editing tools', () => {
  beforeEach(() => vi.clearAllMocks());

  const cases: [string, Record<string, unknown>][] = [
    ['add_tempo_marker', { position: 4, bpm: 140, timeSigNumerator: 3, timeSigDenominator: 4, linear: false }],
    ['edit_tempo_marker', { index: 1, bpm: 150 }],
    ['delete_tempo_marker', { index: 1 }],
    ['set_project_tempo', { bpm: 98 }],
  ];

  it.each(cases)('%s dispatches its params and returns the bridge data', async (name, params) => {
    const tools = captureTools();
    const data = { ok: name };
    mockedSendCommand.mockResolvedValue({ id: 't', success: true, data, timestamp: 0 });
    const result = await tools[name].handler(params);
    expect(mockedSendCommand).toHaveBeenCalledTimes(1);
    const [type, sent] = mockedSendCommand.mock.calls[0];
    expect(type).toBe(name);
    if (Object.keys(params).length) expect(sent).toEqual(params);
    expect(result).toEqual({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
  });

  it.each(cases)('%s passes a bridge refusal through as an error', async (name, params) => {
    const tools = captureTools();
    mockedSendCommand.mockResolvedValue({ id: 't', success: false, error: 'refused: nope', timestamp: 0 });
    const result = await tools[name].handler(params);
    expect(result).toEqual({ content: [{ type: 'text', text: 'Error: refused: nope' }], isError: true });
  });
});
