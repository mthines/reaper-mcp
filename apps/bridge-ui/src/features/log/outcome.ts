import type { Outcome } from '../../lib/commands.js';

// A refused request ("Track 9 not found") is a warning, a system error is an error; rows, dots and the
// drawer's badge are coloured by their data-outcome
export const OUTCOME_TAG: Record<Outcome, string> = { ok: 'ok ', error: 'ERR', refused: 'WRN' };
export const OUTCOME_LABEL: Record<Outcome, string> = { ok: 'Success', error: 'Error', refused: 'Refused' };
