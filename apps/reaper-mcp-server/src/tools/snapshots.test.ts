import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bridge.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../bridge.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSnapshotTools } from './snapshots.js';

const mockedSendCommand = vi.mocked(sendCommand);

function captureTools() {
  const tools: Record<string, { handler: (...args: unknown[]) => unknown }> = {};
  const mockServer = {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: (...args: unknown[]) => unknown) => {
      tools[name] = { handler };
    }),
  } as unknown as McpServer;
  registerSnapshotTools(mockServer);
  return tools;
}

describe('snapshot tools', () => {
  let tools: ReturnType<typeof captureTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    tools = captureTools();
  });

  describe('snapshot_save', () => {
    it('saves snapshot and returns success data', async () => {
      const now = Date.now();
      const saveData = {
        success: true,
        name: 'before-compression',
        timestamp: now,
        path: '/project/.reaper-mcp/snapshots/before-compression.json',
        storageLocation: 'project',
      };

      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: saveData,
        timestamp: now,
      });

      const result = await tools['snapshot_save'].handler({
        name: 'before-compression',
        description: 'Mix before adding compression',
      });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(saveData, null, 2) }],
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('snapshot_save', {
        name: 'before-compression',
        description: 'Mix before adding compression',
      });
    });

    it('saves snapshot without optional description', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: { success: true, name: 'v1', timestamp: Date.now() },
        timestamp: Date.now(),
      });

      await tools['snapshot_save'].handler({ name: 'v1' });
      expect(mockedSendCommand).toHaveBeenCalledWith('snapshot_save', {
        name: 'v1',
        description: undefined,
      });
    });

    it('returns error when save fails', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: false,
        error: 'Failed to write snapshot file',
        timestamp: Date.now(),
      });

      const result = await tools['snapshot_save'].handler({ name: 'broken' });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: Failed to write snapshot file' }],
        isError: true,
      });
    });
  });

  describe('snapshot_restore', () => {
    it('restores snapshot and returns result', async () => {
      const restoreData = {
        success: true,
        name: 'before-compression',
        timestamp: 1700000000000,
        tracksRestored: 8,
      };

      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: restoreData,
        timestamp: Date.now(),
      });

      const result = await tools['snapshot_restore'].handler({ name: 'before-compression' });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(restoreData, null, 2) }],
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('snapshot_restore', { name: 'before-compression' });
    });

    it('returns error when snapshot not found', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: false,
        error: 'Snapshot not found: nonexistent',
        timestamp: Date.now(),
      });

      const result = await tools['snapshot_restore'].handler({ name: 'nonexistent' });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: Snapshot not found: nonexistent' }],
        isError: true,
      });
    });
  });

  describe('snapshot_list', () => {
    it('returns list of saved snapshots', async () => {
      const listData = {
        snapshots: [
          { name: 'after-mastering', description: 'Final master', timestamp: 1700000002000 },
          { name: 'before-compression', description: 'Mix before adding compression', timestamp: 1700000001000 },
          { name: 'v1', description: '', timestamp: 1700000000000 },
        ],
        total: 3,
        storageLocation: 'project',
      };

      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: listData,
        timestamp: Date.now(),
      });

      const result = await tools['snapshot_list'].handler({});
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(listData, null, 2) }],
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('snapshot_list', {});
    });

    it('returns empty list when no snapshots exist', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: { snapshots: [], total: 0, storageLocation: 'global' },
        timestamp: Date.now(),
      });

      const result = await tools['snapshot_list'].handler({});
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify({ snapshots: [], total: 0, storageLocation: 'global' }, null, 2) }],
      });
    });

    it('returns error on failure', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: false,
        error: 'Bridge not running',
        timestamp: Date.now(),
      });

      const result = await tools['snapshot_list'].handler({});
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: Bridge not running' }],
        isError: true,
      });
    });
  });

  describe('snapshot_delete', () => {
    it('deletes snapshot and returns confirmation', async () => {
      const deleteData = { name: 'before-compression', deleted: true };

      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: deleteData,
        timestamp: Date.now(),
      });

      const result = await tools['snapshot_delete'].handler({ name: 'before-compression' });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(deleteData, null, 2) }],
      });
      expect(mockedSendCommand).toHaveBeenCalledWith('snapshot_delete', { name: 'before-compression' });
    });

    it('returns error when snapshot not found', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: false,
        error: 'Snapshot not found: nonexistent',
        timestamp: Date.now(),
      });

      const result = await tools['snapshot_delete'].handler({ name: 'nonexistent' });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: Snapshot not found: nonexistent' }],
        isError: true,
      });
    });

    it('returns error when deletion fails', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: false,
        error: 'Failed to delete snapshot: permission denied',
        timestamp: Date.now(),
      });

      const result = await tools['snapshot_delete'].handler({ name: 'locked-snapshot' });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: Failed to delete snapshot: permission denied' }],
        isError: true,
      });
    });

    it('dispatches correct command type and params', async () => {
      mockedSendCommand.mockResolvedValue({
        id: 'test',
        success: true,
        data: { name: 'v2-mix', deleted: true },
        timestamp: Date.now(),
      });

      await tools['snapshot_delete'].handler({ name: 'v2-mix' });
      expect(mockedSendCommand).toHaveBeenCalledWith('snapshot_delete', { name: 'v2-mix' });
    });
  });
});
