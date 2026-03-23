import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock @inquirer/prompts before importing init
vi.mock('@inquirer/prompts', () => ({
  checkbox: vi.fn(),
  select: vi.fn(),
}));

vi.mock('./bridge.js', () => ({
  ensureBridgeDir: vi.fn(),
  isBridgeRunning: vi.fn(),
  getReaperScriptsPath: vi.fn(),
  getReaperEffectsPath: vi.fn(),
}));

vi.mock('./cli.js', () => ({
  resolveAssetDir: vi.fn(),
  resolveAssetDirWithFallback: vi.fn(),
  installFile: vi.fn(),
  copyDirSync: vi.fn(),
  createMcpJson: vi.fn(),
  ensureClaudeSettings: vi.fn(),
  REAPER_ASSETS: ['mcp_bridge.lua', 'mcp_analyzer.jsfx', 'mcp_lufs_meter.jsfx', 'mcp_correlation_meter.jsfx', 'mcp_crest_factor.jsfx'],
  MCP_TOOL_NAMES: Array.from({ length: 78 }, (_, i) => `tool_${i}`),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
  };
});

import { checkbox, select } from '@inquirer/prompts';
import { ensureBridgeDir, isBridgeRunning, getReaperScriptsPath, getReaperEffectsPath } from './bridge.js';
import { installFile, copyDirSync, ensureClaudeSettings, createMcpJson, resolveAssetDir, resolveAssetDirWithFallback } from './cli.js';
import { existsSync } from 'node:fs';
import { runInit } from './init.js';

const mockedCheckbox = vi.mocked(checkbox);
const mockedSelect = vi.mocked(select);
const mockedEnsureBridgeDir = vi.mocked(ensureBridgeDir);
const mockedIsBridgeRunning = vi.mocked(isBridgeRunning);
const mockedGetReaperScriptsPath = vi.mocked(getReaperScriptsPath);
const mockedGetReaperEffectsPath = vi.mocked(getReaperEffectsPath);
const mockedInstallFile = vi.mocked(installFile);
const mockedCopyDirSync = vi.mocked(copyDirSync);
const mockedEnsureClaudeSettings = vi.mocked(ensureClaudeSettings);
const mockedCreateMcpJson = vi.mocked(createMcpJson);
const mockedResolveAssetDir = vi.mocked(resolveAssetDir);
const mockedResolveAssetDirWithFallback = vi.mocked(resolveAssetDirWithFallback);
const mockedExistsSync = vi.mocked(existsSync);

const fakeDir = () => '/fake/dist';
const fakeBridgeDir = '/fake/reaper/Scripts/mcp_bridge_data';

// Source asset paths that exist in the package
const FAKE_ASSET_PATHS = new Set([
  '/fake/dist/reaper',
  '/fake/dist/knowledge',
  '/fake/dist/claude-rules',
  '/fake/dist/claude-skills',
  '/fake/dist/claude-agents',
]);

beforeEach(() => {
  vi.clearAllMocks();
  mockedEnsureBridgeDir.mockResolvedValue(fakeBridgeDir);
  mockedIsBridgeRunning.mockResolvedValue(false);
  mockedGetReaperScriptsPath.mockReturnValue('/fake/reaper/Scripts');
  mockedGetReaperEffectsPath.mockReturnValue('/fake/reaper/Effects');
  mockedInstallFile.mockReturnValue(true);
  mockedCopyDirSync.mockReturnValue(5);
  mockedEnsureClaudeSettings.mockReturnValue('created');
  mockedCreateMcpJson.mockReturnValue(true);
  // resolveAssetDir returns fake source paths
  mockedResolveAssetDir.mockImplementation((_dir: string, name: string) => `/fake/dist/${name}`);
  mockedResolveAssetDirWithFallback.mockImplementation((_dir: string, buildName: string) => `/fake/dist/${buildName}`);
  // existsSync returns true for known source asset paths, false for install destinations
  mockedExistsSync.mockImplementation((p: unknown) => FAKE_ASSET_PATHS.has(String(p)));
});

describe('runInit', () => {
  describe('--yes flag (headless mode)', () => {
    it('installs bridge, skills, and settings by default (no project config)', async () => {
      await runInit({ yes: true, project: false }, fakeDir);

      // Bridge: installs lua + jsfx files
      expect(mockedInstallFile).toHaveBeenCalled();

      // Skills: copies directories
      expect(mockedCopyDirSync).toHaveBeenCalled();

      // Settings: ensures claude settings
      expect(mockedEnsureClaudeSettings).toHaveBeenCalled();

      // No project config
      expect(mockedCreateMcpJson).not.toHaveBeenCalled();
    });

    it('installs project config when --project flag is set', async () => {
      await runInit({ yes: true, project: true }, fakeDir);

      expect(mockedCreateMcpJson).toHaveBeenCalled();
    });

    it('does not call interactive prompts', async () => {
      await runInit({ yes: true, project: false }, fakeDir);

      expect(mockedCheckbox).not.toHaveBeenCalled();
      expect(mockedSelect).not.toHaveBeenCalled();
    });

    it('runs bridge check at the end', async () => {
      await runInit({ yes: true, project: false }, fakeDir);

      expect(mockedIsBridgeRunning).toHaveBeenCalled();
    });
  });

  describe('non-TTY detection', () => {
    let originalIsTTY: boolean | undefined;

    beforeEach(() => {
      originalIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    });

    afterEach(() => {
      Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
    });

    it('behaves like --yes when stdin is not a TTY', async () => {
      await runInit({ yes: false, project: false }, fakeDir);

      // Should not prompt
      expect(mockedCheckbox).not.toHaveBeenCalled();
      expect(mockedSelect).not.toHaveBeenCalled();

      // Should still install everything
      expect(mockedInstallFile).toHaveBeenCalled();
      expect(mockedEnsureClaudeSettings).toHaveBeenCalled();
    });
  });

  describe('interactive mode (TTY)', () => {
    let originalIsTTY: boolean | undefined;

    beforeEach(() => {
      originalIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    });

    afterEach(() => {
      Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
    });

    it('calls checkbox prompt for component selection', async () => {
      mockedCheckbox.mockResolvedValue(['bridge', 'skills', 'settings']);
      mockedSelect.mockResolvedValue('global');

      await runInit({ yes: false, project: false }, fakeDir);

      expect(mockedCheckbox).toHaveBeenCalledOnce();
      expect(mockedSelect).toHaveBeenCalledOnce();
    });

    it('calls select for skills scope when skills is selected', async () => {
      mockedCheckbox.mockResolvedValue(['skills']);
      mockedSelect.mockResolvedValue('global');

      await runInit({ yes: false, project: false }, fakeDir);

      expect(mockedSelect).toHaveBeenCalledOnce();
    });

    it('does not call select when skills is not selected', async () => {
      mockedCheckbox.mockResolvedValue(['bridge']);

      await runInit({ yes: false, project: false }, fakeDir);

      expect(mockedSelect).not.toHaveBeenCalled();
    });

    it('installs only bridge when bridge-only selected', async () => {
      mockedCheckbox.mockResolvedValue(['bridge']);

      await runInit({ yes: false, project: false }, fakeDir);

      expect(mockedInstallFile).toHaveBeenCalled();
      expect(mockedEnsureClaudeSettings).not.toHaveBeenCalled();
      expect(mockedCreateMcpJson).not.toHaveBeenCalled();
    });

    it('installs only settings when settings-only selected', async () => {
      mockedCheckbox.mockResolvedValue(['settings']);

      await runInit({ yes: false, project: false }, fakeDir);

      expect(mockedInstallFile).not.toHaveBeenCalled();
      expect(mockedEnsureClaudeSettings).toHaveBeenCalled();
      expect(mockedCopyDirSync).not.toHaveBeenCalled();
    });

    it('installs project config when projectConfig is selected', async () => {
      mockedCheckbox.mockResolvedValue(['projectConfig']);

      await runInit({ yes: false, project: false }, fakeDir);

      expect(mockedCreateMcpJson).toHaveBeenCalled();
    });

    it('all components selected installs everything', async () => {
      mockedCheckbox.mockResolvedValue(['bridge', 'skills', 'settings', 'projectConfig']);
      mockedSelect.mockResolvedValue('global');

      await runInit({ yes: false, project: false }, fakeDir);

      expect(mockedInstallFile).toHaveBeenCalled();
      expect(mockedCopyDirSync).toHaveBeenCalled();
      expect(mockedEnsureClaudeSettings).toHaveBeenCalled();
      expect(mockedCreateMcpJson).toHaveBeenCalled();
    });

    it('uses project scope for skills when project is selected', async () => {
      mockedCheckbox.mockResolvedValue(['skills']);
      mockedSelect.mockResolvedValue('project');

      await runInit({ yes: false, project: false }, fakeDir);

      // copyDirSync should be called (skills were selected)
      expect(mockedCopyDirSync).toHaveBeenCalled();
    });

    it('nothing selected installs nothing', async () => {
      mockedCheckbox.mockResolvedValue([]);

      await runInit({ yes: false, project: false }, fakeDir);

      expect(mockedInstallFile).not.toHaveBeenCalled();
      expect(mockedCopyDirSync).not.toHaveBeenCalled();
      expect(mockedEnsureClaudeSettings).not.toHaveBeenCalled();
      expect(mockedCreateMcpJson).not.toHaveBeenCalled();
    });
  });

  describe('bridge installation', () => {
    it('installs mcp_bridge.lua to scripts directory', async () => {
      mockedResolveAssetDir.mockReturnValue('/fake/reaper');
      mockedInstallFile.mockReturnValue(true);

      await runInit({ yes: true, project: false }, fakeDir);

      // Should install the Lua bridge file
      const calls = mockedInstallFile.mock.calls;
      const luaCall = calls.find(([src]) => String(src).includes('mcp_bridge.lua'));
      expect(luaCall).toBeDefined();
    });

    it('installs JSFX analyzers to effects directory', async () => {
      mockedResolveAssetDir.mockReturnValue('/fake/reaper');

      await runInit({ yes: true, project: false }, fakeDir);

      // Should have installed analyzer files (not the .lua)
      const calls = mockedInstallFile.mock.calls;
      const jsfxCalls = calls.filter(([src]) => String(src).includes('.jsfx'));
      expect(jsfxCalls.length).toBeGreaterThan(0);
    });
  });

  describe('settings installation', () => {
    it('calls ensureClaudeSettings with global settings path', async () => {
      const { homedir } = await import('node:os');
      const expectedPath = `${homedir()}/.claude/settings.json`;

      await runInit({ yes: true, project: false }, fakeDir);

      expect(mockedEnsureClaudeSettings).toHaveBeenCalledWith(expectedPath);
    });
  });
});
