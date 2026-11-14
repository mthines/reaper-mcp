import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const generator = path.join(repoRoot, 'scripts/gen-feature-flags.mjs');

function run(args: string[]): string {
  return execFileSync('node', [generator, ...args], { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' });
}

describe('gen-feature-flags', () => {
  it('reports the committed artifacts as in sync', () => {
    expect(run(['--check'])).toMatch(/in sync/);
  });

  it('fails the check when a generated file has drifted', () => {
    const file = path.join(repoRoot, 'libs/feature-flags/generated/flags.manifest.json');
    const original = readFileSync(file, 'utf8');
    try {
      writeFileSync(file, original.replace('"flags"', '"flagz"'));
      expect(() => run(['--check'])).toThrow(/stale/);
    } finally {
      writeFileSync(file, original);
    }
  });

  it('fails when the registry is invalid', async () => {
    // A throwaway registry outside the source tree (a lint run scanning src/ must never see it)
    const dir = mkdtempSync(path.join(tmpdir(), 'bad-registry-'));
    try {
      const schema = path.join(repoRoot, 'libs/feature-flags/src/schema.ts');
      writeFileSync(
        path.join(dir, 'registry.ts'),
        `import { parseRegistry } from ${JSON.stringify(schema)};\nexport const FLAG_REGISTRY = parseRegistry([{ key: 'Bad', description: 'x', type: 'boolean', variants: { a: true }, defaultVariant: 'a', owner: 'o' }]);\n`,
      );
      const mod = await import(/* @vite-ignore */ generator);
      await expect(mod.loadRegistry(path.join(dir, 'registry.ts'))).rejects.toThrow(/kebab-case/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
