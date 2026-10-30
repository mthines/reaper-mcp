import type { Outcome } from '../../lib/commands.js';

// A refused request ("Track 9 not found") is a warning, a system error is an error
export const ROW_CLASS: Record<Outcome, string> = { ok: '', error: 'row-err', refused: 'row-warn' };
export const DOT_CLASS: Record<Outcome, string> = { ok: 'ok', error: 'err', refused: 'warn' };
export const OUTCOME_TAG: Record<Outcome, string> = { ok: 'ok ', error: 'ERR', refused: 'WRN' };
export const BADGE: Record<Outcome, { className: string; label: string }> = {
  ok: { className: 'result-ok', label: 'Success' },
  error: { className: 'result-err', label: 'Error' },
  refused: { className: 'result-warn', label: 'Refused' },
};
