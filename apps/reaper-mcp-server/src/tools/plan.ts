import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PlanOp } from '@reaper-mcp/protocol';
import { sendCommand } from '../bridge.js';
import { actionRef, actionSection } from './actions.js';
import { itemRefs } from './arrange.js';

/**
 * Applying a plan can re-instantiate many plugins (add_fx, graft_fxchain), which
 * takes far longer than a single command. A timeout here would make the client
 * report failure while REAPER finishes the write — and a retry would apply twice.
 */
export const RUN_PLAN_TIMEOUT_MS = 120_000;

// Refs are not z.coerce'd: a digit string may be a track *name*, so the bridge
// resolves "3" by name first and only then by index.
const trackRef = z
  .union([z.number().int().min(-1), z.string().min(1)])
  .describe('Track: 0-based index (-1 or "master" = master track), exact name, "{GUID}", or a "$ref" bound by an earlier add_track');
const fxRef = z
  .union([z.number().int().min(0), z.string().min(1)])
  .describe('FX: index on the track, unique name substring, or a "$ref" bound by an earlier add_fx');
const refName = z.string().regex(/^\$[A-Za-z0-9_]+$/, 'refs look like "$name"');
const paramValues = z
  .array(z.object({
    index: z.coerce.number().int().min(0).describe('Parameter index'),
    value: z.coerce.number().describe('Parameter value (same scale as set_fx_parameter)'),
  }))
  .min(1);

const opSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add_track'),
    name: z.string().optional(),
    index: z.coerce.number().int().min(0).optional().describe('Insert position (default: end)'),
    as: refName.optional(),
  }),
  z.object({
    op: z.literal('set_track'),
    track: trackRef,
    volume: z.coerce.number().optional().describe('Volume in dB'),
    pan: z.coerce.number().min(-1).max(1).optional(),
    mute: z.coerce.number().int().min(0).max(1).optional(),
    solo: z.coerce.number().int().min(0).max(1).optional(),
    recordArm: z.coerce.number().int().min(0).max(1).optional(),
    phase: z.coerce.number().int().min(0).max(1).optional(),
    input: z.coerce.number().int().optional(),
    name: z.string().optional(),
  }),
  z.object({
    op: z.literal('add_fx'),
    track: trackRef,
    fxName: z.string().min(1).describe('FX name (partial match, e.g. "ReaComp", "VST3: Pro-Q 3")'),
    position: z.coerce.number().int().min(0).optional().describe('Chain position (default: end)'),
    enabled: z.coerce.number().int().min(0).max(1).optional(),
    params: paramValues.optional(),
    as: refName.optional(),
  }),
  z.object({
    op: z.literal('set_fx_params'),
    track: trackRef.optional().describe('Required unless fx is a "$ref"'),
    fx: fxRef,
    params: paramValues,
  }),
  z.object({
    op: z.literal('add_send'),
    from: trackRef,
    to: trackRef,
    volume: z.coerce.number().optional().describe('Send volume in dB'),
    pan: z.coerce.number().min(-1).max(1).optional(),
    mute: z.coerce.number().int().min(0).max(1).optional(),
  }),
  z.object({
    op: z.literal('graft_fxchain'),
    track: trackRef.describe('Target track; its items, envelopes and sends are kept'),
    from: trackRef.optional().describe('Source track in this project'),
    fromChunk: z.string().optional().describe('Base64 track state chunk (e.g. a full-chunk snapshot track)'),
  }),
  z.object({
    op: z.literal('select_tracks'),
    tracks: z.array(trackRef).min(1).describe('Tracks to select (refs allowed)'),
    mode: z.enum(['replace', 'add']).optional().describe('replace (default) or add to the selection'),
  }),
  z.object({
    op: z.literal('run_action'),
    action: actionRef,
    section: actionSection,
    allowDialog: z.boolean().optional(),
  }),
  z.object({
    op: z.literal('copy_items'),
    items: itemRefs.describe('Items to copy, as the project is before the plan (no op that adds tracks or items may come first)'),
    times: z.coerce.number().int().min(1).max(64).optional(),
    position: z.coerce.number().min(0).optional(),
    trackIndex: z.coerce.number().int().min(0).optional(),
    pooled: z.boolean().optional(),
  }),
  z.object({
    op: z.literal('insert_time'),
    position: z.coerce.number().min(0),
    length: z.coerce.number().positive().max(3600),
    splitItems: z.boolean().optional(),
  }),
  z.object({
    op: z.literal('remove_time'),
    start: z.coerce.number().min(0),
    end: z.coerce.number().min(0),
  }),
]);

export const runPlanShape = {
  ops: z.array(opSchema).min(1).max(500).describe('Ordered list of ops'),
  dryRun: z.boolean().optional().describe('Validate and resolve only; write nothing'),
  idempotencyKey: z.string().min(1).optional().describe('Re-sending a key that was already applied returns the earlier result instead of applying again'),
  snapshotBefore: z.string().min(1).optional().describe('Save a snapshot with this name before applying'),
  label: z.string().min(1).optional().describe('Undo history label'),
};

/**
 * Static checks the bridge would also catch, done here so a malformed plan
 * never reaches REAPER: refs must be bound by an EARLIER op, bound once, and
 * used as the right kind (track vs FX).
 */
const KIND = { track: 'a track', fx: 'an FX' } as const;

export function validatePlanRefs(ops: PlanOp[]): string[] {
  const errors: string[] = [];
  const bound = new Map<string, 'track' | 'fx'>();

  const use = (i: number, field: string, ref: unknown, kind: 'track' | 'fx') => {
    if (typeof ref !== 'string' || !ref.startsWith('$')) return;
    const got = bound.get(ref);
    if (!got) errors.push(`op ${i} (${ops[i].op}): ${field} ${ref} is not defined by an earlier op`);
    else if (got !== kind) errors.push(`op ${i} (${ops[i].op}): ${field} ${ref} is ${KIND[got]}, not ${KIND[kind]}`);
  };

  ops.forEach((op, i) => {
    switch (op.op) {
      case 'set_track':
      case 'add_fx':
        use(i, 'track', op.track, 'track');
        break;
      case 'set_fx_params':
        use(i, 'track', op.track, 'track');
        use(i, 'fx', op.fx, 'fx');
        if (op.track === undefined && !(typeof op.fx === 'string' && op.fx.startsWith('$'))) {
          errors.push(`op ${i} (set_fx_params): track is required unless fx is a "$ref"`);
        }
        break;
      case 'add_send':
        use(i, 'from', op.from, 'track');
        use(i, 'to', op.to, 'track');
        break;
      case 'select_tracks':
        op.tracks.forEach((t, k) => use(i, `tracks[${k}]`, t, 'track'));
        break;
      case 'graft_fxchain':
        use(i, 'track', op.track, 'track');
        use(i, 'from', op.from, 'track');
        if ((op.from === undefined) === (op.fromChunk === undefined)) {
          errors.push(`op ${i} (graft_fxchain): give exactly one of from or fromChunk`);
        }
        break;
    }
    if ((op.op === 'add_track' || op.op === 'add_fx') && op.as) {
      if (bound.has(op.as)) errors.push(`op ${i} (${op.op}): ${op.as} is already defined`);
      else bound.set(op.as, op.op === 'add_track' ? 'track' : 'fx');
    }
  });
  return errors;
}

export function registerPlanTools(server: McpServer): void {
  server.tool(
    'run_plan',
    'Execute a multi-step edit as ONE bridge call in ONE undo block, all-or-nothing. ' +
      'Use instead of many sequential tool calls. Ops run in order: add_track, set_track, add_fx, ' +
      'set_fx_params, add_send, graft_fxchain (copy a source FX chain onto a track; sends are not copied), ' +
      'select_tracks, copy_items / insert_time / remove_time (as the arrange tools), and run_action (any REAPER action — usually after select_tracks; same safety rules as run_action; only run_action ops may follow a run_action). ' +
      'Target tracks by index, exact name, "{GUID}", or a "$ref" that an earlier add_track/add_fx bound with `as`. ' +
      'Every target is resolved before anything is written: an unknown or ambiguous track rejects the whole plan, ' +
      'and a failure mid-apply reverts it. Use dryRun to preview resolution and conflicts. ' +
      'Pass an idempotencyKey so a retried call is not applied twice.',
    runPlanShape,
    async ({ ops, dryRun, idempotencyKey, snapshotBefore, label }) => {
      const errors = validatePlanRefs(ops as PlanOp[]);
      if (errors.length > 0) {
        return {
          content: [{ type: 'text', text: `Error: Plan rejected, nothing was changed — ${errors.join('; ')}` }],
          isError: true,
        };
      }
      const res = await sendCommand(
        'run_plan',
        { ops: JSON.stringify(ops), dryRun, idempotencyKey, snapshotBefore, label },
        dryRun ? undefined : RUN_PLAN_TIMEOUT_MS,
      );
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    },
  );
}
