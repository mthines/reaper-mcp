/**
 * align_audio_to_guide: vocal alignment with stretch markers. The sidecar finds the hits
 * (onsets) in the guide item and in each double, src/align.ts pairs them, and the bridge
 * writes the stretch markers that move the double's hits onto the guide's. The bridge's
 * own behaviour is tested in mixing-lib.test.ts, the pairing in align.test.ts.
 */
import { z } from 'zod/v4';
import { trace } from '@opentelemetry/api';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';
import { getSidecarClient } from '../sidecar.js';
import { MAX_HITS, buildPairs, projectTime, type DoubleGeometry, type Hit } from '../align.js';

const SIDECAR_NOT_INSTALLED_MSG =
  'Audio understanding sidecar not installed. ' +
  'Run: node dist/apps/reaper-mcp-server/main.js setup-sidecar';

/** Longest item whose hits are detected (seconds of source audio), as quantize_audio. */
const MAX_ALIGN_SECONDS = 900;

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };
const error = (text: string): ToolResult => ({ content: [{ type: 'text', text: `Error: ${text}` }], isError: true });
const ok = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });

interface ItemProps {
  isMidi?: boolean;
  sourceFile?: string;
  startOffset?: number;
  playRate?: number;
  length?: number;
  position?: number;
}

const itemRef = z.object({
  trackIndex: z.coerce.number().int().min(0),
  itemIndex: z.coerce.number().int().min(0),
});

async function readItem(ref: { trackIndex: number; itemIndex: number }, what: string): Promise<{ item: ItemProps } | { error: string }> {
  const res = await sendCommand('get_media_item_properties', ref);
  if (!res.success) return { error: `${what}: ${res.error ?? 'item not found'}` };
  const item = res.data as ItemProps;
  if (item.isMidi) return { error: `${what} is a MIDI item; align_audio_to_guide needs audio` };
  if (!item.sourceFile) return { error: `${what} has no source file to analyse` };
  if ((item.length ?? 0) * (item.playRate ?? 1) > MAX_ALIGN_SECONDS) {
    return { error: `${what} is too long: max ${MAX_ALIGN_SECONDS} s of source audio per item` };
  }
  return { item };
}

interface Detect { sensitivity: number; minGapMs: number; minStrength: number }

/** Hits of an item's source window, times in seconds of the source file; `truncated` when more than MAX_HITS were found. */
async function detect(item: ItemProps, d: Detect): Promise<{ hits: Hit[]; truncated: boolean }> {
  const offs = item.startOffset ?? 0;
  const span = (item.length ?? 0) * (item.playRate ?? 1);
  const res = await getSidecarClient().transients({
    path: item.sourceFile as string,
    ...(offs > 0 ? { startTime: offs } : {}),
    endTime: offs + span,
    band: 'full',
    sensitivity: d.sensitivity,
    minGapMs: d.minGapMs,
  });
  const all = (res['transients'] as Hit[] | undefined) ?? [];
  const strong = all.filter((h) => (h.strength ?? 1) >= d.minStrength);
  return { hits: strong.slice(0, MAX_HITS), truncated: strong.length > MAX_HITS };
}

export function registerAlignTools(server: McpServer): void {
  server.tool(
    'align_audio_to_guide',
    'Align doubles (a second take, a harmony, a stack) to a guide item with stretch markers, the way VocalSync does: finds the hits (onsets) in the guide and in each double (sidecar), pairs them in order within maxShiftMs, and puts a stretch marker on each hit of the double so it lands on the guide\'s. Audio between hits is stretched; anchors at both ends keep each double\'s length. strength < 1 moves hits only part of the way. protectConsonants moves high-band hits (s, t, k, sh) as a block, so the stretch lands in the vowel after them instead of smearing the consonant. dryRun returns the planned moves and writes nothing. Each double\'s existing stretch markers are replaced; a guide that has stretch markers is refused (its hits would not sit where its source says). Returns, per double, the timing offset before and after (avg/max ms against the guide). Works on the items\' source files (take FX are ignored). Requires the sidecar. Not pitch correction.',
    {
      guide: itemRef.describe('The item to align to (the lead)'),
      doubles: z.array(itemRef).min(1).max(8).describe('The items to move onto the guide'),
      strength: z.coerce.number().positive().max(1).optional().default(1).describe('0..1, how far each hit moves toward the guide\'s'),
      maxShiftMs: z.coerce.number().min(10).max(500).optional().default(120).describe('Hits further apart than this are not paired (and stay put)'),
      protectConsonants: z.boolean().optional().default(true).describe('Move high-band hits as a block with a rigid tail of consonantMs'),
      consonantMs: z.coerce.number().min(20).max(300).optional().default(80),
      dryRun: z.boolean().optional().default(false),
      sensitivity: z.coerce.number().min(0).max(1).optional().default(0.5).describe('Hit detection: higher finds softer hits'),
      minGapMs: z.coerce.number().min(5).max(2000).optional().default(60),
      minStrength: z.coerce.number().min(0).max(1).optional().default(0.2).describe('Ignore hits weaker than this (0..1 of the loudest)'),
    },
    async ({ guide, doubles, strength, maxShiftMs, protectConsonants, consonantMs, dryRun, sensitivity, minGapMs, minStrength }) => {
      if (!getSidecarClient().isAvailable()) return error(SIDECAR_NOT_INSTALLED_MSG);
      const det: Detect = { sensitivity, minGapMs, minStrength };

      const g = await readItem(guide, 'The guide');
      if ('error' in g) return error(g.error);
      const markers = await sendCommand('get_stretch_markers', guide);
      if (markers.success && ((markers.data as { total?: number }).total ?? 0) > 0) {
        return error('The guide item has stretch markers, so its hits would not sit where its source says. ' +
          'Glue or render it first, or align to an item without stretch markers.');
      }
      let guideHits: Hit[];
      let guideTruncated = false;
      try {
        const found = await detect(g.item, det);
        guideTruncated = found.truncated;
        const raw = found.hits;
        // Hit times are seconds of the guide's source; the pairing works in project time
        const geo: DoubleGeometry = { position: g.item.position ?? 0, length: g.item.length ?? 0, startOffset: g.item.startOffset ?? 0, playRate: g.item.playRate ?? 1 };
        guideHits = raw.map((h) => ({ ...h, time: projectTime(geo, h.time) }));
      } catch (err) {
        return error(`Hit detection failed on the guide: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (guideHits.length === 0) return error('No hits found in the guide (lower minStrength or raise sensitivity) — nothing changed.');

      const results: Record<string, unknown>[] = [];
      for (const ref of doubles) {
        const label = `track ${ref.trackIndex} item ${ref.itemIndex}`;
        const fail = (message: string) => results.push({ ...ref, ok: false, error: message });
        const d = await readItem(ref, `The double (${label})`);
        if ('error' in d) { fail(d.error); continue; }
        let hits: Hit[];
        let truncated = false;
        try {
          const found = await detect(d.item, det);
          hits = found.hits;
          truncated = found.truncated;
        } catch (err) {
          fail(`Hit detection failed: ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }
        const geo: DoubleGeometry = { position: d.item.position ?? 0, length: d.item.length ?? 0, startOffset: d.item.startOffset ?? 0, playRate: d.item.playRate ?? 1 };
        const built = buildPairs(guideHits, hits, geo, { maxShiftMs, protectConsonants, consonantMs });
        if (built.matched === 0) {
          fail(`No hit of the double sits within ${maxShiftMs} ms of a guide hit (${hits.length} hits in the double, ${guideHits.length} in the guide) — nothing changed. Raise maxShiftMs or check the items overlap.`);
          continue;
        }
        const res = await sendCommand('align_audio_to_guide', {
          ...ref,
          pairs: JSON.stringify(built.pairs),
          strength,
          dryRun,
          guideTrackIndex: guide.trackIndex,
          guideItemIndex: guide.itemIndex,
        }, 60_000);
        if (!res.success) { fail(res.error ?? 'unknown error'); continue; }
        results.push({
          ...ref, ok: true, ...(res.data as Record<string, unknown>),
          matched: built.matched, unmatchedGuide: built.unmatchedGuide, unmatchedDouble: built.unmatchedDouble,
          ...(truncated || guideTruncated
            ? { warning: `More than ${MAX_HITS} hits were found; only the first ${MAX_HITS} were used, so the end of the item is not aligned. Raise minStrength or lower sensitivity, or align it in parts.` }
            : {}),
        });
      }

      const aligned = results.filter((r) => r['ok']).length;
      const span = trace.getActiveSpan();
      span?.setAttribute('reaper.align.doubles', doubles.length);
      span?.setAttribute('reaper.align.aligned', aligned);
      span?.setAttribute('reaper.align.dry_run', dryRun);
      if (aligned === 0) {
        return error(`Nothing aligned: ${results.map((r) => `${r['trackIndex']}/${r['itemIndex']}: ${r['error']}`).join('; ')}`);
      }
      return ok({ guide, dryRun, aligned, failed: results.length - aligned, guideHits: guideHits.length, results });
    },
  );
}
