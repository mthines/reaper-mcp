import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bridge.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../bridge.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
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

describe('render tools', () => {
  beforeEach(() => vi.clearAllMocks());
  const ok = (data: unknown) => mockedSendCommand.mockResolvedValue({ id: 't', success: true, data, timestamp: 0 });

  it('render tools: set_render_settings sends nested metadata and the region matrix as JSON the bridge can decode', async () => {
    const tools = captureTools();
    ok({ source: 'region_matrix' });
    await tools['set_render_settings'].handler({
      source: 'region_matrix', bounds: 'all_regions', bitDepth: '24', normalize: 'lufs_i', normalizeTarget: -14,
      metadata: { title: 'Night Drive', isrc: 'USABC2600001' }, regionMatrix: [{ regionIndex: 1, tracks: ['Drums', 'master'] }],
    });
    const [, sent] = mockedSendCommand.mock.calls[0] as [string, Record<string, unknown>];
    expect(sent).toMatchObject({ source: 'region_matrix', bitDepth: '24', normalize: 'lufs_i', normalizeTarget: -14 });
    expect(JSON.parse(sent.metadata as string)).toEqual({ title: 'Night Drive', isrc: 'USABC2600001' });
    expect(JSON.parse(sent.regionMatrix as string)).toEqual([{ regionIndex: 1, tracks: ['Drums', 'master'] }]);
    expect(sent).not.toHaveProperty('metadataRaw');
  });

  it('render tools: render_project returns the measured files and allows a long render', async () => {
    const tools = captureTools();
    const data = { rendered: true, files: ['/tmp/out/Drums.wav'], analysis: [{ file: '/tmp/out/Drums.wav', durationSeconds: 184.2, lufsIntegrated: -14.1, truePeak: -1 }] };
    ok(data);
    const result = await tools['render_project'].handler({ tracks: ['Drums'], overwrite: true });
    const [type, sent, timeout] = mockedSendCommand.mock.calls[0] as [string, Record<string, unknown>, number];
    expect(type).toBe('render_project');
    expect(JSON.parse(sent.tracks as string)).toEqual(['Drums']);
    expect(timeout).toBeGreaterThanOrEqual(300_000);
    expect(result).toEqual({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
  });

  it('render tools: render_versions sends the versions and passes a refusal through', async () => {
    const tools = captureTools();
    ok({ rendered: true, versions: [{ name: 'Instrumental', files: ['/tmp/out/song-Instrumental.wav'] }] });
    await tools['render_versions'].handler({ versions: [{ name: 'Instrumental', mute: ['Vocals'] }] });
    const [type, sent] = mockedSendCommand.mock.calls[0] as [string, Record<string, unknown>];
    expect(type).toBe('render_versions');
    expect(JSON.parse(sent.versions as string)).toEqual([{ name: 'Instrumental', mute: ['Vocals'] }]);
    mockedSendCommand.mockResolvedValue({ id: 't', success: false, error: "versions[1].mute: track 'Nope' not found — nothing rendered", timestamp: 0 });
    const refused = await tools['render_versions'].handler({ versions: [{ name: 'X', mute: ['Nope'] }] });
    expect(refused).toEqual({ content: [{ type: 'text', text: "Error: versions[1].mute: track 'Nope' not found — nothing rendered" }], isError: true });
  });

  it('keeps a track named with digits as a name, so the bridge resolves it name-first', () => {
    const schemas: Record<string, z.ZodObject> = {};
    registerProjectTools({ tool: (name: string, _d: string, shape: z.ZodRawShape) => { schemas[name] = z.object(shape); } } as unknown as McpServer);
    const versions = schemas['render_versions'].parse({ versions: [{ name: 'No 808', mute: ['808', 'Lead Vox', 3] }] });
    expect((versions as { versions: { mute: unknown[] }[] }).versions[0].mute).toEqual(['808', 'Lead Vox', 3]);
    expect(schemas['render_project'].parse({ tracks: ['2024'] }).tracks).toEqual(['2024']);
  });
});
