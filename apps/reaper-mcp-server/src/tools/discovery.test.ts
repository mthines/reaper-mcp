import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bridge.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../bridge.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDiscoveryTools } from './discovery.js';

const mockedSendCommand = vi.mocked(sendCommand);

function captureTools() {
  const tools: Record<string, { handler: (...args: unknown[]) => unknown }> = {};
  const mockServer = {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: (...args: unknown[]) => unknown) => {
      tools[name] = { handler };
    }),
  } as unknown as McpServer;
  registerDiscoveryTools(mockServer);
  return tools;
}

describe('discovery tools', () => {
  let tools: ReturnType<typeof captureTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    tools = captureTools();
  });

  describe('list_available_fx', () => {
    it('returns FX list without category filter', async () => {
      const fxData = {
        fxList: [
          { name: 'VST: Pro-Q 3 (FabFilter)', type: 'VST' },
          { name: 'JS: ReaEQ', type: 'JS' },
        ],
        total: 2,
        source: 'sws',
      };

      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: fxData,
        timestamp: Date.now(),
      });

      const result = await tools['list_available_fx'].handler({});
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(fxData, null, 2) }],
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('list_available_fx', { category: undefined });
    });

    it('passes category filter to bridge', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: { fxList: [{ name: 'VST: Pro-Q 3', type: 'VST' }], total: 1, source: 'sws' },
        timestamp: Date.now(),
      });

      await tools['list_available_fx'].handler({ category: 'VST' });
      expect(mockedSendCommand).toHaveBeenCalledWith('list_available_fx', { category: 'VST' });
    });

    it('returns error on failure', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: false,
        error: 'REAPER not running',
        timestamp: Date.now(),
      });

      const result = await tools['list_available_fx'].handler({});
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: REAPER not running' }],
        isError: true,
      });
    });
  });

  describe('search_fx', () => {
    it('returns matching FX plugins', async () => {
      const searchResult = {
        query: 'pro-q',
        matches: [{ name: 'VST: Pro-Q 3 (FabFilter)', type: 'VST' }],
        total: 1,
      };

      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: searchResult,
        timestamp: Date.now(),
      });

      const result = await tools['search_fx'].handler({ query: 'pro-q' });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(searchResult, null, 2) }],
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('search_fx', { query: 'pro-q' });
    });

    it('returns empty matches when nothing found', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: { query: 'nonexistent', matches: [], total: 0 },
        timestamp: Date.now(),
      });

      const result = await tools['search_fx'].handler({ query: 'nonexistent' });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify({ query: 'nonexistent', matches: [], total: 0 }, null, 2) }],
      });
    });

    it('returns error on failure', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: false,
        error: 'query required',
        timestamp: Date.now(),
      });

      const result = await tools['search_fx'].handler({ query: '' });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: query required' }],
        isError: true,
      });
    });
  });
});
