import { describe, it, expect } from 'vitest';
import { classifySpec, installAttributes, installMethod, installPin, npxRoot, type InstallContext } from './install-info.js';

const mac = (dir: string, over: Partial<InstallContext> = {}): InstallContext => ({
  dir,
  isClone: false,
  env: {},
  execPath: '/opt/homebrew/Cellar/node/24.1.0/bin/node',
  platform: 'darwin',
  ...over,
});

const win = (dir: string, over: Partial<InstallContext> = {}): InstallContext => ({
  dir,
  isClone: false,
  env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' },
  execPath: 'C:\\Program Files\\nodejs\\node.exe',
  platform: 'win32',
  ...over,
});

const NPX_MAC = '/Users/me/.npm/_npx/3d369a4b5e871276/node_modules/@mthines/reaper-mcp';
const NPX_WIN = 'C:\\Users\\me\\AppData\\Local\\npm-cache\\_npx\\3d369a4b5e871276\\node_modules\\@mthines\\reaper-mcp';

describe('installMethod', () => {
  it.each([
    ['Homebrew', '/opt/homebrew/lib/node_modules/@mthines/reaper-mcp'],
    ['nvm', '/Users/me/.nvm/versions/node/v24.1.0/lib/node_modules/@mthines/reaper-mcp'],
    ['Volta', '/Users/me/.volta/tools/image/packages/@mthines/reaper-mcp/lib/node_modules/@mthines/reaper-mcp'],
    ['a custom prefix', '/Users/me/.npm-global/lib/node_modules/@mthines/reaper-mcp'],
  ])('tells a global npm install under %s', (_, dir) => {
    expect(installMethod(mac(dir))).toBe('npm_global');
  });

  it('tells npx by its cache folder', () => {
    expect(installMethod(mac(NPX_MAC))).toBe('npx');
    expect(installMethod(win(NPX_WIN))).toBe('npx');
  });

  it('tells a global install on Windows, under %APPDATA%\\npm or beside node itself', () => {
    expect(installMethod(win('C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@mthines\\reaper-mcp'))).toBe('npm_global');
    expect(installMethod(win('c:\\program files\\nodejs\\node_modules\\@mthines\\reaper-mcp'))).toBe('npm_global');
  });

  it('calls a clone a clone, wherever it sits', () => {
    expect(installMethod(mac('/Users/me/code/reaper-mcp/dist/apps/reaper-mcp-server', { isClone: true }))).toBe('clone');
  });

  it('calls a copy npx found in a project npx, and anything else other', () => {
    const project = '/Users/me/music-tools/node_modules/@mthines/reaper-mcp';
    expect(installMethod(mac(project, { env: { npm_command: 'exec' } }))).toBe('npx');
    expect(installMethod(mac(project))).toBe('other');
    expect(installMethod(mac('/Users/me/Library/pnpm/global/5/node_modules/.pnpm/@mthines+reaper-mcp@0.96.1/node_modules/@mthines/reaper-mcp'))).toBe('other');
  });
});

describe('npxRoot', () => {
  it('finds the cache folder that holds npx\'s package.json', () => {
    expect(npxRoot(NPX_MAC, 'darwin')).toBe('/Users/me/.npm/_npx/3d369a4b5e871276');
    expect(npxRoot(NPX_WIN, 'win32')).toBe('C:\\Users\\me\\AppData\\Local\\npm-cache\\_npx\\3d369a4b5e871276');
    expect(npxRoot('/opt/homebrew/lib/node_modules/@mthines/reaper-mcp', 'darwin')).toBeUndefined();
  });
});

describe('classifySpec', () => {
  it.each([
    ['@mthines/reaper-mcp', 'unversioned'],
    ['@mthines/reaper-mcp@latest', 'latest'],
    ['@mthines/reaper-mcp@0.85.0', 'exact'],
    ['@mthines/reaper-mcp@0.83.0-beta.118.1', 'exact'],
    ['@mthines/reaper-mcp@^0.85.0', 'range'],
    ['@mthines/reaper-mcp@~0.85', 'range'],
    ['@mthines/reaper-mcp@0.85', 'range'],
    ['@mthines/reaper-mcp@>=0.80 <1', 'range'],
    ['@mthines/reaper-mcp@beta', 'tag'],
  ])('%s is %s', (spec, pin) => {
    expect(classifySpec(spec)).toBe(pin);
  });

  it('ignores other packages, including ones whose name starts the same', () => {
    expect(classifySpec('tsx')).toBeUndefined();
    expect(classifySpec('@mthines/reaper-mcp-extras@1.0.0')).toBeUndefined();
  });
});

describe('installPin', () => {
  const npxPackage = (packages: unknown) => () => JSON.stringify({ dependencies: {}, _npx: { packages } });

  it('reads what npx was asked for from its cache folder', () => {
    const ctx = mac(NPX_MAC);
    expect(installPin(ctx, 'npx', npxPackage(['@mthines/reaper-mcp@0.85.0']))).toBe('exact');
    expect(installPin(ctx, 'npx', npxPackage(['@mthines/reaper-mcp']))).toBe('unversioned');
    expect(installPin(ctx, 'npx', npxPackage(['tsx', '@mthines/reaper-mcp@latest']))).toBe('latest');
  });

  it('reads the folder beside the package, not the package itself', () => {
    const read: string[] = [];
    installPin(mac(NPX_MAC), 'npx', (path) => {
      read.push(path);
      return '{}';
    });
    expect(read).toEqual(['/Users/me/.npm/_npx/3d369a4b5e871276/package.json']);
  });

  it('falls back to npx --package, and sends nothing when neither says', () => {
    const unreadable = () => {
      throw new Error('ENOENT');
    };
    expect(installPin(mac(NPX_MAC, { env: { npm_config_package: '@mthines/reaper-mcp@^0.90.0' } }), 'npx', unreadable)).toBe('range');
    expect(installPin(mac(NPX_MAC), 'npx', unreadable)).toBeUndefined();
  });

  it('is none for every install that stays on its release until someone updates it', () => {
    expect(installPin(mac('/opt/homebrew/lib/node_modules/@mthines/reaper-mcp'), 'npm_global')).toBe('none');
    expect(installPin(mac('/Users/me/code/reaper-mcp', { isClone: true }), 'clone')).toBe('none');
  });
});

describe('installAttributes', () => {
  it('sends the method always and the rest only when known', () => {
    expect(installAttributes({ method: 'npm_global', pin: 'none', updateAvailable: true, via: 'bridge_page' })).toEqual({
      'reaper.install.method': 'npm_global',
      'reaper.install.pin': 'none',
      'reaper.update.available': true,
      'reaper.update.via': 'bridge_page',
    });
    expect(installAttributes({ method: 'npx' })).toEqual({ 'reaper.install.method': 'npx' });
  });

  it('never carries a path or the spec', () => {
    const values = Object.values(installAttributes({ method: 'npx', pin: 'exact', updateAvailable: false }));
    expect(values.some((v) => typeof v === 'string' && /[/\\@]/.test(v))).toBe(false);
  });
});
