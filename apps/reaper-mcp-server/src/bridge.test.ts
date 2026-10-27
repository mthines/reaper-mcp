import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { sendCommand, isBridgeRunning, cleanupStaleFiles, ensureBridgeDir, readBridgeEvents, classifyBridgeError } from './bridge.js';

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  appendFile: vi.fn(),
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

import { appendFile, readFile, writeFile, readdir, unlink, mkdir, stat } from 'node:fs/promises';

const mockedAppendFile = vi.mocked(appendFile);
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
    mockedAppendFile.mockResolvedValue(undefined);
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

  describe('readBridgeEvents', () => {
    it('exports each Lua event as an OTel log record with its own timestamp and severity', async () => {
      // The cached ProxyLogger binds to whichever global provider is registered.
      const emit = vi.fn();
      logs.setGlobalLoggerProvider({ getLogger: () => ({ emit }) } as unknown as Parameters<typeof logs.setGlobalLoggerProvider>[0]);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mockedWriteFile.mockResolvedValue(undefined);
      mockedReadFile.mockResolvedValueOnce(
        '{"type":"bridge_start","ts":1000,"reaperVersion":"7.2","bridgeDir":"/Users/someone/REAPER"}\n' +
          'not json\n' +
          '{"type":"handler_error","ts":2000,"commandType":"add_fx","error":"boom"}\n',
      );

      await readBridgeEvents();

      expect(mockedWriteFile).toHaveBeenCalledWith(
        '/tmp/test-reaper/Scripts/mcp_bridge_data/bridge_events.jsonl', '', 'utf-8',
      );
      expect(emit).toHaveBeenCalledTimes(2);
      expect(emit.mock.calls[0][0]).toMatchObject({
        eventName: 'reaper.bridge.bridge_start',
        severityNumber: SeverityNumber.INFO,
        timestamp: 1000,
        attributes: { 'reaper.version': '7.2' },
      });
      expect(JSON.stringify(emit.mock.calls[0][0].attributes)).not.toContain('/Users/someone');
      expect(emit.mock.calls[1][0]).toMatchObject({
        eventName: 'reaper.bridge.handler_error',
        severityNumber: SeverityNumber.ERROR,
        timestamp: 2000,
        attributes: { 'rpc.method': 'add_fx', 'exception.message': 'boom', 'error.type': 'handler_crash' },
      });
    });
  });

  describe('classifyBridgeError', () => {
    it('maps the Lua bridge error prefixes to bounded error.type values', () => {
      expect(classifyBridgeError('Handler error: attempt to index nil')).toBe('handler_crash');
      expect(classifyBridgeError('Unknown command type: nope')).toBe('unknown_command');
      expect(classifyBridgeError('Track 99 not found')).toBe('command_failed');
      expect(classifyBridgeError(undefined)).toBe('command_failed');
    });
  });

  describe('telemetry redaction', () => {
    it('replaces the home directory (OS username) with ~ in exported log text', async () => {
      const { homedir } = await import('node:os');
      const { redactHome } = await import('./telemetry.js');
      expect(redactHome(`Cannot read ${homedir()}/Music/a.rpp`)).toBe('Cannot read ~/Music/a.rpp');
      expect(redactHome('/tmp/x.wav')).toBe('/tmp/x.wav');
    });
  });
});
