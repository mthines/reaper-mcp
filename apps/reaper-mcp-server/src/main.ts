#!/usr/bin/env node

import { createInterface } from 'node:readline';
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
import { exec as execCb, spawn } from 'node:child_process';
import { promisify as promisifyUtil } from 'node:util';
import { runUpdate, realUpdateDeps } from './update.js';
import { installClaudeAssets } from './claude-assets.js';
import { HARNESSES, connectHarness, detectHarnesses, isStale, parseHarnessFlag, realEnv, registeredServer, skillsHomes, type Harness, type HarnessId } from './harnesses.js';
import { installExamplePlugins } from './jsfx/examples.js';
import { loadToolkit, generatedDir, presetsDir } from './tools/jsfx.js';
import { resolveAssetDir, copyDirSync, installFile, createMcpJson, ensureClaudeSettings, REAPER_ASSETS, RETIRED_ASSETS, MCP_TOOL_NAMES, BRIDGE_UI_FILE, DEFAULT_WEB_PORT, ensureWebInterface, ensureSnapshotActions, ensureBridgeAutostart, autostartCheck, setupFilesPlan, findCloneRoot, isDevClone, updateConfigText, npmUpdateConfigText, type CloneState } from './cli.js';
import { detectInstalled, setupSidecar } from './setup-sidecar.js';
import { confirmOptOutPrompt, firstRunTelemetryNotice, resolveTelemetry, saveTelemetryChoice, TELEMETRY_DOC_URL } from './telemetry-consent.js';
import { endSession, setSessionClient, startSessionPing } from './session.js';
import { getSidecarClient } from './sidecar.js';
import { renderDoctor, useColor, type Check, type CheckStatus, type Section } from './doctor-report.js';
import { createUi } from './terminal-ui.js';
import { streamEnded } from './stream-ended.js';
import { repairBridgeInstall, repairNotices, writeBridgeVersion, type BridgeRepair } from './bridge-repair.js';
import { addNotice } from './notices.js';
import { checkForUpdate, updateCheckDisabled } from './update-check.js';
import { offerSidecarSetup } from './sidecar-offer.js';
import { autostartInstalled, isReaperProcessRunning, setupHealthAttributes } from './setup-health.js';

const execAsync = promisifyUtil(execCb);

/** How everything this CLI prints looks (colour and logo only on a terminal): see terminal-ui.ts */
const ui = createUi();

const __dirname = dirname(fileURLToPath(import.meta.url));

async function setup(): Promise<void> {
  // One line per step; --verbose lists every file
  const verbose = process.argv.includes('--verbose');
  const installedLine = (what: string, files: string[]) => {
    if (verbose) for (const f of files) console.log(ui.item('ok', `Installed: ${f}`));
    else if (files.length) console.log(ui.item('ok', `${files.length} ${what} installed`));
  };

  console.log(ui.banner('Setup', readServiceVersion()));

  const bridgeDir = await ensureBridgeDir();
  console.log(`Bridge directory: ${ui.dim(bridgeDir)}\n`);

  const scriptsDir = getReaperScriptsPath();
  mkdirSync(scriptsDir, { recursive: true });

  const reaperDir = resolveAssetDir(__dirname, 'reaper');

  // ReaPack owns the files once it has installed the bridge: copying them to Scripts/ and Effects/ as
  // well would give an Action List with every script twice and a bridge ReaPack updates never touch.
  const filesPlan = setupFilesPlan(existsSync(join(scriptsDir, 'reaper-mcp', 'MCP Bridge', 'mcp_bridge.lua')), findCloneRoot(__dirname) !== null);
  if (filesPlan === 'leave') {
    console.log(`${ui.mark('info')} The bridge is installed by ReaPack: leaving its scripts, JSFX and status page to ReaPack.`);
    console.log(`${ui.dim('Setup only turns on starting with REAPER and the web interface.')}\n`);
    installBridgeAutostart(scriptsDir);
    writeBridgeVersion(scriptsDir, readServiceVersion());
    const port = await enableWebInterface();
    console.log(`\n${ui.mark('ok')} ${ui.bold('Setup complete!')}`);
    if (await chainAfterSetup(port, join(scriptsDir, 'reaper-mcp', 'MCP Bridge', 'mcp_bridge.lua'))) return;
    console.log(`\nRestart REAPER (or run the bridge once from the Action List) and add reaper-mcp to your harness: ${ui.cmd('reaper-mcp doctor')}`);
    if (port) console.log(`The bridge opens its status window on start: ${ui.link(`http://localhost:${port}/${BRIDGE_UI_FILE}`)}`);
    await offerSidecar();
    return;
  }
  if (filesPlan === 'install-with-warning') {
    console.log(`${ui.warn('WARNING:')} ReaPack has installed the bridge too, and REAPER prefers its copy (Scripts/reaper-mcp/MCP Bridge/ and`);
    console.log('Effects/reaper-mcp/Meters/) over the files this checkout installs. Your local changes will not run until you');
    console.log('uninstall the reaper-mcp packages in ReaPack (Manage repositories > reaper-mcp > Uninstall packages),');
    console.log('then run setup again: this run also overwrote the status page ReaPack installed, which uninstalling removes.\n');
  }

  console.log(`${ui.bold('Installing Lua scripts...')}`);
  // Install every Lua asset (bridge, its libraries, the shared snapshot library
  // and the A/B action scripts). REAPER_ASSETS
  // is the single source of truth — a hardcoded subset previously omitted the
  // snapshot library and action scripts, leaving stale copies in REAPER.
  const luaInstalled: string[] = [];
  for (const asset of REAPER_ASSETS) {
    if (!asset.endsWith('.lua')) continue;
    const src = join(reaperDir, asset);
    const dest = join(scriptsDir, asset);
    if (installFile(src, dest)) luaInstalled.push(asset);
    else console.log(ui.item('fail', `Not found: ${src}`));
  }
  installedLine('scripts', luaInstalled);

  for (const asset of RETIRED_ASSETS) {
    const dest = join(scriptsDir, asset);
    if (existsSync(dest)) {
      rmSync(dest);
      console.log(ui.item('info', `Removed: ${asset} (retired)`));
    }
  }

  // Lets the status page's Update button pull and reinstall this clone (it runs scripts/update.sh)
  const cloneRoot = findCloneRoot(__dirname);
  if (cloneRoot) {
    const dev = isDevClone(await cloneState(cloneRoot));
    writeFileSync(join(scriptsDir, 'mcp_update.conf'), updateConfigText(cloneRoot, process.execPath, dev));
    console.log(ui.item('ok', `Installed: mcp_update.conf (${dev ? 'developer clone: Rebuild & reload' : 'one-click updates'} from the status page)`));
  } else {
    // An npm install: the Update button runs `reaper-mcp update` through this node and this CLI
    // Silent: nothing for the user to act on, and the setup output is part of the first-run experience
    writeFileSync(join(scriptsDir, 'mcp_update.conf'), npmUpdateConfigText(process.execPath, join(__dirname, 'main.js')));
  }

  const effectsDir = join(getReaperEffectsPath(), 'reaper-mcp');
  mkdirSync(effectsDir, { recursive: true });

  console.log(ui.section('Installing JSFX analyzers...'));
  const jsfxInstalled: string[] = [];
  for (const asset of REAPER_ASSETS) {
    if (asset.endsWith('.lua')) continue;
    const src = join(reaperDir, asset);
    const dest = join(effectsDir, asset);
    if (installFile(src, dest)) jsfxInstalled.push(`reaper-mcp/${asset}`);
    else console.log(ui.item('fail', `Not found: ${src}`));
  }
  installedLine('JSFX files', jsfxInstalled);

  // The /make-plugin examples as ready-to-use plugins (an example you edited is left alone)
  console.log(ui.section('Installing example plugins...'));
  const examplesDir = join(resolveAssetDir(__dirname, 'claude'), 'skills', 'make-plugin', 'examples');
  const examples = installExamplePlugins(examplesDir, join(generatedDir(), 'examples'), loadToolkit(), presetsDir());
  installedLine('example plugins', examples.installed.map((f) => `reaper-mcp-generated/examples/${f}`));
  for (const f of examples.kept) console.log(ui.item('info', `Kept your edited copy: reaper-mcp-generated/examples/${f}`));
  if (verbose) for (const [f, names] of Object.entries(examples.presets)) if (names.length) console.log(ui.item('info', `Presets for ${f}: ${names.join(', ')}`));
  for (const e of examples.presetErrors) console.log(ui.item('warn', `Skipped presets (invalid): ${e}`));
  if (!examples.installed.length && !examples.kept.length) console.log(ui.item('fail', `Not found: ${examplesDir}`));

  // Bridge status UI (page + PWA manifest, service worker, icons), served by REAPER's web
  // interface from reaper_www_root/. Built by the bridge-ui project into dist/apps/bridge-ui
  // (a sibling of this bundle). Files are all mcp_bridge* so other web remotes are untouched.
  const wwwSrc = resolveAssetDir(__dirname, 'bridge-ui');
  console.log(ui.section('Installing bridge status UI...'));
  if (existsSync(join(wwwSrc, BRIDGE_UI_FILE))) {
    const count = copyDirSync(wwwSrc, getReaperWwwPath());
    console.log(ui.item('ok', verbose ? `Installed: reaper_www_root/${BRIDGE_UI_FILE} (+${count - 1} PWA files)` : 'Status page installed'));
  } else {
    console.log(ui.item('fail', `Not found: ${join(wwwSrc, BRIDGE_UI_FILE)} (build bridge-ui first)`));
  }

  // Before the web-interface step: Ctrl+C at its "Quit REAPER to finish" prompt ends setup there
  installBridgeAutostart(scriptsDir);
  // `serve` brings REAPER's files up to its own release once per release (bridge-repair.ts) from this record
  writeBridgeVersion(scriptsDir, readServiceVersion());
  const webPort = await enableWebInterface();
  await registerSnapshotActions();

  console.log(`\n${ui.mark('ok')} ${ui.bold('Setup complete!')}`);
  if (await chainAfterSetup(webPort, join(scriptsDir, 'mcp_bridge.lua'))) return;
  console.log('');
  console.log(ui.heading('Next steps:'));
  console.log(`  ${ui.bold('1.')} Start REAPER: the bridge starts with it. If REAPER is already open, restart it,`);
  console.log('     or run the bridge once by hand: Actions > Show action list > Load ReaScript,');
  console.log(`     select ${ui.dim(join(scriptsDir, 'mcp_bridge.lua'))} and click Run.`);
  console.log(`  ${ui.bold('2.')} Connect your AI harness: ${ui.cmd('reaper-mcp init')}, then check it with ${ui.cmd('reaper-mcp doctor')}`);
  if (webPort) {
    console.log(`\nThe bridge opens its status window on start: ${ui.link(`http://localhost:${webPort}/${BRIDGE_UI_FILE}`)}`);
  }
  await offerSidecar();
}

/** setup's last step: audio tools need the Python sidecar, which setup does not install (sidecar-offer.ts). */
async function offerSidecar(): Promise<void> {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !process.env['CI'];
  await offerSidecarSetup({ input: process.stdin, output: process.stdout, interactive }, getSidecarClient().isAvailable(), () => setupSidecar([]));
}

/** One yes/no question on the terminal; Enter takes the default, Ctrl+D or a closed stdin too */
async function askYesNo(question: string, defaultYes = true): Promise<boolean> {
  process.stdout.write(`\n${ui.bold(question)} ${ui.dim(defaultYes ? '[Y/n]' : '[y/N]')} `);
  let answer = '';
  // After Ctrl+D the stream is over: a new readline would wait forever, so the default answers
  if (!streamEnded(process.stdin)) {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    answer = await new Promise<string>((resolve) => {
      rl.once('line', resolve);
      rl.once('close', () => resolve(''));
    }).then((a) => a.trim().toLowerCase());
    rl.close();
  }
  return answer === '' ? defaultYes : answer === 'y' || answer === 'yes';
}

/**
 * What follows `reaper-mcp setup`: connect the AI harness (`init`), then check it all (`doctor`).
 * `--yes` (or `-y`) does both without asking, for scripts and agents; at a terminal each is a question where Enter says yes;
 * anywhere else (a pipe, CI) setup prints the next steps and stops, as before.
 * Returns false when it did not chain, so the caller prints the plain next steps.
 */
async function chainAfterSetup(port: number | null | undefined, bridgeScript: string): Promise<boolean> {
  const yes = process.argv.includes('--yes') || process.argv.includes('-y');
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!yes && !interactive) return false;
  if (yes || (await askYesNo('Connect your AI harness now?'))) {
    await init(true);
    if (yes || (await askYesNo('Check that everything is in place?'))) {
      console.log('');
      await doctor();
      console.log(ui.dim('The bridge shows as not detected until REAPER has started it: that is the one step left.'));
    }
  } else {
    console.log(`\nWhenever you are ready: ${ui.cmd('reaper-mcp init')}, then ${ui.cmd('reaper-mcp doctor')}`);
  }
  await offerSidecar();
  console.log(`\n${ui.heading('One step left:')} start REAPER (restart it if it is open): the bridge starts with it.`);
  console.log(`  ${ui.dim('Rather not restart? Actions > Show action list > Load ReaScript, select')} ${ui.dim(bridgeScript)} ${ui.dim('and click Run.')}`);
  if (port) console.log(`\nThe bridge opens its status window on start: ${ui.link(`http://localhost:${port}/${BRIDGE_UI_FILE}`)}`);
  return true;
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
  return (await isReaperProcessRunning(10_000)) ?? false;
}

/** Turn on REAPER's web browser interface so the bridge can open its status window. Returns the port, or null. */
async function enableWebInterface(): Promise<number | null> {
  console.log(ui.section('Enabling REAPER web interface...'));
  const iniPath = join(getReaperResourcePath(), 'reaper.ini');
  if (!existsSync(iniPath)) {
    console.log(ui.item('warn', `Skipped: ${iniPath} not found (start REAPER once, quit it, then re-run setup)`));
    return null;
  }
  const requested = Number(process.env['REAPER_WEB_PORT']) || DEFAULT_WEB_PORT;
  const result = ensureWebInterface(readFileSync(iniPath, 'utf-8'), requested);
  if (!result.changed) {
    console.log(ui.item('ok', `Already enabled on port ${result.port}`));
    return result.port;
  }
  if (await isReaperRunning()) {
    if (!process.stdout.isTTY) {
      console.log(ui.item('warn', 'Skipped: REAPER is running and would overwrite reaper.ini on exit.'));
      console.log(`    Quit REAPER and run ${ui.cmd('reaper-mcp setup')} again.`);
      return null;
    }
    console.log(ui.item('warn', 'REAPER is running and would overwrite reaper.ini on exit.'));
    console.log('    Quit REAPER to finish (Ctrl+C to skip)...');
    while (await isReaperRunning()) await new Promise((r) => setTimeout(r, 1000));
  }
  // Re-read: REAPER may have rewritten reaper.ini while quitting
  writeFileSync(iniPath, ensureWebInterface(readFileSync(iniPath, 'utf-8'), requested).ini, 'utf-8');
  console.log(ui.item('ok', `Enabled on port ${result.port} (override with REAPER_WEB_PORT)`));
  return result.port;
}

/**
 * Start the bridge with REAPER: a block in Scripts/__startup.lua, which REAPER runs at launch. Written
 * every time (it honours the page's "Start with REAPER" setting, so it never overrides a user's choice).
 * REAPER never writes that file, so this is safe while REAPER is open.
 */
function installBridgeAutostart(scriptsDir: string): void {
  console.log(ui.section('Starting the bridge with REAPER...'));
  const path = join(scriptsDir, '__startup.lua');
  const { text, changed } = ensureBridgeAutostart(existsSync(path) ? readFileSync(path, 'utf-8') : '');
  if (changed) writeFileSync(path, text, 'utf-8');
  console.log(ui.item('ok', changed ? 'Added to Scripts/__startup.lua (REAPER runs it at launch)' : 'Already in Scripts/__startup.lua'));
  console.log(ui.dim('    Turn it off in the bridge window: Settings > Start with REAPER.'));
}

/** List the snapshot scripts in REAPER's Action List (reaper-kb.ini), ready for a shortcut. */
async function registerSnapshotActions(): Promise<void> {
  console.log(ui.section('Registering snapshot actions (quick save, next, previous)...'));
  const kbPath = join(getReaperResourcePath(), 'reaper-kb.ini');
  const kb = existsSync(kbPath) ? readFileSync(kbPath, 'utf-8') : '';
  const { added } = ensureSnapshotActions(kb);
  if (!added.length) {
    console.log(ui.item('ok', 'Already in the Action List'));
  } else if (await isReaperRunning()) {
    // REAPER rewrites reaper-kb.ini from memory; the bridge adds them through the API when it starts
    console.log(ui.item('info', 'REAPER is running: the bridge adds them when it next starts (re-run mcp_bridge.lua).'));
  } else {
    writeFileSync(kbPath, ensureSnapshotActions(kb).kb, 'utf-8');
    console.log(ui.item('ok', `Added: ${added.join(', ')}`));
  }
  console.log(`${ui.dim('    Bind keys in Actions > Show action list: search')} ${ui.cmd('"mcp_snapshot"')}${ui.dim('.')}`);
}

// Connect the AI harnesses (Claude Code, Codex CLI, Gemini CLI, Cursor) to this REAPER MCP server: the ones that
// are installed get configured, the ones that are not get an install hint. `--harness codex,gemini` or `--all`
// picks them by hand. Claude Code also gets the tool allow-list, so the REAPER tools are pre-approved everywhere.
/** An install hint, with a bare URL drawn as a link */
function installHint(ui: ReturnType<typeof createUi>, hint: string): string {
  return /^https?:\/\/\S+$/.test(hint) ? ui.link(hint) : hint;
}

async function init(chained = false): Promise<void> {
  let chosen: HarnessId[] | null;
  try {
    chosen = parseHarnessFlag(process.argv);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
  console.log(ui.banner('Connect your AI harness', readServiceVersion()));
  const env = realEnv();
  const found = detectHarnesses(env).map((h) => h.id);
  const ids = chosen ?? found;

  for (const h of HARNESSES) {
    console.log(found.includes(h.id) ? `  ${ui.mark('ok')} ${ui.dim('found')}      ${ui.bold(h.name)}` : `  ${ui.mark('info')} ${ui.dim('not found')}  ${h.name}: ${ui.dim(installHint(ui, h.installHint))}`);
  }
  console.log('');
  if (ids.length === 0) {
    console.log(`None of the supported harnesses is installed yet. Install one (see above), then run: ${ui.cmd('reaper-mcp init')}`);
    return;
  }

  const mainJs = realpathSync(process.argv[1]);
  const inClone = findCloneRoot(__dirname) !== null;
  for (const id of ids) {
    const h = HARNESSES.find((x) => x.id === id) as Harness;
    if (id === 'claude') {
      const settingsPath = join(homedir(), '.claude', 'settings.json');
      mkdirSync(dirname(settingsPath), { recursive: true });
      console.log(`${ui.mark('ok')} Claude settings (${MCP_TOOL_NAMES.length} REAPER tools allow-listed): ${ensureClaudeSettings(settingsPath)} → ${ui.dim(settingsPath.replace(homedir(), '~'))}`);
      if (inClone) {
        // .mcp.json in the current directory: `node <this script> serve`, so it needs no PATH link.
        const mcpJsonPath = join(process.cwd(), '.mcp.json');
        console.log(createMcpJson(mcpJsonPath, resolve(process.argv[1])) ? `${ui.mark('ok')} Created: ${ui.dim(mcpJsonPath)}` : `${ui.mark('ok')} .mcp.json already exists — leaving it untouched.`);
        continue;
      }
    }
    const r = connectHarness(id, process.execPath, mainJs, env);
    if (r.status === 'failed') {
      console.log(`${ui.mark('fail')} Could not connect ${ui.bold(h.name)}: ${r.detail}${found.includes(id) ? '' : ` ${ui.dim(`(not installed: ${installHint(ui, h.installHint)})`)}`}`);
      console.log(`  ${ui.dim('To connect it yourself:')} ${ui.cmd(r.manual ?? '')}`);
    } else {
      const what = { connected: 'Connected', replaced: 'Reconnected (the old entry pointed at files that no longer exist)', already: 'Already connected' }[r.status];
      console.log(`${ui.mark('ok')} ${what}: ${ui.bold(h.name)}${id === 'claude' && inClone ? '' : ui.dim(' (works from any folder)')}`);
    }
  }

  await askTelemetryOnce();

  if (inClone) {
    console.log('\nIf you haven\'t yet, symlink the skills + knowledge and install the bridge:');
    console.log(`  ${ui.cmd('scripts/sync-symlinks.sh')}   ${ui.dim('# mix skills + knowledge → ~/.claude, skills + agents → ~/.agents')}`);
  } else {
    console.log('');
    installSkills(false, ids);
    if (!chained) console.log('\nIf you haven\'t yet, install the bridge:');
  }
  // After `setup` the bridge is installed already: only a stand-alone `init` points back at it
  if (!chained) {
    console.log(`  ${ui.cmd('reaper-mcp setup')}           ${ui.dim('# Lua bridge + JSFX → REAPER')}`);
    console.log('then start (or restart) REAPER: the bridge starts with it.');
  }
  if (!inClone) console.log(`\nWant it to remember plugins and your corrections? Connect LoreKit (free): ${ui.link('https://lorekit.io')}. ${ui.cmd('/learn-plugin')} will walk you through it.`);
  console.log(`\nTry: ${ui.cmd('/mixer "Please gain stage my tracks"')}  ·  ${ui.cmd('/critique "Roast my mix"')}`);
}

/**
 * Copy the mix skills, agents and knowledge shipped in the npm package (a clone symlinks them instead):
 * into ~/.claude for Claude Code (with the knowledge the skills read), and skills + agents into the shared
 * ~/.agents for Codex CLI, Gemini CLI and Cursor. With no `ids`, for the harnesses that are installed (Claude Code when none is).
 */
function installSkills(dryRun = false, ids?: HarnessId[]): void {
  if (findCloneRoot(__dirname)) {
    console.log('Running from a clone: scripts/sync-symlinks.sh links the skills and knowledge into ~/.claude and ~/.agents.');
    return;
  }
  const src = join(resolveAssetDir(__dirname, 'claude'));
  if (!existsSync(src)) {
    console.log(`Skills not found: ${src} (this build has no claude/ folder)`);
    process.exitCode = 1;
    return;
  }
  let targets = ids;
  if (!targets) {
    try {
      targets = parseHarnessFlag(process.argv) ?? detectHarnesses().map((h) => h.id);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
      return;
    }
  }
  const homes = skillsHomes(targets.length ? targets : ['claude']);
  const verb = dryRun ? 'Would install' : 'Installed';
  const jobs: { label: string; dir: string; include?: ('skills' | 'agents' | 'knowledge')[]; what: string }[] = [];
  if (homes.claude) jobs.push({ label: '~/.claude', dir: join(homedir(), '.claude'), what: 'the mix skills, agents and knowledge' });
  if (homes.agents) jobs.push({ label: '~/.agents', dir: join(homedir(), '.agents'), include: ['skills', 'agents'], what: 'the mix skills and agents' });
  // The skills read their knowledge from ~/.claude/knowledge whichever harness runs them
  if (homes.agents && !homes.claude) jobs.push({ label: '~/.claude', dir: join(homedir(), '.claude'), include: ['knowledge'], what: 'the knowledge base the skills read' });
  for (const job of jobs) {
    const r = installClaudeAssets(src, job.dir, { dryRun, include: job.include });
    console.log(`${ui.mark('ok')} ${verb} ${job.what} in ${job.label}: ${r.installed.length} new, ${r.updated.length} updated, ${r.unchanged} already current.`);
    for (const s of r.skipped) {
      const why = { edited: 'you changed it, left as is', 'not-ours': 'already exists and is yours, left as is', symlink: 'linked elsewhere, left as is', 'broken-symlink': 'a link to a folder that no longer exists (a deleted clone?); remove it and run this again' }[s.reason];
      console.log(ui.dim(`  Skipped ${s.path}: ${why}`));
    }
  }
  if (!dryRun) console.log('Try /mixer, /critique or /learn-plugin in your harness. (/learn-plugin saves what it learns to LoreKit, see the README.)');
}

function consoleConsentIO() {
  return { input: process.stdin, output: process.stdout, interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY), ui };
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
  const label = { default: ui.ok('On — pseudonymous usage data to the developer'), custom: ui.cmd('Custom — your own OTEL_* destination'), off: ui.dim('Off') }[mode];
  return `${label} ${ui.dim(`(${reason})`)}`;
}

// reaper-mcp telemetry [status|on|off|setup]
async function telemetryCommand(sub = 'status'): Promise<void> {
  if (sub !== 'on' && sub !== 'off' && sub !== 'setup' && sub !== 'status') {
    console.log(`Usage: ${ui.cmd('reaper-mcp telemetry')} [status|on|off]`);
    process.exitCode = 1;
    return;
  }
  // Only on a terminal: scripts read this command's output, so a pipe gets exactly the lines below
  if (ui.fancy && sub !== 'setup') console.log(ui.banner('Telemetry', readServiceVersion()));
  // Turning it off asks once more, at a terminal only (and not when it is already off)
  if (sub === 'off' && resolveTelemetry().mode === 'default' && !(await confirmOptOutPrompt(consoleConsentIO()))) return;
  if (sub === 'on' || sub === 'off') {
    const change = saveTelemetryChoice(sub === 'on');
    const counted = change ? await reportConsentChange(change) : false;
    if (sub === 'on') console.log(`${ui.mark('ok')} Pseudonymous usage telemetry turned ${ui.ok('on')} — thank you!`);
    else console.log(`${ui.mark('ok')} Telemetry turned ${ui.bold('off')}. ${counted ? OPT_OUT_COUNTED : 'Nothing will be sent.'}`);
    console.log(`${ui.dim('Restart Claude Code (or run')} ${ui.cmd('/mcp')}${ui.dim(') for the running server to pick it up.')}`);
  } else if (sub === 'setup') {
    if (!(await askTelemetryOnce())) console.log(`${ui.bold('Telemetry:')} ${describeTelemetry()}`);
    return;
  }
  console.log(`${ui.bold('Telemetry:')} ${describeTelemetry()}`);
  console.log(`What is and isn't collected: ${ui.link(TELEMETRY_DOC_URL)}`);
}

/** Prints the report and returns the exit code (0 = everything it checks is in place) */
async function doctor(): Promise<number> {
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
  const sharedSkills = existsSync(join(homedir(), '.agents', 'skills', 'mixer', 'SKILL.md'));
  core.push(
    localSkills || globalSkills || sharedSkills
      ? { label: 'Mix skills', status: 'ok', detail: localSkills ? '.claude/skills' : globalSkills ? '~/.claude/skills' : '~/.agents/skills' }
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

  const mcpJsonExists = existsSync(join(process.cwd(), '.mcp.json'));
  const harnessEnv = realEnv();
  const installed = detectHarnesses(harnessEnv);
  const connected = installed.filter((h) => registeredServer(h.id, harnessEnv));
  const staleOnes = connected.filter((h) => isStale(registeredServer(h.id, harnessEnv)!));
  const fixMcp = findCloneRoot(__dirname) ? 'scripts/install.sh (from your clone)' : 'reaper-mcp init';
  const mcpRegistered = staleOnes.length === 0 && (connected.length > 0 || mcpJsonExists);
  if (staleOnes.length) {
    core.push({ label: 'MCP config', status: 'fail', detail: `${staleOnes.map((h) => h.name).join(', ')}: points at files that no longer exist`, fix: fixMcp });
  } else if (connected.length || mcpJsonExists) {
    const where = [...connected.map((h) => h.name), ...(mcpJsonExists ? ['.mcp.json in this folder'] : [])].join(', ');
    const missing = installed.filter((h) => !connected.includes(h));
    core.push({ label: 'MCP config', status: 'ok', detail: `Connected: ${where}${missing.length ? ` · not yet: ${missing.map((h) => h.name).join(', ')} (reaper-mcp init)` : ''}` });
  } else {
    core.push({ label: 'MCP config', status: 'fail', detail: installed.length ? `Not registered in ${installed.map((h) => h.name).join(', ')}` : 'No supported harness found (Claude Code, Codex CLI, Gemini CLI, Cursor)', fix: fixMcp });
  }

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

  if (ui.fancy) console.log(ui.banner('Doctor', readServiceVersion()));
  console.log(renderDoctor(sections, { version: readServiceVersion(), color: useColor(), header: !ui.fancy }));
  return bridgeRunning && knowledgeLinked && mcpRegistered && !sidecarBroken && !extensionsBroken ? 0 : 1;
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
      // Why the bridge is down (REAPER closed, or open with the bridge stopped): looked up meanwhile, set below
      const reaperRunning = bridge.state === 'connected' ? Promise.resolve(undefined) : isReaperProcessRunning();

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
      // After oninitialized is set, so awaiting here can't miss the client's initialized notification
      startupSpan.setAttributes(setupHealthAttributes({
        status: bridge,
        reaperRunning: await reaperRunning,
        autostart: autostartInstalled(getReaperScriptsPath()),
        sidecarInstalled: getSidecarClient().isAvailable(),
      }));
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

/** `reaper-mcp update`: an npm install updates itself (update.ts); a clone runs its scripts/update.sh. */
async function updateCommand(force: boolean, bridge: boolean): Promise<number> {
  const cloneRoot = findCloneRoot(__dirname);
  if (cloneRoot) {
    return new Promise((resolveCode) => {
      const child = spawn('bash', ['./scripts/update.sh'], { cwd: cloneRoot, stdio: 'inherit' });
      child.on('error', () => resolveCode(1));
      child.on('close', (code) => resolveCode(code ?? 1));
    });
  }
  return runUpdate(realUpdateDeps(readServiceVersion(), join(__dirname, 'main.js'), force, bridge));
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

  case 'update':
    updateCommand(process.argv.includes('--force'), process.argv.includes('--bridge')).then(
      (code) => process.exit(code),
      (err: unknown) => {
        console.error('Update failed:', err);
        process.exit(1);
      },
    );
    break;

  case 'doctor':
    doctor().then(
      (code) => process.exit(code),
      (err) => {
        console.error('Doctor failed:', err);
        process.exit(1);
      },
    );
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
      console.log(`Bridge status: ${running ? ui.ok('CONNECTED') : ui.fail(`NOT DETECTED (${status.state})`)}`);
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
  reaper-mcp setup            Install Lua bridge + JSFX analyzers into REAPER, then offer init and doctor
                              (--yes: do all three without asking; --verbose lists every file)
  reaper-mcp setup-sidecar    Install the Python sidecar (opt-in audio analysis); in a terminal it asks which parts.
                              Agents/CI: --yes (core + aesthetics weights), --all, --with-separation (Demucs),
                              --with-chords (chord model), --without-aesthetics, --list [--json] (what is installed)
  reaper-mcp extension        Manage opt-in extensions: list | add <name|folder|git-url> | link <folder> | remove <name> | new <name>
  reaper-mcp init             Connect the harnesses you have installed (Claude Code, Codex CLI, Gemini CLI, Cursor) and suggest the ones you don't;
                              --harness claude,codex or --all to pick by hand. From npm it also installs the skills
  reaper-mcp install-skills   Copy the mix skills, agents and knowledge into ~/.claude, and skills + agents into ~/.agents for the
                              other harnesses (npm install; --harness to pick, --dry-run to preview)
  reaper-mcp update           Update to the latest release (npm install: downloads it and installs it into REAPER; --force reinstalls)
  reaper-mcp doctor           Check that everything is configured correctly
  reaper-mcp status           Check if Lua bridge is running in REAPER
  reaper-mcp telemetry off    Opt out of pseudonymous usage telemetry (also: on, status)

Quick Start (from npm):
  npm install -g @mthines/reaper-mcp
  reaper-mcp setup && reaper-mcp init     # bridge into REAPER, tools + skills into your harness(es)
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
