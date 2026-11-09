import type { ExtensionApi, ExtensionModule, ToolResult } from '@reaper-mcp/extension-api';
import { parseProgression, voiceProgression, type Note } from './chords.js';
import { buildPattern, DRUM_MAPS } from './drums.js';

const MAX_NOTES = 4000;

/**
 * Put notes into a MIDI item: the given one, or a new one at `positionSeconds` sized to the notes (constant project
 * tempo; the tempo map is not followed). `dryRun` writes nothing.
 */
async function writeNotes(
  api: ExtensionApi,
  a: { trackIndex: number; itemIndex?: number; positionSeconds: number; dryRun?: boolean },
  notes: Note[],
  endBeat: number,
  extra: Record<string, unknown>,
): Promise<ToolResult> {
  if (notes.length > MAX_NOTES) return api.error(`${notes.length} notes is over the ${MAX_NOTES} limit for one call; write it in parts`);
  const info = await api.bridge('get_project_info');
  if (!info.success) return api.error(info.error ?? 'could not read the project');
  const tempo = (info.data as { tempo?: number }).tempo ?? 120;
  const seconds = (endBeat * 60) / tempo;
  if (a.dryRun) return api.json({ written: false, dryRun: true, noteCount: notes.length, beats: endBeat, ...extra, notes: notes.slice(0, 64) });

  let itemIndex = a.itemIndex;
  let created = false;
  const warnings: string[] = [];
  if (itemIndex === undefined) {
    const made = await api.bridge('create_midi_item', { trackIndex: a.trackIndex, startPosition: a.positionSeconds, endPosition: a.positionSeconds + seconds });
    if (!made.success) return api.error(made.error ?? 'could not create the MIDI item');
    itemIndex = (made.data as { itemIndex: number }).itemIndex;
    created = true;
  } else {
    const props = await api.bridge('get_midi_item_properties', { trackIndex: a.trackIndex, itemIndex });
    if (!props.success) return api.error(props.error ?? 'could not read the item');
    const length = (props.data as { length: number }).length;
    if (seconds > length + 1e-6) warnings.push(`the notes run ${seconds.toFixed(2)} s at ${tempo} BPM but the item is ${length.toFixed(2)} s long; the end will be cut off. Lengthen it with set_midi_item_properties.`);
  }
  const res = await api.bridge('insert_midi_notes', { trackIndex: a.trackIndex, itemIndex, notes });
  if (!res.success) return api.error(res.error ?? 'could not insert the notes');
  return api.json({
    written: true,
    trackIndex: a.trackIndex,
    itemIndex,
    itemCreated: created,
    noteCount: notes.length,
    beats: endBeat,
    ...extra,
    ...(warnings.length > 0 && { warnings }),
    note: 'undo_project reverts it (a created item is a separate undo point).',
  });
}

const extension: ExtensionModule = {
  register(api) {
    const { z } = api;
    api.describeCategory(
      'Write MIDI from notation: chord progressions ("Cm7, Fm7, Bb7, Eb") and step-sequencer drum patterns with GM and GGD Invasion maps. ' +
        'Opt-in; the tools write notes only, they never pick a sound.',
    );
    const target = {
      trackIndex: z.coerce.number().int().min(0).describe('0-based track index'),
      itemIndex: z.coerce.number().int().min(0).optional().describe('MIDI item to write into. Omit to create a new item at positionSeconds, sized to the notes'),
      positionSeconds: z.coerce.number().min(0).default(0).describe('Where a new item starts (seconds). Ignored with itemIndex'),
      dryRun: z.boolean().optional().describe('Show the notes that would be written, write nothing'),
    };

    api.tool(
      'chord_progression',
      'Write a chord progression as MIDI notes. progression is text: chords separated by commas, spaces or "|", e.g. "Cm7, Fm7, Bb7, Eb" or "Am F C G/B". ' +
        'Symbols: major, m/min/-, dim, aug, sus2, sus4, 5, 6, m6, 7, maj7/M7, m7, mmaj7, m7b5, dim7, 9, maj9, m9, add9, 7sus4; slash bass ("C/E"); ' +
        '"Am:2" lasts 2 beats. Notes are in beats from the item start. octave is the root octave with C4 = 60. Whole call is checked first: a bad chord writes nothing.',
      {
        ...target,
        progression: z.string().min(1).describe('e.g. "Cm7, Fm7, Bb7, Eb"'),
        beatsPerChord: z.coerce.number().positive().default(4).describe('Beats each chord lasts unless it carries ":beats" (4 = one bar in 4/4)'),
        startBeat: z.coerce.number().min(0).default(0).describe('Beat from the item start where the first chord begins'),
        octave: z.coerce.number().int().min(-1).max(9).default(3).describe('Octave of the chord root, C4 = 60 (3 puts C at 48)'),
        inversion: z.coerce.number().int().min(0).max(4).default(0).describe('Move the lowest note up an octave this many times'),
        bass: z.boolean().default(false).describe('Also play the root (or slash bass) an octave below. A slash bass is always added'),
        velocity: z.coerce.number().int().min(1).max(127).default(90),
      },
      async (a) => {
        const parsed = parseProgression(a.progression);
        if (!parsed.ok) return api.error(`${parsed.error} (nothing was written)`);
        const voiced = voiceProgression(parsed.value, a);
        if (!voiced.ok) return api.error(`${voiced.error} (nothing was written)`);
        return writeNotes(api, a, voiced.value.notes, voiced.value.endBeat, { chords: voiced.value.chords });
      },
    );

    api.tool(
      'drum_pattern',
      'Write a drum pattern from step-sequencer lanes as MIDI notes. lanes maps a drum name (or a note number) to a string of steps: x hit, X accent, o ghost, - rest; ' +
        'spaces and "|" are ignored, e.g. { "kick": "x---x---x---x---", "snare": "----x-------x---", "hihat": "x-x-x-x-x-x-x-x-" }. ' +
        'All lanes must be the same length. map picks the drum-name → note table: gm (General MIDI) or invasion (GetGood Drums Invasion, Kontakt, which is NOT GM); ' +
        'pitches overrides single lanes. A lane the map lacks is refused with the list of lanes it has. Steps are 16ths by default (stepsPerBeat 4).',
      {
        ...target,
        lanes: z.record(z.string(), z.string()).describe('Lane name or note number → steps, e.g. {"kick":"x---x---"}'),
        map: z.enum(['gm', 'invasion', 'custom']).default('gm').describe(`Drum map: ${Object.keys(DRUM_MAPS).join(', ')}; custom = every lane is a note number or in pitches`),
        pitches: z.record(z.string(), z.coerce.number().int().min(0).max(127)).default({}).describe('Lane name → note, overriding the map'),
        stepsPerBeat: z.coerce.number().int().min(1).max(12).default(4).describe('4 = 16th-note steps, 2 = 8ths, 3 = 8th-note triplets'),
        beatsPerBar: z.coerce.number().int().min(1).max(16).default(4),
        repeat: z.coerce.number().int().min(1).max(64).default(1).describe('Repeat the pattern this many times'),
        swing: z.coerce.number().min(0).max(1).default(0).describe('0-1: every second step lands later, up to a third of a step'),
        startBeat: z.coerce.number().min(0).default(0),
        noteLength: z.coerce.number().positive().optional().describe('Note length in beats (default one step)'),
      },
      async (a) => {
        const built = buildPattern(a.lanes, a);
        if (!built.ok) return api.error(`${built.error} (nothing was written)`);
        const p = built.value;
        const bars = p.patternBeats / a.beatsPerBar;
        return writeNotes(api, a, p.notes, p.endBeat, {
          lanes: p.lanes,
          patternBars: Number.isInteger(bars) ? bars : Number(bars.toFixed(3)),
          repeat: a.repeat,
        });
      },
    );
  },
};

export default extension;
