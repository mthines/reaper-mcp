#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { ensureBridgeDir, isBridgeRunning, cleanupStaleFiles, getReaperScriptsPath, getReaperEffectsPath } from './bridge.js';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function setup(): Promise<void> {
  console.log('REAPER MCP Server — Setup\n');

  // Ensure bridge data directory exists
  const bridgeDir = await ensureBridgeDir();
  console.log(`Bridge directory: ${bridgeDir}`);

  // Copy Lua bridge script
  const scriptsDir = getReaperScriptsPath();
  mkdirSync(scriptsDir, { recursive: true });

  const luaSrc = join(__dirname, '..', 'reaper', 'mcp_bridge.lua');
  const luaDest = join(scriptsDir, 'mcp_bridge.lua');

  if (existsSync(luaSrc)) {
    copyFileSync(luaSrc, luaDest);
    console.log(`Installed: ${luaDest}`);
  } else {
    console.log(`Lua bridge source not found at ${luaSrc}`);
    console.log('You may need to manually copy reaper/mcp_bridge.lua to your REAPER Scripts folder.');
  }

  // Copy JSFX analyzer
  const effectsDir = getReaperEffectsPath();
  mkdirSync(effectsDir, { recursive: true });

  const jsfxSrc = join(__dirname, '..', 'reaper', 'mcp_analyzer.jsfx');
  const jsfxDest = join(effectsDir, 'mcp_analyzer.jsfx');

  if (existsSync(jsfxSrc)) {
    copyFileSync(jsfxSrc, jsfxDest);
    console.log(`Installed: ${jsfxDest}`);
  } else {
    console.log(`JSFX analyzer source not found at ${jsfxSrc}`);
    console.log('You may need to manually copy reaper/mcp_analyzer.jsfx to your REAPER Effects folder.');
  }

  console.log('\nSetup complete!');
  console.log('\nNext steps:');
  console.log('  1. Open REAPER');
  console.log('  2. Actions > Show action list > Load ReaScript');
  console.log(`  3. Select: ${luaDest}`);
  console.log('  4. Run the script (it will keep running in background via defer loop)');
  console.log('  5. Start the MCP server: reaper-mcp serve');
}

async function serve(): Promise<void> {
  // Log to stderr so stdout stays clean for JSON-RPC
  const log = (...args: unknown[]) => console.error('[reaper-mcp]', ...args);

  log('Starting REAPER MCP Server...');

  // Ensure bridge directory exists
  await ensureBridgeDir();

  // Cleanup stale files from previous sessions
  const cleaned = await cleanupStaleFiles();
  if (cleaned > 0) {
    log(`Cleaned up ${cleaned} stale bridge files`);
  }

  // Check if bridge is running
  const bridgeRunning = await isBridgeRunning();
  if (!bridgeRunning) {
    log('WARNING: Lua bridge does not appear to be running in REAPER.');
    log('Commands will timeout until the bridge script is started.');
    log('Run "reaper-mcp setup" for installation instructions.');
  } else {
    log('Lua bridge detected — connected to REAPER');
  }

  // Create and connect MCP server
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

  case 'serve':
  case undefined:
    // Default to serve mode (for MCP client integration)
    serve().catch((err) => {
      console.error('[reaper-mcp] Fatal error:', err);
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

  default:
    console.log(`reaper-mcp — MCP server for REAPER DAW

Usage:
  reaper-mcp              Start MCP server (stdio mode)
  reaper-mcp serve        Start MCP server (stdio mode)
  reaper-mcp setup        Install Lua bridge and JSFX analyzer into REAPER
  reaper-mcp status       Check if Lua bridge is running in REAPER
`);
    break;
}

// Handle signals
process.on('SIGINT', () => {
  console.error('[reaper-mcp] Interrupted');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('[reaper-mcp] Terminated');
  process.exit(0);
});
