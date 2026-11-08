/**
 * What sendCommand reports to OpenTelemetry, observed end to end: a real temp
 * bridge directory, a tiny fake bridge answering command files, and in-memory
 * span/metric exporters. Bridge plumbing (the diagnostics poller, the session
 * heartbeat, the bridge page's tool log) stays out of usage telemetry, the way
 * the bridge status page hides it; internal commands a tool runs are traced.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { metrics as otelMetrics, trace, SpanStatusCode } from '@opentelemetry/api';
import { metrics, node, tracing } from '@opentelemetry/sdk-node';
import type { CommandType } from '@reaper-mcp/protocol';
import { sendCommand, pollBridgeDiagnostics } from './bridge.js';

const spans = new tracing.InMemorySpanExporter();
const metricExporter = new metrics.InMemoryMetricExporter(metrics.AggregationTemporality.CUMULATIVE);
const reader = new metrics.PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 60_000 });

let root: string;
let bridgeDir: string;
let responder: ReturnType<typeof setInterval>;
let received: string[];

/** Answer every command file like the Lua bridge does, recording its type. */
function startFakeBridge(): void {
  let busy = false; // ticks must not overlap, or two could answer the same command
  responder = setInterval(async () => {
    if (busy) return;
    busy = true;
    for (const file of await readdir(bridgeDir).catch(() => [] as string[])) {
      if (!file.startsWith('command_')) continue;
      const path = join(bridgeDir, file);
      const cmd = JSON.parse(await readFile(path, 'utf8').catch(() => 'null')) as { id: string; type: string } | null;
      if (!cmd) continue;
      await rm(path, { force: true });
      received.push(cmd.type);
      const data = cmd.type === '_bridge_diagnostics'
        ? { deferIntervals: { p50Ms: 30, p95Ms: 33 }, scanDurations: { avgMs: 0.1, maxMs: 0.4 } }
        : {};
      await writeFile(join(bridgeDir, `response_${cmd.id}.json`), JSON.stringify({ id: cmd.id, success: true, data, _handlerMs: 0.2, _pickupMs: 3 }));
    }
    busy = false;
  }, 2);
}

/** rpc.method values recorded on the per-command duration metrics. */
async function meteredMethods(): Promise<string[]> {
  await reader.forceFlush();
  const methods = new Set<string>();
  for (const rm of metricExporter.getMetrics()) {
    for (const sm of rm.scopeMetrics) {
      for (const m of sm.metrics) {
        if (!m.descriptor.name.startsWith('reaper.bridge.')) continue;
        for (const dp of m.dataPoints) {
          const method = dp.attributes['rpc.method'];
          if (typeof method === 'string') methods.add(method);
        }
      }
    }
  }
  return [...methods];
}

describe('bridge telemetry', () => {
  beforeAll(() => {
    // register() installs the async context manager, so a tool span parents the bridge span
    new node.NodeTracerProvider({ spanProcessors: [new tracing.SimpleSpanProcessor(spans)] }).register();
    otelMetrics.setGlobalMeterProvider(new metrics.MeterProvider({ readers: [reader] }));
  });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'reaper-mcp-telemetry-'));
    bridgeDir = join(root, 'Scripts', 'mcp_bridge_data');
    await mkdir(bridgeDir, { recursive: true });
    await writeFile(join(bridgeDir, 'heartbeat.json'), '{}');
    process.env['REAPER_RESOURCE_PATH'] = root;
    received = [];
    spans.reset();
    startFakeBridge();
  });

  afterEach(async () => {
    vi.useRealTimers();
    clearInterval(responder);
    delete process.env['REAPER_RESOURCE_PATH'];
    await rm(root, { recursive: true, force: true });
  });

  it('traces and meters a tool command', async () => {
    const res = await sendCommand('get_project_info');

    expect(res.success).toBe(true);
    expect(spans.getFinishedSpans().map((s) => s.name)).toEqual(['reaper.Bridge/get_project_info']);
    expect(await meteredMethods()).toContain('get_project_info');
  });

  it('keeps the diagnostics poll out of traces and per-command metrics, but still polls', async () => {
    await pollBridgeDiagnostics();

    expect(received).toEqual(['_bridge_diagnostics']);
    expect(spans.getFinishedSpans()).toEqual([]);
    expect(await meteredMethods()).not.toContain('_bridge_diagnostics');
  });

  it('keeps the session heartbeat and the bridge page\'s tool log out of traces and per-command metrics', async () => {
    const results = [await sendCommand('_session' as CommandType), await sendCommand('_log_result' as CommandType)];

    expect(results.every((r) => r.success)).toBe(true);
    expect(received).toEqual(['_session', '_log_result']);
    expect(spans.getFinishedSpans()).toEqual([]);
    const metered = await meteredMethods();
    expect(metered).not.toContain('_session');
    expect(metered).not.toContain('_log_result');
  });

  it('reports a command refused because the bridge never started, with the bridge state, and sends nothing', async () => {
    // Earlier tests' answers are long past: an answer within the last minute counts as REAPER being up
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 10 * 60_000 });
    await rm(join(bridgeDir, 'heartbeat.json'));
    await writeFile(join(root, 'Scripts', 'mcp_bridge.lua'), '-- installed by reaper-mcp setup');

    const res = await sendCommand('get_project_info');

    expect(res.success).toBe(false);
    expect(received).toEqual([]);
    const [span] = spans.getFinishedSpans();
    expect(span?.name).toBe('reaper.Bridge/get_project_info');
    expect(span?.attributes).toMatchObject({ 'error.type': 'bridge_not_running', 'reaper.bridge.state': 'never_started' });
    // Not a bug in the bridge: the status stays unset, like a refused request
    expect(span?.status.code).toBe(SpanStatusCode.UNSET);
  });

  it.each(['_chord_grid', '_item_range', '_midi_pitch_profile'])(
    'traces and meters %s, an internal command a tool runs, under the tool\'s span',
    async (command) => {
      await trace.getTracer('test').startActiveSpan('tools/call detect_chords', async (tool) => {
        await sendCommand(command as CommandType);
        tool.end();
      });

      const finished = spans.getFinishedSpans();
      const tool = finished.find((s) => s.name === 'tools/call detect_chords');
      const bridge = finished.find((s) => s.name === `reaper.Bridge/${command}`);
      expect(bridge?.parentSpanContext?.spanId).toBe(tool?.spanContext().spanId);
      expect(await meteredMethods()).toContain(command);
    },
  );
});
