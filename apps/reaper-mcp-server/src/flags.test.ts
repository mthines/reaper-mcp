import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trace } from '@opentelemetry/api';
import { node, tracing } from '@opentelemetry/sdk-node';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { parseRegistry } from '@reaper-mcp/feature-flags';
import { createServerFlags, flagsCommand, readFlagOverrides, type FlagsCommandIO } from './flags.js';
import { instrumentToolHandlers } from './server.js';
import { AnonymizingSpanExporter } from './telemetry-consent.js';

const registry = parseRegistry([
  {
    key: 'new-panel',
    description: 'fixture',
    type: 'boolean',
    variants: { off: false, on: true },
    defaultVariant: 'off',
    owner: 'tests',
    experiment: { enabled: true, variants: [{ key: 'off', weight: 50 }, { key: 'on', weight: 50 }] },
  },
  {
    key: 'static-panel',
    description: 'fixture',
    type: 'string',
    variants: { a: 'A', b: 'B' },
    defaultVariant: 'a',
    owner: 'tests',
  },
]);

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'reaper-mcp-flags-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function capture(): { io: FlagsCommandIO; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { log: (l) => out.push(l), error: (l) => err.push(l) }, out, err };
}

describe('reaper-mcp flags', () => {
  it('set writes flags.json, list shows it with reason override, reset clears it', () => {
    const run = (...args: string[]) => {
      const c = capture();
      const code = flagsCommand(args, { registry, dir, env: {}, installId: () => 'install-1', io: c.io, domain: 'cli-test' });
      return { code, ...c };
    };

    expect(run('set', 'new-panel', 'on').code).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, 'flags.json'), 'utf-8'))).toEqual({ 'new-panel': 'on' });

    const listed = run('list');
    expect(listed.out.join('\n')).toMatch(/new-panel {2}on {2}reason=override/);
    expect(listed.out.join('\n')).toMatch(/static-panel {2}a {2}reason=static/);

    expect(run('reset', 'new-panel').code).toBe(0);
    expect(run('list').out.join('\n')).toMatch(/new-panel {2}\w+ {2}reason=split/);
    expect(JSON.parse(readFileSync(join(dir, 'flags.json'), 'utf-8'))).toEqual({});
  });

  it('reset without a key clears every override', () => {
    writeFileSync(join(dir, 'flags.json'), '{"new-panel":"on","static-panel":"b"}');
    const c = capture();
    flagsCommand(['reset'], { registry, dir, env: {}, io: c.io });
    expect(readFileSync(join(dir, 'flags.json'), 'utf-8').trim()).toBe('{}');
  });

  it('refuses an unknown flag or variant and leaves flags.json untouched', () => {
    const unknownFlag = capture();
    const unknownVariant = capture();
    expect(flagsCommand(['set', 'nope', 'on'], { registry, dir, env: {}, io: unknownFlag.io })).toBe(1);
    expect(flagsCommand(['set', 'new-panel', 'maybe'], { registry, dir, env: {}, io: unknownVariant.io })).toBe(1);
    expect(unknownFlag.err.join('')).toMatch(/Unknown flag "nope"/);
    expect(unknownVariant.err.join('')).toMatch(/not a variant/);
    expect(() => readFileSync(join(dir, 'flags.json'), 'utf-8')).toThrow();
  });

  it('says so when no flags are declared', () => {
    const c = capture();
    expect(flagsCommand(['list'], { registry: [], dir, env: {}, io: c.io })).toBe(0);
    expect(c.out).toEqual(['No feature flags are declared.']);
  });

  it('does not bake REAPER_MCP_FLAGS into flags.json', () => {
    const c = capture();
    flagsCommand(['set', 'static-panel', 'b'], { registry, dir, env: { REAPER_MCP_FLAGS: '{"new-panel":"on"}' }, io: c.io });
    expect(JSON.parse(readFileSync(join(dir, 'flags.json'), 'utf-8'))).toEqual({ 'static-panel': 'b' });
  });
});

describe('readFlagOverrides', () => {
  it('layers the env over the file and drops anything that names no real flag or variant', () => {
    writeFileSync(join(dir, 'flags.json'), '{"new-panel":"on","gone":"x","static-panel":"zzz"}');
    expect(readFlagOverrides(dir, { REAPER_MCP_FLAGS: '{"new-panel":"off"}' }, registry)).toEqual({ 'new-panel': 'off' });
  });

  it('is empty when the file is missing or not JSON', () => {
    expect(readFlagOverrides(dir, {}, registry)).toEqual({});
    writeFileSync(join(dir, 'flags.json'), 'not json');
    expect(readFlagOverrides(dir, {}, registry)).toEqual({});
  });
});

describe('createServerFlags', () => {
  it('buckets an experiment by the install id: the same install always gets the same arm', async () => {
    const flags = createServerFlags({ registry, dir, env: {}, installId: () => 'install-42', domain: 'ctx-test' });
    const first = await flags.details('new-panel');
    expect(first.reason).toBe('SPLIT');
    expect((await flags.details('new-panel')).variant).toBe(first.variant);
    expect(flags.context().targetingKey).toBe('install-42');
  });

  it('spreads different installs across both arms', async () => {
    const arms = new Set<string | undefined>();
    for (let i = 0; i < 60; i++) {
      const flags = createServerFlags({ registry, dir, env: {}, installId: () => `install-${i}`, domain: 'spread-test' });
      arms.add((await flags.details('new-panel')).variant);
    }
    expect(arms).toEqual(new Set(['off', 'on']));
  });

  it('keeps an experiment on its default when the install has no id', async () => {
    const flags = createServerFlags({ registry, dir, env: {}, installId: () => undefined, domain: 'noid-test' });
    expect((await flags.details('new-panel')).reason).toBe('STATIC');
  });

  it('lets the owner override win over the split', async () => {
    writeFileSync(join(dir, 'flags.json'), '{"new-panel":"on"}');
    const flags = createServerFlags({ registry, dir, env: {}, installId: () => 'install-1', domain: 'ovr-test' });
    expect(await flags.details('new-panel')).toMatchObject({ value: true, reason: 'OVERRIDE' });
  });
});

describe('a tool call that evaluates a flag', () => {
  const memory = new tracing.InMemorySpanExporter();
  const provider = new node.NodeTracerProvider({
    spanProcessors: [new tracing.SimpleSpanProcessor(new AnonymizingSpanExporter(memory))],
  });
  beforeAll(() => provider.register());
  afterAll(() => provider.shutdown());
  beforeEach(() => memory.reset());

  it('carries the flag key, provider, variant and reason on its span through usage telemetry, and no install id', async () => {
    writeFileSync(join(dir, 'flags.json'), '{"new-panel":"on"}');
    const flags = createServerFlags({ registry, dir, env: {}, installId: () => 'install-private-id', domain: 'span-test' });
    let registered: ((...a: unknown[]) => Promise<unknown>) | undefined;
    const server = { tool: (...args: unknown[]) => { registered = args[args.length - 1] as typeof registered; } };
    instrumentToolHandlers(server as unknown as McpServer);
    server.tool('demo_tool', 'desc', {}, async () => {
      await flags.details('new-panel');
      return { content: [{ type: 'text', text: 'ok' }] };
    });

    await registered!({}, { requestId: 1 });

    const span = memory.getFinishedSpans().find((s) => s.name === 'tools/call demo_tool');
    expect(span?.attributes).toMatchObject({
      'feature_flag.key': 'new-panel',
      'feature_flag.provider.name': 'reaper-mcp-flags',
      'feature_flag.result.variant': 'on',
      'feature_flag.result.reason': 'override',
    });
    expect(JSON.stringify(span?.attributes)).not.toContain('install-private-id');
    expect(trace.getActiveSpan()).toBeUndefined();
  });
});
