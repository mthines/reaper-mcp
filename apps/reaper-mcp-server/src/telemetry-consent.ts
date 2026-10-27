/**
 * Telemetry consent: whether this install sends anonymous usage telemetry to
 * the developer, how users opt out, and what is stripped before anything
 * leaves the machine. See TELEMETRY.md for the user-facing description.
 *
 * Modes:
 *   custom  — the user set their own OTEL_* exporters; exported as configured
 *   default — anonymous usage telemetry to the built-in destination
 *   off     — nothing is exported
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { core, tracing } from '@opentelemetry/sdk-node';

type ReadableSpan = tracing.ReadableSpan;
type SpanExporter = tracing.SpanExporter;
type ExportResult = core.ExportResult;

/**
 * Where default telemetry goes. The token can only ingest into this dataset —
 * it can't read anything — so it is safe to ship in a public repo. Users' data
 * shares the dataset with the developer's own, told apart by service name.
 * An empty token means this build has no built-in destination: default mode is off.
 */
export const DEFAULT_DESTINATION = {
  endpoint: 'https://ingress.europe-west4.gcp.dash0-dev.com',
  dataset: 'reaper-mcp',
  serviceName: 'reaper-mcp-usage',
  token: 'auth_qWTU9VhiQD5ADILLZKLuF5WiuZcAeGe8',
};

export const TELEMETRY_DOC_URL = 'https://github.com/mthines/reaper-mcp/blob/main/TELEMETRY.md';

export const TELEMETRY_NOTICE = `Pseudonymous usage telemetry is ON by default.
reaper-mcp is built by one developer. To see which tools people use, which fail,
and how fast they are, it sends pseudonymous usage data: tool names, error types,
timings, and app/OS versions, tagged with a random install id.
It never sends your projects, track names, parameters, file paths or error text.

Opt out any time:  reaper-mcp telemetry off
                   (or set REAPER_MCP_TELEMETRY=0 or DO_NOT_TRACK=1)
Details: ${TELEMETRY_DOC_URL}`;

export type TelemetryMode = 'custom' | 'default' | 'off';

export interface TelemetryDecision {
  mode: TelemetryMode;
  /** Why, in words a user can act on. */
  reason: string;
}

export interface TelemetryConfig {
  telemetry?: boolean;
  telemetryNoticeShown?: boolean;
}

type Env = Record<string, string | undefined>;

const FALSY = new Set(['0', 'false', 'off', 'no']);
const isSet = (v: string | undefined): v is string => v !== undefined && v.trim() !== '';
const isFalsy = (v: string) => FALSY.has(v.trim().toLowerCase());

export function defaultConfigDir(): string {
  return join(homedir(), '.reaper-mcp');
}

export function readTelemetryConfig(dir = defaultConfigDir()): TelemetryConfig {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf-8'));
    return parsed && typeof parsed === 'object' ? (parsed as TelemetryConfig) : {};
  } catch {
    return {};
  }
}

/** Merge `patch` into config.json, keeping any other keys. */
export function writeTelemetryConfig(patch: TelemetryConfig, dir = defaultConfigDir()): void {
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf-8')) as Record<string, unknown>;
  } catch {
    // no config yet
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), `${JSON.stringify({ ...current, ...patch }, null, 2)}\n`, 'utf-8');
}

/**
 * Decide the telemetry mode. Precedence: the user's own OTEL_* exporters, then
 * DO_NOT_TRACK, then REAPER_MCP_TELEMETRY, then `reaper-mcp telemetry on|off`,
 * then the built-in default (on, when this build has a destination).
 */
export function resolveTelemetry(
  env: Env = process.env,
  config: TelemetryConfig = readTelemetryConfig(),
  destination: { token: string } = DEFAULT_DESTINATION,
): TelemetryDecision {
  const exporters = ['OTEL_TRACES_EXPORTER', 'OTEL_METRICS_EXPORTER', 'OTEL_LOGS_EXPORTER'];
  if (exporters.some((k) => isSet(env[k]) && env[k] !== 'none')) {
    return { mode: 'custom', reason: 'your own OTEL_* exporter settings' };
  }
  const dnt = env['DO_NOT_TRACK'];
  if (isSet(dnt) && !isFalsy(dnt)) return { mode: 'off', reason: 'DO_NOT_TRACK is set' };

  const flag = env['REAPER_MCP_TELEMETRY'];
  if (isSet(flag) && isFalsy(flag)) return { mode: 'off', reason: `REAPER_MCP_TELEMETRY=${flag}` };
  const forcedOn = isSet(flag);

  if (!forcedOn && config.telemetry === false) {
    return { mode: 'off', reason: 'turned off with `reaper-mcp telemetry off`' };
  }
  if (!destination.token) return { mode: 'off', reason: 'this build has no built-in telemetry destination' };
  return {
    mode: 'default',
    reason: forcedOn ? `REAPER_MCP_TELEMETRY=${flag}` : 'on by default — opt out with `reaper-mcp telemetry off`',
  };
}

export interface ConsentIO {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  /** Ask Y/n when true; otherwise only show the notice. */
  interactive: boolean;
}

/**
 * First-time setup: show the notice once and, when someone is at the keyboard,
 * ask whether to keep telemetry on (Enter keeps it on). Returns false without
 * a word when the notice was already shown, or when default telemetry wouldn't
 * run anyway (opted out by env, own OTEL_* setup, no built-in destination) —
 * then it is still unshown for when it would.
 */
export async function firstRunTelemetryNotice(
  io: ConsentIO,
  dir = defaultConfigDir(),
  env: Env = process.env,
  destination: { token: string } = DEFAULT_DESTINATION,
): Promise<boolean> {
  const config = readTelemetryConfig(dir);
  if (config.telemetryNoticeShown || resolveTelemetry(env, config, destination).mode !== 'default') return false;
  io.output.write(`\n${TELEMETRY_NOTICE}\n\n`);

  let keep = true;
  if (io.interactive) {
    const rl = createInterface({ input: io.input, output: io.output, terminal: false });
    io.output.write('Keep usage telemetry on? [Y/n] ');
    // 'line' always fires before 'close'; Ctrl+D or a closed stdin counts as Enter.
    const answer = await new Promise<string>((resolve) => {
      rl.once('line', resolve);
      rl.once('close', () => resolve(''));
    }).then((a) => a.trim().toLowerCase());
    rl.close();
    keep = !(answer === 'n' || answer === 'no');
    io.output.write(keep ? 'Thanks — telemetry stays on.\n' : 'Telemetry is off. Turn it back on with `reaper-mcp telemetry on`.\n');
  }
  writeTelemetryConfig({ telemetry: keep, telemetryNoticeShown: true }, dir);
  return true;
}

/** Span attributes default telemetry keeps: what ran, how it ended, how long it took. */
const ALLOWED_SPAN_ATTRIBUTES = new Set([
  'mcp.method.name',
  'gen_ai.tool.name',
  'gen_ai.operation.name',
  'network.transport',
  'error.type',
  'rpc.system',
  'rpc.service',
  'rpc.method',
  'reaper.bridge.timeout_ms',
  'reaper.bridge.handler_ms',
  'reaper.bridge.pickup_ms',
  'reaper.bridge.poll_attempts',
]);

/**
 * Wraps a span exporter so only anonymous usage data leaves the machine:
 * allow-listed attributes, the status code without its message (error text
 * can name tracks or paths), and no events (exception messages, stacks).
 */
export class AnonymizingSpanExporter implements SpanExporter {
  constructor(private readonly inner: SpanExporter) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    this.inner.export(spans.map(anonymizeSpan), resultCallback);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}

function anonymizeSpan(span: ReadableSpan): ReadableSpan {
  const attributes = Object.fromEntries(
    Object.entries(span.attributes).filter(([key]) => ALLOWED_SPAN_ATTRIBUTES.has(key)),
  );
  return {
    name: span.name,
    kind: span.kind,
    spanContext: () => span.spanContext(),
    parentSpanContext: span.parentSpanContext,
    startTime: span.startTime,
    endTime: span.endTime,
    status: { code: span.status.code },
    attributes,
    links: [],
    events: [],
    duration: span.duration,
    ended: span.ended,
    resource: span.resource,
    instrumentationScope: span.instrumentationScope,
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}
