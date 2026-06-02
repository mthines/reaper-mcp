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
import { join } from 'node:path';
import { homedir } from 'node:os';

// ---------------------------------------------------------------------------
// Paths (must match setup-sidecar.ts constants)
// ---------------------------------------------------------------------------

const SIDECAR_VENV_PATH = join(homedir(), '.reaper-mcp', 'sidecar-venv');
const SIDECAR_SCRIPT_PATH = join(homedir(), '.reaper-mcp', 'sidecar', 'server.py');
const VENV_PYTHON = join(SIDECAR_VENV_PATH, 'bin', 'python');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AestheticsRawResult {
  CE: number;
  CU: number;
  PC: number;
  PQ: number;
  durationSeconds: number;
  modelVersion: string;
}

export interface SidecarClient {
  /** True if the sidecar is installed (script + venv exist). Does NOT guarantee it's running. */
  isAvailable(): boolean;
  /** Send an analyze request to the sidecar. Spawns the process if not already running. */
  analyze(wavPath: string, startTime: number, endTime: number): Promise<AestheticsRawResult>;
  /** Terminate the sidecar process. Safe to call even if not running. */
  shutdown(): void;
}

interface PendingRequest {
  resolve: (result: AestheticsRawResult) => void;
  reject: (err: Error) => void;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: AestheticsRawResult;
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

  isAvailable(): boolean {
    return existsSync(SIDECAR_SCRIPT_PATH) && existsSync(VENV_PYTHON);
  }

  async analyze(wavPath: string, startTime: number, endTime: number): Promise<AestheticsRawResult> {
    if (!this.isAvailable()) {
      throw new Error(
        'Audio understanding sidecar not installed. ' +
        'Run: node dist/apps/reaper-mcp-server/main.js setup-sidecar'
      );
    }

    await this.ensureRunning();

    return new Promise<AestheticsRawResult>((resolve, reject) => {
      const id = this.nextId++;
      const request = {
        jsonrpc: '2.0',
        id,
        method: 'analyze',
        params: { path: wavPath, startTime, endTime },
      };

      this.pending.set(id, { resolve, reject });

      const line = JSON.stringify(request) + '\n';
      try {
        const proc = this.process;
        if (!proc || !proc.stdin) {
          throw new Error('Sidecar process not running');
        }
        proc.stdin.write(line);
      } catch (err) {
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
    await this.spawn();
  }

  private async spawn(): Promise<void> {
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
      process.stderr.write(`[reaper-mcp] Sidecar process exited (code ${code})\n`);
      this.process = null;
      this.handleProcessDeath();
    });

    child.on('error', (err) => {
      process.stderr.write(`[reaper-mcp] Sidecar spawn error: ${err.message}\n`);
      this.process = null;
      this.handleProcessDeath();
    });

    this.process = child;
    this.lineBuffer = '';
    this.restarting = false;
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
      process.stderr.write(`[reaper-mcp] Sidecar returned malformed JSON: ${line}\n`);
      // Reject all pending with a parse error — we can't tell which request this was for
      for (const [id, { reject }] of this.pending.entries()) {
        reject(new Error(`Sidecar returned malformed JSON: ${line}`));
        this.pending.delete(id);
      }
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) {
      process.stderr.write(`[reaper-mcp] Sidecar response for unknown id ${response.id}\n`);
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
      process.stderr.write('[reaper-mcp] Sidecar crashed; attempting one restart...\n');

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
