/**
 * Python sidecar client — subprocess lifecycle + JSON-RPC 2.0 over stdio
 *
 * The sidecar is a long-lived Python process that loads the Audiobox Aesthetics
 * model once and accepts newline-delimited JSON-RPC requests on stdin.
 * It is spawned lazily on the first call to analyze().
 *
 * Exports a singleton SidecarClient via getSidecarClient().
 */

import { spawn, ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, platform } from 'node:os';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { getTracer, emitLog, getSidecarDurationHistogram, redactHome } from './telemetry.js';
import { copySidecarScript } from './setup-sidecar.js';

// ---------------------------------------------------------------------------
// Paths (must match setup-sidecar.ts constants)
// ---------------------------------------------------------------------------

// Venv binary layout differs by OS: POSIX uses bin/, Windows uses Scripts\
const VENV_BIN = platform() === 'win32' ? 'Scripts' : 'bin';
const VENV_PYTHON_NAME = platform() === 'win32' ? 'python.exe' : 'python';

const SIDECAR_VENV_PATH = join(homedir(), '.reaper-mcp', 'sidecar-venv');
const SIDECAR_SCRIPT_PATH = join(homedir(), '.reaper-mcp', 'sidecar', 'server.py');
const VENV_PYTHON = join(SIDECAR_VENV_PATH, VENV_BIN, VENV_PYTHON_NAME);

/** Per-request timeout for analyze() in milliseconds. Default 60s — generous for
 * cold model load + inference, tight enough to fail fast on a hung process.
 * Override with REAPER_MCP_SIDECAR_TIMEOUT_MS (must be a positive integer ≥ 1000).
 * Values ≤ 0 or non-numeric are ignored and the default is used. */
const _rawTimeout = Number(process.env['REAPER_MCP_SIDECAR_TIMEOUT_MS']);
const ANALYZE_TIMEOUT_MS = Number.isFinite(_rawTimeout) && _rawTimeout > 0 ? _rawTimeout : 60_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnalyzeOptions {
  /** Scale the clip to this integrated loudness (LUFS) before scoring; null/undefined = as rendered. */
  normalizeLufs?: number | null;
}

export interface AestheticsRawResult {
  CE: number;
  CU: number;
  PC: number;
  PQ: number;
  durationSeconds: number;
  modelVersion: string;
  normalizeLufs?: number | null;
  inputLufs?: number | null;
  gainDb?: number;
}

/** Params of the sidecar's analyze_audio method (no model load). */
export interface AnalyzeAudioParams {
  path: string;
  startTime?: number;
  endTime?: number;
  sectionSeconds?: number;
  referencePath?: string;
  referenceStartTime?: number;
  referenceEndTime?: number;
}

/** Params of the sidecar's align method. */
export interface AlignParams {
  referencePath: string;
  path: string;
  maxLagMs?: number;
}

/** Params of the sidecar's chroma method (pitch-class energy, for detect_key). */
export interface ChromaParams {
  path: string;
  /** Seconds into the file */
  startTime?: number;
  endTime?: number;
}

/** Params of the sidecar's transients method. */
export interface TransientsParams {
  path: string;
  startTime?: number;
  endTime?: number;
  band?: 'full' | 'low' | 'mid' | 'high';
  sensitivity?: number;
  minGapMs?: number;
}

export interface SidecarClient {
  /** True if the sidecar is installed (script + venv exist). Does NOT guarantee it's running. */
  isAvailable(): boolean;
  /** Send an analyze request to the sidecar. Spawns the process if not already running. */
  analyze(wavPath: string, startTime: number, endTime: number, options?: AnalyzeOptions): Promise<AestheticsRawResult>;
  /** Loudness, spectrum and optional reference comparison of a file (no model load). */
  analyzeAudio(params: AnalyzeAudioParams): Promise<Record<string, unknown>>;
  /** Delay and polarity of one file relative to another. */
  align(params: AlignParams): Promise<Record<string, unknown>>;
  /** Transient (onset) times with strength, dominant band and a tempo estimate. */
  transients(params: TransientsParams): Promise<Record<string, unknown>>;
  /** 12 pitch-class energies, C first, normalized so the largest is 1. */
  chroma(params: ChromaParams): Promise<{ chroma: number[]; durationSeconds: number; frames: number }>;
  /** Terminate the sidecar process. Safe to call even if not running. */
  shutdown(): void;
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

// ---------------------------------------------------------------------------
// Singleton implementation
// ---------------------------------------------------------------------------

class SidecarClientImpl implements SidecarClient {
  private process: ChildProcess | null = null;
  private pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private lineBuffer = '';
  private restarting = false;
  private restartAttempted = false;
  /** Cached spawn promise — prevents double-spawn on concurrent cold-start calls. */
  private spawnPromise: Promise<void> | null = null;

  isAvailable(): boolean {
    return existsSync(SIDECAR_SCRIPT_PATH) && existsSync(VENV_PYTHON);
  }

  analyze(wavPath: string, startTime: number, endTime: number, options: AnalyzeOptions = {}): Promise<AestheticsRawResult> {
    const params: Record<string, unknown> = { path: wavPath, startTime, endTime };
    if (options.normalizeLufs != null) params['normalizeLufs'] = options.normalizeLufs;
    return this.call('analyze', params) as Promise<AestheticsRawResult>;
  }

  analyzeAudio(params: AnalyzeAudioParams): Promise<Record<string, unknown>> {
    return this.call('analyze_audio', { ...params }) as Promise<Record<string, unknown>>;
  }

  align(params: AlignParams): Promise<Record<string, unknown>> {
    return this.call('align', { ...params }) as Promise<Record<string, unknown>>;
  }

  transients(params: TransientsParams): Promise<Record<string, unknown>> {
    return this.call('transients', { ...params }) as Promise<Record<string, unknown>>;
  }

  chroma(params: ChromaParams): Promise<{ chroma: number[]; durationSeconds: number; frames: number }> {
    return this.call('chroma', { ...params }) as Promise<{ chroma: number[]; durationSeconds: number; frames: number }>;
  }

  /**
   * CLIENT span `sidecar/<method>` (JSON-RPC conventions) around the request,
   * plus `reaper.sidecar.request.duration` by `rpc.method` and `error.type`.
   */
  private call(method: string, params: Record<string, unknown>): Promise<unknown> {
    const startMs = Date.now();
    return getTracer().startActiveSpan(
      `sidecar/${method}`,
      {
        kind: SpanKind.CLIENT,
        attributes: { 'rpc.system': 'jsonrpc', 'rpc.service': 'sidecar', 'rpc.method': method, 'peer.service': 'reaper-mcp-sidecar' },
      },
      async (span) => {
        const metricAttrs: Record<string, string> = { 'rpc.method': method };
        try {
          const result = await this.callUntraced(method, params);
          const modelVersion = (result as { modelVersion?: unknown } | null)?.modelVersion;
          if (typeof modelVersion === 'string') span.setAttribute('reaper.sidecar.model.version', modelVersion);
          return result;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const errorType = message.startsWith('Sidecar timeout')
            ? 'timeout'
            : message.startsWith('Audio understanding sidecar not installed')
              ? 'not_installed'
              : 'sidecar_error';
          metricAttrs['error.type'] = errorType;
          span.setAttribute('error.type', errorType);
          span.setStatus({ code: SpanStatusCode.ERROR, message: redactHome(message) });
          emitLog(errorType === 'not_installed' ? 'warn' : 'error', `Sidecar ${method} failed: ${message}`, {
            'rpc.method': method,
            'error.type': errorType,
          });
          throw err;
        } finally {
          span.end();
          getSidecarDurationHistogram().record((Date.now() - startMs) / 1000, metricAttrs);
        }
      },
    );
  }

  private async callUntraced(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.isAvailable()) {
      throw new Error(
        'Audio understanding sidecar not installed. ' +
        'Run: node dist/apps/reaper-mcp-server/main.js setup-sidecar'
      );
    }

    await this.ensureRunning();

    return new Promise<unknown>((resolve, reject) => {
      const id = this.nextId++;
      // Method names must match keys in the METHODS dict in sidecar/server.py.
      const request = { jsonrpc: '2.0', id, method, params };

      // Timeout watchdog: a hung Python inference (OOM, model corruption,
      // deadlock) must not block the caller forever. On timeout, reject the
      // request and kill the process so the next call gets a fresh sidecar.
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          emitLog('error', `Sidecar ${method}() timed out after ${ANALYZE_TIMEOUT_MS}ms — killing process`, {
            'reaper.sidecar.timeout_ms': ANALYZE_TIMEOUT_MS,
          }, { eventName: 'reaper.sidecar.timeout' });
          if (this.process) {
            this.process.kill('SIGKILL');
            this.process = null;
          }
          reject(new Error(
            `Sidecar timeout after ${ANALYZE_TIMEOUT_MS}ms. Override with REAPER_MCP_SIDECAR_TIMEOUT_MS env var.`
          ));
        }
      }, ANALYZE_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: (r) => { clearTimeout(timer); resolve(r); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });

      const line = JSON.stringify(request) + '\n';
      try {
        const proc = this.process;
        if (!proc || !proc.stdin) {
          throw new Error('Sidecar process not running');
        }
        proc.stdin.write(line);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(`Failed to write to sidecar stdin: ${err instanceof Error ? err.message : String(err)}`));
      }
    });
  }

  shutdown(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    // Reject all pending requests
    for (const [id, { reject }] of this.pending.entries()) {
      reject(new Error('Sidecar shut down'));
      this.pending.delete(id);
    }
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private async ensureRunning(): Promise<void> {
    if (this.process && !this.process.killed) return;
    // Deduplicate concurrent spawn calls — only one Python process is ever started.
    if (!this.spawnPromise) {
      this.spawnPromise = this.spawn().finally(() => {
        this.spawnPromise = null;
      });
    }
    await this.spawnPromise;
  }

  private async spawn(): Promise<void> {
    // The installed scripts only change when setup-sidecar runs; refresh them from
    // this build so an update never runs an old server.py without its new methods.
    try {
      copySidecarScript(dirname(fileURLToPath(import.meta.url)));
    } catch {
      // No bundled sidecar next to this build: keep the installed copy
    }
    const child = spawn(VENV_PYTHON, [SIDECAR_SCRIPT_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (child.stdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    }

    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (data: string) => {
        process.stderr.write(`[reaper-mcp-sidecar] ${data}`);
      });
    }

    child.on('exit', (code) => {
      // Exit while requests are pending is a crash; otherwise an expected shutdown.
      emitLog(this.pending.size > 0 ? 'error' : 'info', `Sidecar process exited (code ${code})`, {
        'process.exit.code': code ?? -1,
        'reaper.sidecar.pending_requests': this.pending.size,
      }, { eventName: 'reaper.sidecar.exit' });
      this.process = null;
      this.handleProcessDeath();
    });

    child.on('error', (err) => {
      emitLog('error', `Sidecar spawn error: ${err.message}`, {
        'error.type': (err as NodeJS.ErrnoException).code ?? err.name,
        'exception.message': err.message,
      }, { eventName: 'reaper.sidecar.spawn_error' });
      this.process = null;
      this.handleProcessDeath();
    });

    this.process = child;
    this.lineBuffer = '';
    this.restarting = false;
    // Reset the one-shot restart flag so a future crash (after successful calls)
    // can also be retried once rather than failing immediately.
    this.restartAttempted = false;
  }

  private onStdout(chunk: string): void {
    this.lineBuffer += chunk;
    let newlineIdx: number;
    while ((newlineIdx = this.lineBuffer.indexOf('\n')) !== -1) {
      const line = this.lineBuffer.slice(0, newlineIdx).trim();
      this.lineBuffer = this.lineBuffer.slice(newlineIdx + 1);
      if (line) this.onResponse(line);
    }
  }

  private onResponse(line: string): void {
    let response: JsonRpcResponse;
    try {
      response = JSON.parse(line) as JsonRpcResponse;
    } catch {
      emitLog('error', 'Sidecar returned malformed JSON', { 'reaper.sidecar.line': line.slice(0, 512) });
      // Reject all pending with a parse error — we can't tell which request this was for
      for (const [id, { reject }] of this.pending.entries()) {
        reject(new Error(`Sidecar returned malformed JSON: ${line}`));
        this.pending.delete(id);
      }
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) {
      emitLog('warn', `Sidecar response for unknown id ${response.id}`);
      return;
    }
    this.pending.delete(response.id);

    if (response.error) {
      pending.reject(new Error(response.error.message));
    } else if (response.result) {
      pending.resolve(response.result);
    } else {
      pending.reject(new Error('Sidecar response missing both result and error fields'));
    }
  }

  private handleProcessDeath(): void {
    if (this.restarting || this.pending.size === 0) {
      // No pending requests — nothing to do
      return;
    }

    if (!this.restartAttempted) {
      // Attempt one restart
      this.restarting = true;
      this.restartAttempted = true;
      emitLog('warn', 'Sidecar crashed; attempting one restart', {}, { eventName: 'reaper.sidecar.restart' });

      this.spawn().then(() => {
        // Replay pending requests on the new process
        for (const [id, { reject }] of this.pending.entries()) {
          // We can't replay them safely — reject and let the caller retry
          reject(new Error('Sidecar restarted; please retry the operation'));
          this.pending.delete(id);
        }
      }).catch((err: Error) => {
        for (const [id, { reject }] of this.pending.entries()) {
          reject(new Error(`Sidecar restart failed: ${err.message}. Run: node dist/apps/reaper-mcp-server/main.js setup-sidecar`));
          this.pending.delete(id);
        }
      });
    } else {
      // Already tried once — fail all pending
      for (const [id, { reject }] of this.pending.entries()) {
        reject(new Error('Python sidecar unavailable after restart attempt. Run: node dist/apps/reaper-mcp-server/main.js setup-sidecar'));
        this.pending.delete(id);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton accessor
// ---------------------------------------------------------------------------

let _singleton: SidecarClientImpl | null = null;

/** Returns the singleton sidecar client. Safe to call multiple times. */
export function getSidecarClient(): SidecarClient {
  if (!_singleton) {
    _singleton = new SidecarClientImpl();
  }
  return _singleton;
}

/** Reset the singleton — for testing only. */
export function _resetSidecarClient(): void {
  if (_singleton) {
    _singleton.shutdown();
    _singleton = null;
  }
}
