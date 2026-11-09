#!/usr/bin/env node
// Assemble the npm package in dist/apps/reaper-mcp-server from a finished build.
//
//   node scripts/prepare-npm-package.mjs [version]
//
// `nx run-many --target=build` leaves main.js, reaper/, sidecar/ and package.json there, and the
// status page in dist/apps/bridge-ui. The package also needs the status page as a sibling
// `bridge-ui/` (where `reaper-mcp setup` looks for it), plus LICENSE and the npm README: the
// root README with its install section swapped for apps/reaper-mcp-server/NPM_INSTALL.md and
// its relative images and links made absolute (apps/reaper-mcp-server/src/npm-readme.mjs).
// Every required file is checked up front and the script names the missing ones, so a layout
// change fails here with a readable message instead of in the middle of `npm publish`.

import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNpmReadme } from '../apps/reaper-mcp-server/src/npm-readme.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const pkgDir = join(root, 'dist', 'apps', 'reaper-mcp-server');
const uiBuild = join(root, 'dist', 'apps', 'bridge-ui');

const copies = [
  [join(root, 'LICENSE'), join(pkgDir, 'LICENSE')],
  [uiBuild, join(pkgDir, 'bridge-ui')],
];
const required = [
  join(pkgDir, 'main.js'),
  join(pkgDir, 'package.json'),
  join(pkgDir, 'reaper', 'mcp_bridge.lua'),
  join(pkgDir, 'sidecar', 'server.py'),
  join(uiBuild, 'mcp_bridge.html'),
  join(root, 'README.md'),
  join(root, 'apps', 'reaper-mcp-server', 'NPM_INSTALL.md'),
  join(root, 'LICENSE'),
];

const missing = required.filter((p) => !existsSync(p));
if (missing.length) {
  console.error('Cannot assemble the npm package; missing (run `pnpm nx run-many --target=build` first):');
  for (const p of missing) console.error(`  ${p.replace(root + '/', '')}`);
  process.exit(1);
}

for (const [from, to] of copies) cpSync(from, to, { recursive: true });

// Maintainer skills (a .repo-only marker, e.g. changelog-highlight) work inside the repo only: leave them out
const skillsDir = join(pkgDir, 'claude', 'skills');
if (existsSync(skillsDir)) {
  for (const name of readdirSync(skillsDir)) {
    if (existsSync(join(skillsDir, name, '.repo-only'))) rmSync(join(skillsDir, name), { recursive: true, force: true });
  }
}

const pkgPath = join(pkgDir, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const version = process.argv[2];
if (version) {
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    console.error(`Not a version: ${version}`);
    process.exit(1);
  }
  pkg.version = version;
}
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// Links point at the release's tag, so a page never shows files from a later commit
writeFileSync(
  join(pkgDir, 'README.md'),
  buildNpmReadme(
    readFileSync(join(root, 'README.md'), 'utf-8'),
    readFileSync(join(root, 'apps', 'reaper-mcp-server', 'NPM_INSTALL.md'), 'utf-8'),
    { repo: 'mthines/reaper-mcp', ref: version ? `v${pkg.version}` : 'main' },
  ),
);
console.log(`Prepared @mthines/reaper-mcp@${pkg.version} in ${pkgDir.replace(root + '/', '')}`);
