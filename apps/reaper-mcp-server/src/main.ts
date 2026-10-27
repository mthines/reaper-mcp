#!/usr/bin/env node

import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { ensureBridgeDir, isBridgeRunning, cleanupStaleFiles, readBridgeEvents, getReaperScriptsPath, getReaperEffectsPath, getReaperWwwPath, getReaperResourcePath, startDiagnosticsPoller, startEventsPoller, stopPollers } from './bridge.js';
import { initTelemetry, shutdownTelemetry, getTracer, registerBridgeGauges, emitLog, exceptionAttributes } from './telemetry.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, platform } from 'node:os';
import { exec as execCb } from 'node:child_process';
import { promisify as promisifyUtil } from 'node:util';
import { resolveAssetDir, copyDirSync, installFile, createMcpJson, ensureClaudeSettings, REAPER_ASSETS, MCP_TOOL_NAMES, BRIDGE_UI_FILE, DEFAULT_WEB_PORT, ensureWebInterface } from './cli.js';
import { setupSidecar } from './setup-sidecar.js';
import { firstRunTelemetryNotice, resolveTelemetry, writeTelemetryConfig, TELEMETRY_DOC_URL } from './telemetry-consent.js';
import { endSession, setSessionClient, startSessionPing } from './session.js';
import { getSidecarClient } from './sidecar.js';

const execAsync = promisifyUtil(execCb);

const __dirname = dirname(fileURLToPath(import.meta.url));

async function setup(): Promise<void> {
  console.log('REAPER MCP Server — Setup\n');

  const bridgeDir = await ensureBridgeDir();
  console.log(`Bridge directory: ${bridgeDir}\n`);

  const scriptsDir = getReaperScriptsPath();
  mkdirSync(scriptsDir, { recursive: true });

  const reaperDir = resolveAssetDir(__dirname, 'reaper');

  console.log('Installing Lua scripts...');
  // Install every Lua asset (bridge, snapshot manager GUI, the shared snapshot
  // library it dofile()s at runtime, and the A/B action scripts). REAPER_ASSETS
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

  const webPort = await enableWebInterface();

  console.log('\nSetup complete!\n');
  console.log('Next steps:');
  console.log('  1. Open REAPER');
  console.log('  2. Actions > Show action list > Load ReaScript');
  console.log(`  3. Select: ${join(scriptsDir, 'mcp_bridge.lua')}`);
  console.log('  4. Run the script (it will keep running in background via defer loop)');
  console.log('  5. Add reaper-mcp to your Claude Code config (see: reaper-mcp doctor)');
  if (webPort) {
    console.log(`\nThe bridge opens its status window on start: http://localhost:${webPort}/${BRIDGE_UI_FILE}`);
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

// Configure Claude Code for this clone: pre-approve the REAPER tools globally and
// drop a .mcp.json pointing at the local reaper-mcp CLI. Copy-free — the skills
// and knowledge come from the symlinks created by scripts/sync-symlinks.sh.
async function init(): Promise<void> {
  console.log('REAPER MCP — Configure Claude Code\n');

  // Tool allow-list, written globally so the REAPER tools are pre-approved everywhere.
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  mkdirSync(dirname(settingsPath), { recursive: true });
  const result = ensureClaudeSettings(settingsPath);
  console.log(`Claude settings (${MCP_TOOL_NAMES.length} REAPER tools allow-listed): ${result} → ${settingsPath}`);

  // .mcp.json in the current directory, pointing at the local reaper-mcp CLI.
  const mcpJsonPath = join(process.cwd(), '.mcp.json');
  if (createMcpJson(mcpJsonPath)) {
    console.log(`Created: ${mcpJsonPath}`);
  } else {
    console.log(`.mcp.json already exists — leaving it untouched.`);
  }

  await firstRunTelemetryNotice(consoleConsentIO());

  console.log('\nIf you haven\'t yet, symlink the skills + knowledge and install the bridge:');
  console.log('  scripts/sync-symlinks.sh   # mix skills + knowledge → ~/.claude');
  console.log('  reaper-mcp setup           # Lua bridge + JSFX → REAPER');
  console.log('then load mcp_bridge.lua in REAPER.');
  console.log('\nTry: /mixer "Please gain stage my tracks"  ·  /critique "Roast my mix"');
}

function consoleConsentIO() {
  return { input: process.stdin, output: process.stdout, interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY) };
}

function describeTelemetry(): string {
  const { mode, reason } = resolveTelemetry();
  const label = { default: 'On — anonymous usage data to the developer', custom: 'Custom — your own OTEL_* destination', off: 'Off' }[mode];
  return `${label} (${reason})`;
}

// reaper-mcp telemetry [status|on|off|setup]
async function telemetryCommand(sub = 'status'): Promise<void> {
  if (sub === 'on' || sub === 'off') {
    writeTelemetryConfig({ telemetry: sub === 'on', telemetryNoticeShown: true });
    console.log(sub === 'on' ? 'Anonymous usage telemetry turned on — thank you!' : 'Telemetry turned off. Nothing will be sent.');
    console.log('Restart Claude Code (or run /mcp) for the running server to pick it up.');
  } else if (sub === 'setup') {
    if (!(await firstRunTelemetryNotice(consoleConsentIO()))) console.log(`Telemetry: ${describeTelemetry()}`);
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
  console.log('REAPER MCP — System Check\n');

  const bridgeRunning = await isBridgeRunning();
  console.log(`Lua bridge:    ${bridgeRunning ? '✓ Connected' : '✗ Not detected'}`);
  if (!bridgeRunning) {
    console.log('  → Run "reaper-mcp setup" then load mcp_bridge.lua in REAPER');
  }

  const globalClaudeDir = join(homedir(), '.claude');
  const localSkills = existsSync(join(process.cwd(), '.claude', 'skills', 'mixer', 'SKILL.md'));
  const globalSkills = existsSync(join(globalClaudeDir, 'skills', 'mixer', 'SKILL.md'));
  const skillsExist = localSkills || globalSkills;
  const skillsLocation = localSkills ? '.claude/skills/' : globalSkills ? '~/.claude/skills/' : '';
  console.log(`Mix skills:    ${skillsExist ? `✓ Found (${skillsLocation})` : '✗ Not linked'}`);
  if (!skillsExist) {
    console.log('  → Run "scripts/sync-symlinks.sh" from your clone');
  }

  // The skills read ~/.claude/knowledge (the symlink sync-symlinks.sh creates), or
  // a project-scoped .claude/knowledge — NOT a bare repo-root knowledge/ dir.
  const knowledgeLinked =
    existsSync(join(globalClaudeDir, 'knowledge')) ||
    existsSync(join(process.cwd(), '.claude', 'knowledge'));
  console.log(`Knowledge base: ${knowledgeLinked ? '✓ Linked (~/.claude/knowledge)' : '✗ Not linked'}`);
  if (!knowledgeLinked) {
    console.log('  → Run "scripts/sync-symlinks.sh" from your clone');
  }

  const mcpJsonExists = existsSync(join(process.cwd(), '.mcp.json'));
  console.log(`MCP config:    ${mcpJsonExists ? '✓ .mcp.json found' : '✗ .mcp.json missing'}`);
  if (!mcpJsonExists) {
    console.log('  → Run "reaper-mcp init" to create .mcp.json');
  }

  console.log(`Telemetry:     ${describeTelemetry()}`);

  console.log('\nTo check SWS Extensions, start REAPER and use the "list_available_fx" tool.');
  console.log('SWS provides enhanced plugin discovery and snapshot support.\n');

  // --- Sidecar checks (opt-in; all run independently to show partial state) ---
  console.log('Python Sidecar (opt-in, for analyze_track_aesthetics):');

  const sidecarVenvPath = join(homedir(), '.reaper-mcp', 'sidecar-venv');
  // Venv binary layout differs by OS: POSIX uses bin/, Windows uses Scripts\
  const venvBin = platform() === 'win32' ? 'Scripts' : 'bin';
  const venvPythonName = platform() === 'win32' ? 'python.exe' : 'python';
  const venvPython = join(sidecarVenvPath, venvBin, venvPythonName);
  const hfCachePath = join(homedir(), '.cache', 'huggingface', 'hub');

  // Check (a): Python ≥ 3.10 available
  let pythonOk = false;
  let pythonDetail = 'not found';
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
    pythonDetail = 'not found';
  }
  console.log(`  Python ≥ 3.10:  ${pythonOk ? `✓ ${pythonDetail}` : `✗ ${pythonDetail}`}`);
  if (!pythonOk) {
    console.log('    → Install Python 3.10+ from https://python.org or set PYTHON_BIN');
  }

  // Check (b): venv exists
  const venvExists = existsSync(sidecarVenvPath);
  console.log(`  Venv:           ${venvExists ? `✓ ${sidecarVenvPath}` : '✗ Not installed'}`);
  if (!venvExists) {
    console.log('    → Run: node dist/apps/reaper-mcp-server/main.js setup-sidecar');
  }

  // Check (c): audiobox-aesthetics importable in venv
  let depsOk = false;
  if (venvExists && existsSync(venvPython)) {
    try {
      await execAsync(`"${venvPython}" -c "import audiobox_aesthetics"`);
      depsOk = true;
    } catch {
      depsOk = false;
    }
  }
  console.log(`  Dependencies:   ${depsOk ? '✓ audiobox-aesthetics importable' : '✗ Not installed'}`);
  if (!depsOk && venvExists) {
    console.log('    → Run: node dist/apps/reaper-mcp-server/main.js setup-sidecar');
  }

  // Check (d): model weights in HuggingFace cache
  const weightsPath = join(hfCachePath, 'models--facebook--audiobox-aesthetics');
  const weightsExist = existsSync(weightsPath);
  console.log(`  Model weights:  ${weightsExist ? `✓ ${weightsPath}` : '✗ Not downloaded'}`);
  if (!weightsExist) {
    console.log('    → Run: node dist/apps/reaper-mcp-server/main.js setup-sidecar');
  }

  const sidecarReady = venvExists && depsOk && weightsExist;
  // The sidecar is opt-in. If the user has not started installing it (no venv
  // and no weights), don't penalize the exit code. But if they have opted in
  // (any artifact present) we fail loud on a partial / broken install.
  // Note: weightsExist checks the shared HuggingFace cache (~/.cache/huggingface).
  // A user who has the Audiobox weights from an unrelated project and no venv will
  // see sidecarOptedIn=true and exit code 1. This is intentional: "you have model
  // weights but no venv" is a broken state this tool cannot use — run setup-sidecar.
  const sidecarOptedIn = venvExists || weightsExist;
  const sidecarBroken = sidecarOptedIn && !sidecarReady;
  if (!sidecarOptedIn) {
    console.log('\n  Sidecar: not installed (opt-in). Run setup-sidecar to enable audio AI tools.');
  } else if (sidecarBroken) {
    console.log('\n  Sidecar: PARTIALLY INSTALLED — run setup-sidecar to repair.');
  } else {
    console.log('\n  Sidecar: fully installed and ready.');
  }

  console.log('');
  process.exit(bridgeRunning && knowledgeLinked && mcpJsonExists && !sidecarBroken ? 0 : 1);
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

      // Check bridge connectivity in a child span
      const bridgeRunning = await tracer.startActiveSpan('check bridge connection', { kind: SpanKind.INTERNAL }, async (bridgeSpan) => {
        const running = await isBridgeRunning();
        bridgeSpan.setAttribute('reaper.bridge.connected', running);
        if (!running) {
          emitLog('warn', 'Lua bridge not detected at startup — commands will time out until it is started', {
            'reaper.bridge.connected': false,
          });
          log('WARNING: Lua bridge does not appear to be running in REAPER.');
          log('Commands will timeout until the bridge script is started.');
          log('Run "reaper-mcp setup" for installation instructions.');
        } else {
          bridgeSpan.setStatus({ code: SpanStatusCode.OK });
          log('Lua bridge detected — connected to REAPER');
        }
        bridgeSpan.end();
        return running;
      });

      startupSpan.setAttribute('reaper.bridge.connected', bridgeRunning);

      const server = createServer();
      const transport = new StdioServerTransport();

      await server.connect(transport);
      server.server.oninitialized = () => setSessionClient(server.server.getClientVersion()?.name);
      startSessionPing();
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

  case 'setup-sidecar':
    setupSidecar().catch((err) => {
      console.error('Sidecar setup failed:', err);
      process.exit(1);
    });
    break;

  case 'status': {
    (async () => {
      const running = await isBridgeRunning();
      console.log(`Bridge status: ${running ? 'CONNECTED' : 'NOT DETECTED'}`);
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

reaper-mcp is fork-and-clone: clone your fork and run one command.

Usage:
  reaper-mcp                  Start MCP server (stdio mode)
  reaper-mcp serve            Start MCP server (stdio mode)
  reaper-mcp setup            Install Lua bridge + JSFX analyzers into REAPER
  reaper-mcp setup-sidecar    Install Python sidecar for perceptual audio analysis (opt-in, ~831 MB)
  reaper-mcp init             Configure Claude Code: tool allow-list + .mcp.json (copy-free)
  reaper-mcp doctor           Check that everything is configured correctly
  reaper-mcp status           Check if Lua bridge is running in REAPER
  reaper-mcp telemetry off    Opt out of anonymous usage telemetry (also: on, status)

Quick Start (from your clone):
  ./scripts/install.sh        # build, link CLI, bridge, symlink skills + knowledge, configure
  # then load mcp_bridge.lua in REAPER (Actions > Load ReaScript > Run)

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
