import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bridge.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../bridge.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTransportTools } from './transport.js';

const mockedSendCommand = vi.mocked(sendCommand);

function captureTools() {
  const tools: Record<string, { handler: (...args: unknown[]) => unknown }> = {};
  const mockServer = {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: (...args: unknown[]) => unknown) => {
      tools[name] = { handler };
    }),
  } as unknown as McpServer;
  registerTransportTools(mockServer);
  return tools;
}

describe('transport tools', () => {
  let tools: ReturnType<typeof captureTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    tools = captureTools();
  });

  describe('play', () => {
    it('sends play command', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: { success: true },
        timestamp: Date.now(),
      });

      const result = await tools['play'].handler({});
      expect(mockedSendCommand).toHaveBeenCalledWith('play');
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Playback started' }],
      });
    });

    it('returns error on failure', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: false,
        error: 'Bridge timeout',
        timestamp: Date.now(),
      });

      const result = await tools['play'].handler({});
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: Bridge timeout' }],
        isError: true,
      });
    });
  });

  describe('stop', () => {
    it('sends stop command', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: { success: true },
        timestamp: Date.now(),
      });

      const result = await tools['stop'].handler({});
      expect(mockedSendCommand).toHaveBeenCalledWith('stop');
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Playback stopped' }],
      });
    });
  });

  describe('record', () => {
    it('sends record command', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: { success: true },
        timestamp: Date.now(),
      });

      const result = await tools['record'].handler({});
      expect(mockedSendCommand).toHaveBeenCalledWith('record');
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Recording started' }],
      });
    });
  });

  describe('get_transport_state', () => {
    it('returns transport state info', async () => {
      const stateData = {
        playing: true,
        recording: false,
        paused: false,
        cursorPosition: 10.5,
        playPosition: 12.3,
        tempo: 120,
        timeSignatureNumerator: 4,
        timeSignatureDenominator: 4,
      };

      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: stateData,
        timestamp: Date.now(),
      });

      const result = await tools['get_transport_state'].handler({});
      expect(mockedSendCommand).toHaveBeenCalledWith('get_transport_state');
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(stateData, null, 2) }],
      });
    });
  });

  describe('set_cursor_position', () => {
    it('sends position param', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: { success: true, position: 30.5 },
        timestamp: Date.now(),
      });

      const result = await tools['set_cursor_position'].handler({ position: 30.5 });
      expect(mockedSendCommand).toHaveBeenCalledWith('set_cursor_position', { position: 30.5 });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Cursor moved to 30.5s' }],
      });
    });

    it('returns error on failure', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: false,
        error: 'Bridge not running',
        timestamp: Date.now(),
      });

      const result = await tools['set_cursor_position'].handler({ position: 0 });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: Bridge not running' }],
        isError: true,
      });
    });
  });
});
