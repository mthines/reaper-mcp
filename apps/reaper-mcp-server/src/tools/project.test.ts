import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bridge.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../bridge.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerProjectTools } from './project.js';

const mockedSendCommand = vi.mocked(sendCommand);

// Capture registered tool handlers
function captureTools() {
  const tools: Record<string, { handler: (...args: unknown[]) => unknown }> = {};
  const mockServer = {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: (...args: unknown[]) => unknown) => {
      tools[name] = { handler };
    }),
  } as unknown as McpServer;
  registerProjectTools(mockServer);
  return tools;
}

describe('project tools', () => {
  let tools: ReturnType<typeof captureTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    tools = captureTools();
  });

  describe('get_project_info', () => {
    it('returns project info on success', async () => {
      const projectData = {
        name: 'My Song',
        path: '/Users/test/projects',
        trackCount: 8,
        tempo: 120,
        timeSignatureNumerator: 4,
        timeSignatureDenominator: 4,
        sampleRate: 44100,
        isPlaying: false,
        isRecording: false,
        cursorPosition: 0,
      };

      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: projectData,
        timestamp: Date.now(),
      });

      const result = await tools['get_project_info'].handler({});
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(projectData, null, 2) }],
      });
    });

    it('returns error on bridge failure', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: false,
        error: 'Bridge timeout',
        timestamp: Date.now(),
      });

      const result = await tools['get_project_info'].handler({});
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: Bridge timeout' }],
        isError: true,
      });
    });
  });
});
