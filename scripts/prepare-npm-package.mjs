#!/usr/bin/env node
// Assemble the npm package in dist/apps/reaper-mcp-server from a finished build.
//
//   node scripts/prepare-npm-package.mjs [version]
//
// `nx run-many --target=build` leaves main.js, reaper/, sidecar/ and package.json there, and the
// status page in dist/apps/bridge-ui. The package also needs the status page as a sibling
// `bridge-ui/` (where `reaper-mcp setup` looks for it), plus LICENSE and the npm README
// (apps/reaper-mcp-server/NPM_README.md, written for people who install without git).
// Every required file is checked up front and the script names the missing ones, so a layout
// change fails here with a readable message instead of in the middle of `npm publish`.

import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const pkgDir = join(root, 'dist', 'apps', 'reaper-mcp-server');
const uiBuild = join(root, 'dist', 'apps', 'bridge-ui');

const copies = [
  // npm's page: the root README is the clone tour (relative images, git clone steps)
  [join(root, 'apps', 'reaper-mcp-server', 'NPM_README.md'), join(pkgDir, 'README.md')],
  [join(root, 'LICENSE'), join(pkgDir, 'LICENSE')],
  [uiBuild, join(pkgDir, 'bridge-ui')],
];
const required = [
  join(pkgDir, 'main.js'),
  join(pkgDir, 'package.json'),
  join(pkgDir, 'reaper', 'mcp_bridge.lua'),
  join(pkgDir, 'sidecar', 'server.py'),
  join(uiBuild, 'mcp_bridge.html'),
  join(root, 'apps', 'reaper-mcp-server', 'NPM_README.md'),
  join(root, 'LICENSE'),
];

const missing = required.filter((p) => !existsSync(p));
if (missing.length) {
  console.error('Cannot assemble the npm package; missing (run `pnpm nx run-many --target=build` first):');
  for (const p of missing) console.error(`  ${p.replace(root + '/', '')}`);
  process.exit(1);
}

for (const [from, to] of copies) cpSync(from, to, { recursive: true });

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
console.log(`Prepared @mthines/reaper-mcp@${pkg.version} in ${pkgDir.replace(root + '/', '')}`);
