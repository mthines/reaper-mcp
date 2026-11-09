import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * What the bridge and sidecar calls of one tool call reported about their failures.
 *
 * Every failure follows one rule: an expected outcome (a refused request, a bridge that is not running or is
 * from another release, a sidecar that is not installed, is busy or rejected its input) is a WARN log and
 * leaves the span status unset, like an HTTP 4xx; a regression (a crash, an internal error, a timeout) is an
 * ERROR log and sets the span status to ERROR. `sendCommand()` and the sidecar client note each failure here
 * after logging it, so the tool wrapper in `server.ts` can apply the same rule to the tool's own span without
 * re-reading the message the agent got, and logs a failure only when no call below already did.
 */
export interface CallOutcome {
  /** A call below already logged a failure. */
  logged: boolean;
  /** A call below failed with a regression. */
  regression: boolean;
}

const store = new AsyncLocalStorage<CallOutcome>();

/** Runs one tool call, recording what the calls it makes report. */
export function trackCallOutcome<T>(fn: () => Promise<T>): Promise<{ result: T; outcome: CallOutcome }> {
  const outcome: CallOutcome = { logged: false, regression: false };
  return store.run(outcome, async () => ({ result: await fn(), outcome }));
}

/** Notes a failure a bridge or sidecar call has just logged (no-op outside a tool call). */
export function noteLoggedFailure(regression: boolean): void {
  const outcome = store.getStore();
  if (!outcome) return;
  outcome.logged = true;
  if (regression) outcome.regression = true;
}
