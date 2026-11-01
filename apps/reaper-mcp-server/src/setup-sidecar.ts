/**
 * setup-sidecar — CLI command implementation
 *
 * Installs the Python sidecar for AI-powered perceptual audio analysis:
 *   1. Detect Python ≥ 3.10 (or use PYTHON_BIN env var)
 *   2. Create an isolated venv at ~/.reaper-mcp/sidecar-venv/
 *   3. Install pinned deps from sidecar/requirements.txt
 *   4. Pre-download Audiobox Aesthetics model weights
 *   5. Copy server.py (+ its modules) to ~/.reaper-mcp/sidecar/
 *
 * The components (COMPONENTS) are picked interactively in a terminal, or by flags for agents
 * and CI (never a prompt without a TTY, with --yes, in CI, or with any component flag):
 *   core        venv + Python deps: offline analysis, loudness, transients, key/chords (templates), mix checks
 *   aesthetics  Audiobox Aesthetics weights (831 MB; downloaded on first use when skipped)
 *   separation  Demucs + htdemucs (--with-separation, ~80 MB model + package)
 *   chords      lv-chordia chord model (--with-chords, ~135 MB)
 * On an existing install only the missing picked components are added; the scripts are always refreshed.
 *
 * Usage: reaper-mcp setup-sidecar [--yes] [--all] [--with-separation] [--with-chords] [--without-aesthetics] [--list [--json]]
 */

import { exec as execImpl } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
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
/** Python modules server.py imports; installed next to it. */
export const SIDECAR_MODULES = ['analysis.py', 'mixcheck.py', 'separation.py', 'chords.py'];
/** The Demucs model separate_stems uses by default; pre-downloaded by --with-separation. */
export const SEPARATION_MODEL = 'htdemucs';
export const MODEL_ID = 'facebook/audiobox-aesthetics';
/** Where huggingface_hub caches the aesthetics weights */
export const AESTHETICS_WEIGHTS_PATH = join(process.env['HF_HOME'] ? join(process.env['HF_HOME'], 'hub') : join(homedir(), '.cache', 'huggingface', 'hub'), 'models--facebook--audiobox-aesthetics');
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

/** Install Demucs into the existing venv and pre-download its default model (~80 MB, torch hub cache). */
export async function installSeparation(baseDir: string): Promise<void> {
  const requirements = join(resolveAssetDir(baseDir, 'sidecar'), 'requirements-separation.txt');
  if (!existsSync(requirements)) {
    throw new Error(`requirements-separation.txt not found at: ${requirements}\nRun \`pnpm nx build reaper-mcp-server\` first.`);
  }
  const pip = join(SIDECAR_VENV_PATH, VENV_BIN, VENV_PIP_NAME);
  const python = join(SIDECAR_VENV_PATH, VENV_BIN, VENV_PYTHON_NAME);
  const install = await exec(`"${pip}" install -r "${requirements}"`);
  if (install.stdout) process.stdout.write(install.stdout);
  if (install.stderr) process.stderr.write(install.stderr);
  // Single quotes only: the script goes inside a double-quoted shell argument.
  const script = [
    'from demucs.pretrained import get_model',
    `get_model('${SEPARATION_MODEL}')`,
    `print('Model ${SEPARATION_MODEL} ready.')`,
  ].join('; ');
  const fetch = await exec(`"${python}" -c "${script}"`);
  if (fetch.stdout) process.stdout.write(fetch.stdout);
}

/** Install the lv-chordia chord model into the existing venv (its weights ship in the wheel). */
export async function installChords(baseDir: string): Promise<void> {
  const requirements = join(resolveAssetDir(baseDir, 'sidecar'), 'requirements-chords.txt');
  if (!existsSync(requirements)) {
    throw new Error(`requirements-chords.txt not found at: ${requirements}\nRun \`pnpm nx build reaper-mcp-server\` first.`);
  }
  const pip = join(SIDECAR_VENV_PATH, VENV_BIN, VENV_PIP_NAME);
  const python = join(SIDECAR_VENV_PATH, VENV_BIN, VENV_PYTHON_NAME);
  const install = await exec(`"${pip}" install -r "${requirements}"`);
  if (install.stdout) process.stdout.write(install.stdout);
  if (install.stderr) process.stderr.write(install.stderr);
  const check = await exec(`"${python}" -c "import lv_chordia.chord_recognition; print('Chord model ready.')"`);
  if (check.stdout) process.stdout.write(check.stdout);
}

/** Pre-download the Audiobox Aesthetics model weights. */
export async function downloadModelWeights(): Promise<void> {
  const python = join(SIDECAR_VENV_PATH, VENV_BIN, VENV_PYTHON_NAME);
  // Single quotes only: the script goes inside a double-quoted shell argument.
  const script = [
    'from huggingface_hub import snapshot_download',
    `print('Downloading ${MODEL_ID} weights to ~/.cache/huggingface/hub/ ...')`,
    `snapshot_download('${MODEL_ID}')`,
    `print('Download complete.')`,
  ].join('; ');

  const { stdout, stderr } = await exec(`"${python}" -c "${script}"`);
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
}

/** Copy server.py and its modules from dist/sidecar/ to ~/.reaper-mcp/sidecar/. */
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
  for (const module of SIDECAR_MODULES) {
    copyFileSync(join(sidecarDir, module), join(SIDECAR_DIR, module));
  }
}

// ---------------------------------------------------------------------------
// Components: what can be installed, what each one is for, and how big it is
// ---------------------------------------------------------------------------

export type ComponentId = 'core' | 'aesthetics' | 'separation' | 'chords';

export interface Component {
  id: ComponentId;
  title: string;
  /** What it lets Claude do (tools) */
  enables: string;
  /** Why someone would want it */
  why: string;
  /** Download / disk size */
  size: string;
  /** Flag that adds it without a prompt */
  flag: string;
  required?: boolean;
  /** Picked unless deselected */
  defaultOn: boolean;
}

export const COMPONENTS: Component[] = [
  {
    id: 'core',
    title: 'Audio analysis (required)',
    enables: 'analyze_track_offline, analyze_audio_file, measure_track_alignment, detect_transients, quantize_audio, ' +
      'detect_key / detect_chords on audio, analyze_loudness_curve, analyze_stereo_bands, measure_masking',
    why: 'Claude renders a track and reads it offline: loudness (LUFS, LRA, true peak), tonal balance against a reference, ' +
      'timing, phase, key and chords. Everything else builds on it.',
    size: 'Python venv with PyTorch (CPU) and audio libraries: ~0.5-1 GB on macOS/Windows, up to ~2.5 GB on Linux (CUDA wheels)',
    flag: '(always)',
    required: true,
    defaultOn: true,
  },
  {
    id: 'aesthetics',
    title: 'Audiobox Aesthetics model',
    enables: 'analyze_track_aesthetics',
    why: "Meta's model rates a track 0-10 for production quality, complexity and enjoyment: a perceptual second opinion " +
      'next to the meters. Skipped, it downloads the first time the tool runs.',
    size: '831 MB weights (Hugging Face cache)',
    flag: 'on by default; --without-aesthetics skips it',
    defaultOn: true,
  },
  {
    id: 'separation',
    title: 'Stem separation (Demucs)',
    enables: 'separate_stems',
    why: 'Splits a mix or a bounce into drums, bass, vocals and the rest (6 stems with guitar and piano), e.g. to check a ' +
      'reference song part by part or to analyze one instrument of a stereo recording.',
    size: '~80 MB htdemucs model + ~30 MB packages (htdemucs_6s fetches another ~80 MB on first use)',
    flag: '--with-separation',
    defaultOn: false,
  },
  {
    id: 'chords',
    title: 'Chord recognition model (lv-chordia)',
    enables: 'detect_chords engine "model" (the default for audio once installed)',
    why: 'A trained chord recognizer: reads chords from a full mix or a recording with sevenths, inversions (slash chords) ' +
      'and fewer mistakes than the built-in templates. Worth it when you write bass lines or parts to recorded audio.',
    size: '~135 MB download (lv-chordia + librosa), ~400 MB installed',
    flag: '--with-chords',
    defaultOn: false,
  },
];

export type Selection = Record<ComponentId, boolean>;

export interface SetupArgs {
  /** Ask in the terminal (false: flags and defaults only) */
  interactive: boolean;
  /** Print the components and what is installed, then exit */
  list: boolean;
  json: boolean;
  /** Explicit picks from flags (absent = default) */
  picks: Partial<Selection>;
  /** Unknown flags */
  unknown: string[];
}

const SETUP_FLAGS = new Set(['--yes', '-y', '--non-interactive', '--all', '--with-separation', '--with-chords',
  '--with-aesthetics', '--without-aesthetics', '--list', '--json']);

/**
 * setup-sidecar's flags. A prompt only appears with a terminal on stdin and stdout, outside CI,
 * without --yes and without any component flag: an agent never blocks on one.
 */
export function parseSetupArgs(argv: string[], env: NodeJS.ProcessEnv = process.env, tty = Boolean(process.stdin.isTTY && process.stdout.isTTY)): SetupArgs {
  const has = (f: string) => argv.includes(f);
  const picks: Partial<Selection> = {};
  if (has('--all')) Object.assign(picks, { aesthetics: true, separation: true, chords: true });
  if (has('--with-separation')) picks.separation = true;
  if (has('--with-chords')) picks.chords = true;
  if (has('--with-aesthetics')) picks.aesthetics = true;
  if (has('--without-aesthetics')) picks.aesthetics = false;
  const ci = Boolean(env['CI']) && env['CI'] !== 'false' && env['CI'] !== '0';
  const yes = has('--yes') || has('-y') || has('--non-interactive');
  const list = has('--list');
  return {
    interactive: tty && !ci && !yes && !list && Object.keys(picks).length === 0,
    list,
    json: has('--json'),
    picks,
    unknown: argv.filter((a) => a.startsWith('-') && !SETUP_FLAGS.has(a)),
  };
}

/** The picks applied to the defaults (core is always on). */
export function resolveSelection(picks: Partial<Selection>): Selection {
  const out = Object.fromEntries(COMPONENTS.map((c) => [c.id, picks[c.id] ?? c.defaultOn])) as Selection;
  out.core = true;
  return out;
}

/** What is installed now: the venv, the weights in the HF cache, and the optional packages in the venv. */
export async function detectInstalled(): Promise<Selection> {
  const python = join(SIDECAR_VENV_PATH, VENV_BIN, VENV_PYTHON_NAME);
  const out: Selection = { core: false, aesthetics: existsSync(AESTHETICS_WEIGHTS_PATH), separation: false, chords: false };
  if (!existsSync(python)) return out;
  const script = "import importlib.util as u, json; print(json.dumps({k: u.find_spec(m) is not None for k, m in [('core', 'audiobox_aesthetics'), ('separation', 'demucs'), ('chords', 'lv_chordia')]}))";
  try {
    const { stdout } = await exec(`"${python}" -c "${script}"`);
    const found = JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as Partial<Selection>;
    out.core = Boolean(found.core);
    out.separation = Boolean(found.separation);
    out.chords = Boolean(found.chords);
  } catch {
    // A venv whose Python fails counts as not installed: setup rebuilds it
  }
  return out;
}

/**
 * The install steps for a selection on top of what is there (the scripts are always refreshed).
 * Rebuilding the venv drops the packages in it, so without a working core the venv add-ons
 * are installed again; the aesthetics weights live in the shared Hugging Face cache and stay.
 */
export function planSetup(selection: Selection, installed: Selection): ComponentId[] {
  const present = (id: ComponentId) => installed[id] && (id === 'core' || id === 'aesthetics' || installed.core);
  return COMPONENTS.map((c) => c.id).filter((id) => selection[id] && !present(id));
}

/** The picker's list, with the current picks and what is installed */
export function renderComponents(selection: Selection, installed: Selection): string {
  return COMPONENTS.map((c, i) => {
    const box = installed[c.id] ? '[installed]' : selection[c.id] ? '[x]' : '[ ]';
    return [
      `  ${i + 1}. ${box} ${c.title}`,
      `       What: ${c.enables}`,
      `       Why:  ${c.why}`,
      `       Size: ${c.size}`,
    ].join('\n');
  }).join('\n\n');
}

/** Toggle components by number ("3 4"); "a" picks all. Core and installed ones stay as they are. */
export function applyToggles(input: string, selection: Selection, installed: Selection): Selection {
  const next = { ...selection };
  const words = input.trim().toLowerCase().split(/[\s,]+/).filter(Boolean);
  for (const w of words) {
    if (w === 'a' || w === 'all') {
      for (const c of COMPONENTS) next[c.id] = true;
      continue;
    }
    const c = COMPONENTS[Number(w) - 1];
    if (!c || c.required || installed[c.id]) continue;
    next[c.id] = !next[c.id];
  }
  return next;
}

async function pickInteractively(selection: Selection, installed: Selection): Promise<Selection | null> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    let current = selection;
    for (;;) {
      console.log(`\n${renderComponents(current, installed)}\n`);
      let answer: string;
      try {
        answer = (await rl.question('Toggle by number (e.g. "3 4"), "a" for all, Enter to install, "q" to quit: ')).trim();
      } catch {
        // Ctrl+C / Ctrl+D: quit without installing
        return null;
      }
      if (answer === '') return current;
      if (/^q(uit)?$/i.test(answer)) return null;
      current = applyToggles(answer, current, installed);
    }
  } finally {
    rl.close();
  }
}

function printList(installed: Selection, json: boolean): void {
  const rows = COMPONENTS.map((c) => ({ id: c.id, title: c.title, installed: installed[c.id], default: c.defaultOn, flag: c.flag, size: c.size, enables: c.enables, why: c.why }));
  if (json) {
    console.log(JSON.stringify({ components: rows }, null, 2));
    return;
  }
  for (const r of rows) console.log(`${r.installed ? '✓' : '·'} ${r.id.padEnd(11)} ${r.title} — ${r.size}${r.installed || r.flag === '(always)' ? '' : ` (${r.flag})`}`);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

const fatal = (message: string): never => {
  console.error(`\n${message}`);
  process.exit(1);
};
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function setupSidecar(argv: string[] = []): Promise<void> {
  const args = parseSetupArgs(argv);
  if (args.unknown.length) fatal(`Unknown option ${args.unknown.join(', ')}. Options: ${[...SETUP_FLAGS].join(' ')}`);
  const installed = await detectInstalled();
  if (args.list) {
    printList(installed, args.json);
    return;
  }

  console.log('REAPER MCP — Python sidecar setup\n');
  console.log('The sidecar lets Claude listen to audio: it renders tracks and analyzes them in Python.');
  console.log('Requires Python 3.10+ and an internet connection.');
  let selection = resolveSelection(args.picks);
  if (args.interactive) {
    console.log('Pick what to install (each can be added later by running this again):');
    const picked = await pickInteractively(selection, installed);
    if (!picked) {
      console.log('Nothing installed.');
      return;
    }
    selection = picked;
  } else {
    console.log('Non-interactive: ' + COMPONENTS.map((c) => `${c.id} ${installed[c.id] ? 'installed' : selection[c.id] ? 'yes' : 'no'}`).join(', '));
    console.log('(run `reaper-mcp setup-sidecar --list` for what each one does; in a terminal without flags you get a picker)');
  }

  const steps = planSetup(selection, installed);
  if (steps.includes('core')) await installCore();
  if (steps.includes('aesthetics')) {
    console.log('\nPre-downloading Audiobox Aesthetics model weights (831 MB)...');
    console.log('This may take several minutes depending on your internet connection.');
    try {
      await downloadModelWeights();
    } catch (err) {
      fatal(`Model download failed: ${errText(err)}\nCheck your internet connection and run setup-sidecar again (or skip it: --without-aesthetics; it then downloads on first use).`);
    }
  }

  console.log(`\nInstalling sidecar scripts to: ${SIDECAR_DIR}`);
  try {
    copySidecarScript(__dirname);
  } catch (err) {
    fatal(`Failed to install sidecar script: ${errText(err)}`);
  }

  if (steps.includes('separation')) {
    console.log('\nInstalling stem separation (Demucs) and its htdemucs model (~80 MB)...');
    try {
      await installSeparation(__dirname);
      console.log('  Stem separation installed: separate_stems is ready.');
    } catch (err) {
      fatal(`Failed to install stem separation: ${errText(err)}`);
    }
  }
  if (steps.includes('chords')) {
    console.log('\nInstalling the chord model (lv-chordia, ~135 MB)...');
    try {
      await installChords(__dirname);
      console.log('  Chord model installed: detect_chords reads audio with it.');
    } catch (err) {
      fatal(`Failed to install the chord model: ${errText(err)}`);
    }
  }

  const now = { ...installed };
  for (const id of steps) now[id] = true;
  console.log(steps.length ? '\nSidecar setup complete!\n' : '\nEverything picked was already installed; scripts refreshed.\n');
  printList(now, false);
  console.log('\nRun `reaper-mcp doctor` to verify.\n');
}

/** Python check, venv and the base dependencies. */
async function installCore(): Promise<void> {
  const pythonBin = getPythonBin();
  console.log(`\nChecking Python interpreter: ${pythonBin}`);
  let version = '';
  try {
    version = await checkPython(pythonBin);
  } catch (err) {
    fatal(`Error: ${errText(err)}`);
  }
  console.log(`  Using Python interpreter: ${pythonBin} (${version})`);

  console.log(`\nCreating virtual environment at: ${SIDECAR_VENV_PATH}`);
  try {
    await createVenv(pythonBin);
    console.log('  Virtual environment created.');
  } catch (err) {
    fatal(`Failed to create venv: ${errText(err)}`);
  }

  const requirementsPath = resolveRequirementsTxt(__dirname);
  console.log(`\nInstalling Python dependencies from: ${requirementsPath}`);
  if (!existsSync(requirementsPath)) {
    fatal(`Error: requirements.txt not found at: ${requirementsPath}\nRun \`pnpm nx build reaper-mcp-server\` first.`);
  }
  try {
    await installDeps(requirementsPath);
    console.log('  Dependencies installed.');
  } catch (err) {
    cleanupBrokenVenv();
    fatal(`Failed to install dependencies: ${errText(err)}\nRemoved partial venv so the next setup-sidecar run starts clean.`);
  }
}
