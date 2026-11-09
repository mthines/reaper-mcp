import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { sendCommand, isBridgeRunning, cleanupStaleFiles, ensureBridgeDir, readBridgeEvents, classifyBridgeError, isSystemError, getBridgeState, outdatedBridgeMessage } from './bridge.js';

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
import { randomUUID } from 'node:crypto';

const mockedAppendFile = vi.mocked(appendFile);
const mockedReadFile = vi.mocked(readFile);
const mockedWriteFile = vi.mocked(writeFile);
const mockedReaddir = vi.mocked(readdir);
const mockedUnlink = vi.mocked(unlink);
const mockedMkdir = vi.mocked(mkdir);
const mockedStat = vi.mocked(stat);

type Stat = Awaited<ReturnType<typeof stat>>;

/**
 * What REAPER's resource folder holds: each key is a file (matched by the end of its path),
 * its value the file's age in ms. Anything else does not exist.
 */
function resourceFolder(files: Record<string, number>): void {
  mockedStat.mockImplementation(async (path) => {
    for (const [name, ageMs] of Object.entries(files)) {
      if (String(path).endsWith(name)) return { mtimeMs: Date.now() - ageMs } as Stat;
    }
    throw Object.assign(new Error(`ENOENT: ${String(path)}`), { code: 'ENOENT' });
  });
}

const INSTALLED = { 'mcp_bridge.lua': 0, 'reaper.ini': 0 };

/**
 * Jump the clock (Date only, timers stay real) ten minutes past the previous jump, so REAPER's answers
 * to earlier tests are long past: an answer within the last minute counts as REAPER being up.
 */
let clockShift = 0;
function minutesLater(): void {
  vi.useRealTimers();
  clockShift += 10 * 60_000;
  vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + clockShift });
}

// The global logger provider can be set only once per process: register one
// whose emit every test can inspect.
const emit = vi.fn();
logs.setGlobalLoggerProvider({ getLogger: () => ({ emit }) } as unknown as Parameters<typeof logs.setGlobalLoggerProvider>[0]);

describe('bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['REAPER_RESOURCE_PATH'] = '/tmp/test-reaper';
    mockedMkdir.mockResolvedValue(undefined);
    mockedAppendFile.mockResolvedValue(undefined);
    // REAPER is running with the bridge: a fresh heartbeat
    mockedStat.mockResolvedValue({ mtimeMs: Date.now() } as Stat);
  });

  afterEach(() => {
    delete process.env['REAPER_RESOURCE_PATH'];
    vi.useRealTimers();
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

    it('logs a handler-reported internal error at ERROR, a bad request at WARN', async () => {
      emit.mockClear();
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mockedWriteFile.mockResolvedValue(undefined);
      mockedUnlink.mockResolvedValue(undefined);
      const fail = (error: string) => JSON.stringify({ id: 'test-uuid-1234', success: false, error, timestamp: Date.now() });

      mockedReadFile.mockResolvedValueOnce(fail('Internal error: emitter was inserted but could not be found'));
      await sendCommand('send_midi_cc', { trackIndex: 0, cc: 1, value: 0 });
      mockedReadFile.mockResolvedValueOnce(fail('Track 99 not found'));
      await sendCommand('send_midi_cc', { trackIndex: 99, cc: 1, value: 0 });

      const failed = emit.mock.calls.map(([r]) => r).filter((r) => r.eventName === 'reaper.bridge.command.failed');
      expect(failed).toHaveLength(2);
      expect(failed[0]).toMatchObject({ severityNumber: SeverityNumber.ERROR, attributes: { 'error.type': 'internal_error' } });
      expect(failed[1]).toMatchObject({ severityNumber: SeverityNumber.WARN, attributes: { 'error.type': 'command_failed' } });
    });

    it('reports a command the running bridge does not know as an outdated bridge, with the step that fixes it', async () => {
      emit.mockClear();
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mockedWriteFile.mockResolvedValue(undefined);
      mockedUnlink.mockResolvedValue(undefined);
      // What an mcp_bridge.lua from an older release answers for a command it has no handler for
      mockedReadFile.mockResolvedValueOnce(JSON.stringify({
        id: 'test-uuid-1234', success: false, error: 'Unknown command type: get_project_settings', timestamp: Date.now(),
      }));

      const result = await sendCommand('get_project_settings');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/^Bridge outdated: the REAPER bridge does not know the command 'get_project_settings'/);
      expect(result.error).toMatch(/Restart the bridge/);
      expect(result.error).toMatch(/reaper-mcp setup/);
      expect(result.error).toMatch(/\(The bridge said: Unknown command type: get_project_settings\)$/);
      expect(classifyBridgeError(result.error)).toBe('bridge_outdated');
      const failed = emit.mock.calls.map(([r]) => r).filter((r) => r.eventName === 'reaper.bridge.command.failed');
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatchObject({
        severityNumber: SeverityNumber.WARN,
        attributes: { 'rpc.method': 'get_project_settings', 'error.type': 'bridge_outdated' },
      });
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

  describe('getBridgeState', () => {
    it('counts the copy ReaPack installed as an installed bridge', async () => {
      resourceFolder({ 'MCP Bridge/mcp_bridge.lua': 0, 'reaper.ini': 0 });
      expect((await getBridgeState()).state).toBe('never_started');
    });

    it.each([
      ['connected', { 'heartbeat.json': 1_000, ...INSTALLED }],
      ['stale', { 'heartbeat.json': 10 * 60_000, ...INSTALLED }],
      ['never_started', INSTALLED],
      ['not_installed', { 'reaper.ini': 0 }],
      ['no_reaper', {}],
    ] as const)('reports %s from the files in REAPER\'s resource folder', async (state, files) => {
      resourceFolder(files);
      expect((await getBridgeState()).state).toBe(state);
    });
  });

  describe('sendCommand while the bridge is down', () => {
    beforeEach(() => {
      minutesLater();
      mockedReaddir.mockResolvedValue([] as unknown as Awaited<ReturnType<typeof readdir>>);
    });

    it.each([
      ['never ran', INSTALLED, /Script: mcp_bridge\.lua/],
      ['is not installed', { 'reaper.ini': 0 }, /Run in a terminal: reaper-mcp setup/],
      ['has no REAPER to run in', {}, /REAPER_RESOURCE_PATH/],
      ['stopped half an hour ago', { 'heartbeat.json': 30 * 60_000, ...INSTALLED }, /has not answered for 30 min/],
    ] as const)('refuses at once when the bridge %s, says how to fix it, and sends nothing', async (_case, files, fix) => {
      resourceFolder(files);
      const started = Date.now();

      const result = await sendCommand('get_project_info');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(fix);
      expect(classifyBridgeError(result.error)).toBe('bridge_not_running');
      expect(Date.now() - started).toBeLessThan(1_000); // not the 10 s timeout
      expect(mockedWriteFile).not.toHaveBeenCalled(); // no command file left behind for REAPER
    });

    it('never tells a REAPER that is only busy to run the bridge script, which would stop it', async () => {
      resourceFolder({ 'heartbeat.json': 5 * 60_000, ...INSTALLED });

      const { error } = await sendCommand('get_project_info');

      expect(error).toMatch(/rendering or showing a dialog, finish or close it and try again/);
      expect(error).toMatch(/If REAPER is open and idle, the bridge stopped\. Start the bridge/);
    });

    it('logs the refusal as a warning that names the bridge state', async () => {
      emit.mockClear();
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      resourceFolder({ 'reaper.ini': 0 });

      await sendCommand('get_project_info');

      const refused = emit.mock.calls.map(([r]) => r).filter((r) => r.eventName === 'reaper.bridge.command.not_sent');
      expect(refused).toHaveLength(1);
      expect(refused[0]).toMatchObject({
        severityNumber: SeverityNumber.WARN,
        attributes: { 'error.type': 'bridge_not_running', 'reaper.bridge.state': 'not_installed' },
      });
    });

    it('still waits for REAPER when the heartbeat is only seconds old (a render pauses it)', async () => {
      resourceFolder({ 'heartbeat.json': 20_000, ...INSTALLED });
      mockedWriteFile.mockResolvedValue(undefined);
      mockedUnlink.mockResolvedValue(undefined);
      mockedReadFile.mockResolvedValueOnce(JSON.stringify({ id: 'test-uuid-1234', success: true, data: {}, timestamp: Date.now() }));

      const result = await sendCommand('get_project_info');

      expect(result.success).toBe(true);
    });

    it('queues behind a command REAPER is still busy with, even once the heartbeat has gone stale', async () => {
      resourceFolder({ 'heartbeat.json': 0, ...INSTALLED });
      mockedWriteFile.mockResolvedValue(undefined);
      mockedUnlink.mockResolvedValue(undefined);
      let rendering = true;
      mockedReadFile.mockImplementation(async (path) => {
        if (rendering) throw new Error('ENOENT');
        const id = /response_(.+)\.json$/.exec(String(path))?.[1];
        return JSON.stringify({ id, success: true, data: {}, timestamp: Date.now() });
      });
      vi.mocked(randomUUID)
        .mockReturnValueOnce('render-0000-0000-0000-000000000000')
        .mockReturnValueOnce('next-0000-0000-0000-000000000000');

      const render = sendCommand('render_track_to_wav' as never, {}, 5_000);
      await vi.waitFor(() => expect(mockedWriteFile).toHaveBeenCalledTimes(1));
      // The render blocks REAPER's defer loop, so the heartbeat stops being written
      resourceFolder({ 'heartbeat.json': 5 * 60_000, ...INSTALLED });
      const next = sendCommand('get_project_info', {}, 5_000);
      await vi.waitFor(() => expect(mockedWriteFile).toHaveBeenCalledTimes(2));
      rendering = false;

      expect((await render).success).toBe(true);
      expect((await next).success).toBe(true);
    });

    it('waits behind another session\'s command that REAPER is still running, though the heartbeat is old', async () => {
      // Another server's render: its command file stays in the bridge folder until REAPER has run it
      resourceFolder({ 'heartbeat.json': 3 * 60_000, 'command_other-session.json': 3 * 60_000, ...INSTALLED });
      mockedReaddir.mockResolvedValue(['command_other-session.json', 'heartbeat.json'] as unknown as Awaited<ReturnType<typeof readdir>>);
      mockedWriteFile.mockResolvedValue(undefined);
      mockedUnlink.mockResolvedValue(undefined);
      mockedReadFile.mockResolvedValueOnce(JSON.stringify({ id: 'test-uuid-1234', success: true, data: {}, timestamp: Date.now() }));

      expect((await sendCommand('get_project_info')).success).toBe(true);
    });

    it('ignores a command file left behind long ago', async () => {
      resourceFolder({ 'heartbeat.json': 60 * 60_000, 'command_crashed.json': 20 * 60_000, ...INSTALLED });
      mockedReaddir.mockResolvedValue(['command_crashed.json', 'heartbeat.json'] as unknown as Awaited<ReturnType<typeof readdir>>);

      const result = await sendCommand('get_project_info');

      expect(classifyBridgeError(result.error)).toBe('bridge_not_running');
      expect(mockedWriteFile).not.toHaveBeenCalled();
    });

    it('sends a command right after REAPER answered, though the heartbeat has not caught up, until a minute passes', async () => {
      mockedWriteFile.mockResolvedValue(undefined);
      mockedUnlink.mockResolvedValue(undefined);
      mockedReadFile.mockImplementation(async (path) =>
        JSON.stringify({ id: /response_(.+)\.json$/.exec(String(path))?.[1], success: true, data: {}, timestamp: Date.now() }));
      resourceFolder({ 'heartbeat.json': 0, ...INSTALLED });
      expect((await sendCommand('render_track_to_wav' as never)).success).toBe(true);

      // REAPER rewrites the heartbeat only on the tick after a long render: still old when the next command goes out
      resourceFolder({ 'heartbeat.json': 90_000, ...INSTALLED });
      expect((await sendCommand('get_project_info')).success).toBe(true);

      vi.setSystemTime(Date.now() + 61_000);
      const late = await sendCommand('get_project_info');
      expect(late.success).toBe(false);
      expect(classifyBridgeError(late.error)).toBe('bridge_not_running');
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
      emit.mockClear();
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
        timestamp: new Date(1000), // a Date: numbers below the SDK time origin get shifted
        attributes: { 'reaper.version': '7.2' },
      });
      expect(JSON.stringify(emit.mock.calls[0][0].attributes)).not.toContain('/Users/someone');
      expect(emit.mock.calls[1][0]).toMatchObject({
        eventName: 'reaper.bridge.handler_error',
        severityNumber: SeverityNumber.ERROR,
        timestamp: new Date(2000),
        attributes: { 'rpc.method': 'add_fx', 'exception.message': 'boom', 'error.type': 'handler_crash' },
      });
    });

    it('reports a command the running bridge does not know as an outdated bridge at WARN, not as an error', async () => {
      emit.mockClear();
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mockedWriteFile.mockResolvedValue(undefined);
      mockedReadFile.mockResolvedValueOnce(
        '{"type":"handler_unknown","ts":3000,"commandType":"get_project_settings","commandId":"c-1"}\n',
      );

      await readBridgeEvents();

      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit.mock.calls[0][0]).toMatchObject({
        eventName: 'reaper.bridge.handler_unknown',
        severityNumber: SeverityNumber.WARN,
        timestamp: new Date(3000),
        attributes: {
          'rpc.method': 'get_project_settings',
          'reaper.bridge.command.id': 'c-1',
          'error.type': 'bridge_outdated',
        },
      });
    });
  });

  describe('classifyBridgeError', () => {
    it('maps the Lua bridge error prefixes to bounded error.type values', () => {
      expect(classifyBridgeError('Handler error: attempt to index nil')).toBe('handler_crash');
      expect(classifyBridgeError('Unknown command type: nope')).toBe('unknown_command');
      expect(classifyBridgeError('Internal error: x was inserted but could not be found')).toBe('internal_error');
      expect(classifyBridgeError('Timeout: no response from REAPER Lua bridge after 10000ms')).toBe('timeout');
      expect(classifyBridgeError('Track 99 not found')).toBe('command_failed');
      expect(classifyBridgeError(undefined)).toBe('command_failed');
    });

    it('does not count a bridge the user has not started as a system error', () => {
      expect(classifyBridgeError('Bridge not running: REAPER has not answered for 5 min.')).toBe('bridge_not_running');
      expect(isSystemError('bridge_not_running')).toBe(false);
      expect(isSystemError('timeout')).toBe(true);
    });

    it('does not count a bridge the user has not restarted since an update as a system error', () => {
      expect(classifyBridgeError(outdatedBridgeMessage('save_project', 'Unknown command type: save_project'))).toBe('bridge_outdated');
      expect(isSystemError('bridge_outdated')).toBe(false);
      expect(isSystemError('unknown_command')).toBe(true);
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
