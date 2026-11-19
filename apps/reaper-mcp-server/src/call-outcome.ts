import { AsyncLocalStorage } from 'node:async_hooks';

// sendCommand() and the sidecar client note each failure here after logging it, so the tool wrapper (server.ts) can
// set the tool span's status without re-reading the agent's message, and log only a failure nothing below logged.
// The expected-vs-regression rule itself: DEVELOPMENT.md § OpenTelemetry / Observability.

/** What the bridge and sidecar calls of one tool call reported about their failures. */
export interface CallOutcome {
  /** A call below already logged a failure. */
  logged: boolean;
  /** A call below failed with a regression. */
  regression: boolean;
  /** The tool already put its failure on the bridge page's log (`logToolResult`). */
  pageLogged: boolean;
}

const store = new AsyncLocalStorage<CallOutcome>();

/** Runs one tool call, recording what the calls it makes report. */
export function trackCallOutcome<T>(fn: () => Promise<T>): Promise<{ result: T; outcome: CallOutcome }> {
  const outcome: CallOutcome = { logged: false, regression: false, pageLogged: false };
  return store.run(outcome, async () => ({ result: await fn(), outcome }));
}

/** Notes a failure a bridge or sidecar call has just logged (no-op outside a tool call). */
export function noteLoggedFailure(regression: boolean): void {
  const outcome = store.getStore();
  if (!outcome) return;
  outcome.logged = true;
  if (regression) outcome.regression = true;
}

/** Notes that the tool put a failure on the bridge page's log (no-op outside a tool call). */
export function notePageLogged(): void {
  const outcome = store.getStore();
  if (outcome) outcome.pageLogged = true;
}
