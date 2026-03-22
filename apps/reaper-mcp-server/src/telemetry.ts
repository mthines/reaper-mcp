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
import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_NAMESPACE,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
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
// Pre-created metric instruments
// ---------------------------------------------------------------------------

/**
 * Lazily-created metric instruments.  Instruments are created once per
 * process — calling getMeter() multiple times for the same name is fine, but
 * creating instruments inside hot paths should be avoided.
 */

let _commandDurationHistogram: ReturnType<Meter['createHistogram']> | null =
  null;
let _commandCounter: ReturnType<Meter['createCounter']> | null = null;
let _timeoutCounter: ReturnType<Meter['createCounter']> | null = null;

export function getCommandDurationHistogram(): ReturnType<
  Meter['createHistogram']
> {
  if (!_commandDurationHistogram) {
    _commandDurationHistogram = getMeter().createHistogram(
      'mcp.bridge.command.duration',
      {
        description: 'Duration of MCP bridge commands (file IPC round-trip)',
        unit: 'ms',
      },
    );
  }
  return _commandDurationHistogram;
}

export function getCommandCounter(): ReturnType<Meter['createCounter']> {
  if (!_commandCounter) {
    _commandCounter = getMeter().createCounter('mcp.bridge.command.count', {
      description: 'Number of MCP bridge commands sent, by type and success',
    });
  }
  return _commandCounter;
}

export function getTimeoutCounter(): ReturnType<Meter['createCounter']> {
  if (!_timeoutCounter) {
    _timeoutCounter = getMeter().createCounter('mcp.bridge.timeout.count', {
      description:
        'Number of MCP bridge commands that timed out waiting for REAPER',
    });
  }
  return _timeoutCounter;
}

// ---------------------------------------------------------------------------
// Bridge-side metric instruments (handler timing, pickup latency)
// ---------------------------------------------------------------------------

let _handlerDurationHistogram: ReturnType<Meter['createHistogram']> | null =
  null;
let _pickupDurationHistogram: ReturnType<Meter['createHistogram']> | null =
  null;

export function getHandlerDurationHistogram(): ReturnType<
  Meter['createHistogram']
> {
  if (!_handlerDurationHistogram) {
    _handlerDurationHistogram = getMeter().createHistogram(
      'mcp.bridge.handler.duration',
      {
        description:
          'Time Lua spent executing the command handler inside REAPER',
        unit: 'ms',
        advice: {
          explicitBucketBoundaries: [
            0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500,
          ],
        },
      },
    );
  }
  return _handlerDurationHistogram;
}

export function getPickupDurationHistogram(): ReturnType<
  Meter['createHistogram']
> {
  if (!_pickupDurationHistogram) {
    _pickupDurationHistogram = getMeter().createHistogram(
      'mcp.bridge.pickup.duration',
      {
        description:
          'Time from Node writing the command file to Lua picking it up (defer cycle latency)',
        unit: 'ms',
        advice: {
          explicitBucketBoundaries: [
            1, 2, 5, 10, 16, 33, 50, 100, 200, 500, 1000,
          ],
        },
      },
    );
  }
  return _pickupDurationHistogram;
}

// ---------------------------------------------------------------------------
// Bridge diagnostics gauge state
// ---------------------------------------------------------------------------

let _deferP50Ms = 0;
let _deferP95Ms = 0;
let _scanAvgMs = 0;
let _scanMaxMs = 0;

export function updateDeferStats(p50: number, p95: number): void {
  _deferP50Ms = p50;
  _deferP95Ms = p95;
}

export function updateScanStats(avg: number, max: number): void {
  _scanAvgMs = avg;
  _scanMaxMs = max;
}

/**
 * Register ObservableGauge instruments for bridge diagnostics.
 * Must be called after `initTelemetry()`.
 */
export function registerBridgeGauges(): void {
  getMeter()
    .createObservableGauge('mcp.bridge.defer.interval', {
      description: 'REAPER defer loop interval (p50/p95 over last 100 cycles)',
      unit: 'ms',
    })
    .addCallback((obs) => {
      obs.observe(_deferP50Ms, { percentile: 'p50' });
      obs.observe(_deferP95Ms, { percentile: 'p95' });
    });

  getMeter()
    .createObservableGauge('mcp.bridge.scan.duration', {
      description:
        'Time Lua spends per main_loop scan cycle (avg/max over last 100 scans)',
      unit: 'ms',
    })
    .addCallback((obs) => {
      obs.observe(_scanAvgMs, { percentile: 'avg' });
      obs.observe(_scanMaxMs, { percentile: 'max' });
    });
}
