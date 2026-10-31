/**
 * What the mixing tools report to OpenTelemetry: quantize_audio's timing offset before and
 * after on `reaper.audio.quantize.offset` plus hit counts on its span, and freeze / pins /
 * modulation attributes on theirs, observed through in-memory exporters with the bridge
 * and sidecar stubbed.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { metrics as otelMetrics } from '@opentelemetry/api';
import { metrics, node, tracing } from '@opentelemetry/sdk-node';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('../bridge.js', async (importOriginal) => ({ ...(await importOriginal<object>()), sendCommand: vi.fn() }));
vi.mock('../sidecar.js', () => ({ getSidecarClient: vi.fn() }));

import { sendCommand } from '../bridge.js';
import { getSidecarClient } from '../sidecar.js';
import { instrumentToolHandlers } from '../server.js';
import { registerMixingTools } from './mixing.js';

const spans = new tracing.InMemorySpanExporter();
const metricExporter = new metrics.InMemoryMetricExporter(metrics.AggregationTemporality.DELTA);
const reader = new metrics.PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 60_000 });

type Handler = (args: Record<string, unknown>, extra: unknown) => Promise<{ isError?: boolean }>;

function tools(): Record<string, Handler> {
  const registered: Record<string, Handler> = {};
  const server = { tool: (...args: unknown[]) => { registered[args[0] as string] = args[args.length - 1] as Handler; } };
  instrumentToolHandlers(server as unknown as McpServer);
  registerMixingTools(server as unknown as McpServer);
  return registered;
}

function bridgeAnswers(byType: Record<string, unknown>): void {
  vi.mocked(sendCommand).mockImplementation(async (type) => ({ id: 't', success: true, data: byType[type] ?? {}, timestamp: 0 }));
}

async function offsets(): Promise<[number, Record<string, unknown>][]> {
  await reader.forceFlush();
  const out: [number, Record<string, unknown>][] = [];
  for (const rm of metricExporter.getMetrics()) {
    for (const sm of rm.scopeMetrics) {
      for (const m of sm.metrics) {
        if (m.descriptor.name !== 'reaper.audio.quantize.offset') continue;
        for (const dp of m.dataPoints) out.push([(dp.value as { sum: number }).sum, dp.attributes]);
      }
    }
  }
  metricExporter.reset();
  return out;
}

const toolSpan = (name: string) => spans.getFinishedSpans().find((s) => s.attributes['gen_ai.tool.name'] === name);

describe('mixing telemetry', () => {
  beforeAll(() => {
    new node.NodeTracerProvider({ spanProcessors: [new tracing.SimpleSpanProcessor(spans)] }).register();
    otelMetrics.setGlobalMeterProvider(new metrics.MeterProvider({ readers: [reader] }));
  });

  beforeEach(async () => {
    spans.reset();
    await offsets();
    vi.mocked(getSidecarClient).mockReturnValue({
      isAvailable: () => true,
      transients: async () => ({ transients: [{ time: 0.52, strength: 1 }, { time: 1.03, strength: 1 }] }),
    } as unknown as ReturnType<typeof getSidecarClient>);
  });

  it('records the timing offset before and after a quantize, and the hit counts on its span', async () => {
    bridgeAnswers({
      get_media_item_properties: { isMidi: false, sourceFile: '/a.wav', startOffset: 0, playRate: 1, length: 4 },
      quantize_audio: { placed: 2, moved: 2, skipped: 0, offsetBefore: { avgMs: 25, maxMs: 30 }, offsetAfter: { avgMs: 2, maxMs: 3 } },
    });
    await tools()['quantize_audio']({ trackIndex: 0, itemIndex: 0, grid: 0.5 }, {});
    const points = await offsets();
    expect(points.find(([, a]) => a['reaper.quantize.stage'] === 'before')?.[0]).toBeCloseTo(0.025);
    expect(points.find(([, a]) => a['reaper.quantize.stage'] === 'after')?.[0]).toBeCloseTo(0.002);
    const span = toolSpan('quantize_audio');
    expect(span?.attributes['reaper.quantize.hits']).toBe(2);
    expect(span?.attributes['reaper.quantize.moved']).toBe(2);
  });

  it('records nothing on the offset histogram when the bridge refuses the quantize', async () => {
    vi.mocked(sendCommand).mockImplementation(async (type) => (type === 'get_media_item_properties'
      ? { id: 't', success: true, data: { sourceFile: '/a.wav', length: 4 }, timestamp: 0 }
      : { id: 't', success: false, error: 'grid must be > 0', timestamp: 0 }));
    const res = await tools()['quantize_audio']({ trackIndex: 0, itemIndex: 0, grid: 0.5 }, {});
    expect(res.isError).toBe(true);
    expect(await offsets()).toEqual([]);
  });

  it('puts the freeze mode and track count, the pin widening and the modulation kind on the spans', async () => {
    bridgeAnswers({ freeze_tracks: { tracks: [] }, set_fx_pins: { trackChannels: 4, trackChannelsBefore: 2 }, set_fx_param_modulation: {} });
    const t = tools();
    await t['freeze_tracks']({ tracks: ['Synth', 'Pad'], mode: 'mono' }, {});
    await t['set_fx_pins']({ trackIndex: 0, fxIndex: 0, inputs: [[3]] }, {});
    await t['set_fx_param_modulation']({ trackIndex: 0, fxIndex: 0, paramIndex: 1, lfo: { shape: 'sine' }, link: { fxIndex: 1, paramIndex: 0 } }, {});
    expect(toolSpan('freeze_tracks')?.attributes['reaper.freeze.mode']).toBe('mono');
    expect(toolSpan('freeze_tracks')?.attributes['reaper.freeze.track_count']).toBe(2);
    expect(toolSpan('set_fx_pins')?.attributes['reaper.fx.pins.widened']).toBe(true);
    expect(toolSpan('set_fx_param_modulation')?.attributes['reaper.fx.modulation.kind']).toBe('lfo,link');
  });
});
