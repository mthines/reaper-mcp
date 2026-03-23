import { checkbox, select } from '@inquirer/prompts';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  resolveAssetDir,
  resolveAssetDirWithFallback,
  copyDirSync,
  installFile,
  createMcpJson,
  ensureClaudeSettings,
  REAPER_ASSETS,
  MCP_TOOL_NAMES,
} from './cli.js';
import {
  ensureBridgeDir,
  isBridgeRunning,
  getReaperScriptsPath,
  getReaperEffectsPath,
} from './bridge.js';

export interface InitOptions {
  /** Skip all prompts and install everything */
  yes: boolean;
  /** Include project-local .mcp.json (only relevant with --yes) */
  project: boolean;
}

export interface InitSelections {
  bridge: boolean;
  skills: boolean;
  settings: boolean;
  projectConfig: boolean;
  skillsScope: 'global' | 'project';
}

/** Compute __dirname equivalent for ESM — passed in from main.ts to avoid import.meta issues */
export type DirResolver = () => string;

/**
 * Run the interactive init flow.
 * @param opts - CLI flags parsed from argv
 * @param dirResolver - returns the directory of the entry point (for asset resolution)
 */
export async function runInit(opts: InitOptions, dirResolver: DirResolver): Promise<void> {
  const isTTY = Boolean(process.stdin.isTTY);
  const headless = opts.yes || !isTTY;

  console.log('REAPER MCP — Interactive Setup\n');

  const bridgeDir = await ensureBridgeDir();
  console.log(`REAPER resource path: ${join(bridgeDir, '..', '..')}\n`);

  let selections: InitSelections;

  if (headless) {
    selections = {
      bridge: true,
      skills: true,
      settings: true,
      projectConfig: opts.project,
      skillsScope: 'global',
    };
    if (opts.yes) {
      console.log('Running in non-interactive mode (--yes flag).\n');
    } else {
      console.log('Non-interactive terminal detected. Running with defaults.\n');
    }
  } else {
    // Interactive prompts
    const components = await checkbox({
      message: 'Which components would you like to install?',
      choices: [
        { name: 'REAPER Bridge  (Lua bridge + JSFX analyzers)', value: 'bridge', checked: true },
        { name: `AI Skills & Agents  (knowledge base, Claude agents, rules, skills)`, value: 'skills', checked: true },
        { name: `Claude Code Settings  (auto-allow ${MCP_TOOL_NAMES.length} REAPER tools)`, value: 'settings', checked: true },
        { name: 'Project Config  (.mcp.json in current directory)', value: 'projectConfig', checked: false },
      ],
    });

    let skillsScope: 'global' | 'project' = 'global';
    if (components.includes('skills')) {
      const scopeAnswer = await select({
        message: 'Install scope for AI Skills & Agents:',
        choices: [
          { name: 'Global (~/.claude/)  — available in all projects', value: 'global' },
          { name: 'Project (.claude/)   — current directory only', value: 'project' },
        ],
      });
      skillsScope = scopeAnswer as 'global' | 'project';
    }

    selections = {
      bridge: components.includes('bridge'),
      skills: components.includes('skills'),
      settings: components.includes('settings'),
      projectConfig: components.includes('projectConfig'),
      skillsScope,
    };
  }

  const __dirname = dirResolver();

  // --- Install REAPER Bridge ---
  if (selections.bridge) {
    console.log('Installing REAPER Bridge...');

    const scriptsDir = getReaperScriptsPath();
    mkdirSync(scriptsDir, { recursive: true });

    const reaperDir = resolveAssetDir(__dirname, 'reaper');
    const luaSrc = join(reaperDir, 'mcp_bridge.lua');
    const luaDest = join(scriptsDir, 'mcp_bridge.lua');
    if (installFile(luaSrc, luaDest)) {
      console.log('  Installed: mcp_bridge.lua');
    } else {
      console.log(`  Not found: ${luaSrc}`);
    }

    const effectsDir = join(getReaperEffectsPath(), 'reaper-mcp');
    mkdirSync(effectsDir, { recursive: true });

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
    console.log('');
  }

  // --- Install AI Skills & Agents ---
  if (selections.skills) {
    const isGlobal = selections.skillsScope === 'global';
    const baseDir = isGlobal ? join(homedir(), '.claude') : process.cwd();
    const claudeDir = isGlobal ? baseDir : join(baseDir, '.claude');

    console.log(`Installing AI Skills & Agents (${selections.skillsScope})...`);

    const knowledgeSrc = resolveAssetDir(__dirname, 'knowledge');
    if (existsSync(knowledgeSrc)) {
      const dest = join(isGlobal ? join(homedir(), '.claude') : process.cwd(), 'knowledge');
      const count = copyDirSync(knowledgeSrc, dest);
      console.log(`  Installed knowledge base: ${count} files`);
    } else {
      console.log('  Knowledge base not found in package. Skipping.');
    }

    const rulesSrc = resolveAssetDirWithFallback(__dirname, 'claude-rules', join('.claude', 'rules'));
    if (existsSync(rulesSrc)) {
      const dest = join(claudeDir, 'rules');
      const count = copyDirSync(rulesSrc, dest);
      console.log(`  Installed Claude rules: ${count} files`);
    }

    const skillsSrc = resolveAssetDirWithFallback(__dirname, 'claude-skills', join('.claude', 'skills'));
    if (existsSync(skillsSrc)) {
      const dest = join(claudeDir, 'skills');
      const count = copyDirSync(skillsSrc, dest);
      console.log(`  Installed Claude skills: ${count} files`);
    }

    const agentsSrc = resolveAssetDirWithFallback(__dirname, 'claude-agents', join('.claude', 'agents'));
    if (existsSync(agentsSrc)) {
      const dest = join(claudeDir, 'agents');
      const count = copyDirSync(agentsSrc, dest);
      console.log(`  Installed Claude agents: ${count} files`);
    }

    console.log('');
  }

  // --- Claude Code Settings ---
  if (selections.settings) {
    console.log('Configuring Claude Code Settings...');
    const settingsDir = join(homedir(), '.claude');
    const settingsPath = join(settingsDir, 'settings.json');
    const result = ensureClaudeSettings(settingsPath);
    if (result === 'created') {
      console.log(`  Created: ${settingsPath}`);
    } else if (result === 'updated') {
      console.log(`  Updated with new REAPER tools: ${settingsPath}`);
    } else {
      console.log(`  Already configured: ${settingsPath}`);
    }
    console.log('');
  }

  // --- Project Config ---
  if (selections.projectConfig) {
    console.log('Creating Project Config...');
    const mcpJsonPath = join(process.cwd(), '.mcp.json');
    if (createMcpJson(mcpJsonPath)) {
      console.log(`  Created: ${mcpJsonPath}`);
    } else {
      console.log(`  Already exists: ${mcpJsonPath}`);
    }
    console.log('');
  }

  // --- Doctor checks ---
  console.log('Running system check...');
  const bridgeRunning = await isBridgeRunning();
  console.log(`  Lua bridge:    ${bridgeRunning ? 'Connected' : 'Not detected (start after REAPER is open)'}`);

  const globalClaudeDir = join(homedir(), '.claude');
  const localAgents = existsSync(join(process.cwd(), '.claude', 'agents'));
  const globalAgents = existsSync(join(globalClaudeDir, 'agents'));
  const agentsExist = localAgents || globalAgents;
  console.log(`  Mix agents:    ${agentsExist ? 'Installed' : 'Not installed'}`);

  const mcpJsonExists = existsSync(join(process.cwd(), '.mcp.json'));
  console.log(`  MCP config:    ${mcpJsonExists ? '.mcp.json found' : '.mcp.json not present'}`);
  console.log('');

  // --- Next steps ---
  console.log('Setup complete! Next steps:');
  if (selections.bridge) {
    const scriptsDir = getReaperScriptsPath();
    const luaDest = join(scriptsDir, 'mcp_bridge.lua');
    console.log('  1. Open REAPER');
    console.log('  2. Actions > Show action list > Load ReaScript');
    console.log(`  3. Select: ${luaDest}`);
    console.log('  4. Run the script (it keeps running via defer loop)');
    console.log('  5. Open Claude Code — REAPER tools + mix engineer agents are ready');
  } else {
    console.log('  1. Open Claude Code — REAPER tools + mix engineer agents are ready');
  }

  if (agentsExist) {
    console.log('\nTry: @mix-engineer "Please gain stage my tracks"');
    console.log('Or:  @mix-analyzer "Roast my mix"');
  }
}
