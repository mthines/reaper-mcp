#!/usr/bin/env node

import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { ensureBridgeDir, isBridgeRunning, cleanupStaleFiles, getReaperScriptsPath, getReaperEffectsPath, startDiagnosticsPoller, startEventsPoller, stopPollers } from './bridge.js';
import { initTelemetry, shutdownTelemetry, getTracer, registerBridgeGauges } from './telemetry.js';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { resolveAssetDir, resolveAssetDirWithFallback, copyDirSync, installFile, createMcpJson, ensureClaudeSettings, REAPER_ASSETS, MCP_TOOL_NAMES } from './cli.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function setup(): Promise<void> {
  console.log('REAPER MCP Server — Setup\n');

  const bridgeDir = await ensureBridgeDir();
  console.log(`Bridge directory: ${bridgeDir}\n`);

  const scriptsDir = getReaperScriptsPath();
  mkdirSync(scriptsDir, { recursive: true });

  const reaperDir = resolveAssetDir(__dirname, 'reaper');
  const luaSrc = join(reaperDir, 'mcp_bridge.lua');
  const luaDest = join(scriptsDir, 'mcp_bridge.lua');
  console.log('Installing Lua bridge...');
  if (installFile(luaSrc, luaDest)) {
    console.log(`  Installed: mcp_bridge.lua`);
  } else {
    console.log(`  Not found: ${luaSrc}`);
  }

  const effectsDir = join(getReaperEffectsPath(), 'reaper-mcp');
  mkdirSync(effectsDir, { recursive: true });

  console.log('\nInstalling JSFX analyzers...');
  for (const jsfx of REAPER_ASSETS) {
    if (jsfx === 'mcp_bridge.lua') continue;
    const src = join(reaperDir, jsfx);
    const dest = join(effectsDir, jsfx);
    if (installFile(src, dest)) {
      console.log(`  Installed: reaper-mcp/${jsfx}`);
    } else {
      console.log(`  Not found: ${src}`);
    }
  }

  console.log('\nSetup complete!\n');
  console.log('Next steps:');
  console.log('  1. Open REAPER');
  console.log('  2. Actions > Show action list > Load ReaScript');
  console.log(`  3. Select: ${luaDest}`);
  console.log('  4. Run the script (it will keep running in background via defer loop)');
  console.log('  5. Add reaper-mcp to your Claude Code config (see: npx @mthines/reaper-mcp doctor)');
}

type InstallScope = 'project' | 'global';

function parseInstallScope(args: string[]): InstallScope {
  if (args.includes('--project')) return 'project';
  return 'global';
}

async function installSkills(scope: InstallScope): Promise<void> {
  console.log(`REAPER MCP — Install AI Mix Engineer Skills (scope: ${scope})\n`);

  const isGlobal = scope === 'global';
  const baseDir = isGlobal ? join(homedir(), '.claude') : process.cwd();
  const claudeDir = isGlobal ? baseDir : join(baseDir, '.claude');

  // --- Knowledge base ---
  const knowledgeSrc = resolveAssetDir(__dirname, 'knowledge');
  if (existsSync(knowledgeSrc)) {
    const dest = join(baseDir, 'knowledge');
    const count = copyDirSync(knowledgeSrc, dest);
    console.log(`Installed knowledge base: ${count} files → ${dest}`);
  } else {
    console.log('Knowledge base not found in package. Skipping.');
  }

  // --- Claude rules ---
  // Build output uses 'claude-rules'; source tree uses '.claude/rules'
  const rulesSrc = resolveAssetDirWithFallback(__dirname, 'claude-rules', join('.claude', 'rules'));
  if (existsSync(rulesSrc)) {
    const dest = join(claudeDir, 'rules');
    const count = copyDirSync(rulesSrc, dest);
    console.log(`Installed Claude rules: ${count} files → ${dest}`);
  } else {
    console.log('Claude rules not found in package. Skipping.');
  }

  // --- Claude skills ---
  const skillsSrc = resolveAssetDirWithFallback(__dirname, 'claude-skills', join('.claude', 'skills'));
  if (existsSync(skillsSrc)) {
    const dest = join(claudeDir, 'skills');
    const count = copyDirSync(skillsSrc, dest);
    console.log(`Installed Claude skills: ${count} files → ${dest}`);
  } else {
    console.log('Claude skills not found in package. Skipping.');
  }

  // --- Claude agents ---
  const agentsSrc = resolveAssetDirWithFallback(__dirname, 'claude-agents', join('.claude', 'agents'));
  if (existsSync(agentsSrc)) {
    const dest = join(claudeDir, 'agents');
    const count = copyDirSync(agentsSrc, dest);
    console.log(`Installed Claude agents: ${count} files → ${dest}`);
  } else {
    console.log('Claude agents not found in package. Skipping.');
  }

  // --- Claude settings (REAPER tool permissions) ---
  const settingsPath = join(claudeDir, 'settings.json');
  const result = ensureClaudeSettings(settingsPath);
  if (result === 'created') {
    console.log(`Created Claude settings: ${settingsPath}`);
  } else if (result === 'updated') {
    console.log(`Updated Claude settings with new REAPER tools: ${settingsPath}`);
  } else {
    console.log(`Claude settings already has all REAPER tools: ${settingsPath}`);
  }

  // --- .mcp.json (project-local only) ---
  if (!isGlobal) {
    const mcpJsonPath = join(baseDir, '.mcp.json');
    if (createMcpJson(mcpJsonPath)) {
      console.log(`\nCreated: ${mcpJsonPath}`);
    } else {
      console.log(`\n.mcp.json already exists — add the reaper server config manually if needed.`);
    }
  }

  console.log('\nDone! Claude Code now has mix engineer agents, knowledge, and REAPER MCP tools.');
  console.log(`All ${MCP_TOOL_NAMES.length} REAPER tools are pre-approved — agents work autonomously.`);
  console.log('\nTry: @mix-engineer "Please gain stage my tracks"');
  console.log('Or:  @mix-analyzer "Roast my mix"');
}

async function doctor(): Promise<void> {
  console.log('REAPER MCP — System Check\n');

  const bridgeRunning = await isBridgeRunning();
  console.log(`Lua bridge:    ${bridgeRunning ? '✓ Connected' : '✗ Not detected'}`);
  if (!bridgeRunning) {
    console.log('  → Run "npx @mthines/reaper-mcp setup" then load mcp_bridge.lua in REAPER');
  }

  const globalClaudeDir = join(homedir(), '.claude');
  const localAgents = existsSync(join(process.cwd(), '.claude', 'agents'));
  const globalAgents = existsSync(join(globalClaudeDir, 'agents'));
  const agentsExist = localAgents || globalAgents;
  const agentsLocation = localAgents ? '.claude/agents/' : globalAgents ? '~/.claude/agents/' : '';
  console.log(`Mix agents:    ${agentsExist ? `✓ Found (${agentsLocation})` : '✗ Not installed'}`);
  if (!agentsExist) {
    console.log('  → Run "npx @mthines/reaper-mcp install-skills"');
  }

  const localKnowledge = existsSync(join(process.cwd(), 'knowledge'));
  const globalKnowledge = existsSync(join(globalClaudeDir, 'knowledge'));
  const knowledgeExists = localKnowledge || globalKnowledge;
  const knowledgeLocation = localKnowledge ? 'project' : globalKnowledge ? '~/.claude/' : '';
  console.log(`Knowledge base: ${knowledgeExists ? `✓ Found (${knowledgeLocation})` : '✗ Not installed'}`);
  if (!knowledgeExists) {
    console.log('  → Run "npx @mthines/reaper-mcp install-skills"');
  }

  const mcpJsonExists = existsSync(join(process.cwd(), '.mcp.json'));
  console.log(`MCP config:    ${mcpJsonExists ? '✓ .mcp.json found' : '✗ .mcp.json missing'}`);
  if (!mcpJsonExists) {
    console.log('  → Run "npx @mthines/reaper-mcp install-skills --project" to create .mcp.json');
  }

  console.log('\nTo check SWS Extensions, start REAPER and use the "list_available_fx" tool.');
  console.log('SWS provides enhanced plugin discovery and snapshot support.\n');

  process.exit(bridgeRunning && knowledgeExists && mcpJsonExists ? 0 : 1);
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
          log('Run "npx @mthines/reaper-mcp setup" for installation instructions.');
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
  case 'setup':
    setup().catch((err) => {
      console.error('Setup failed:', err);
      process.exit(1);
    });
    break;

  case 'install-skills':
    installSkills(parseInstallScope(process.argv.slice(3))).catch((err) => {
      console.error('Install failed:', err);
      process.exit(1);
    });
    break;

  case 'doctor':
    doctor().catch((err) => {
      console.error('Doctor failed:', err);
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

Usage:
  npx @mthines/reaper-mcp                  Start MCP server (stdio mode)
  npx @mthines/reaper-mcp serve            Start MCP server (stdio mode)
  npx @mthines/reaper-mcp setup            Install Lua bridge + JSFX analyzers into REAPER
  npx @mthines/reaper-mcp install-skills   Install AI knowledge + agents globally (default)
  npx @mthines/reaper-mcp install-skills --project  Install into current project directory
  npx @mthines/reaper-mcp install-skills --global   Install into ~/.claude/ (default)
  npx @mthines/reaper-mcp doctor           Check that everything is configured correctly
  npx @mthines/reaper-mcp status           Check if Lua bridge is running in REAPER

Quick Start:
  1. npx @mthines/reaper-mcp setup            # install REAPER components
  2. Load mcp_bridge.lua in REAPER (Actions > Load ReaScript > Run)
  3. npx @mthines/reaper-mcp install-skills   # install AI knowledge + agents (globally)
  4. Open Claude Code — REAPER tools + mix engineer agents are ready

Tip: install globally for shorter commands:
  npm install -g @mthines/reaper-mcp
  reaper-mcp setup
`);
    break;
}

// ---------------------------------------------------------------------------
// Graceful shutdown — flush telemetry before the process exits
// ---------------------------------------------------------------------------

process.on('SIGINT', () => {
  console.error('[reaper-mcp] Interrupted');
  stopPollers();
  shutdownTelemetry().finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
  console.error('[reaper-mcp] Terminated');
  stopPollers();
  shutdownTelemetry().finally(() => process.exit(0));
});

process.on('uncaughtException', (err) => {
  console.error('[reaper-mcp] Uncaught exception:', err);
  stopPollers();
  shutdownTelemetry().finally(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  console.error('[reaper-mcp] Unhandled rejection:', reason);
  stopPollers();
  shutdownTelemetry().finally(() => process.exit(1));
});
