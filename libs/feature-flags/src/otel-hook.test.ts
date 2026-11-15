import { trace } from '@opentelemetry/api';
import { node, tracing } from '@opentelemetry/sdk-node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFlagClient, evaluateDefinition } from './client.js';
import { parseRegistry } from './schema.js';

const registry = parseRegistry([
  {
    key: 'ramp-flag',
    description: 'fixture',
    type: 'boolean',
    variants: { off: false, on: true },
    defaultVariant: 'off',
    owner: 'tests',
    experiment: { enabled: true, variants: [{ key: 'off', weight: 50 }, { key: 'on', weight: 50 }] },
  },
]);
const def = registry[0];

const exporter = new tracing.InMemorySpanExporter();
const provider = new node.NodeTracerProvider({ spanProcessors: [new tracing.SimpleSpanProcessor(exporter)] });

// register() installs the async-hooks context manager, so trace.getActiveSpan() works inside a span
beforeAll(() => provider.register());
afterAll(() => provider.shutdown());
beforeEach(() => exporter.reset());

describe('feature flag span attributes', () => {
  it('stamps the evaluation on the active span without the targeting key', async () => {
    const client = createFlagClient(registry, 'hook-test');
    const tracer = trace.getTracer('test');

    await tracer.startActiveSpan('tools/call demo', async (span) => {
      await evaluateDefinition(client, def, { targetingKey: 'install-secret-1', flagOverrides: { 'ramp-flag': 'on' } });
      span.end();
    });

    const [span] = exporter.getFinishedSpans();
    expect(span.attributes).toMatchObject({
      'feature_flag.key': 'ramp-flag',
      'feature_flag.result.variant': 'on',
      'feature_flag.result.reason': 'override',
      'feature_flag.provider.name': 'reaper-mcp-flags',
    });
    expect(JSON.stringify(span.attributes)).not.toContain('install-secret-1');
  });

  it('lowercases the split reason for the semantic conventions', async () => {
    const client = createFlagClient(registry, 'hook-test');
    await trace.getTracer('test').startActiveSpan('tools/call demo', async (span) => {
      await evaluateDefinition(client, def, { targetingKey: 'install-1' });
      span.end();
    });
    expect(exporter.getFinishedSpans()[0].attributes['feature_flag.result.reason']).toBe('split');
  });

  it('evaluates without a span', async () => {
    const result = await evaluateDefinition(createFlagClient(registry, 'hook-test'), def, { targetingKey: 'install-1' });
    expect(['off', 'on']).toContain(result.variant);
  });
});
