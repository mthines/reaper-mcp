import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bridge.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../bridge.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerProjectTools, bridgeText } from './project.js';

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

describe('project ops tools', () => {
  beforeEach(() => vi.clearAllMocks());

  const cases: [string, Record<string, unknown>][] = [
    ['undo_project', {}],
    ['redo_project', {}],
    ['save_project', { path: '/tmp/a.rpp', overwrite: true }],
    ['get_render_settings', {}],
    ['set_render_settings', { outputDirectory: '/tmp/out', filePattern: 'mix', format: 'flac', bounds: 'custom', startTime: 0, endTime: 2, sampleRate: 48000, channels: 2 }],
    ['render_project', { overwrite: false }],
    ['get_project_settings', {}],
    ['set_project_settings', { sampleRate: 48000, title: 'Song', repeat: true, metronome: false }],
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

describe('bridgeText', () => {
  it('accepts plain text with control characters and refuses braces', () => {
    for (const ok of ['Verse 1\nline 2 — ok', '', 'a\tb', 'a\r\nb']) {
      expect(bridgeText.safeParse(ok).success).toBe(true);
    }
    for (const bad of ['Bridge }', '{x']) {
      expect(bridgeText.safeParse(bad).success).toBe(false);
    }
  });
});
