#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { ensureBridgeDir, isBridgeRunning, cleanupStaleFiles, getReaperScriptsPath, getReaperEffectsPath } from './bridge.js';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Resolve asset path — checks sibling (npm published) then parent (dev build) */
function resolveAssetDir(name: string): string {
  const sibling = join(__dirname, name);
  if (existsSync(sibling)) return sibling;
  return join(__dirname, '..', name);
}

/** Recursively copy a directory */
function copyDirSync(src: string, dest: string): number {
  if (!existsSync(src)) return 0;
  mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      count += copyDirSync(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
      count++;
    }
  }
  return count;
}

/** Copy a single file, log result */
function installFile(src: string, dest: string, label: string): boolean {
  if (existsSync(src)) {
    copyFileSync(src, dest);
    console.log(`  Installed: ${label}`);
    return true;
  }
  console.log(`  Not found: ${src}`);
  return false;
}

async function setup(): Promise<void> {
  console.log('REAPER MCP Server — Setup\n');

  // Ensure bridge data directory exists
  const bridgeDir = await ensureBridgeDir();
  console.log(`Bridge directory: ${bridgeDir}\n`);

  // Copy Lua bridge script
  const scriptsDir = getReaperScriptsPath();
  mkdirSync(scriptsDir, { recursive: true });

  const reaperDir = resolveAssetDir('reaper');
  const luaSrc = join(reaperDir, 'mcp_bridge.lua');
  const luaDest = join(scriptsDir, 'mcp_bridge.lua');
  console.log('Installing Lua bridge...');
  installFile(luaSrc, luaDest, 'mcp_bridge.lua');

  // Copy ALL JSFX analyzers
  const effectsDir = getReaperEffectsPath();
  mkdirSync(effectsDir, { recursive: true });

  const jsfxFiles = [
    'mcp_analyzer.jsfx',
    'mcp_lufs_meter.jsfx',
    'mcp_correlation_meter.jsfx',
    'mcp_crest_factor.jsfx',
  ];

  console.log('\nInstalling JSFX analyzers...');
  for (const jsfx of jsfxFiles) {
    const src = join(reaperDir, jsfx);
    const dest = join(effectsDir, jsfx);
    installFile(src, dest, jsfx);
  }

  console.log('\nSetup complete!\n');
  console.log('Next steps:');
  console.log('  1. Open REAPER');
  console.log('  2. Actions > Show action list > Load ReaScript');
  console.log(`  3. Select: ${luaDest}`);
  console.log('  4. Run the script (it will keep running in background via defer loop)');
  console.log('  5. Add reaper-mcp to your Claude Code config (see: reaper-mcp doctor)');
}

async function installSkills(): Promise<void> {
  console.log('REAPER MCP — Install AI Mix Engineer Skills\n');

  const targetDir = process.cwd();

  // Copy knowledge base
  const knowledgeSrc = resolveAssetDir('knowledge');
  const knowledgeDest = join(targetDir, 'knowledge');

  if (existsSync(knowledgeSrc)) {
    const count = copyDirSync(knowledgeSrc, knowledgeDest);
    console.log(`Installed knowledge base: ${count} files → ${knowledgeDest}`);
  } else {
    console.log('Knowledge base not found in package. Skipping.');
  }

  // Copy Claude rules
  const rulesSrc = resolveAssetDir('claude-rules');
  const rulesDir = join(targetDir, '.claude', 'rules');

  if (existsSync(rulesSrc)) {
    const count = copyDirSync(rulesSrc, rulesDir);
    console.log(`Installed Claude rules: ${count} files → ${rulesDir}`);
  } else {
    console.log('Claude rules not found in package. Skipping.');
  }

  // Copy Claude skills
  const skillsSrc = resolveAssetDir('claude-skills');
  const skillsDir = join(targetDir, '.claude', 'skills');

  if (existsSync(skillsSrc)) {
    const count = copyDirSync(skillsSrc, skillsDir);
    console.log(`Installed Claude skills: ${count} files → ${skillsDir}`);
  } else {
    console.log('Claude skills not found in package. Skipping.');
  }

  // Create/update .mcp.json if it doesn't exist
  const mcpJsonPath = join(targetDir, '.mcp.json');
  if (!existsSync(mcpJsonPath)) {
    const mcpConfig = JSON.stringify({
      mcpServers: {
        reaper: {
          command: 'npx',
          args: ['@mthines/reaper-mcp', 'serve'],
        },
      },
    }, null, 2);
    copyFileSync('/dev/null', mcpJsonPath); // create empty
    const { writeFileSync } = await import('node:fs');
    writeFileSync(mcpJsonPath, mcpConfig + '\n', 'utf-8');
    console.log(`\nCreated: ${mcpJsonPath}`);
  } else {
    console.log(`\n.mcp.json already exists — add the reaper server config manually if needed.`);
  }

  console.log('\nDone! Claude Code now has mix engineer knowledge and REAPER MCP tools.');
  console.log('Try asking: "Please gain stage my tracks" or "Roast my mix"');
}

async function doctor(): Promise<void> {
  console.log('REAPER MCP — System Check\n');

  // Check bridge status
  const bridgeRunning = await isBridgeRunning();
  console.log(`Lua bridge:    ${bridgeRunning ? '✓ Connected' : '✗ Not detected'}`);
  if (!bridgeRunning) {
    console.log('  → Run "reaper-mcp setup" then load mcp_bridge.lua in REAPER');
  }

  // Check if knowledge is installed in cwd
  const knowledgeExists = existsSync(join(process.cwd(), 'knowledge'));
  console.log(`Knowledge base: ${knowledgeExists ? '✓ Found in project' : '✗ Not installed'}`);
  if (!knowledgeExists) {
    console.log('  → Run "reaper-mcp install-skills" in your project directory');
  }

  // Check if .mcp.json exists
  const mcpJsonExists = existsSync(join(process.cwd(), '.mcp.json'));
  console.log(`MCP config:    ${mcpJsonExists ? '✓ .mcp.json found' : '✗ .mcp.json missing'}`);
  if (!mcpJsonExists) {
    console.log('  → Run "reaper-mcp install-skills" to create .mcp.json');
  }

  // Check for SWS extensions (via bridge)
  console.log('\nTo check SWS Extensions, start REAPER and use the "list_available_fx" tool.');
  console.log('SWS provides enhanced plugin discovery and snapshot support.\n');

  process.exit(bridgeRunning && knowledgeExists && mcpJsonExists ? 0 : 1);
}

async function serve(): Promise<void> {
  const log = (...args: unknown[]) => console.error('[reaper-mcp]', ...args);

  log('Starting REAPER MCP Server...');

  await ensureBridgeDir();

  const cleaned = await cleanupStaleFiles();
  if (cleaned > 0) {
    log(`Cleaned up ${cleaned} stale bridge files`);
  }

  const bridgeRunning = await isBridgeRunning();
  if (!bridgeRunning) {
    log('WARNING: Lua bridge does not appear to be running in REAPER.');
    log('Commands will timeout until the bridge script is started.');
    log('Run "reaper-mcp setup" for installation instructions.');
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
  reaper-mcp                  Start MCP server (stdio mode)
  reaper-mcp serve            Start MCP server (stdio mode)
  reaper-mcp setup            Install Lua bridge + JSFX analyzers into REAPER
  reaper-mcp install-skills   Install AI mix engineer knowledge into your project
  reaper-mcp doctor           Check that everything is configured correctly
  reaper-mcp status           Check if Lua bridge is running in REAPER

Quick Start:
  1. reaper-mcp setup            # install REAPER components
  2. Load mcp_bridge.lua in REAPER (Actions > Load ReaScript > Run)
  3. reaper-mcp install-skills   # install AI knowledge in your project
  4. Open Claude Code — REAPER tools + mix engineer brain are ready
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
