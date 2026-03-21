#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { ensureBridgeDir, isBridgeRunning, cleanupStaleFiles, getReaperScriptsPath, getReaperEffectsPath } from './bridge.js';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { resolveAssetDir, copyDirSync, installFile, createMcpJson, REAPER_ASSETS } from './cli.js';

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

  const effectsDir = getReaperEffectsPath();
  mkdirSync(effectsDir, { recursive: true });

  console.log('\nInstalling JSFX analyzers...');
  for (const jsfx of REAPER_ASSETS) {
    if (jsfx === 'mcp_bridge.lua') continue;
    const src = join(reaperDir, jsfx);
    const dest = join(effectsDir, jsfx);
    if (installFile(src, dest)) {
      console.log(`  Installed: ${jsfx}`);
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

async function installSkills(): Promise<void> {
  console.log('REAPER MCP — Install AI Mix Engineer Skills\n');

  const targetDir = process.cwd();
  const globalClaudeDir = join(homedir(), '.claude');

  const knowledgeSrc = resolveAssetDir(__dirname, 'knowledge');
  const knowledgeDest = join(targetDir, 'knowledge');
  if (existsSync(knowledgeSrc)) {
    const count = copyDirSync(knowledgeSrc, knowledgeDest);
    console.log(`Installed knowledge base: ${count} files → ${knowledgeDest}`);
  } else {
    console.log('Knowledge base not found in package. Skipping.');
  }

  const rulesSrc = resolveAssetDir(__dirname, 'claude-rules');
  const rulesDir = join(targetDir, '.claude', 'rules');
  if (existsSync(rulesSrc)) {
    const count = copyDirSync(rulesSrc, rulesDir);
    console.log(`Installed Claude rules: ${count} files → ${rulesDir}`);
  } else {
    console.log('Claude rules not found in package. Skipping.');
  }

  const skillsSrc = resolveAssetDir(__dirname, 'claude-skills');
  const skillsDir = join(targetDir, '.claude', 'skills');
  if (existsSync(skillsSrc)) {
    const count = copyDirSync(skillsSrc, skillsDir);
    console.log(`Installed Claude skills: ${count} files → ${skillsDir}`);
  } else {
    console.log('Claude skills not found in package. Skipping.');
  }

  const agentsSrc = resolveAssetDir(__dirname, 'claude-agents');

  // Install agents to project-local .claude/agents/
  const agentsDir = join(targetDir, '.claude', 'agents');
  if (existsSync(agentsSrc)) {
    const count = copyDirSync(agentsSrc, agentsDir);
    console.log(`Installed Claude agents: ${count} files → ${agentsDir}`);
  } else {
    console.log('Claude agents not found in package. Skipping.');
  }

  // Also install agents globally to ~/.claude/agents/ so they work from any directory
  const globalAgentsDir = join(globalClaudeDir, 'agents');
  if (existsSync(agentsSrc)) {
    const count = copyDirSync(agentsSrc, globalAgentsDir);
    console.log(`Installed Claude agents (global): ${count} files → ${globalAgentsDir}`);
  }

  const mcpJsonPath = join(targetDir, '.mcp.json');
  if (createMcpJson(mcpJsonPath)) {
    console.log(`\nCreated: ${mcpJsonPath}`);
  } else {
    console.log(`\n.mcp.json already exists — add the reaper server config manually if needed.`);
  }

  console.log('\nDone! Claude Code now has mix engineer agents, knowledge, and REAPER MCP tools.');
  console.log('Try: @mix-engineer "Please gain stage my tracks"');
  console.log('Or:  @mix-analyzer "Roast my mix"');
}

async function doctor(): Promise<void> {
  console.log('REAPER MCP — System Check\n');

  const bridgeRunning = await isBridgeRunning();
  console.log(`Lua bridge:    ${bridgeRunning ? '✓ Connected' : '✗ Not detected'}`);
  if (!bridgeRunning) {
    console.log('  → Run "npx @mthines/reaper-mcp setup" then load mcp_bridge.lua in REAPER');
  }

  const agentsExist = existsSync(join(process.cwd(), '.claude', 'agents'));
  console.log(`Mix agents:    ${agentsExist ? '✓ Found (.claude/agents/)' : '✗ Not installed'}`);
  if (!agentsExist) {
    console.log('  → Run "npx @mthines/reaper-mcp install-skills" in your project directory');
  }

  const knowledgeExists = existsSync(join(process.cwd(), 'knowledge'));
  console.log(`Knowledge base: ${knowledgeExists ? '✓ Found in project' : '✗ Not installed'}`);
  if (!knowledgeExists) {
    console.log('  → Run "npx @mthines/reaper-mcp install-skills" in your project directory');
  }

  const mcpJsonExists = existsSync(join(process.cwd(), '.mcp.json'));
  console.log(`MCP config:    ${mcpJsonExists ? '✓ .mcp.json found' : '✗ .mcp.json missing'}`);
  if (!mcpJsonExists) {
    console.log('  → Run "npx @mthines/reaper-mcp install-skills" to create .mcp.json');
  }

  console.log('\nTo check SWS Extensions, start REAPER and use the "list_available_fx" tool.');
  console.log('SWS provides enhanced plugin discovery and snapshot support.\n');

  process.exit(bridgeRunning && knowledgeExists && mcpJsonExists ? 0 : 1);
}

async function serve(): Promise<void> {
  const log = (...args: unknown[]) => console.error('[reaper-mcp]', ...args);

  log('Starting REAPER MCP Server...');
  log(`Entry: ${fileURLToPath(import.meta.url)}`);

  await ensureBridgeDir();

  const cleaned = await cleanupStaleFiles();
  if (cleaned > 0) {
    log(`Cleaned up ${cleaned} stale bridge files`);
  }

  const bridgeRunning = await isBridgeRunning();
  if (!bridgeRunning) {
    log('WARNING: Lua bridge does not appear to be running in REAPER.');
    log('Commands will timeout until the bridge script is started.');
    log('Run "npx @mthines/reaper-mcp setup" for installation instructions.');
  } else {
    log('Lua bridge detected — connected to REAPER');
  }

  const server = createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
  log('MCP server connected via stdio');
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
    installSkills().catch((err) => {
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
  npx @mthines/reaper-mcp install-skills   Install AI mix engineer knowledge + agents into your project
  npx @mthines/reaper-mcp doctor           Check that everything is configured correctly
  npx @mthines/reaper-mcp status           Check if Lua bridge is running in REAPER

Quick Start:
  1. npx @mthines/reaper-mcp setup            # install REAPER components
  2. Load mcp_bridge.lua in REAPER (Actions > Load ReaScript > Run)
  3. npx @mthines/reaper-mcp install-skills   # install AI knowledge + agents
  4. Open Claude Code — REAPER tools + mix engineer agents are ready

Tip: install globally for shorter commands:
  npm install -g @mthines/reaper-mcp
  reaper-mcp setup
`);
    break;
}

process.on('SIGINT', () => {
  console.error('[reaper-mcp] Interrupted');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('[reaper-mcp] Terminated');
  process.exit(0);
});
