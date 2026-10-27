/**
 * OpenTelemetry instrumentation setup for the REAPER MCP Server.
 *
 * Initializes the NodeSDK with resource attributes, then exposes helpers for
 * acquiring tracers, meters, and trace-correlation context for structured logging.
 *
 * Usage:
 *   import { initTelemetry, shutdownTelemetry } from './telemetry.js';
 *   await initTelemetry();
 *   // ...
 *   await shutdownTelemetry();
 */

import { trace, metrics, type Tracer, type Meter } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_NAMESPACE,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SERVICE_NAME = process.env['OTEL_SERVICE_NAME'] ?? 'reaper-mcp-server';
const SERVICE_NAMESPACE = 'reaper-mcp';
const DEPLOYMENT_ENV = process.env['DEPLOYMENT_ENVIRONMENT'] ?? 'development';

// Instrumentation scope name — used for all tracers/meters from this package.
const SCOPE_NAME = 'reaper-mcp-server';

// ---------------------------------------------------------------------------
// Read service version from package.json
// ---------------------------------------------------------------------------

function readServiceVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const __dirname = dirname(fileURLToPath(import.meta.url));
    // Works from both source (src/) and built output (dist/apps/reaper-mcp-server/)
    const pkgPaths = [
      join(__dirname, '..', 'package.json'),
      join(__dirname, 'package.json'),
    ];
    for (const p of pkgPaths) {
      try {
        const pkg = require(p) as { version?: string };
        if (pkg.version) return pkg.version;
      } catch {
        // try next
      }
    }
  } catch {
    // ignore
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// SDK lifecycle
// ---------------------------------------------------------------------------

let sdk: NodeSDK | null = null;

/**
 * Initialise the OpenTelemetry SDK.  Call this once, early in the process
 * lifecycle (before any instrumented code runs).
 *
 * Configuration is driven primarily by OTEL_* environment variables, which
 * makes it easy to swap exporters without code changes.
 */
export async function initTelemetry(): Promise<void> {
  if (sdk) return; // already initialised

  const serviceVersion = readServiceVersion();

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: SERVICE_NAME,
    [ATTR_SERVICE_NAMESPACE]: SERVICE_NAMESPACE,
    [ATTR_SERVICE_VERSION]: serviceVersion,
    // Each Claude Code session spawns its own server over stdio — tell them apart.
    'service.instance.id': randomUUID(),
    'deployment.environment.name': DEPLOYMENT_ENV,
  });

  // NodeSDK reads OTEL_TRACES_EXPORTER, OTEL_METRICS_EXPORTER, OTEL_LOGS_EXPORTER,
  // OTEL_EXPORTER_OTLP_ENDPOINT, and OTEL_EXPORTER_OTLP_HEADERS automatically.
  sdk = new NodeSDK({ resource });

  sdk.start();

  // Log whether telemetry is actively being exported
  const tracesExporter = process.env['OTEL_TRACES_EXPORTER'] ?? 'none';
  const metricsExporter = process.env['OTEL_METRICS_EXPORTER'] ?? 'none';
  const logsExporter = process.env['OTEL_LOGS_EXPORTER'] ?? 'none';
  const endpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];

  const hasExporter = [tracesExporter, metricsExporter, logsExporter].some(
    (e) => e !== 'none' && e !== '',
  );

  if (hasExporter) {
    const signals = [
      tracesExporter !== 'none' && `traces=${tracesExporter}`,
      metricsExporter !== 'none' && `metrics=${metricsExporter}`,
      logsExporter !== 'none' && `logs=${logsExporter}`,
    ]
      .filter(Boolean)
      .join(', ');

    console.error(`[reaper-mcp] OpenTelemetry enabled (${signals})`);
    if (endpoint) {
      console.error(`[reaper-mcp] OTLP endpoint: ${endpoint}`);
    }
  } else {
    console.error(
      '[reaper-mcp] OpenTelemetry initialized (no exporters configured — telemetry stays local)',
    );
  }
}

/**
 * Flush all pending telemetry and shut down the SDK.  Call this on process
 * exit (SIGINT, SIGTERM, uncaughtException, unhandledRejection).
 */
export async function shutdownTelemetry(): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.shutdown();
  } catch (err) {
    // Log to stderr — console.error is always safe here
    console.error('[reaper-mcp] OTel shutdown error:', err);
  } finally {
    sdk = null;
  }
}

// ---------------------------------------------------------------------------
// Tracer / Meter accessors
// ---------------------------------------------------------------------------

/**
 * Returns the named tracer for this instrumentation scope.
 * Safe to call before `initTelemetry()` — the OTel API returns a no-op tracer
 * when no SDK has been registered.
 */
export function getTracer(): Tracer {
  return trace.getTracer(SCOPE_NAME);
}

/**
 * Returns the named meter for this instrumentation scope.
 * Safe to call before `initTelemetry()` — returns a no-op meter when not
 * initialised.
 */
export function getMeter(): Meter {
  return metrics.getMeter(SCOPE_NAME);
}

// ---------------------------------------------------------------------------
// Trace-context helper for structured logging
// ---------------------------------------------------------------------------

export interface TraceContext {
  trace_id: string;
  span_id: string;
}

/**
 * Returns the current trace context (traceId + spanId) so it can be included
 * in structured log records for correlation.
 *
 * Returns empty strings when there is no active span.
 */
export function getTraceContext(): TraceContext {
  const span = trace.getActiveSpan();
  if (!span) return { trace_id: '', span_id: '' };
  const ctx = span.spanContext();
  return { trace_id: ctx.traceId, span_id: ctx.spanId };
}

// ---------------------------------------------------------------------------
// Structured logging (stderr + OTLP log records)
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const SEVERITY: Record<LogLevel, SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

export interface LogOptions {
  /** OTel event name; set only when the record has a fixed attribute shape. */
  eventName?: string;
  /** Override the record time — for bridge events Lua wrote before the poller read them. */
  timestampMs?: number;
}

/**
 * Emit a structured log: a JSON line on stderr (as before) plus an OTel log
 * record, exported when OTEL_LOGS_EXPORTER is set and a no-op otherwise. The
 * active span context is attached automatically, so records correlate with
 * the tool and bridge spans.
 */
export function emitLog(
  level: LogLevel,
  body: string,
  attributes: Record<string, unknown> = {},
  options: LogOptions = {},
): void {
  console.error(
    JSON.stringify({ level, msg: body, event: options.eventName, ...attributes, ...getTraceContext() }),
  );

  const attrs: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value == null) continue;
    attrs[key] =
      typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? value
        : JSON.stringify(value);
  }

  logs.getLogger(SCOPE_NAME).emit({
    severityNumber: SEVERITY[level],
    severityText: level.toUpperCase(),
    body,
    attributes: attrs,
    ...(options.eventName && { eventName: options.eventName }),
    ...(options.timestampMs != null && { timestamp: options.timestampMs }),
  });
}

/** `exception.*` log attributes for an unknown thrown value (semconv). */
export function exceptionAttributes(err: unknown): Record<string, string | undefined> {
  if (err instanceof Error) {
    return { 'exception.type': err.name, 'exception.message': err.message, 'exception.stacktrace': err.stack };
  }
  return { 'exception.type': typeof err, 'exception.message': String(err) };
}

// ---------------------------------------------------------------------------
// Metric instruments
// ---------------------------------------------------------------------------
//
// Durations are in seconds (semconv). Attributes stay low-cardinality:
// `rpc.method` is the bridge command type and `gen_ai.tool.name` the MCP tool
// name — both bounded by the ~90 registered commands/tools. Error rate is the
// histogram count filtered on `error.type`, so there are no separate counters.

type Histogram = ReturnType<Meter['createHistogram']>;

// Bucket boundaries from the MCP semconv for `mcp.server.operation.duration`.
const OPERATION_BUCKETS_S = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300];

let _toolDuration: Histogram | null = null;
let _commandDuration: Histogram | null = null;
let _handlerDuration: Histogram | null = null;
let _pickupDuration: Histogram | null = null;
let _sidecarDuration: Histogram | null = null;

/** MCP semconv `mcp.server.operation.duration` — one record per tool call. */
export function getToolDurationHistogram(): Histogram {
  _toolDuration ??= getMeter().createHistogram('mcp.server.operation.duration', {
    description: 'Duration of MCP requests handled by the server',
    unit: 's',
    advice: { explicitBucketBoundaries: OPERATION_BUCKETS_S },
  });
  return _toolDuration;
}

/** Full file-IPC round-trip of a bridge command, timeouts included. */
export function getCommandDurationHistogram(): Histogram {
  _commandDuration ??= getMeter().createHistogram('reaper.bridge.command.duration', {
    description: 'Round-trip duration of commands sent to the REAPER Lua bridge',
    unit: 's',
    advice: { explicitBucketBoundaries: [0.01, 0.025, 0.05, 0.1, 0.15, 0.25, 0.5, 1, 2.5, 5, 10, 30] },
  });
  return _commandDuration;
}

/** Time Lua spent inside the command handler (reported by the bridge). */
export function getHandlerDurationHistogram(): Histogram {
  _handlerDuration ??= getMeter().createHistogram('reaper.bridge.handler.duration', {
    description: 'Time the Lua bridge spent executing a command handler inside REAPER',
    unit: 's',
    advice: {
      explicitBucketBoundaries: [0.0001, 0.00025, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
    },
  });
  return _handlerDuration;
}

/** Time from Node writing the command file to Lua picking it up. */
export function getPickupDurationHistogram(): Histogram {
  _pickupDuration ??= getMeter().createHistogram('reaper.bridge.pickup.duration', {
    description: 'Time from writing a command file to the Lua defer loop picking it up',
    unit: 's',
    advice: { explicitBucketBoundaries: [0.001, 0.002, 0.005, 0.01, 0.016, 0.033, 0.05, 0.1, 0.2, 0.5, 1] },
  });
  return _pickupDuration;
}

/** Python sidecar JSON-RPC call duration (inference included). */
export function getSidecarDurationHistogram(): Histogram {
  _sidecarDuration ??= getMeter().createHistogram('reaper.sidecar.request.duration', {
    description: 'Duration of JSON-RPC requests to the Python analysis sidecar',
    unit: 's',
    advice: { explicitBucketBoundaries: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120] },
  });
  return _sidecarDuration;
}

// ---------------------------------------------------------------------------
// Bridge health gauges
// ---------------------------------------------------------------------------

// Diagnostics are only observed while fresh, so a dead bridge produces a gap
// instead of repeating its last good value forever.
const DIAGNOSTICS_MAX_AGE_MS = 3 * 60_000;

interface BridgeDiagnostics {
  deferP50Ms: number;
  deferP95Ms: number;
  scanAvgMs: number;
  scanMaxMs: number;
  updatedAt: number;
}

let _diagnostics: BridgeDiagnostics | null = null;

export function updateBridgeDiagnostics(d: Omit<BridgeDiagnostics, 'updatedAt'>): void {
  _diagnostics = { ...d, updatedAt: Date.now() };
}

/**
 * Register the bridge's ObservableGauges. Must be called after `initTelemetry()`.
 *
 * `reaper.bridge.up` is the primary health signal: 1 while REAPER's heartbeat
 * file is fresh, 0 when the Lua bridge is stopped or REAPER is closed.
 */
export function registerBridgeGauges(isBridgeUp: () => Promise<boolean>): void {
  const meter = getMeter();

  meter
    .createObservableGauge('reaper.bridge.up', {
      description: 'Whether the REAPER Lua bridge heartbeat is fresh (1) or stale/missing (0)',
      unit: '1',
    })
    .addCallback(async (obs) => {
      obs.observe((await isBridgeUp()) ? 1 : 0);
    });

  const fresh = () =>
    _diagnostics && Date.now() - _diagnostics.updatedAt < DIAGNOSTICS_MAX_AGE_MS ? _diagnostics : null;

  meter
    .createObservableGauge('reaper.bridge.defer.interval', {
      description: 'REAPER defer loop interval over the last 100 cycles',
      unit: 's',
    })
    .addCallback((obs) => {
      const d = fresh();
      if (!d) return;
      obs.observe(d.deferP50Ms / 1000, { 'reaper.statistic': 'p50' });
      obs.observe(d.deferP95Ms / 1000, { 'reaper.statistic': 'p95' });
    });

  meter
    .createObservableGauge('reaper.bridge.scan.duration', {
      description: 'Time the Lua bridge spends per main-loop scan over the last 100 scans',
      unit: 's',
    })
    .addCallback((obs) => {
      const d = fresh();
      if (!d) return;
      obs.observe(d.scanAvgMs / 1000, { 'reaper.statistic': 'avg' });
      obs.observe(d.scanMaxMs / 1000, { 'reaper.statistic': 'max' });
    });
}
