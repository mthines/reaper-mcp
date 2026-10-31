import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './server.js';

// Every tool count the docs state equals the tools the server actually registers
const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const doc = (path: string) => readFileSync(join(root, path), 'utf-8');

describe('documented tool count', () => {
  const registered = Object.keys((createServer() as unknown as { _registeredTools: Record<string, unknown> })._registeredTools).length;

  it('the server registers tools', () => {
    expect(registered).toBeGreaterThan(100);
  });

  it.each([
    ['CLAUDE.md', /## MCP Tools \((\d+) total\)/],
    ['CLAUDE.md', /avoids loading all (\d+) schemas/],
    ['docs/REFERENCE.md', /MCP server \((\d+) tools/],
  ])('%s says %s with the registered count', (path, pattern) => {
    const m = doc(path).match(pattern);
    expect(m, `${pattern} not found in ${path}`).not.toBeNull();
    expect(Number(m?.[1])).toBe(registered);
  });
});
