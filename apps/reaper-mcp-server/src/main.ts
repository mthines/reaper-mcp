#!/usr/bin/env node

import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { resolveProfile } from './profile.js';
import { checkExtensions, loadExtensions } from './extensions.js';
import { extensionCommand } from './extension-cli.js';
import { ensureBridgeDir, isBridgeRunning, getBridgeState, bridgeDownMessage, cleanupStaleFiles, readBridgeEvents, getReaperScriptsPath, getReaperEffectsPath, getReaperWwwPath, getReaperResourcePath, startDiagnosticsPoller, startEventsPoller, stopPollers } from './bridge.js';
import { initTelemetry, shutdownTelemetry, getTracer, recordClientConnected, registerBridgeGauges, emitLog, exceptionAttributes, readServiceVersion, reportConsentChange } from './telemetry.js';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, platform } from 'node:os';
import { exec as execCb, execFileSync } from 'node:child_process';
import { promisify as promisifyUtil } from 'node:util';
import { installClaudeAssets } from './claude-assets.js';
import { installExamplePlugins } from './jsfx/examples.js';
import { loadToolkit, generatedDir, presetsDir } from './tools/jsfx.js';
import { resolveAssetDir, copyDirSync, installFile, createMcpJson, hasUserMcpServer, userMcpServerIsStale, ensureClaudeSettings, REAPER_ASSETS, RETIRED_ASSETS, MCP_TOOL_NAMES, BRIDGE_UI_FILE, DEFAULT_WEB_PORT, ensureWebInterface, ensureSnapshotActions, ensureBridgeAutostart, autostartCheck, setupFilesPlan, findCloneRoot, isDevClone, updateConfigText, type CloneState } from './cli.js';
import { detectInstalled, setupSidecar } from './setup-sidecar.js';
import { firstRunTelemetryNotice, resolveTelemetry, saveTelemetryChoice, TELEMETRY_DOC_URL } from './telemetry-consent.js';
import { endSession, setSessionClient, startSessionPing } from './session.js';
import { getSidecarClient } from './sidecar.js';
import { renderDoctor, useColor, type Check, type CheckStatus, type Section } from './doctor-report.js';
import { repairBridgeInstall, repairNotices, writeBridgeVersion, type BridgeRepair } from './bridge-repair.js';
import { addNotice } from './notices.js';
import { checkForUpdate, updateCheckDisabled } from './update-check.js';

const execAsync = promisifyUtil(execCb);

const __dirname = dirname(fileURLToPath(import.meta.url));

async function setup(): Promise<void> {
  console.log('REAPER MCP Server — Setup\n');

  const bridgeDir = await ensureBridgeDir();
  console.log(`Bridge directory: ${bridgeDir}\n`);

  const scriptsDir = getReaperScriptsPath();
  mkdirSync(scriptsDir, { recursive: true });

  const reaperDir = resolveAssetDir(__dirname, 'reaper');

  // ReaPack owns the files once it has installed the bridge: copying them to Scripts/ and Effects/ as
  // well would give an Action List with every script twice and a bridge ReaPack updates never touch.
  const filesPlan = setupFilesPlan(existsSync(join(scriptsDir, 'reaper-mcp', 'MCP Bridge', 'mcp_bridge.lua')), findCloneRoot(__dirname) !== null);
  if (filesPlan === 'leave') {
    console.log('The bridge is installed by ReaPack: leaving its scripts, JSFX and status page to ReaPack.');
    console.log('Setup only turns on starting with REAPER and the web interface.\n');
    installBridgeAutostart(scriptsDir);
    writeBridgeVersion(scriptsDir, readServiceVersion());
    const port = await enableWebInterface();
    console.log('\nSetup complete!\n');
    console.log('Restart REAPER (or run the bridge once from the Action List) and add reaper-mcp to Claude Code: reaper-mcp doctor');
    if (port) console.log(`The bridge opens its status window on start: http://localhost:${port}/${BRIDGE_UI_FILE}`);
    return;
  }
  if (filesPlan === 'install-with-warning') {
    console.log('WARNING: ReaPack has installed the bridge too, and REAPER prefers its copy (Scripts/reaper-mcp/MCP Bridge/ and');
    console.log('Effects/reaper-mcp/Meters/) over the files this checkout installs. Your local changes will not run until you');
    console.log('uninstall the reaper-mcp packages in ReaPack (Manage repositories > reaper-mcp > Uninstall packages),');
    console.log('then run setup again: this run also overwrote the status page ReaPack installed, which uninstalling removes.\n');
  }

  console.log('Installing Lua scripts...');
  // Install every Lua asset (bridge, its libraries, the shared snapshot library
  // and the A/B action scripts). REAPER_ASSETS
  // is the single source of truth — a hardcoded subset previously omitted the
  // snapshot library and action scripts, leaving stale copies in REAPER.
  for (const asset of REAPER_ASSETS) {
    if (!asset.endsWith('.lua')) continue;
    const src = join(reaperDir, asset);
    const dest = join(scriptsDir, asset);
    if (installFile(src, dest)) {
      console.log(`  Installed: ${asset}`);
    } else {
      console.log(`  Not found: ${src}`);
    }
  }

  for (const asset of RETIRED_ASSETS) {
    const dest = join(scriptsDir, asset);
    if (existsSync(dest)) {
      rmSync(dest);
      console.log(`  Removed: ${asset} (retired)`);
    }
  }

  // Lets the status page's Update button pull and reinstall this clone (it runs scripts/update.sh)
  const cloneRoot = findCloneRoot(__dirname);
  if (cloneRoot) {
    const dev = isDevClone(await cloneState(cloneRoot));
    writeFileSync(join(scriptsDir, 'mcp_update.conf'), updateConfigText(cloneRoot, process.execPath, dev));
    console.log(`  Installed: mcp_update.conf (${dev ? 'developer clone: Rebuild & reload' : 'one-click updates'} from the status page)`);
  }

  const effectsDir = join(getReaperEffectsPath(), 'reaper-mcp');
  mkdirSync(effectsDir, { recursive: true });

  console.log('\nInstalling JSFX analyzers...');
  for (const asset of REAPER_ASSETS) {
    if (asset.endsWith('.lua')) continue;
    const src = join(reaperDir, asset);
    const dest = join(effectsDir, asset);
    if (installFile(src, dest)) {
      console.log(`  Installed: reaper-mcp/${asset}`);
    } else {
      console.log(`  Not found: ${src}`);
    }
  }

  // The /make-plugin examples as ready-to-use plugins (an example you edited is left alone)
  console.log('\nInstalling example plugins...');
  const examplesDir = join(resolveAssetDir(__dirname, 'claude'), 'skills', 'make-plugin', 'examples');
  const examples = installExamplePlugins(examplesDir, join(generatedDir(), 'examples'), loadToolkit(), presetsDir());
  for (const f of examples.installed) console.log(`  Installed: reaper-mcp-generated/examples/${f}`);
  for (const f of examples.kept) console.log(`  Kept your edited copy: reaper-mcp-generated/examples/${f}`);
  for (const [f, names] of Object.entries(examples.presets)) if (names.length) console.log(`  Presets for ${f}: ${names.join(', ')}`);
  for (const e of examples.presetErrors) console.log(`  Skipped presets (invalid): ${e}`);
  if (!examples.installed.length && !examples.kept.length) console.log(`  Not found: ${examplesDir}`);

  // Bridge status UI (page + PWA manifest, service worker, icons), served by REAPER's web
  // interface from reaper_www_root/. Built by the bridge-ui project into dist/apps/bridge-ui
  // (a sibling of this bundle). Files are all mcp_bridge* so other web remotes are untouched.
  const wwwSrc = resolveAssetDir(__dirname, 'bridge-ui');
  console.log('\nInstalling bridge status UI...');
  if (existsSync(join(wwwSrc, BRIDGE_UI_FILE))) {
    const count = copyDirSync(wwwSrc, getReaperWwwPath());
    console.log(`  Installed: reaper_www_root/${BRIDGE_UI_FILE} (+${count - 1} PWA files)`);
  } else {
    console.log(`  Not found: ${join(wwwSrc, BRIDGE_UI_FILE)} (build bridge-ui first)`);
  }

  // Before the web-interface step: Ctrl+C at its "Quit REAPER to finish" prompt ends setup there
  installBridgeAutostart(scriptsDir);
  // `serve` brings REAPER's files up to its own release once per release (bridge-repair.ts) from this record
  writeBridgeVersion(scriptsDir, readServiceVersion());
  const webPort = await enableWebInterface();
  await registerSnapshotActions();

  console.log('\nSetup complete!\n');
  console.log('Next steps:');
  console.log('  1. Start REAPER: the bridge starts with it. If REAPER is already open, restart it,');
  console.log('     or run the bridge once by hand: Actions > Show action list > Load ReaScript,');
  console.log(`     select ${join(scriptsDir, 'mcp_bridge.lua')} and click Run.`);
  console.log('  2. Add reaper-mcp to your Claude Code config (see: reaper-mcp doctor)');
  if (webPort) {
    console.log(`\nThe bridge opens its status window on start: http://localhost:${webPort}/${BRIDGE_UI_FILE}`);
  }
}

/** Git state of the clone for isDevClone; a git failure reads as a dev clone (never offer a pull that can't work). */
async function cloneState(repo: string): Promise<CloneState> {
  const git = async (args: string) => (await execAsync(`git -C "${repo}" ${args}`)).stdout.trim();
  try {
    const [status, branch] = await Promise.all([git('status --porcelain --untracked-files=no'), git('rev-parse --abbrev-ref HEAD')]);
    const ahead = await git('rev-list --count @{u}..HEAD').then(Number, () => null);
    return { dirty: status !== '', branch, ahead };
  } catch {
    return { dirty: true, branch: '', ahead: null };
  }
}

/** REAPER rewrites reaper.ini from memory on exit, so only edit it while REAPER is closed. */
async function isReaperRunning(): Promise<boolean> {
  const cmd = platform() === 'win32' ? 'tasklist /FI "IMAGENAME eq reaper.exe" /NH' : 'pgrep -xi reaper';
  try {
    const { stdout } = await execAsync(cmd);
    return platform() === 'win32' ? /reaper\.exe/i.test(stdout) : true;
  } catch {
    return false; // pgrep exits 1 when nothing matches
  }
}

/** Turn on REAPER's web browser interface so the bridge can open its status window. Returns the port, or null. */
async function enableWebInterface(): Promise<number | null> {
  console.log('\nEnabling REAPER web interface...');
  const iniPath = join(getReaperResourcePath(), 'reaper.ini');
  if (!existsSync(iniPath)) {
    console.log(`  Skipped: ${iniPath} not found (start REAPER once, quit it, then re-run setup)`);
    return null;
  }
  const requested = Number(process.env['REAPER_WEB_PORT']) || DEFAULT_WEB_PORT;
  const result = ensureWebInterface(readFileSync(iniPath, 'utf-8'), requested);
  if (!result.changed) {
    console.log(`  Already enabled on port ${result.port}`);
    return result.port;
  }
  if (await isReaperRunning()) {
    if (!process.stdout.isTTY) {
      console.log('  Skipped: REAPER is running and would overwrite reaper.ini on exit.');
      console.log('  Quit REAPER and run "reaper-mcp setup" again.');
      return null;
    }
    console.log('  REAPER is running and would overwrite reaper.ini on exit.');
    console.log('  Quit REAPER to finish (Ctrl+C to skip)...');
    while (await isReaperRunning()) await new Promise((r) => setTimeout(r, 1000));
  }
  // Re-read: REAPER may have rewritten reaper.ini while quitting
  writeFileSync(iniPath, ensureWebInterface(readFileSync(iniPath, 'utf-8'), requested).ini, 'utf-8');
  console.log(`  Enabled on port ${result.port} (override with REAPER_WEB_PORT)`);
  return result.port;
}

/**
 * Start the bridge with REAPER: a block in Scripts/__startup.lua, which REAPER runs at launch. Written
 * every time (it honours the page's "Start with REAPER" setting, so it never overrides a user's choice).
 * REAPER never writes that file, so this is safe while REAPER is open.
 */
function installBridgeAutostart(scriptsDir: string): void {
  console.log('\nStarting the bridge with REAPER...');
  const path = join(scriptsDir, '__startup.lua');
  const { text, changed } = ensureBridgeAutostart(existsSync(path) ? readFileSync(path, 'utf-8') : '');
  if (changed) writeFileSync(path, text, 'utf-8');
  console.log(changed ? '  Added to Scripts/__startup.lua (REAPER runs it at launch)' : '  Already in Scripts/__startup.lua');
  console.log('  Turn it off in the bridge window: Settings > Start with REAPER.');
}

/** List the snapshot scripts in REAPER's Action List (reaper-kb.ini), ready for a shortcut. */
async function registerSnapshotActions(): Promise<void> {
  console.log('\nRegistering snapshot actions (quick save, next, previous)...');
  const kbPath = join(getReaperResourcePath(), 'reaper-kb.ini');
  const kb = existsSync(kbPath) ? readFileSync(kbPath, 'utf-8') : '';
  const { added } = ensureSnapshotActions(kb);
  if (!added.length) {
    console.log('  Already in the Action List');
  } else if (await isReaperRunning()) {
    // REAPER rewrites reaper-kb.ini from memory; the bridge adds them through the API when it starts
    console.log('  REAPER is running: the bridge adds them when it next starts (re-run mcp_bridge.lua).');
  } else {
    writeFileSync(kbPath, ensureSnapshotActions(kb).kb, 'utf-8');
    console.log(`  Added: ${added.join(', ')}`);
  }
  console.log('  Bind keys in Actions > Show action list: search "mcp_snapshot".');
}

// Configure Claude Code for this clone: pre-approve the REAPER tools globally and
// drop a .mcp.json that runs this clone's built main.js. Copy-free — the skills
// and knowledge come from the symlinks created by scripts/sync-symlinks.sh.
async function init(): Promise<void> {
  console.log('REAPER MCP — Configure Claude Code\n');

  // Tool allow-list, written globally so the REAPER tools are pre-approved everywhere.
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  mkdirSync(dirname(settingsPath), { recursive: true });
  const result = ensureClaudeSettings(settingsPath);
  console.log(`Claude settings (${MCP_TOOL_NAMES.length} REAPER tools allow-listed): ${result} → ${settingsPath}`);

  if (findCloneRoot(__dirname)) {
    // .mcp.json in the current directory: `node <this script> serve`, so it needs no PATH link.
    const mcpJsonPath = join(process.cwd(), '.mcp.json');
    if (createMcpJson(mcpJsonPath, resolve(process.argv[1]))) {
      console.log(`Created: ${mcpJsonPath}`);
    } else {
      console.log(`.mcp.json already exists — leaving it untouched.`);
    }
  } else {
    registerUserMcpServer();
  }

  await askTelemetryOnce();

  if (findCloneRoot(__dirname)) {
    console.log('\nIf you haven\'t yet, symlink the skills + knowledge and install the bridge:');
    console.log('  scripts/sync-symlinks.sh   # mix skills + knowledge → ~/.claude');
  } else {
    console.log('');
    installSkills();
    console.log('\nIf you haven\'t yet, install the bridge:');
  }
  console.log('  reaper-mcp setup           # Lua bridge + JSFX → REAPER');
  console.log('then start (or restart) REAPER: the bridge starts with it.');
  if (!findCloneRoot(__dirname)) console.log('\nWant it to remember plugins and your corrections? Connect LoreKit (free): https://lorekit.io. /learn-plugin will walk you through it.');
  console.log('\nTry: /mixer "Please gain stage my tracks"  ·  /critique "Roast my mix"');
}

/** npm install: tell Claude Code about the server once, for every folder (a clone writes .mcp.json instead). */
function registerUserMcpServer(): void {
  const claudeJson = join(homedir(), '.claude.json');
  const registered = hasUserMcpServer(claudeJson);
  if (registered && !userMcpServerIsStale(claudeJson)) {
    console.log('Claude Code already knows REAPER (user-scope server "reaper" is registered).');
    return;
  }
  const mainJs = realpathSync(process.argv[1]);
  try {
    if (registered) {
      // Its node or main.js is gone (Node switched, package moved): replace it instead of keeping a dead entry
      execFileSync('claude', ['mcp', 'remove', '--scope', 'user', 'reaper'], { stdio: 'pipe' });
      console.log('The registered REAPER server pointed at files that no longer exist; replacing it.');
    }
    execFileSync('claude', ['mcp', 'add', '--scope', 'user', 'reaper', '--', process.execPath, mainJs, 'serve'], { stdio: 'pipe' });
    console.log('Connected Claude Code to REAPER (works from any folder).');
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === 'ENOENT';
    console.log(missing ? 'Claude Code is not installed yet. Get it from https://claude.com/claude-code, then run: reaper-mcp init' : `Could not connect Claude Code to REAPER: ${String((err as Error).message).split('\n')[0]}`);
    console.log(`To connect it yourself: claude mcp add --scope user reaper -- ${process.execPath} ${mainJs} serve`);
  }
}

/** Copy the mix skills, agents and knowledge shipped in the npm package into ~/.claude (a clone symlinks them instead). */
function installSkills(dryRun = false): void {
  if (findCloneRoot(__dirname)) {
    console.log('Running from a clone: scripts/sync-symlinks.sh links the skills and knowledge into ~/.claude.');
    return;
  }
  const src = join(resolveAssetDir(__dirname, 'claude'));
  if (!existsSync(src)) {
    console.log(`Skills not found: ${src} (this build has no claude/ folder)`);
    process.exitCode = 1;
    return;
  }
  const r = installClaudeAssets(src, join(homedir(), '.claude'), { dryRun });
  const verb = dryRun ? 'Would install' : 'Installed';
  console.log(`${verb} the mix skills, agents and knowledge in ~/.claude: ${r.installed.length} new, ${r.updated.length} updated, ${r.unchanged} already current.`);
  for (const s of r.skipped) {
    const why = { edited: 'you changed it, left as is', 'not-ours': 'already exists and is yours, left as is', symlink: 'linked elsewhere, left as is', 'broken-symlink': 'a link to a folder that no longer exists (a deleted clone?); remove it and run this again' }[s.reason];
    console.log(`  Skipped ${s.path}: ${why}`);
  }
  if (!dryRun) console.log('Try /mixer, /critique or /learn-plugin in Claude Code. (/learn-plugin saves what it learns to LoreKit, see the README.)');
}

function consoleConsentIO() {
  return { input: process.stdin, output: process.stdout, interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY) };
}

const OPT_OUT_COUNTED = 'One anonymous "opted out" count was sent (no install id). Nothing is sent after this.';

/** The first-run notice, then its answer reported as one anonymous count. False when the notice was not shown. */
async function askTelemetryOnce(): Promise<boolean> {
  const choice = await firstRunTelemetryNotice(consoleConsentIO());
  if (!choice) return false;
  if ((await reportConsentChange(choice)) && choice.state === 'off') console.log(OPT_OUT_COUNTED);
  return true;
}

function describeTelemetry(): string {
  const { mode, reason } = resolveTelemetry();
  const label = { default: 'On — pseudonymous usage data to the developer', custom: 'Custom — your own OTEL_* destination', off: 'Off' }[mode];
  return `${label} (${reason})`;
}

// reaper-mcp telemetry [status|on|off|setup]
async function telemetryCommand(sub = 'status'): Promise<void> {
  if (sub === 'on' || sub === 'off') {
    const change = saveTelemetryChoice(sub === 'on');
    const counted = change ? await reportConsentChange(change) : false;
    if (sub === 'on') console.log('Pseudonymous usage telemetry turned on — thank you!');
    else console.log(counted ? `Telemetry turned off. ${OPT_OUT_COUNTED}` : 'Telemetry turned off. Nothing will be sent.');
    console.log('Restart Claude Code (or run /mcp) for the running server to pick it up.');
  } else if (sub === 'setup') {
    if (!(await askTelemetryOnce())) console.log(`Telemetry: ${describeTelemetry()}`);
    return;
  } else if (sub !== 'status') {
    console.log('Usage: reaper-mcp telemetry [status|on|off]');
    process.exitCode = 1;
    return;
  }
  console.log(`Telemetry: ${describeTelemetry()}`);
  console.log(`What is and isn't collected: ${TELEMETRY_DOC_URL}`);
}

async function doctor(): Promise<void> {
  const core: Check[] = [];

  const bridgeRunning = await isBridgeRunning();
  core.push(
    bridgeRunning
      ? { label: 'Lua bridge', status: 'ok', detail: 'Connected' }
      : { label: 'Lua bridge', status: 'fail', detail: 'Not detected', fix: 'reaper-mcp setup, then run mcp_bridge.lua in REAPER' },
  );

  // Whether the bridge starts with REAPER: the block setup writes into Scripts/__startup.lua, and the
  // bridge window's Start with REAPER setting (persistent ExtState, saved in reaper-extstate.ini)
  const readIfExists = (path: string) => (existsSync(path) ? readFileSync(path, 'utf-8') : null);
  core.push(autostartCheck(
    readIfExists(join(getReaperScriptsPath(), '__startup.lua')),
    readIfExists(join(getReaperResourcePath(), 'reaper-extstate.ini')),
    await isReaperRunning(),
  ));

  const globalClaudeDir = join(homedir(), '.claude');
  const localSkills = existsSync(join(process.cwd(), '.claude', 'skills', 'mixer', 'SKILL.md'));
  const globalSkills = existsSync(join(globalClaudeDir, 'skills', 'mixer', 'SKILL.md'));
  core.push(
    localSkills || globalSkills
      ? { label: 'Mix skills', status: 'ok', detail: localSkills ? '.claude/skills' : '~/.claude/skills' }
      : { label: 'Mix skills', status: 'fail', detail: 'Not linked', fix: findCloneRoot(__dirname) ? 'scripts/sync-symlinks.sh (from your clone)' : 'reaper-mcp install-skills' },
  );

  // The skills read ~/.claude/knowledge (the symlink sync-symlinks.sh creates), or
  // a project-scoped .claude/knowledge — NOT a bare repo-root knowledge/ dir.
  const localKnowledge = existsSync(join(process.cwd(), '.claude', 'knowledge'));
  const knowledgeLinked = localKnowledge || existsSync(join(globalClaudeDir, 'knowledge'));
  core.push(
    knowledgeLinked
      ? { label: 'Knowledge base', status: 'ok', detail: localKnowledge ? '.claude/knowledge' : '~/.claude/knowledge' }
      : { label: 'Knowledge base', status: 'fail', detail: 'Not linked', fix: findCloneRoot(__dirname) ? 'scripts/sync-symlinks.sh (from your clone)' : 'reaper-mcp install-skills' },
  );

  const userServer = hasUserMcpServer(join(homedir(), '.claude.json'));
  const mcpJsonExists = existsSync(join(process.cwd(), '.mcp.json'));
  const mcpRegistered = userServer || mcpJsonExists;
  core.push(
    mcpRegistered
      ? { label: 'MCP config', status: 'ok', detail: userServer ? 'Registered for your user (any folder)' : '.mcp.json in this folder' }
      : { label: 'MCP config', status: 'fail', detail: 'Not registered', fix: findCloneRoot(__dirname) ? 'scripts/install.sh (from your clone)' : 'reaper-mcp init' },
  );

  core.push({ label: 'SWS', status: 'info', detail: 'Checked live: the bridge page shows it, or ask Claude to run list_available_fx' });
  const telemetry = resolveTelemetry().mode;
  core.push({
    label: 'Telemetry',
    status: 'info',
    detail: { default: 'On, pseudonymous · turn off: reaper-mcp telemetry off', custom: 'Your own OTEL_* destination', off: 'Off' }[telemetry],
  });

  // --- Sidecar checks (opt-in; all run independently to show partial state) ---
  const sidecarVenvPath = join(homedir(), '.reaper-mcp', 'sidecar-venv');
  // Venv binary layout differs by OS: POSIX uses bin/, Windows uses Scripts\
  const venvBin = platform() === 'win32' ? 'Scripts' : 'bin';
  const venvPythonName = platform() === 'win32' ? 'python.exe' : 'python';
  const venvPython = join(sidecarVenvPath, venvBin, venvPythonName);
  const hfCachePath = join(homedir(), '.cache', 'huggingface', 'hub');

  // Check (a): Python ≥ 3.10 available
  let pythonOk = false;
  let pythonDetail = 'Not found';
  try {
    const pythonBin = process.env['PYTHON_BIN'] ?? 'python3';
    const { stdout, stderr } = await execAsync(`"${pythonBin}" --version`);
    const versionStr = (stdout + stderr).trim();
    const match = versionStr.match(/Python\s+(\d+)\.(\d+)/i);
    if (match) {
      const major = parseInt(match[1], 10);
      const minor = parseInt(match[2], 10);
      pythonOk = major > 3 || (major === 3 && minor >= 10);
      pythonDetail = versionStr;
    }
  } catch {
    pythonDetail = 'Not found';
  }

  // Check (b): venv exists
  const venvExists = existsSync(sidecarVenvPath);

  // Check (c): the module server.py loads is importable in venv
  let depsOk = false;
  if (venvExists && existsSync(venvPython)) {
    try {
      await execAsync(`"${venvPython}" -c "import audiobox_aesthetics.infer"`);
      depsOk = true;
    } catch {
      depsOk = false;
    }
  }

  // Check (c2): the optional add-ons in the venv (setup-sidecar --with-separation / --with-chords)
  const addOns = { demucs: false, lv_chordia: false };
  if (depsOk) {
    // The same check setup-sidecar plans its installs from: a chord model counts only when it imports
    const found = await detectInstalled();
    addOns.demucs = found.separation;
    addOns.lv_chordia = found.chords;
  }

  // Check (d): model weights in HuggingFace cache
  const weightsPath = join(hfCachePath, 'models--facebook--audiobox-aesthetics');
  const weightsExist = existsSync(weightsPath);

  // Weights are optional: the sidecar downloads them on first use; setup-sidecar only pre-fetches them
  const sidecarReady = venvExists && depsOk;
  // The sidecar is opt-in. If the user has not started installing it (no venv),
  // don't penalize the exit code. Once they have opted in, fail loud on a broken install.
  // Weights alone don't count: they live in the shared HuggingFace cache and may come
  // from an unrelated project.
  const sidecarOptedIn = venvExists;
  const sidecarBroken = sidecarOptedIn && !sidecarReady;
  // Not opted in: missing pieces are information, not problems
  const missing: CheckStatus = sidecarOptedIn ? 'fail' : 'info';
  const repair = 'reaper-mcp setup-sidecar';
  const home = (p: string) => p.replace(homedir(), '~');
  const sidecar: Section = {
    title: 'Python sidecar',
    note: 'optional · lets Claude listen to the audio',
    state: sidecarReady
      ? { text: 'ready', status: 'ok' }
      : sidecarBroken
        ? { text: 'partly installed', status: 'fail' }
        : { text: `not installed · enable with ${repair}`, status: 'info' },
    checks: [
      pythonOk
        ? { label: 'Python ≥ 3.10', status: 'ok', detail: pythonDetail }
        : { label: 'Python ≥ 3.10', status: missing, detail: pythonDetail, fix: 'install Python 3.10+ (python.org) or set PYTHON_BIN' },
      venvExists
        ? { label: 'Venv', status: 'ok', detail: home(sidecarVenvPath) }
        : { label: 'Venv', status: missing, detail: 'Not installed', fix: repair },
      depsOk
        ? { label: 'Dependencies', status: 'ok', detail: 'audiobox-aesthetics importable' }
        : { label: 'Dependencies', status: missing, detail: 'Not installed', fix: repair },
      weightsExist
        ? { label: 'Model weights', status: 'ok', detail: `Audiobox Aesthetics · ${home(weightsPath)}` }
        : {
            label: 'Model weights',
            status: 'info',
            detail: "Meta's Audiobox Aesthetics: Claude listens to any track and rates it 0–10 for production quality, complexity and enjoyment",
            fix: `~831 MB, downloads on first use · or get it now: ${repair}`,
          },
      ...(depsOk ? [
      addOns.lv_chordia
        ? { label: 'Chord model', status: 'ok', detail: 'lv-chordia · detect_chords reads audio with it' }
        : {
            label: 'Chord model',
            status: 'info',
            detail: 'Optional: chords with sevenths and inversions from a full mix (detect_chords uses templates without it)',
            fix: `~135 MB · ${repair} --with-chords`,
          },
      addOns.demucs
        ? { label: 'Stem separation', status: 'ok', detail: 'Demucs · separate_stems' }
        : {
            label: 'Stem separation',
            status: 'info',
            detail: 'Optional: separate_stems splits a mix into drums, bass, vocals and the rest',
            fix: `~110 MB · ${repair} --with-separation`,
          },
      ] satisfies Section['checks'] : []),
    ],
  };

  const extensionChecks = await checkExtensions();
  const sections: Section[] = [{ title: 'Core', checks: core }, sidecar];
  if (extensionChecks.length > 0) sections.push({ title: 'Extensions', checks: extensionChecks });
  const extensionsBroken = extensionChecks.some((c) => c.status === 'fail');

  console.log(renderDoctor(sections, { version: readServiceVersion(), color: useColor() }));
  process.exit(bridgeRunning && knowledgeLinked && mcpRegistered && !sidecarBroken && !extensionsBroken ? 0 : 1);
}

/**
 * Ask npm (at most once a day, update-check.ts) whether a newer release is out and queue the notice for the
 * first tool result. In the background: it never delays the MCP connection. A clone updates through its
 * status page or `git pull`, so it is not asked.
 */
function notifyNewerRelease(log: (...args: unknown[]) => void): void {
  if (findCloneRoot(__dirname) || updateCheckDisabled()) return;
  checkForUpdate({ current: readServiceVersion() })
    .then((update) => {
      if (!update) return;
      log(`reaper-mcp ${update.latest} is available (this is ${readServiceVersion()})`);
      addNotice({ text: update.text, onDelivered: update.markNotified });
    })
    .catch(() => undefined);
}

/** repairBridgeInstall() for this build's files; never fails `serve` (an unwritable folder only skips it). */
function repairReaperSide(log: (...args: unknown[]) => void): BridgeRepair | undefined {
  try {
    return repairBridgeInstall({
      scriptsDir: getReaperScriptsPath(),
      effectsDir: getReaperEffectsPath(),
      wwwDir: getReaperWwwPath(),
      assetsDir: resolveAssetDir(__dirname, 'reaper'),
      wwwSrcDir: resolveAssetDir(__dirname, 'bridge-ui'),
    }, readServiceVersion(), { inClone: findCloneRoot(__dirname) !== null });
  } catch (err) {
    log(`Could not update REAPER's reaper-mcp files: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

async function serve(): Promise<void> {
  const log = (...args: unknown[]) => console.error('[reaper-mcp]', ...args);

  // Initialise OpenTelemetry before any instrumented code runs.
  // Configuration is driven by OTEL_* environment variables (pass via .mcp.json env block).
  await initTelemetry();
  registerBridgeGauges(isBridgeRunning);
  startDiagnosticsPoller();
  startEventsPoller();
  log('Starting REAPER MCP Server...');
  log(`Entry: ${fileURLToPath(import.meta.url)}`);

  const tracer = getTracer();

  // Root span wrapping the entire startup sequence — an early touchpoint for
  // validating the OTel pipeline.  This is a headless process (no inbound HTTP)
  // so we create the root span manually.
  await tracer.startActiveSpan('reaper-mcp startup', { kind: SpanKind.INTERNAL }, async (startupSpan) => {
    try {
      await ensureBridgeDir();

      const cleaned = await cleanupStaleFiles();
      if (cleaned > 0) {
        startupSpan.setAttribute('reaper.bridge.stale_files_cleaned', cleaned);
        log(`Cleaned up ${cleaned} stale bridge files`);
      }

      // An npm update replaces this server but never REAPER's files: bring them up to this release, once
      const repair = repairReaperSide(log);

      // Check bridge connectivity in a child span. `reaper.bridge.state` says which setup step
      // is missing when it is not connected (both attributes are in the usage telemetry).
      const bridge = await tracer.startActiveSpan('check bridge connection', { kind: SpanKind.INTERNAL }, async (bridgeSpan) => {
        const status = await getBridgeState();
        const running = status.state === 'connected';
        bridgeSpan.setAttribute('reaper.bridge.connected', running);
        bridgeSpan.setAttribute('reaper.bridge.state', status.state);
        if (!running) {
          emitLog('warn', 'Lua bridge not detected at startup — commands are refused until it is started', {
            'reaper.bridge.connected': false,
            'reaper.bridge.state': status.state,
          });
          log(`WARNING: Lua bridge does not appear to be running in REAPER (${status.state}).`);
          log(bridgeDownMessage(status));
        } else {
          bridgeSpan.setStatus({ code: SpanStatusCode.OK });
          log('Lua bridge detected — connected to REAPER');
        }
        bridgeSpan.end();
        return status;
      });

      startupSpan.setAttribute('reaper.bridge.connected', bridge.state === 'connected');
      startupSpan.setAttribute('reaper.bridge.state', bridge.state);
      if (repair && !repair.skipped) {
        const version = readServiceVersion();
        if (repair.bridgeChanged) startupSpan.setAttribute('reaper.bridge.files_updated', true);
        if (repair.autostartAdded) startupSpan.setAttribute('reaper.bridge.autostart_added', true);
        log(`Updated REAPER's reaper-mcp files from ${repair.from ?? 'an earlier release'} to ${version}`);
        // The user hears it through the agent, on the first tool result (notices.ts)
        for (const text of repairNotices(repair, version, bridge.state === 'connected')) addNotice({ text });
      }

      const profile = resolveProfile();
      const server = createServer(profile);
      const selected = profile.categories;
      const loadedExtensions = await loadExtensions(server, undefined, selected ? (name) => selected.has(name) : undefined);
      for (const ext of loadedExtensions) {
        if (ext.status === 'loaded') log(`Extension ${ext.name} ${ext.version ?? ''} loaded (${ext.tools.length} tools)`);
        else log(`Extension ${ext.name} skipped: ${ext.reason}`);
      }
      if (selected) {
        log(`Tool profile "${profile.name}": ${Object.keys((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools).length} tools`);
        for (const name of profile.extensions) {
          if (!loadedExtensions.some((e) => e.name === name && e.status === 'loaded')) log(`REAPER_MCP_PROFILE names "${name}", which is neither a profile, a tool category nor a loaded extension`);
        }
      }
      const transport = new StdioServerTransport();

      await server.connect(transport);
      server.server.oninitialized = () => {
        setSessionClient(server.server.getClientVersion()?.name);
        recordClientConnected();
      };
      startSessionPing();
      notifyNewerRelease(log);
      startupSpan.setStatus({ code: SpanStatusCode.OK });
      log('MCP server connected via stdio');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      startupSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: `${err.name}: ${err.message}`,
      });
      throw error;
    } finally {
      startupSpan.end();
    }
  });
}

// --- CLI entry point ---

const command = process.argv[2];

switch (command) {
  case 'init':
    init().catch((err: unknown) => {
      console.error('Init failed:', err);
      process.exit(1);
    });
    break;

  case 'install-skills':
    installSkills(process.argv.includes('--dry-run'));
    break;

  case 'setup':
    setup().catch((err) => {
      console.error('Setup failed:', err);
      process.exit(1);
    });
    break;

  case 'doctor':
    doctor().catch((err) => {
      console.error('Doctor failed:', err);
      process.exit(1);
    });
    break;

  case 'telemetry':
    telemetryCommand(process.argv[3]).catch((err: unknown) => {
      console.error('Telemetry command failed:', err);
      process.exit(1);
    });
    break;

  case 'extension':
  case 'extensions':
    extensionCommand(process.argv.slice(3)).then(
      (code) => process.exit(code),
      (err: unknown) => {
        console.error('Extension command failed:', err);
        process.exit(1);
      },
    );
    break;

  case 'setup-sidecar':
    setupSidecar(process.argv.slice(3)).catch((err) => {
      console.error('Sidecar setup failed:', err);
      process.exit(1);
    });
    break;

  case 'status': {
    (async () => {
      const status = await getBridgeState();
      const running = status.state === 'connected';
      console.log(`Bridge status: ${running ? 'CONNECTED' : `NOT DETECTED (${status.state})`}`);
      if (!running) console.log(bridgeDownMessage(status));
      process.exit(running ? 0 : 1);
    })();
    break;
  }

  case 'serve':
  case undefined:
    serve().catch((err) => {
      console.error('[reaper-mcp] Fatal error:', err);
      process.exit(1);
    });
    break;

  default:
    console.log(`reaper-mcp — AI-powered mixing for REAPER DAW

Install from npm (below), or clone the repo and run ./scripts/install.sh.

Usage:
  reaper-mcp                  Start MCP server (stdio mode)
  reaper-mcp serve            Start MCP server (stdio mode)
  reaper-mcp setup            Install Lua bridge + JSFX analyzers into REAPER
  reaper-mcp setup-sidecar    Install the Python sidecar (opt-in audio analysis); in a terminal it asks which parts.
                              Agents/CI: --yes (core + aesthetics weights), --all, --with-separation (Demucs),
                              --with-chords (chord model), --without-aesthetics, --list [--json] (what is installed)
  reaper-mcp extension        Manage opt-in extensions: list | add <name|folder|git-url> | link <folder> | remove <name> | new <name>
  reaper-mcp init             Configure Claude Code: tool allow-list + .mcp.json (copy-free); from npm also installs the skills
  reaper-mcp install-skills   Copy the mix skills, agents and knowledge into ~/.claude (npm install; --dry-run to preview)
  reaper-mcp doctor           Check that everything is configured correctly
  reaper-mcp status           Check if Lua bridge is running in REAPER
  reaper-mcp telemetry off    Opt out of pseudonymous usage telemetry (also: on, status)

Quick Start (from npm):
  npm install -g @mthines/reaper-mcp
  reaper-mcp setup && reaper-mcp init     # bridge into REAPER, tools + skills into Claude Code
  # then start (or restart) REAPER: the bridge starts with it

Quick Start (from your clone):
  ./scripts/install.sh        # build, link CLI, bridge, symlink skills + knowledge, configure
  # then start (or restart) REAPER: the bridge starts with it

Then in Claude Code:
  /mixer "Please gain stage my tracks"   ·   /critique "Roast my mix"
`);
    break;
}

// ---------------------------------------------------------------------------
// Graceful shutdown — flush telemetry before the process exits
// ---------------------------------------------------------------------------

function shutdownAll(): void {
  stopPollers();
  // Terminate the Python sidecar if it was ever spawned
  try {
    getSidecarClient().shutdown();
  } catch {
    // Best-effort — sidecar may not have been started
  }
}

/** Report Lua events written since the last poll, then flush all telemetry. */
function flushAndExit(code: number): void {
  // Tell the bridge first (bounded to 1s) so the status page marks this session disconnected
  endSession()
    .finally(() => {
      shutdownAll();
      readBridgeEvents()
        .catch(() => { /* best-effort: exiting anyway */ })
        .finally(() => shutdownTelemetry().finally(() => process.exit(code)));
    });
}

process.on('SIGINT', () => {
  console.error('[reaper-mcp] Interrupted');
  flushAndExit(0);
});

process.on('SIGTERM', () => {
  console.error('[reaper-mcp] Terminated');
  flushAndExit(0);
});

process.on('uncaughtException', (err) => {
  emitLog('error', 'Uncaught exception — server exiting', exceptionAttributes(err), {
    eventName: 'reaper.server.crash',
  });
  flushAndExit(1);
});

process.on('unhandledRejection', (reason) => {
  emitLog('error', 'Unhandled promise rejection — server exiting', exceptionAttributes(reason), {
    eventName: 'reaper.server.crash',
  });
  flushAndExit(1);
});
