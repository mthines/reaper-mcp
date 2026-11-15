#!/usr/bin/env node
/**
 * Emit the artifacts derived from `libs/feature-flags/src/registry.ts`, the single hand-authored
 * source of truth for every flag:
 *
 *   1. `src/generated/flags.generated.ts`: a `FlagKey` union, per-key value types and `FLAG_KEYS`,
 *      so `evaluateFlag('typo', …)` is a compile error instead of a runtime FLAG_NOT_FOUND.
 *   2. `generated/flags.manifest.json`: a plain, language-neutral manifest of every field the schema
 *      validates, for any consumer that cannot import TypeScript.
 *
 * The registry is TypeScript, so it is bundled with esbuild (already a dev dependency) into one
 * self-contained module and imported from there: no loader, no flags, any Node the repo supports.
 * An invalid registry throws here (the schema runs at import time), so the generator also fails on it.
 *
 * Usage:
 *   node scripts/gen-feature-flags.mjs           # write the artifacts
 *   node scripts/gen-feature-flags.mjs --check   # exit 1 when they are stale
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const registryPath = join(repoRoot, 'libs/feature-flags/src/registry.ts');

/** Bundle and import the registry module. */
export async function loadRegistry(entry = registryPath) {
  const out = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'silent',
  });
  const code = out.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

const TS_BANNER = `// GENERATED — do not edit.
// Source: libs/feature-flags/src/registry.ts
// Regenerate: node scripts/gen-feature-flags.mjs
//
// Edit the registry, not this file. \`--check\` fails CI when the two disagree.
`;

const TS_TYPE_FOR = { boolean: 'boolean', string: 'string', number: 'number', object: 'JsonValue' };

const JSON_VALUE_TS = `/** A JSON value, mirroring \`schema.ts\`'s \`JsonValue\`, re-declared to keep this file import-free. */
export type JsonValue = boolean | string | number | null | JsonValue[] | { [key: string]: JsonValue };`;

export function renderFlagsTs({ FLAG_REGISTRY }) {
  const keys = FLAG_REGISTRY.map((f) => f.key);
  const usesObjectType = FLAG_REGISTRY.some((f) => f.type === 'object');
  const keyUnion = keys.length ? '\n' + keys.map((k) => `  | '${k}'`).join('\n') : ' never';
  const valueMap = keys.length
    ? '\n' + FLAG_REGISTRY.map((f) => `  '${f.key}': ${TS_TYPE_FOR[f.type]};`).join('\n') + '\n'
    : '';
  const keysArray = keys.length ? `[\n${keys.map((k) => `  '${k}',`).join('\n')}\n]` : '[]';

  return `${TS_BANNER}
${usesObjectType ? JSON_VALUE_TS + '\n\n' : ''}/** Every declared flag key. */
export type FlagKey =${keyUnion};

/** Flag key -> its evaluated value type. */
${keys.length ? `export interface FlagValueMap {${valueMap}}` : 'export type FlagValueMap = Record<never, never>;'}

/** The value type \`evaluateFlag(key, …)\` resolves to for a given key. */
export type FlagValue<K extends FlagKey> = FlagValueMap[K];

/** Every declared flag key, in registry order, for runtime iteration. */
export const FLAG_KEYS: readonly FlagKey[] = ${keysArray};
`;
}

export function renderManifestJson({ FLAG_REGISTRY }) {
  const manifest = {
    generatedFrom: 'libs/feature-flags/src/registry.ts',
    flags: FLAG_REGISTRY.map((f) => ({
      key: f.key,
      description: f.description,
      type: f.type,
      variants: f.variants,
      defaultVariant: f.defaultVariant,
      experiment: f.experiment ?? null,
      owner: f.owner,
      tags: f.tags,
    })),
  };
  return JSON.stringify(manifest, null, 2) + '\n';
}

export const GENERATED_TARGETS = [
  { path: 'libs/feature-flags/src/generated/flags.generated.ts', render: renderFlagsTs },
  { path: 'libs/feature-flags/generated/flags.manifest.json', render: renderManifestJson },
];

async function main() {
  const check = process.argv.includes('--check');
  const registry = await loadRegistry();
  const stale = [];

  for (const target of GENERATED_TARGETS) {
    const to = join(repoRoot, target.path);
    const expected = target.render(registry);
    if (check) {
      if (!existsSync(to) || readFileSync(to, 'utf8') !== expected) stale.push(target.path);
      continue;
    }
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, expected);
  }

  if (check && stale.length) {
    console.error(`Generated feature-flag artifacts are stale:\n  ${stale.join('\n  ')}\nRun: node scripts/gen-feature-flags.mjs`);
    process.exit(1);
  }
  console.log(check ? `Feature-flag artifacts are in sync (${GENERATED_TARGETS.length} files).` : `Generated ${GENERATED_TARGETS.length} feature-flag artifact(s).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
