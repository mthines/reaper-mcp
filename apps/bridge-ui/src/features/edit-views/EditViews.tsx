import type { ReactNode } from 'react';
import { editViewOf, type EditView } from './edit-views.js';
import type { CommandEntry } from '../../lib/status.js';
import { Changes } from './views/Changes.js';
import { Envelope } from './views/Envelope.js';
import { FxChains } from './views/FxChains.js';
import { MidiStats } from './views/MidiStats.js';
import { Mixer } from './views/Mixer.js';
import { PianoRoll } from './views/PianoRoll.js';
import { Plan } from './views/Plan.js';
import { Routing } from './views/Routing.js';
import { Timeline } from './views/Timeline.js';

/** The drawer's card for an edit view; nothing for commands without one */
export function EditViewSection({ entry }: { entry: CommandEntry }) {
  const v = editViewOf(entry);
  if (!v) return null;
  const write = !LISTINGS.has(entry.c) && !(v.kind === "plan" && v.dryRun);
  return (
    <section className="measure" aria-label={write ? "Change" : "Result"}>
      <div className="measure-head">{write ? "Change" : "Result"}</div>
      <div className="measure-body">{render(v)}</div>
    </section>
  );
}

/** Listings show what is there; every other edit view is a write that shows before and after */
const LISTINGS = new Set([
  "get_envelope_points",
  "get_midi_cc",
  "get_midi_notes",
  "analyze_midi",
  "list_markers",
  "list_regions",
  "get_tempo_map",
  "list_media_items",
  "list_tracks",
  "list_midi_items",
  "get_track_properties",
  "get_track_routing",
  "get_time_selection",
  "get_fx_parameters",
]);

function render(v: EditView): ReactNode {
  switch (v.kind) {
    case "changes":
      return <Changes rows={v.rows} more={v.more} />;
    case "envelope":
      return <Envelope v={v} />;
    case "midi":
      return <PianoRoll v={v} />;
    case "midiStats":
      return <MidiStats v={v} />;
    case "timeline":
      return <Timeline v={v} />;
    case "mixer":
      return <Mixer v={v} />;
    case "plan":
      return <Plan v={v} />;
    case "fxChain":
      return <FxChains v={v} />;
    case "routing":
      return <Routing v={v} />;
  }
}
