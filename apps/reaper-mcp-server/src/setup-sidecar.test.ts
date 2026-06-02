/**
 * Vitest unit tests for setup-sidecar.ts
 *
 * Mock strategy: vi.mock('node:child_process') + vi.mock('node:fs') for exec/filesystem calls.
 * Tests run without Python or a real filesystem.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — must be hoisted before imports
// ---------------------------------------------------------------------------

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  copyFileSync: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { exec as execCb } from 'node:child_process';
import {
  parsePythonVersion,
  getPythonBin,
  checkPython,
  SIDECAR_VENV_PATH,
  MIN_PYTHON_MAJOR,
  MIN_PYTHON_MINOR,
} from './setup-sidecar.js';

const execMock = execCb as unknown as ReturnType<typeof vi.fn>;

// Helper: make exec invoke the callback with success (callback-style mock)
function mockExecSuccess(stdout: string, stderr = ''): void {
  execMock.mockImplementationOnce((_cmd: string, cb: (err: null, stdout: string, stderr: string) => void) => {
    cb(null, stdout, stderr);
  });
}

// Helper: make exec invoke the callback with an error
function mockExecFailure(message = 'command not found'): void {
  execMock.mockImplementationOnce((_cmd: string, cb: (err: Error) => void) => {
    cb(new Error(message));
  });
}

// ---------------------------------------------------------------------------
// parsePythonVersion
// ---------------------------------------------------------------------------

describe('parsePythonVersion', () => {
  it('parses "Python 3.11.9"', () => {
    expect(parsePythonVersion('Python 3.11.9')).toEqual([3, 11, 9]);
  });

  it('parses "Python 3.10.0"', () => {
    expect(parsePythonVersion('Python 3.10.0')).toEqual([3, 10, 0]);
  });

  it('returns null for empty string', () => {
    expect(parsePythonVersion('')).toBeNull();
  });

  it('returns null for unrecognised format', () => {
    expect(parsePythonVersion('cpython 3.11')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(parsePythonVersion('python 3.12.1')).toEqual([3, 12, 1]);
  });
});

// ---------------------------------------------------------------------------
// getPythonBin
// ---------------------------------------------------------------------------

describe('getPythonBin', () => {
  it('returns python3 by default', () => {
    delete process.env['PYTHON_BIN'];
    expect(getPythonBin()).toBe('python3');
  });

  it('returns PYTHON_BIN when set', () => {
    process.env['PYTHON_BIN'] = '/usr/local/bin/python3.11';
    expect(getPythonBin()).toBe('/usr/local/bin/python3.11');
    delete process.env['PYTHON_BIN'];
  });
});

// ---------------------------------------------------------------------------
// checkPython
// ---------------------------------------------------------------------------

describe('checkPython', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts Python 3.11.9', async () => {
    mockExecSuccess('Python 3.11.9\n');
    const version = await checkPython('python3');
    expect(version).toBe('3.11.9');
  });

  it('accepts Python 3.10.0 (minimum)', async () => {
    mockExecSuccess('Python 3.10.0\n');
    const version = await checkPython('python3');
    expect(version).toBe('3.10.0');
  });

  it('rejects Python 3.9.1 with actionable error', async () => {
    mockExecSuccess('Python 3.9.1\n');
    await expect(checkPython('python3')).rejects.toThrow(/3\.10\+|too old|required/i);
  });

  it('rejects Python 2.7 with actionable error', async () => {
    mockExecSuccess('Python 2.7.18\n');
    await expect(checkPython('python3')).rejects.toThrow(/3\.10\+|required/i);
  });

  it('throws with install URL when python not found', async () => {
    mockExecFailure('python3: command not found');
    await expect(checkPython('python3')).rejects.toThrow(/https:\/\/python\.org/);
  });

  it('uses PYTHON_BIN interpreter when provided', async () => {
    const customBin = '/usr/local/bin/python3.11';
    mockExecSuccess('Python 3.11.9\n');
    await checkPython(customBin);
    expect(execMock).toHaveBeenCalledWith(expect.stringContaining(customBin), expect.any(Function));
  });
});

// ---------------------------------------------------------------------------
// SIDECAR_VENV_PATH
// ---------------------------------------------------------------------------

describe('SIDECAR_VENV_PATH', () => {
  it('includes .reaper-mcp/sidecar-venv', () => {
    expect(SIDECAR_VENV_PATH).toContain('.reaper-mcp');
    expect(SIDECAR_VENV_PATH).toContain('sidecar-venv');
  });
});

// ---------------------------------------------------------------------------
// MIN_PYTHON_MAJOR / MIN_PYTHON_MINOR
// ---------------------------------------------------------------------------

describe('minimum Python version constants', () => {
  it('MIN_PYTHON_MAJOR is 3', () => {
    expect(MIN_PYTHON_MAJOR).toBe(3);
  });

  it('MIN_PYTHON_MINOR is 10', () => {
    expect(MIN_PYTHON_MINOR).toBe(10);
  });
});
