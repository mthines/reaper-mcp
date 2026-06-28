#!/usr/bin/env node

import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { ensureBridgeDir, isBridgeRunning, cleanupStaleFiles, getReaperScriptsPath, getReaperEffectsPath, startDiagnosticsPoller, startEventsPoller, stopPollers } from './bridge.js';
import { initTelemetry, shutdownTelemetry, getTracer, registerBridgeGauges } from './telemetry.js';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, platform } from 'node:os';
import { exec as execCb } from 'node:child_process';
import { promisify as promisifyUtil } from 'node:util';
import { resolveAssetDir, installFile, createMcpJson, ensureClaudeSettings, REAPER_ASSETS, MCP_TOOL_NAMES } from './cli.js';
import { setupSidecar } from './setup-sidecar.js';
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
  for (const luaFile of ['mcp_bridge.lua', 'mcp_snapshot_manager.lua']) {
    const src = join(reaperDir, luaFile);
    const dest = join(scriptsDir, luaFile);
    if (installFile(src, dest)) {
      console.log(`  Installed: ${luaFile}`);
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

  console.log('\nSetup complete!\n');
  console.log('Next steps:');
  console.log('  1. Open REAPER');
  console.log('  2. Actions > Show action list > Load ReaScript');
  console.log(`  3. Select: ${join(scriptsDir, 'mcp_bridge.lua')}`);
  console.log('  4. Run the script (it will keep running in background via defer loop)');
  console.log('  5. Add reaper-mcp to your Claude Code config (see: reaper-mcp doctor)');
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

  console.log('\nIf you haven\'t yet, symlink the skills + knowledge and install the bridge:');
  console.log('  scripts/sync-symlinks.sh   # mix skills + knowledge → ~/.claude');
  console.log('  reaper-mcp setup           # Lua bridge + JSFX → REAPER');
  console.log('then load mcp_bridge.lua in REAPER.');
  console.log('\nTry: /mixer "Please gain stage my tracks"  ·  /critique "Roast my mix"');
}

async function doctor(): Promise<void> {
  console.log('REAPER MCP — System Check\n');

  const bridgeRunning = await isBridgeRunning();
  console.log(`Lua bridge:    ${bridgeRunning ? '✓ Connected' : '✗ Not detected'}`);
  if (!bridgeRunning) {
    console.log('  → Run "reaper-mcp setup" then load mcp_bridge.lua in REAPER');
  }

  const globalClaudeDir = join(homedir(), '.claude');
  const localSkills = existsSync(join(process.cwd(), '.claude', 'skills', 'mixer.md'));
  const globalSkills = existsSync(join(globalClaudeDir, 'skills', 'mixer.md'));
  const skillsExist = localSkills || globalSkills;
  const skillsLocation = localSkills ? '.claude/skills/' : globalSkills ? '~/.claude/skills/' : '';
  console.log(`Mix skills:    ${skillsExist ? `✓ Found (${skillsLocation})` : '✗ Not linked'}`);
  if (!skillsExist) {
    console.log('  → Run "scripts/sync-symlinks.sh" from your clone');
  }

  const globalKnowledge = existsSync(join(globalClaudeDir, 'knowledge'));
  const knowledgeLinked = existsSync(join(process.cwd(), 'knowledge')) || globalKnowledge;
  const knowledgeLocation = globalKnowledge ? '~/.claude/knowledge' : 'repo';
  console.log(`Knowledge base: ${knowledgeLinked ? `✓ Found (${knowledgeLocation})` : '✗ Not linked'}`);
  if (!knowledgeLinked) {
    console.log('  → Run "scripts/sync-symlinks.sh" from your clone');
  }

  const mcpJsonExists = existsSync(join(process.cwd(), '.mcp.json'));
  console.log(`MCP config:    ${mcpJsonExists ? '✓ .mcp.json found' : '✗ .mcp.json missing'}`);
  if (!mcpJsonExists) {
    console.log('  → Run "reaper-mcp init" to create .mcp.json');
  }

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
  registerBridgeGauges();
  startDiagnosticsPoller();
  startEventsPoller();
  log('Starting REAPER MCP Server...');
  log(`Entry: ${fileURLToPath(import.meta.url)}`);

  const tracer = getTracer();

  // Root span wrapping the entire startup sequence — an early touchpoint for
  // validating the OTel pipeline.  This is a headless process (no inbound HTTP)
  // so we create the root span manually.
  await tracer.startActiveSpan('mcp.server.startup', { kind: SpanKind.INTERNAL }, async (startupSpan) => {
    try {
      await ensureBridgeDir();

      const cleaned = await cleanupStaleFiles();
      if (cleaned > 0) {
        startupSpan.setAttribute('mcp.bridge.stale_files_cleaned', cleaned);
        log(`Cleaned up ${cleaned} stale bridge files`);
      }

      // Check bridge connectivity in a child span
      const bridgeRunning = await tracer.startActiveSpan('mcp.bridge.connect', { kind: SpanKind.INTERNAL }, async (bridgeSpan) => {
        const running = await isBridgeRunning();
        bridgeSpan.setAttribute('mcp.bridge.connected', running);
        if (!running) {
          bridgeSpan.setStatus({
            code: SpanStatusCode.UNSET,
            message: 'Lua bridge not detected — commands will timeout until started',
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

      startupSpan.setAttribute('mcp.bridge.connected', bridgeRunning);

      const server = createServer();
      const transport = new StdioServerTransport();

      await server.connect(transport);
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

process.on('SIGINT', () => {
  console.error('[reaper-mcp] Interrupted');
  shutdownAll();
  shutdownTelemetry().finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
  console.error('[reaper-mcp] Terminated');
  shutdownAll();
  shutdownTelemetry().finally(() => process.exit(0));
});

process.on('uncaughtException', (err) => {
  console.error('[reaper-mcp] Uncaught exception:', err);
  shutdownAll();
  shutdownTelemetry().finally(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  console.error('[reaper-mcp] Unhandled rejection:', reason);
  shutdownAll();
  shutdownTelemetry().finally(() => process.exit(1));
});
