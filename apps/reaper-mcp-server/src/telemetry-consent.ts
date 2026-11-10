/**
 * Telemetry consent: whether this install sends anonymous usage telemetry to
 * the developer, how users opt out, and what is stripped before anything
 * leaves the machine. See TELEMETRY.md for the user-facing description.
 *
 * Modes:
 *   custom  — the user set their own OTEL_* exporters; exported as configured
 *   default — anonymous usage telemetry to the built-in destination
 *   off     — nothing is exported
 *
 * Opting in or out (`reaper-mcp telemetry on|off`, the first-run answer) is
 * itself reported once, as an anonymous count with no install id — see
 * `reportConsentChange()` in telemetry.ts.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { core, tracing } from '@opentelemetry/sdk-node';
import { createUi, type Ui } from './terminal-ui.js';

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

/**
 * Service name of the opt-in/opt-out counts. Kept apart from the usage
 * service so these id-less events never show up as an extra "person" in
 * queries that count distinct `enduser.pseudo.id` values.
 */
export const CONSENT_SERVICE_NAME = 'reaper-mcp-consent';

export const TELEMETRY_DOC_URL = 'https://github.com/mthines/reaper-mcp/blob/main/TELEMETRY.md';

/** The first-run notice, drawn with `ui` (plain by default: the words never depend on colour) */
export function renderTelemetryNotice(ui: Ui = createUi({ level: 0, tty: false })): string {
  return `${ui.bold('Pseudonymous usage telemetry is ON by default.')}
reaper-mcp is built by one developer. To see which tools people use, which fail,
and how fast they are, it sends pseudonymous usage data: tool names, error types,
timings, and app/OS versions, tagged with a random install id.
It never sends your projects, track names, parameters, file paths or error text.
Your answer below is counted once, anonymously (on or off, no install id).

Opt out any time:  ${ui.cmd('reaper-mcp telemetry off')}
                   ${ui.dim('(or set REAPER_MCP_TELEMETRY=0 or DO_NOT_TRACK=1)')}
Details: ${ui.link(TELEMETRY_DOC_URL)}`;
}

export const TELEMETRY_NOTICE = renderTelemetryNotice();

export type TelemetryMode = 'custom' | 'default' | 'off';

/** Where an opt-in or opt-out was made. */
export type ConsentSource =
  | 'cli' //              `reaper-mcp telemetry on|off`
  | 'first_run_prompt' // the Y/n question at setup
  | 'first_run_notice'; // setup without a terminal: notice shown, default kept

/** One opt-in or opt-out, as reported by `reportConsentChange()`. */
export interface ConsentChange {
  state: 'on' | 'off';
  source: ConsentSource;
}

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
 * Save `reaper-mcp telemetry on|off`. Returns the change to report, or
 * undefined when the saved choice already said so — running `off` twice
 * counts one opt-out, and `on` on an install that never opted out counts none.
 */
export function saveTelemetryChoice(on: boolean, dir = defaultConfigDir()): ConsentChange | undefined {
  const wasOn = readTelemetryConfig(dir).telemetry !== false;
  writeTelemetryConfig({ telemetry: on, telemetryNoticeShown: true }, dir);
  return wasOn === on ? undefined : { state: on ? 'on' : 'off', source: 'cli' };
}

/**
 * Whether an opt-in/opt-out may be reported to the built-in destination: only
 * when nothing in the environment rules telemetry to the developer out. The
 * saved choice is ignored on purpose (it is the thing being reported), so
 * DO_NOT_TRACK=1, REAPER_MCP_TELEMETRY=0, own OTEL_* exporters or a build
 * without a destination mean nothing at all is sent, not even this.
 */
export function consentReportAllowed(env: Env = process.env, destination: { token: string } = DEFAULT_DESTINATION): boolean {
  return resolveTelemetry(env, {}, destination).mode === 'default';
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

/** Answers typed one line at a time. Ctrl+D or a closed stdin reads as an empty line (Enter), so every question needs a safe default. */
function lineReader(input: NodeJS.ReadableStream) {
  const rl = createInterface({ input, terminal: false });
  const queue: string[] = [];
  let waiting: ((line: string) => void) | undefined;
  let closed = false;
  rl.on('line', (line) => {
    if (waiting) {
      const resolve = waiting;
      waiting = undefined;
      resolve(line);
    } else queue.push(line);
  });
  rl.on('close', () => {
    closed = true;
    waiting?.('');
  });
  return {
    next: (): Promise<string> => (queue.length ? Promise.resolve(queue.shift() as string) : closed ? Promise.resolve('') : new Promise((resolve) => (waiting = resolve))),
    close: () => rl.close(),
  };
}

/** The one question before telemetry goes off: what it does for the developer, what is never seen. Enter keeps it on. True = turn it off. */
async function confirmOptOut(lines: { next(): Promise<string> }, output: NodeJS.WritableStream, ui: Ui): Promise<boolean> {
  output.write(`\n${ui.bold('Totally your call, no hard feelings 🙏')}
reaper-mcp is just me: one developer, building it in my spare time. These counts help me a ton,
they show me what to fix next. I can't see your music, projects, track names or files. Ever.

${ui.bold('Turn telemetry off anyway?')} ${ui.dim('[y/N]')} `);
  const answer = (await lines.next()).trim().toLowerCase();
  return answer === 'y' || answer === 'yes';
}

/** For `reaper-mcp telemetry off` typed at a terminal: the same one question. Without a terminal there is nobody to ask, so off means off. */
export async function confirmOptOutPrompt(io: ConsentIO): Promise<boolean> {
  if (!io.interactive) return true;
  const lines = lineReader(io.input);
  const off = await confirmOptOut(lines, io.output, io.ui ?? createUi({ level: 0, tty: false }));
  lines.close();
  if (!off) io.output.write(`${(io.ui ?? createUi({ level: 0, tty: false })).mark('ok')} Thanks, telemetry stays on 💚\n`);
  return off;
}

export interface ConsentIO {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  /** Ask Y/n when true; otherwise only show the notice. */
  interactive: boolean;
  /** How to draw the notice (colour on a terminal); plain when absent */
  ui?: Ui;
}

/**
 * First-time setup: show the notice once and, when someone is at the keyboard,
 * ask whether to keep telemetry on (Enter keeps it on). Returns the choice to
 * report, or undefined without a word when the notice was already shown, or
 * when default telemetry wouldn't run anyway (opted out by env, own OTEL_*
 * setup, no built-in destination) — then it is still unshown for when it would.
 */
export async function firstRunTelemetryNotice(
  io: ConsentIO,
  dir = defaultConfigDir(),
  env: Env = process.env,
  destination: { token: string } = DEFAULT_DESTINATION,
): Promise<ConsentChange | undefined> {
  const config = readTelemetryConfig(dir);
  if (config.telemetryNoticeShown || resolveTelemetry(env, config, destination).mode !== 'default') return undefined;
  const ui = io.ui ?? createUi({ level: 0, tty: false });
  io.output.write(`\n${renderTelemetryNotice(ui)}\n\n`);

  let keep = true;
  if (io.interactive) {
    const lines = lineReader(io.input);
    io.output.write(`${ui.bold('Keep usage telemetry on?')} ${ui.dim('[Y/n]')} `);
    const answer = (await lines.next()).trim().toLowerCase();
    keep = !(answer === 'n' || answer === 'no') || !(await confirmOptOut(lines, io.output, ui));
    lines.close();
    io.output.write(keep ? `${ui.mark('ok')} Thanks — telemetry stays on.\n` : `${ui.mark('ok')} Telemetry is off. Turn it back on with \`${ui.cmd('reaper-mcp telemetry on')}\`.\n`);
  }
  writeTelemetryConfig({ telemetry: keep, telemetryNoticeShown: true }, dir);
  return { state: keep ? 'on' : 'off', source: io.interactive ? 'first_run_prompt' : 'first_run_notice' };
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
  // Whether the bridge answered at startup and, when not, which setup step is missing
  // (a fixed set: connected, stale, never_started, not_installed, no_reaper — never a path)
  'reaper.bridge.connected',
  'reaper.bridge.state',
  // detect_key / detect_chords: where they read from and how sure they were, never the key or chords
  'reaper.key.source',
  'reaper.key.confidence',
  'reaper.chords.source',
  'reaper.chords.count',
  'reaper.chords.engine',
  // opt-in/opt-out counts: on or off, and where the choice was made
  'reaper.telemetry.consent.state',
  'reaper.telemetry.consent.source',
  // report_plugin_research: how a plugin research run went, as closed values and capped
  // counts (tools/plugin-research.ts). Never the plugin's name, and nothing that singles
  // one out in combination: no exact parameter count, no built-in or extension flag.
  'reaper.plugin_research.outcome',
  'reaper.plugin_research.caller',
  'reaper.plugin_research.batch_size',
  'reaper.plugin_research.params_probed',
  'reaper.plugin_research.open_questions',
  'reaper.plugin_research.sources',
  'reaper.plugin_research.cleaned_up',
  'reaper.plugin_research.duration_s',
  'reaper.plugin.category',
  'reaper.plugin.style',
  'reaper.plugin.format',
  'reaper.plugin.instrument',
  'reaper.plugin.params_total',
  // write_jsfx (tools/jsfx.ts): the shape of a generated plugin as closed values and capped counts
  // (outcome, sizes, version, lint finding counts). Never its name, the request, its source or any
  // control label: those describe what the person is making.
  'reaper.jsfx.outcome',
  'reaper.jsfx.overwrite',
  'reaper.jsfx.sliders',
  'reaper.jsfx.widgets.core',
  'reaper.jsfx.widgets.advanced',
  'reaper.jsfx.graphs',
  'reaper.jsfx.size',
  'reaper.jsfx.version',
  'reaper.jsfx.toolkit_version',
  'reaper.jsfx.lint.errors',
  'reaper.jsfx.lint.warnings',
  'reaper.jsfx.presets',
  'reaper.jsfx.accent',
  // report_plugin_build (tools/plugin-build.ts): how a /make-plugin run ended, same rule
  'reaper.plugin_build.outcome',
  'reaper.plugin_build.example',
  'reaper.plugin_build.rounds',
  'reaper.plugin_build.checks_passed',
  'reaper.plugin_build.checks_failed',
  'reaper.plugin_build.cleaned_up',
  'reaper.plugin_build.duration_s',
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
