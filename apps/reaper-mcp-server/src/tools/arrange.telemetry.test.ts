/**
 * What an arrangement edit reports to OpenTelemetry: the size of the edit on the
 * tool's span and on `reaper.arrange.items_changed`, observed through in-memory
 * exporters with the bridge response stubbed.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { metrics as otelMetrics } from '@opentelemetry/api';
import { metrics, node, tracing } from '@opentelemetry/sdk-node';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('../bridge.js', async (importOriginal) => ({ ...(await importOriginal<object>()), sendCommand: vi.fn() }));

import { sendCommand } from '../bridge.js';
import { instrumentToolHandlers } from '../server.js';
import { registerArrangeTools } from './arrange.js';

const spans = new tracing.InMemorySpanExporter();
const metricExporter = new metrics.InMemoryMetricExporter(metrics.AggregationTemporality.DELTA);
const reader = new metrics.PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 60_000 });

type Handler = (args: Record<string, unknown>, extra: unknown) => Promise<{ isError?: boolean }>;

function tools(): Record<string, Handler> {
  const registered: Record<string, Handler> = {};
  const server = { tool: (...args: unknown[]) => { registered[args[0] as string] = args[args.length - 1] as Handler; } };
  instrumentToolHandlers(server as unknown as McpServer);
  registerArrangeTools(server as unknown as McpServer);
  return registered;
}

function bridgeAnswers(data: unknown, success = true): void {
  vi.mocked(sendCommand).mockResolvedValue(
    success ? { id: 't', success, data, timestamp: 0 } : { id: 't', success, error: String(data), timestamp: 0 },
  );
}

/** Data points of the items-changed histogram since the last read: [sum, attributes]. */
async function itemsChanged(): Promise<[number, Record<string, unknown>][]> {
  await reader.forceFlush();
  const out: [number, Record<string, unknown>][] = [];
  for (const rm of metricExporter.getMetrics()) {
    for (const sm of rm.scopeMetrics) {
      for (const m of sm.metrics) {
        if (m.descriptor.name !== 'reaper.arrange.items_changed') continue;
        for (const dp of m.dataPoints) out.push([(dp.value as { sum: number }).sum, dp.attributes]);
      }
    }
  }
  metricExporter.reset();
  return out;
}

describe('arrange telemetry', () => {
  beforeAll(() => {
    // register() also installs the async context manager, as NodeSDK does in production,
    // so the tool's span is the active span inside its handler
    new node.NodeTracerProvider({ spanProcessors: [new tracing.SimpleSpanProcessor(spans)] }).register();
    otelMetrics.setGlobalMeterProvider(new metrics.MeterProvider({ readers: [reader] }));
  });

  beforeEach(async () => {
    spans.reset();
    await itemsChanged();
  });

  it('puts the size of a remove_time edit on its span and the items-changed metric', async () => {
    bridgeAnswers({ start: 8, end: 12, itemsDeleted: 2, itemsTrimmed: 1, itemsMoved: 5, markersMoved: 3 });

    await tools()['remove_time']({ start: 8, end: 12 }, { requestId: 1 });

    const [span] = spans.getFinishedSpans();
    expect(span.name).toBe('tools/call remove_time');
    expect(span.attributes).toMatchObject({
      'reaper.arrange.operation': 'remove',
      'reaper.arrange.items_changed': 8,
      'reaper.arrange.length_s': 4,
    });
    expect(await itemsChanged()).toEqual([[8, { 'gen_ai.tool.name': 'remove_time', 'reaper.arrange.operation': 'remove' }]]);
  });

  it('counts the items an inserting copy_section moved as well as the ones it copied', async () => {
    bridgeAnswers({ start: 0, end: 8, length: 8, itemCount: 4, inserted: { itemsMoved: 6, itemsSplit: 1 } });

    await tools()['copy_section']({ regionIndex: 0, position: 32, insert: true }, { requestId: 2 });

    expect(spans.getFinishedSpans()[0].attributes).toMatchObject({ 'reaper.arrange.items_changed': 11, 'reaper.arrange.length_s': 8 });
  });

  it('labels process_items by its operation, a bounded value', async () => {
    bridgeAnswers({ operation: 'glue', items: [{ trackIndex: 0, itemIndex: 0 }] });

    await tools()['process_items']({ operation: 'glue', items: [{ trackIndex: 0, itemIndex: 0 }, { trackIndex: 0, itemIndex: 1 }] }, { requestId: 3 });

    expect(await itemsChanged()).toEqual([[2, { 'gen_ai.tool.name': 'process_items', 'reaper.arrange.operation': 'glue' }]]);
  });

  it('records no edit size for a refused edit, which stays a tool_error on the span', async () => {
    bridgeAnswers('end must be after start — nothing changed', false);

    const res = await tools()['insert_time']({ position: 4, length: 2 }, { requestId: 4 });

    expect(res.isError).toBe(true);
    const [span] = spans.getFinishedSpans();
    expect(span.attributes['error.type']).toBe('tool_error');
    expect(span.attributes['reaper.arrange.items_changed']).toBeUndefined();
    expect(await itemsChanged()).toEqual([]);
  });
});
