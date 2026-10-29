import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bridge.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../bridge.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTrackTools } from './tracks.js';

const mockedSendCommand = vi.mocked(sendCommand);

function captureTools() {
  const tools: Record<string, { handler: (...args: unknown[]) => unknown }> = {};
  const mockServer = {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: (...args: unknown[]) => unknown) => {
      tools[name] = { handler };
    }),
  } as unknown as McpServer;
  registerTrackTools(mockServer);
  return tools;
}

describe('track tools', () => {
  let tools: ReturnType<typeof captureTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    tools = captureTools();
  });

  describe('list_tracks', () => {
    it('returns track list on success', async () => {
      const trackData = [
        { index: 0, name: 'Drums', volume: -6, pan: 0, mute: false, solo: false, fxCount: 2 },
        { index: 1, name: 'Bass', volume: -8, pan: 0, mute: false, solo: false, fxCount: 1 },
      ];

      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: trackData,
        timestamp: Date.now(),
      });

      const result = await tools['list_tracks'].handler({});
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(trackData, null, 2) }],
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('list_tracks');
    });

    it('returns error on failure', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: false,
        error: 'No project open',
        timestamp: Date.now(),
      });

      const result = await tools['list_tracks'].handler({});
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: No project open' }],
        isError: true,
      });
    });
  });

  describe('list_tracks filters', () => {
    // MIX (0) > [INST (1) > [Kick (2), Snare (3)], VOX (4)]; VOX (5) at the top level
    const session = [
      { index: 0, name: 'MIX', parentIndex: -1, depth: 1, volume: 0, pan: 0, mute: false, solo: false, fxCount: 1, color: 1, volumeRaw: 1 },
      { index: 1, name: 'INST', parentIndex: 0, depth: 1, volume: 0, pan: 0, mute: false, solo: false, fxCount: 0, color: 1, volumeRaw: 1 },
      { index: 2, name: 'Kick', parentIndex: 1, depth: 0, volume: -6, pan: 0, mute: false, solo: false, fxCount: 2, color: 1, volumeRaw: 0.5 },
      { index: 3, name: 'Snare', parentIndex: 1, depth: -1, volume: -8, pan: 0, mute: false, solo: false, fxCount: 1, color: 1, volumeRaw: 0.4 },
      { index: 4, name: 'VOX', parentIndex: 0, depth: -1, volume: -3, pan: 0, mute: false, solo: false, fxCount: 3, color: 1, volumeRaw: 0.7 },
      { index: 5, name: 'VOX', parentIndex: -1, depth: 0, volume: 0, pan: 0, mute: true, solo: false, fxCount: 0, color: 1, volumeRaw: 1 },
    ];
    const list = async (params: Record<string, unknown>) => {
      mockedSendCommand.mockResolvedValue({ id: 't', success: true, data: session, timestamp: Date.now() });
      const result = (await tools['list_tracks'].handler(params)) as { content: { text: string }[]; isError?: boolean };
      return { result, body: result.isError ? null : JSON.parse(result.content[0].text) };
    };

    it('parent returns every track inside the folder, at any depth', async () => {
      const { body } = await list({ parent: 0 });
      expect(body.tracks.map((t: { index: number }) => t.index)).toEqual([1, 2, 3, 4]);
      expect(body).toMatchObject({ total: 4, offset: 0, returned: 4, hasMore: false });
    });

    it('parent accepts a unique name and refuses an ambiguous one', async () => {
      expect((await list({ parent: 'inst' })).body.tracks.map((t: { name: string }) => t.name)).toEqual(['Kick', 'Snare']);
      const { result } = await list({ parent: 'VOX' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('4, 5');
    });

    it('nameContains matches case-insensitively and combines with parent', async () => {
      expect((await list({ nameContains: 'vo' })).body.total).toBe(2);
      expect((await list({ parent: 0, nameContains: 'vo' })).body.tracks.map((t: { index: number }) => t.index)).toEqual([4]);
    });

    it('compact keeps only the mixing fields', async () => {
      const { body } = await list({ compact: true });
      expect(Object.keys(body.tracks[0]).sort()).toEqual(
        ['depth', 'fxCount', 'index', 'mute', 'name', 'pan', 'parentIndex', 'solo', 'volume'],
      );
    });

    it('offset and limit page through the matches', async () => {
      const { body } = await list({ offset: 2, limit: 2 });
      expect(body.tracks.map((t: { index: number }) => t.index)).toEqual([2, 3]);
      expect(body).toMatchObject({ total: 6, returned: 2, hasMore: true });
    });

    it('without params the output is the plain track array, unchanged', async () => {
      const { result } = await list({});
      expect(result.content[0].text).toBe(JSON.stringify(session, null, 2));
    });
  });

  describe('get_track_properties', () => {
    it('returns track properties with FX list', async () => {
      const trackProps = {
        index: 0,
        name: 'Drums',
        volume: -6,
        fxList: [{ index: 0, name: 'ReaEQ', enabled: true, preset: '' }],
      };

      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: trackProps,
        timestamp: Date.now(),
      });

      const result = await tools['get_track_properties'].handler({ trackIndex: 0 });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(trackProps, null, 2) }],
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('get_track_properties', { trackIndex: 0 });
    });
  });

  describe('set_track_property', () => {
    it('sends correct params for volume', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: { success: true },
        timestamp: Date.now(),
      });

      const result = await tools['set_track_property'].handler({ trackIndex: 0, property: 'volume', value: -6 });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Set track 0 volume = -6' }],
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('set_track_property', { trackIndex: 0, property: 'volume', value: -6 });
    });

    it('returns error when track not found', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: false,
        error: 'Track 99 not found',
        timestamp: Date.now(),
      });

      const result = await tools['set_track_property'].handler({ trackIndex: 99, property: 'volume', value: 0 });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: Track 99 not found' }],
        isError: true,
      });
    });
  });
});
