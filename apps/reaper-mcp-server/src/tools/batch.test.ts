import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bridge.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../bridge.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerBatchTools } from './batch.js';

const mockedSendCommand = vi.mocked(sendCommand);

function captureTools() {
  const tools: Record<string, { handler: (...args: unknown[]) => unknown }> = {};
  const mockServer = {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: (...args: unknown[]) => unknown) => {
      tools[name] = { handler };
    }),
  } as unknown as McpServer;
  registerBatchTools(mockServer);
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

describe('batch tools', () => {
  let tools: ReturnType<typeof captureTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    tools = captureTools();
  });

  it('registers all 3 batch tools', () => {
    const expectedTools = [
      'set_multiple_track_properties',
      'setup_fx_chain',
      'set_multiple_fx_parameters',
    ];
    for (const name of expectedTools) {
      expect(tools[name]).toBeDefined();
    }
  });

  describe('set_multiple_track_properties', () => {
    it('sends set_multiple_track_properties with volume and pan updates', async () => {
      const data = { success: true, updated: 2, total: 2 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const tracks = [
        { trackIndex: 0, volume: -6, pan: 0 },
        { trackIndex: 1, volume: -3, pan: 0.5 },
      ];
      const result = await tools['set_multiple_track_properties'].handler({ tracks });
      expect(mockedSendCommand).toHaveBeenCalledWith('set_multiple_track_properties', { tracks });
      expectSuccess(result, data);
    });

    it('sends set_multiple_track_properties with mute and solo', async () => {
      const data = { success: true, updated: 3, total: 3 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const tracks = [
        { trackIndex: 0, mute: 1 },
        { trackIndex: 1, mute: 1 },
        { trackIndex: 2, solo: 1 },
      ];
      const result = await tools['set_multiple_track_properties'].handler({ tracks });
      expect(mockedSendCommand).toHaveBeenCalledWith('set_multiple_track_properties', { tracks });
      expectSuccess(result, data);
    });

    it('handles partial failures with errors array', async () => {
      const data = { success: true, updated: 1, total: 2, errors: ['Track 99 not found'] };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const tracks = [
        { trackIndex: 0, volume: -6 },
        { trackIndex: 99, volume: -3 },
      ];
      const result = await tools['set_multiple_track_properties'].handler({ tracks });
      expectSuccess(result, data);
    });

    it('sends all supported properties for a single track', async () => {
      const data = { success: true, updated: 1, total: 1 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const tracks = [{ trackIndex: 0, volume: 0, pan: -0.5, mute: 0, solo: 0, recordArm: 1, phase: 0, input: 2 }];
      await tools['set_multiple_track_properties'].handler({ tracks });
      expect(mockedSendCommand).toHaveBeenCalledWith('set_multiple_track_properties', { tracks });
    });

    it('returns error on bridge failure', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Bridge error'));
      const result = await tools['set_multiple_track_properties'].handler({
        tracks: [{ trackIndex: 0, volume: -6 }],
      });
      expectError(result, 'Bridge error');
    });

    it('sends empty array without error', async () => {
      const data = { success: true, updated: 0, total: 0 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['set_multiple_track_properties'].handler({ tracks: [] });
      expect(mockedSendCommand).toHaveBeenCalledWith('set_multiple_track_properties', { tracks: [] });
      expectSuccess(result, data);
    });
  });

  describe('setup_fx_chain', () => {
    it('sends setup_fx_chain with basic plugins', async () => {
      const data = {
        success: true,
        trackIndex: 0,
        added: 2,
        total: 2,
        plugins: [
          { pluginIndex: 0, fxName: 'ReaEQ', fxIndex: 0 },
          { pluginIndex: 1, fxName: 'ReaComp', fxIndex: 1 },
        ],
      };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const plugins = [
        { fxName: 'ReaEQ' },
        { fxName: 'ReaComp' },
      ];
      const result = await tools['setup_fx_chain'].handler({ trackIndex: 0, plugins });
      expect(mockedSendCommand).toHaveBeenCalledWith('setup_fx_chain', { trackIndex: 0, plugins });
      expectSuccess(result, data);
    });

    it('sends setup_fx_chain with initial parameters', async () => {
      const data = {
        success: true,
        trackIndex: 2,
        added: 1,
        total: 1,
        plugins: [{ pluginIndex: 0, fxName: 'VST: Pro-Q 3', fxIndex: 0 }],
      };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const plugins = [
        {
          fxName: 'VST: Pro-Q 3',
          enabled: 1,
          parameters: [
            { index: 0, value: 0.5 },
            { index: 1, value: 0.75 },
          ],
        },
      ];
      const result = await tools['setup_fx_chain'].handler({ trackIndex: 2, plugins });
      expect(mockedSendCommand).toHaveBeenCalledWith('setup_fx_chain', { trackIndex: 2, plugins });
      expectSuccess(result, data);
    });

    it('sends setup_fx_chain with disabled plugin', async () => {
      const data = {
        success: true,
        trackIndex: 0,
        added: 1,
        total: 1,
        plugins: [{ pluginIndex: 0, fxName: 'ReaLimit', fxIndex: 0 }],
      };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const plugins = [{ fxName: 'ReaLimit', enabled: 0 }];
      await tools['setup_fx_chain'].handler({ trackIndex: 0, plugins });
      expect(mockedSendCommand).toHaveBeenCalledWith('setup_fx_chain', {
        trackIndex: 0,
        plugins,
      });
    });

    it('handles partial failures when FX not found', async () => {
      const data = {
        success: true,
        trackIndex: 0,
        added: 1,
        total: 2,
        plugins: [{ pluginIndex: 0, fxName: 'ReaEQ', fxIndex: 0 }],
        errors: ['FX not found: NonExistentFX'],
      };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const plugins = [{ fxName: 'ReaEQ' }, { fxName: 'NonExistentFX' }];
      const result = await tools['setup_fx_chain'].handler({ trackIndex: 0, plugins });
      expectSuccess(result, data);
    });

    it('returns error when track not found', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Track 99 not found'));
      const result = await tools['setup_fx_chain'].handler({
        trackIndex: 99,
        plugins: [{ fxName: 'ReaEQ' }],
      });
      expectError(result, 'Track 99 not found');
    });

    it('sends setup_fx_chain with empty plugins array', async () => {
      const data = { success: true, trackIndex: 0, added: 0, total: 0, plugins: [] };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['setup_fx_chain'].handler({ trackIndex: 0, plugins: [] });
      expect(mockedSendCommand).toHaveBeenCalledWith('setup_fx_chain', { trackIndex: 0, plugins: [] });
      expectSuccess(result, data);
    });
  });

  describe('set_multiple_fx_parameters', () => {
    it('sends set_multiple_fx_parameters for multiple FX on same track', async () => {
      const data = { success: true, updated: 3, total: 3 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const updates = [
        { trackIndex: 0, fxIndex: 0, paramIndex: 0, value: 0.5 },
        { trackIndex: 0, fxIndex: 0, paramIndex: 1, value: 0.75 },
        { trackIndex: 0, fxIndex: 1, paramIndex: 0, value: 0.25 },
      ];
      const result = await tools['set_multiple_fx_parameters'].handler({ updates });
      expect(mockedSendCommand).toHaveBeenCalledWith('set_multiple_fx_parameters', { updates });
      expectSuccess(result, data);
    });

    it('sends set_multiple_fx_parameters across multiple tracks', async () => {
      const data = { success: true, updated: 4, total: 4 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const updates = [
        { trackIndex: 0, fxIndex: 0, paramIndex: 2, value: 0.6 },
        { trackIndex: 1, fxIndex: 0, paramIndex: 2, value: 0.6 },
        { trackIndex: 2, fxIndex: 0, paramIndex: 2, value: 0.6 },
        { trackIndex: 3, fxIndex: 0, paramIndex: 2, value: 0.6 },
      ];
      const result = await tools['set_multiple_fx_parameters'].handler({ updates });
      expect(mockedSendCommand).toHaveBeenCalledWith('set_multiple_fx_parameters', { updates });
      expectSuccess(result, data);
    });

    it('handles boundary values (0.0 and 1.0)', async () => {
      const data = { success: true, updated: 2, total: 2 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const updates = [
        { trackIndex: 0, fxIndex: 0, paramIndex: 0, value: 0.0 },
        { trackIndex: 0, fxIndex: 0, paramIndex: 1, value: 1.0 },
      ];
      await tools['set_multiple_fx_parameters'].handler({ updates });
      expect(mockedSendCommand).toHaveBeenCalledWith('set_multiple_fx_parameters', { updates });
    });

    it('handles partial failures with errors array', async () => {
      const data = {
        success: true,
        updated: 2,
        total: 3,
        errors: ['Track 99 not found'],
      };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const updates = [
        { trackIndex: 0, fxIndex: 0, paramIndex: 0, value: 0.5 },
        { trackIndex: 0, fxIndex: 0, paramIndex: 1, value: 0.5 },
        { trackIndex: 99, fxIndex: 0, paramIndex: 0, value: 0.5 },
      ];
      const result = await tools['set_multiple_fx_parameters'].handler({ updates });
      expectSuccess(result, data);
    });

    it('returns error on bridge failure', async () => {
      mockedSendCommand.mockResolvedValue(errorResponse('Bridge disconnected'));
      const result = await tools['set_multiple_fx_parameters'].handler({
        updates: [{ trackIndex: 0, fxIndex: 0, paramIndex: 0, value: 0.5 }],
      });
      expectError(result, 'Bridge disconnected');
    });

    it('handles large batch efficiently (100 updates)', async () => {
      const updates = Array.from({ length: 100 }, (_, i) => ({
        trackIndex: i % 8,
        fxIndex: 0,
        paramIndex: i % 10,
        value: (i % 100) / 100,
      }));
      const data = { success: true, updated: 100, total: 100 };
      mockedSendCommand.mockResolvedValue(successResponse(data));

      const result = await tools['set_multiple_fx_parameters'].handler({ updates });
      expect(mockedSendCommand).toHaveBeenCalledWith('set_multiple_fx_parameters', { updates });
      const calledWith = mockedSendCommand.mock.calls[0][1] as { updates: unknown[] };
      expect(Array.isArray(calledWith.updates)).toBe(true);
      expect(calledWith.updates).toHaveLength(100);
      expectSuccess(result, data);
    });
  });
});
