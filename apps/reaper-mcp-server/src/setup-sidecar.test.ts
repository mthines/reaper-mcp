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
import { existsSync, copyFileSync } from 'node:fs';
import {
  parsePythonVersion,
  getPythonBin,
  checkPython,
  copySidecarScript,
  downloadModelWeights,
  installSeparation,
  installChords,
  parseSetupArgs,
  resolveSelection,
  planSetup,
  applyToggles,
  renderComponents,
  detectInstalled,
  SIDECAR_DIR,
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

// ---------------------------------------------------------------------------
// downloadModelWeights
// ---------------------------------------------------------------------------

describe('downloadModelWeights', () => {
  beforeEach(() => execMock.mockReset());

  it('passes a -c script with no double quotes inside the double-quoted argument', async () => {
    mockExecSuccess('');
    await downloadModelWeights();
    const cmd = execMock.mock.calls[0][0] as string;
    const script = cmd.slice(cmd.indexOf(' -c "') + 5, -1);
    expect(script).toContain('snapshot_download');
    expect(script).not.toContain('"');
  });
});

// ---------------------------------------------------------------------------
// copySidecarScript
// ---------------------------------------------------------------------------

describe('copySidecarScript', () => {
  it('installs analysis.py next to server.py', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    copySidecarScript('/fake/dist');
    const dests = vi.mocked(copyFileSync).mock.calls.map((c) => String(c[1]));
    expect(dests).toContain(`${SIDECAR_DIR}/server.py`);
    expect(dests).toContain(`${SIDECAR_DIR}/analysis.py`);
  });

  it('installs the mix-check and separation modules too', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    copySidecarScript('/fake/dist');
    const dests = vi.mocked(copyFileSync).mock.calls.map((c) => String(c[1]));
    expect(dests).toContain(`${SIDECAR_DIR}/mixcheck.py`);
    expect(dests).toContain(`${SIDECAR_DIR}/separation.py`);
    expect(dests).toContain(`${SIDECAR_DIR}/chords.py`);
  });
});

// ---------------------------------------------------------------------------
// installSeparation (--with-separation)
// ---------------------------------------------------------------------------

describe('installSeparation', () => {
  beforeEach(() => execMock.mockReset());

  it('installs Demucs from its own requirements file into the venv, then fetches the htdemucs model', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    mockExecSuccess('');
    mockExecSuccess('Model htdemucs ready.');
    await installSeparation('/fake/dist');
    const [install, fetch] = execMock.mock.calls.map((c) => String(c[0]));
    expect(install).toContain(SIDECAR_VENV_PATH);
    expect(install).toMatch(/install -r ".*requirements-separation\.txt"/);
    const script = fetch.slice(fetch.indexOf(' -c "') + 5, -1);
    expect(script).toContain("get_model('htdemucs')");
    expect(script).not.toContain('"');
  });

  it('refuses before running pip when the requirements file is missing', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    await expect(installSeparation('/fake/dist')).rejects.toThrow(/requirements-separation\.txt not found/);
    expect(execMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// installChords (--with-chords)
// ---------------------------------------------------------------------------

describe('installChords', () => {
  beforeEach(() => execMock.mockReset());

  it('installs lv-chordia from its own requirements file into the venv, then checks it imports', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    mockExecSuccess('');
    mockExecSuccess('Chord model ready.');
    await installChords('/fake/dist');
    const [install, check] = execMock.mock.calls.map((c) => String(c[0]));
    expect(install).toMatch(/install -r ".*requirements-chords\.txt"/);
    expect(check).toContain('import lv_chordia');
  });

  it('refuses before running pip when the requirements file is missing', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    await expect(installChords('/fake/dist')).rejects.toThrow(/requirements-chords\.txt not found/);
    expect(execMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Picking components: a picker in a terminal, flags for agents and CI
// ---------------------------------------------------------------------------

describe('setup-sidecar options', () => {
  const none = { core: false, aesthetics: false, separation: false, chords: false };

  it('asks in a terminal without flags, and never without a terminal, in CI, with --yes or with a component flag', () => {
    expect(parseSetupArgs([], {}, true).interactive).toBe(true);
    expect(parseSetupArgs([], {}, false).interactive).toBe(false);
    expect(parseSetupArgs([], { CI: 'true' }, true).interactive).toBe(false);
    expect(parseSetupArgs(['--yes'], {}, true).interactive).toBe(false);
    expect(parseSetupArgs(['-y'], {}, true).interactive).toBe(false);
    expect(parseSetupArgs(['--with-chords'], {}, true).interactive).toBe(false);
    expect(parseSetupArgs(['--list', '--json'], {}, true)).toMatchObject({ interactive: false, list: true, json: true });
    expect(parseSetupArgs(['--with-chrods'], {}, false).unknown).toEqual(['--with-chrods']);
  });

  it('installs the core and the aesthetics weights by default, add-ons only when asked', () => {
    expect(resolveSelection(parseSetupArgs(['--yes'], {}, false).picks)).toEqual({ core: true, aesthetics: true, separation: false, chords: false });
    expect(resolveSelection(parseSetupArgs(['--with-chords', '--without-aesthetics'], {}, false).picks))
      .toEqual({ core: true, aesthetics: false, separation: false, chords: true });
    expect(resolveSelection(parseSetupArgs(['--all'], {}, false).picks)).toEqual({ core: true, aesthetics: true, separation: true, chords: true });
  });

  it('adds only what is missing to an existing install', () => {
    const installed = { core: true, aesthetics: true, separation: true, chords: false };
    expect(planSetup(resolveSelection({ chords: true, separation: true }), installed)).toEqual(['chords']);
    expect(planSetup(resolveSelection({}), installed)).toEqual([]);
    expect(planSetup(resolveSelection({ separation: true }), none)).toEqual(['core', 'aesthetics', 'separation']);
  });

  it('reinstalls the venv add-ons when the venv itself is rebuilt, but keeps the cached weights', () => {
    const broken = { core: false, aesthetics: true, separation: true, chords: false };
    expect(planSetup(resolveSelection({ separation: true }), broken)).toEqual(['core', 'separation']);
  });

  it('toggles components by number in the picker; the core and installed ones stay', () => {
    const installed = { ...none, separation: true };
    const start = resolveSelection({});
    expect(applyToggles('2 4', start, installed)).toMatchObject({ aesthetics: false, chords: true });
    expect(applyToggles('1 3', start, installed)).toMatchObject({ core: true, separation: false });
    expect(applyToggles('a', start, installed)).toMatchObject({ chords: true, separation: true });
    expect(applyToggles('9 x', start, installed)).toEqual(start);
  });

  it('shows what each component enables, why, and its size', () => {
    const text = renderComponents(resolveSelection({}), { ...none, separation: true });
    expect(text).toMatch(/1\. \[x\] Audio analysis \(required\)/);
    expect(text).toMatch(/3\. \[installed\] Stem separation/);
    expect(text).toMatch(/4\. \[ \] Chord recognition model/);
    expect(text).toContain('831 MB');
    expect(text).toContain('separate_stems');
  });

  it('counts a chord model that is in the venv but fails to import as not installed, so setup repairs it', async () => {
    execMock.mockReset();
    vi.mocked(existsSync).mockReturnValue(true);
    mockExecSuccess('{"core": true, "separation": false, "chords": true}\n');
    mockExecFailure("ModuleNotFoundError: No module named 'pyaudioop'");
    const installed = await detectInstalled();
    expect(installed.chords).toBe(false);
    expect(planSetup(resolveSelection({ chords: true }), installed)).toContain('chords');
  });

  it('reads the installed add-ons from the venv', async () => {
    execMock.mockReset();
    vi.mocked(existsSync).mockReturnValue(true);
    mockExecSuccess('{"core": true, "separation": false, "chords": true}\n');
    mockExecSuccess('');
    expect(await detectInstalled()).toEqual({ core: true, aesthetics: true, separation: false, chords: true });
    vi.mocked(existsSync).mockReturnValue(false);
    expect(await detectInstalled()).toEqual(none);
  });
});
