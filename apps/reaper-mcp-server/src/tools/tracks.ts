import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';

interface ListedTrack {
  index: number;
  name?: string;
  parentIndex?: number;
  depth?: number;
  volume?: number;
  pan?: number;
  mute?: boolean;
  solo?: boolean;
  fxCount?: number;
  [key: string]: unknown;
}

const COMPACT_FIELDS = ['index', 'name', 'parentIndex', 'depth', 'volume', 'pan', 'mute', 'solo', 'fxCount'] as const;

function compactTrack(t: ListedTrack): Partial<ListedTrack> {
  const out: Partial<ListedTrack> = {};
  for (const key of COMPACT_FIELDS) if (t[key] !== undefined) out[key] = t[key] as never;
  return out;
}

/** A folder by index, or by exact (then case-insensitive) name; a name used twice is ambiguous. */
function resolveParent(tracks: ListedTrack[], ref: number | string): { index: number } | { error: string } {
  if (typeof ref === 'number') {
    return tracks.some((t) => t.index === ref) ? { index: ref } : { error: `Track ${ref} not found` };
  }
  let hits = tracks.filter((t) => t.name === ref);
  if (hits.length === 0) hits = tracks.filter((t) => String(t.name ?? '').toLowerCase() === ref.toLowerCase());
  if (hits.length === 0) return { error: `No track named "${ref}"` };
  if (hits.length > 1) {
    return { error: `"${ref}" matches tracks ${hits.map((t) => t.index).join(', ')} — pass the index instead` };
  }
  return { index: hits[0].index };
}

/** Every track whose parent chain reaches `folder`, in project order. */
function descendantsOf(tracks: ListedTrack[], folder: number): ListedTrack[] {
  const parentOf = new Map(tracks.map((t) => [t.index, t.parentIndex ?? -1]));
  return tracks.filter((t) => {
    let p = parentOf.get(t.index) ?? -1;
    for (let hops = 0; p >= 0 && hops < tracks.length; hops++) {
      if (p === folder) return true;
      p = parentOf.get(p) ?? -1;
    }
    return false;
  });
}

export function registerTrackTools(server: McpServer): void {
  server.tool(
    'list_tracks',
    'List tracks in the current REAPER project with name, index, volume, mute/solo state, and folder structure. ' +
    'In large sessions filter it: parent (a folder track — returns everything inside it), nameContains, compact ' +
    '(index, name, parentIndex, depth, volume, pan, mute, solo, fxCount only), offset/limit. With no params it returns ' +
    'every track as before; with any, it returns { total, offset, returned, hasMore, tracks }.',
    {
      parent: z.union([z.coerce.number().int().min(0), z.string().min(1)]).optional()
        .describe('Folder track (index or exact name) — return only the tracks inside it, at any depth'),
      nameContains: z.string().min(1).optional().describe('Only tracks whose name contains this (case-insensitive)'),
      compact: z.boolean().optional().describe('Only index, name, parentIndex, depth, volume, pan, mute, solo, fxCount'),
      offset: z.coerce.number().int().min(0).optional().describe('Skip this many matching tracks (default 0)'),
      limit: z.coerce.number().int().min(1).max(500).optional().describe('Return at most this many tracks'),
    },
    async (params) => {
      const res = await sendCommand('list_tracks');
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      const { parent, nameContains, compact, offset, limit } = params ?? {};
      if (parent == null && nameContains == null && !compact && offset == null && limit == null) {
        return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
      }

      let tracks = (res.data as ListedTrack[]) ?? [];
      if (parent != null) {
        const resolved = resolveParent(tracks, parent);
        if ('error' in resolved) return { content: [{ type: 'text', text: `Error: ${resolved.error}` }], isError: true };
        tracks = descendantsOf(tracks, resolved.index);
      }
      if (nameContains != null) {
        const needle = nameContains.toLowerCase();
        tracks = tracks.filter((t) => String(t.name ?? '').toLowerCase().includes(needle));
      }
      const total = tracks.length;
      const start = offset ?? 0;
      const page = tracks.slice(start, limit != null ? start + limit : undefined);
      const out = compact ? page.map(compactTrack) : page;
      const body = { total, offset: start, returned: out.length, hasMore: start + out.length < total, tracks: out };
      return { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }] };
    }
  );

  server.tool(
    'get_track_properties',
    'Get detailed properties of a specific track including volume, pan, mute, solo, and FX chain',
    { trackIndex: z.coerce.number().int().min(-1).describe('Zero-based track index (-1 = master track)') },
    async ({ trackIndex }) => {
      const res = await sendCommand('get_track_properties', { trackIndex });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'set_track_property',
    'Set a track property: volume (dB), pan (-1.0 to 1.0), mute/solo/recordArm/phase (0/1), input (REAPER input index), playOffsetMs (track playback offset in ms, negative = earlier; use with measure_track_alignment)',
    {
      trackIndex: z.coerce.number().int().min(-1).describe('Zero-based track index (-1 = master track)'),
      property: z.enum(['volume', 'pan', 'mute', 'solo', 'recordArm', 'phase', 'input', 'playOffsetMs']).describe('Property to set: volume (dB), pan (-1.0–1.0), mute/solo/recordArm/phase (0 or 1), input (REAPER input index, -1=no input), playOffsetMs (ms, -500..500)'),
      value: z.coerce.number().describe('Value: volume in dB, pan -1.0–1.0, mute/solo/recordArm/phase 0 or 1, input = REAPER input index'),
    },
    async ({ trackIndex, property, value }) => {
      if (property === 'playOffsetMs' && Math.abs(value) > 500) {
        return { content: [{ type: 'text', text: 'Error: playOffsetMs must be between -500 and 500' }], isError: true };
      }
      const res = await sendCommand('set_track_property', { trackIndex, property, value });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Set track ${trackIndex} ${property} = ${value}` }] };
    }
  );
}
