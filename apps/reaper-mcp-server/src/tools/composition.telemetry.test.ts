/**
 * What composition edits report to OpenTelemetry: the edit size on the tool's span and on
 * `reaper.midi.notes_changed`, and detect_key's source and confidence on its span, observed
 * through in-memory exporters with the bridge stubbed.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { metrics as otelMetrics } from '@opentelemetry/api';
import { metrics, node, tracing } from '@opentelemetry/sdk-node';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('../bridge.js', async (importOriginal) => ({ ...(await importOriginal<object>()), sendCommand: vi.fn() }));

import { sendCommand } from '../bridge.js';
import { instrumentToolHandlers } from '../server.js';
import { registerCompositionTools } from './composition.js';

const spans = new tracing.InMemorySpanExporter();
const metricExporter = new metrics.InMemoryMetricExporter(metrics.AggregationTemporality.DELTA);
const reader = new metrics.PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 60_000 });

type Handler = (args: Record<string, unknown>, extra: unknown) => Promise<{ isError?: boolean }>;

function tools(): Record<string, Handler> {
  const registered: Record<string, Handler> = {};
  const server = { tool: (...args: unknown[]) => { registered[args[0] as string] = args[args.length - 1] as Handler; } };
  instrumentToolHandlers(server as unknown as McpServer);
  registerCompositionTools(server as unknown as McpServer);
  return registered;
}

function bridgeAnswers(byType: Record<string, unknown>, failing?: string): void {
  vi.mocked(sendCommand).mockImplementation(async (type) => (failing
    ? { id: 't', success: false, error: failing, timestamp: 0 }
    : { id: 't', success: true, data: byType[type] ?? {}, timestamp: 0 }));
}

async function notesChanged(): Promise<[number, Record<string, unknown>][]> {
  await reader.forceFlush();
  const out: [number, Record<string, unknown>][] = [];
  for (const rm of metricExporter.getMetrics()) {
    for (const sm of rm.scopeMetrics) {
      for (const m of sm.metrics) {
        if (m.descriptor.name !== 'reaper.midi.notes_changed') continue;
        for (const dp of m.dataPoints) out.push([(dp.value as { sum: number }).sum, dp.attributes]);
      }
    }
  }
  metricExporter.reset();
  return out;
}

describe('composition telemetry', () => {
  beforeAll(() => {
    new node.NodeTracerProvider({ spanProcessors: [new tracing.SimpleSpanProcessor(spans)] }).register();
    otelMetrics.setGlobalMeterProvider(new metrics.MeterProvider({ readers: [reader] }));
  });

  beforeEach(async () => {
    spans.reset();
    await notesChanged();
  });

  it('records the notes a quantize moved on its span and the notes-changed metric', async () => {
    bridgeAnswers({ quantize_midi: { notes: 64, moved: 37 } });
    await tools()['quantize_midi']({ trackIndex: 0, itemIndex: 0, grid: 0.25 }, { requestId: 1 });
    expect(spans.getFinishedSpans()[0].attributes['reaper.midi.notes_changed']).toBe(37);
    expect(await notesChanged()).toEqual([[37, { 'gen_ai.tool.name': 'quantize_midi' }]]);
  });

  it('records nothing for a refused transform, which stays a tool_error', async () => {
    bridgeAnswers({}, 'transpose must be a whole number — nothing changed');
    const res = await tools()['transform_midi']({ trackIndex: 0, itemIndex: 0, transpose: 3 }, { requestId: 2 });
    expect(res.isError).toBe(true);
    const span = spans.getFinishedSpans().find((s) => s.name === 'tools/call transform_midi')!;
    expect(span.attributes['error.type']).toBe('tool_error');
    expect(span.attributes['reaper.midi.notes_changed']).toBeUndefined();
    expect(await notesChanged()).toEqual([]);
  });

  it('puts detect_key\'s source and confidence on its span', async () => {
    bridgeAnswers({ _midi_pitch_profile: { chroma: [4, 0.1, 1, 0.1, 3, 1, 0.1, 3.5, 0.1, 1, 0.1, 0.5], notes: 12, midiItems: 1, audioItems: 0 } });
    await tools()['detect_key']({ trackIndex: 0 }, { requestId: 3 });
    const span = spans.getFinishedSpans().find((s) => s.name === 'tools/call detect_key')!;
    expect(span.attributes['reaper.key.source']).toBe('midi');
    expect(span.attributes['reaper.key.confidence']).toBeGreaterThan(0);
  });
});
