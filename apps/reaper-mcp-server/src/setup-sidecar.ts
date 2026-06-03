/**
 * setup-sidecar — CLI command implementation
 *
 * Installs the Python sidecar for AI-powered perceptual audio analysis:
 *   1. Detect Python ≥ 3.10 (or use PYTHON_BIN env var)
 *   2. Create an isolated venv at ~/.reaper-mcp/sidecar-venv/
 *   3. Install pinned deps from sidecar/requirements.txt
 *   4. Pre-download Audiobox Aesthetics model weights
 *   5. Copy server.py to ~/.reaper-mcp/sidecar/server.py
 *
 * Usage: node dist/apps/reaper-mcp-server/main.js setup-sidecar
 */

import { exec as execImpl } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolveAssetDir } from './cli.js';

// Venv binary layout differs by OS: POSIX uses bin/, Windows uses Scripts\
const VENV_BIN = platform() === 'win32' ? 'Scripts' : 'bin';
const VENV_PYTHON_NAME = platform() === 'win32' ? 'python.exe' : 'python';
const VENV_PIP_NAME = platform() === 'win32' ? 'pip.exe' : 'pip';

/** Promisified exec — lazily resolves from node:child_process so mocks work correctly. */
function exec(cmd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execImpl(cmd, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout, stderr });
    });
  });
}

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Path constants (exported for testability)
// ---------------------------------------------------------------------------

export const SIDECAR_VENV_PATH = join(homedir(), '.reaper-mcp', 'sidecar-venv');
export const SIDECAR_DIR = join(homedir(), '.reaper-mcp', 'sidecar');
export const SIDECAR_SCRIPT_DEST = join(SIDECAR_DIR, 'server.py');
export const MODEL_ID = 'facebook/audiobox-aesthetics';
export const MIN_PYTHON_MAJOR = 3;
export const MIN_PYTHON_MINOR = 10;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Resolve the Python interpreter to use. Reads PYTHON_BIN env var first. */
export function getPythonBin(): string {
  return process.env['PYTHON_BIN'] ?? 'python3';
}

/** Parse a Python version string like "Python 3.11.9" → [3, 11, 9] */
export function parsePythonVersion(output: string): [number, number, number] | null {
  const match = output.match(/Python\s+(\d+)\.(\d+)\.(\d+)/i);
  if (!match) return null;
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
}

/**
 * Check Python interpreter. Returns the full version string if OK.
 * Throws with an actionable message if Python is missing or too old.
 */
export async function checkPython(pythonBin: string): Promise<string> {
  let stdout: string;
  try {
    const result = await exec(`"${pythonBin}" --version`);
    // Python 3 prints to stdout; Python 2 printed to stderr
    stdout = (result.stdout + result.stderr).trim();
  } catch {
    const notFound =
      `Python interpreter not found: ${pythonBin}\n` +
      `Install Python 3.10+ from https://python.org or set the PYTHON_BIN environment variable.\n` +
      `Example: PYTHON_BIN=/usr/local/bin/python3.11 node dist/apps/reaper-mcp-server/main.js setup-sidecar`;
    throw new Error(notFound);
  }

  const version = parsePythonVersion(stdout);
  if (!version) {
    throw new Error(`Could not parse Python version from: "${stdout}". Is PYTHON_BIN set correctly?`);
  }

  const [major, minor, patch] = version;
  if (major < MIN_PYTHON_MAJOR || (major === MIN_PYTHON_MAJOR && minor < MIN_PYTHON_MINOR)) {
    throw new Error(
      `Python ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}+ required. ` +
      `Found: ${major}.${minor}.${patch} at ${pythonBin}.\n` +
      `Install Python 3.10+ from https://python.org or set PYTHON_BIN to a newer interpreter.`
    );
  }

  return `${major}.${minor}.${patch}`;
}

/** Create the isolated venv at SIDECAR_VENV_PATH. Always uses --clear so a
 * partial venv from a previous failed setup is rebuilt cleanly. */
export async function createVenv(pythonBin: string): Promise<void> {
  mkdirSync(join(homedir(), '.reaper-mcp'), { recursive: true });
  await exec(`"${pythonBin}" -m venv --clear "${SIDECAR_VENV_PATH}"`);
}

/** Remove a broken venv after a failed install so the next setup-sidecar
 * run starts from a clean slate. Best-effort — swallows errors. */
export function cleanupBrokenVenv(): void {
  try {
    if (existsSync(SIDECAR_VENV_PATH)) {
      rmSync(SIDECAR_VENV_PATH, { recursive: true, force: true });
    }
  } catch {
    // Best-effort cleanup; do not mask the original error
  }
}

/** Resolve the path to requirements.txt from either the build output or source tree. */
export function resolveRequirementsTxt(baseDir: string): string {
  const sidecarDir = resolveAssetDir(baseDir, 'sidecar');
  return join(sidecarDir, 'requirements.txt');
}

/** Install Python deps from requirements.txt into the venv. */
export async function installDeps(requirementsPath: string): Promise<void> {
  const pip = join(SIDECAR_VENV_PATH, VENV_BIN, VENV_PIP_NAME);
  // Upgrade pip first to avoid warnings on older pip versions
  await exec(`"${pip}" install --upgrade pip`);
  const { stdout, stderr } = await exec(`"${pip}" install -r "${requirementsPath}"`);
  // Forward pip output to console so user sees progress
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
}

/** Pre-download the Audiobox Aesthetics model weights. */
export async function downloadModelWeights(): Promise<void> {
  const python = join(SIDECAR_VENV_PATH, VENV_BIN, VENV_PYTHON_NAME);
  const script = [
    'from huggingface_hub import snapshot_download',
    `print("Downloading ${MODEL_ID} weights to ~/.cache/huggingface/hub/ ...")`,
    `snapshot_download("${MODEL_ID}")`,
    `print("Download complete.")`,
  ].join('; ');

  const { stdout, stderr } = await exec(`"${python}" -c "${script}"`);
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
}

/** Copy server.py from dist/sidecar/ to ~/.reaper-mcp/sidecar/server.py. */
export function copySidecarScript(baseDir: string): void {
  const sidecarDir = resolveAssetDir(baseDir, 'sidecar');
  const src = join(sidecarDir, 'server.py');
  if (!existsSync(src)) {
    throw new Error(
      `sidecar/server.py not found at: ${src}\n` +
      `Run \`pnpm nx build reaper-mcp-server\` first.`
    );
  }
  mkdirSync(SIDECAR_DIR, { recursive: true });
  copyFileSync(src, SIDECAR_SCRIPT_DEST);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function setupSidecar(): Promise<void> {
  console.log('REAPER MCP — Setup Python Sidecar\n');
  console.log('This installs the opt-in audio AI subsystem for perceptual analysis.');
  console.log('Requires Python 3.10+ and an internet connection (~831 MB download).\n');

  // Step 1: Detect Python interpreter
  const pythonBin = getPythonBin();
  console.log(`Checking Python interpreter: ${pythonBin}`);
  let version: string;
  try {
    version = await checkPython(pythonBin);
  } catch (err) {
    console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  console.log(`  Using Python interpreter: ${pythonBin} (${version})`);

  // Step 2: Create isolated venv
  console.log(`\nCreating virtual environment at: ${SIDECAR_VENV_PATH}`);
  try {
    await createVenv(pythonBin);
    console.log('  Virtual environment created.');
  } catch (err) {
    console.error(`\nFailed to create venv: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // Step 3: Install Python dependencies
  const requirementsPath = resolveRequirementsTxt(__dirname);
  console.log(`\nInstalling Python dependencies from: ${requirementsPath}`);
  if (!existsSync(requirementsPath)) {
    console.error(`\nError: requirements.txt not found at: ${requirementsPath}`);
    console.error('Run `pnpm nx build reaper-mcp-server` first.');
    process.exit(1);
  }
  try {
    await installDeps(requirementsPath);
    console.log('  Dependencies installed.');
  } catch (err) {
    console.error(`\nFailed to install dependencies: ${err instanceof Error ? err.message : String(err)}`);
    cleanupBrokenVenv();
    console.error('Removed partial venv so the next setup-sidecar run starts clean.');
    process.exit(1);
  }

  // Step 4: Pre-download model weights
  console.log('\nPre-downloading Audiobox Aesthetics model weights (~831 MB)...');
  console.log('This may take several minutes depending on your internet connection.');
  try {
    await downloadModelWeights();
  } catch (err) {
    console.error(`\nModel download failed: ${err instanceof Error ? err.message : String(err)}`);
    console.error('Check your internet connection and run setup-sidecar again.');
    process.exit(1);
  }

  // Step 5: Copy server.py to install location
  console.log(`\nInstalling sidecar script to: ${SIDECAR_SCRIPT_DEST}`);
  try {
    copySidecarScript(__dirname);
    console.log('  Sidecar script installed.');
  } catch (err) {
    console.error(`\nFailed to install sidecar script: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  console.log('\nSidecar setup complete!\n');
  console.log('The analyze_track_aesthetics tool is now available.');
  console.log('Run `node dist/apps/reaper-mcp-server/main.js doctor` to verify.\n');
}
