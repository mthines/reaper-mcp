import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendCommand, isBridgeRunning, cleanupStaleFiles, ensureBridgeDir } from './bridge.js';

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  readdir: vi.fn(),
  unlink: vi.fn(),
  mkdir: vi.fn(),
  stat: vi.fn(),
}));

// Mock node:crypto
vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid-1234'),
}));

import { readFile, writeFile, readdir, unlink, mkdir, stat } from 'node:fs/promises';

const mockedReadFile = vi.mocked(readFile);
const mockedWriteFile = vi.mocked(writeFile);
const mockedReaddir = vi.mocked(readdir);
const mockedUnlink = vi.mocked(unlink);
const mockedMkdir = vi.mocked(mkdir);
const mockedStat = vi.mocked(stat);

describe('bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['REAPER_RESOURCE_PATH'] = '/tmp/test-reaper';
    mockedMkdir.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env['REAPER_RESOURCE_PATH'];
  });

  describe('ensureBridgeDir', () => {
    it('creates bridge directory and returns path', async () => {
      const dir = await ensureBridgeDir();
      expect(dir).toBe('/tmp/test-reaper/Scripts/mcp_bridge_data');
      expect(mockedMkdir).toHaveBeenCalledWith('/tmp/test-reaper/Scripts/mcp_bridge_data', { recursive: true });
    });
  });

  describe('sendCommand', () => {
    it('writes command file and reads response', async () => {
      const mockResponse = {
        id: 'test-uuid-1234',
        success: true,
        data: { name: 'Test Project' },
        timestamp: Date.now(),
      };

      mockedWriteFile.mockResolvedValue(undefined);
      mockedReadFile.mockResolvedValueOnce(JSON.stringify(mockResponse));
      mockedUnlink.mockResolvedValue(undefined);

      const result = await sendCommand('get_project_info');

      expect(mockedWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('command_test-uuid-1234.json'),
        expect.stringContaining('"type": "get_project_info"'),
        'utf-8',
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'Test Project' });
    });

    it('returns timeout error when no response arrives', async () => {
      mockedWriteFile.mockResolvedValue(undefined);
      mockedReadFile.mockRejectedValue(new Error('ENOENT'));
      mockedUnlink.mockResolvedValue(undefined);

      const result = await sendCommand('get_project_info', {}, 100);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Timeout');
    });

    it('passes params to the command file', async () => {
      const mockResponse = {
        id: 'test-uuid-1234',
        success: true,
        data: {},
        timestamp: Date.now(),
      };

      mockedWriteFile.mockResolvedValue(undefined);
      mockedReadFile.mockResolvedValueOnce(JSON.stringify(mockResponse));
      mockedUnlink.mockResolvedValue(undefined);

      await sendCommand('set_track_property', { trackIndex: 0, property: 'volume', value: -6 });

      const writtenContent = mockedWriteFile.mock.calls[0][1] as string;
      const parsed = JSON.parse(writtenContent);
      expect(parsed.params).toEqual({ trackIndex: 0, property: 'volume', value: -6 });
    });
  });

  describe('isBridgeRunning', () => {
    it('returns true when heartbeat is fresh', async () => {
      mockedStat.mockResolvedValue({ mtimeMs: Date.now() - 2000 } as Awaited<ReturnType<typeof stat>>);
      const result = await isBridgeRunning();
      expect(result).toBe(true);
    });

    it('returns false when heartbeat is stale', async () => {
      mockedStat.mockResolvedValue({ mtimeMs: Date.now() - 10000 } as Awaited<ReturnType<typeof stat>>);
      const result = await isBridgeRunning();
      expect(result).toBe(false);
    });

    it('returns false when heartbeat file does not exist', async () => {
      mockedStat.mockRejectedValue(new Error('ENOENT'));
      const result = await isBridgeRunning();
      expect(result).toBe(false);
    });
  });

  describe('cleanupStaleFiles', () => {
    it('removes stale command and response files', async () => {
      const staleTime = Date.now() - 60000;
      mockedReaddir.mockResolvedValue(['command_old.json', 'response_old.json', 'heartbeat.json'] as unknown as Awaited<ReturnType<typeof readdir>>);
      mockedStat.mockResolvedValue({ mtimeMs: staleTime } as Awaited<ReturnType<typeof stat>>);
      mockedUnlink.mockResolvedValue(undefined);

      const cleaned = await cleanupStaleFiles(30000);

      expect(cleaned).toBe(2);
      expect(mockedUnlink).toHaveBeenCalledTimes(2);
    });

    it('does not remove fresh files', async () => {
      mockedReaddir.mockResolvedValue(['command_new.json'] as unknown as Awaited<ReturnType<typeof readdir>>);
      mockedStat.mockResolvedValue({ mtimeMs: Date.now() } as Awaited<ReturnType<typeof stat>>);

      const cleaned = await cleanupStaleFiles(30000);

      expect(cleaned).toBe(0);
      expect(mockedUnlink).not.toHaveBeenCalled();
    });

    it('returns 0 when bridge dir does not exist', async () => {
      mockedReaddir.mockRejectedValue(new Error('ENOENT'));

      const cleaned = await cleanupStaleFiles();

      expect(cleaned).toBe(0);
    });
  });
});
