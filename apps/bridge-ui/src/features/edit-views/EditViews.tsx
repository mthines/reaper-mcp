import type { ReactNode } from 'react';
import { editViewOf, type EditView } from './edit-views.js';
import { Changes } from './views/Changes.js';
import { Envelope } from './views/Envelope.js';
import { FxChains } from './views/FxChains.js';
import { MidiStats } from './views/MidiStats.js';
import { Mixer } from './views/Mixer.js';
import { PianoRoll } from './views/PianoRoll.js';
import { Plan } from './views/Plan.js';
import { Lanes } from './views/Lanes.js';
import { Record } from './views/Record.js';
import { Modulation } from './views/Modulation.js';
import { Pins } from './views/Pins.js';
import { Render } from './views/Render.js';
import { Stretch } from './views/Stretch.js';
import { Routing } from './views/Routing.js';
import { Timeline } from './views/Timeline.js';
import type { CommandEntry } from '../../lib/commands.js';
import chartStyles from '../../styles/chart.module.css';

/**
 * What an edit changed, or what a listing showed, in the measurements' hairline language: the value now is the
 * accent, the value before is a hollow ghost (dashed for curves), and whatever this call added is drawn solid.
 */

/** The drawer's card for an edit view; nothing for commands without one */
export function EditViewSection({ entry }: { entry: CommandEntry }) {
  const v = editViewOf(entry);
  if (!v) return null;
  const write = !LISTINGS.has(entry.c) && !(v.kind === "plan" && v.dryRun);
  return (
    <section className={chartStyles.measure} aria-label={TITLE[v.kind]}>
      <div className={chartStyles.measureHead}>
        <span>{TITLE[v.kind]}</span>
        <span className={chartStyles.measureHeadNote}>{write ? "before → after" : "as it is now"}</span>
      </div>
      <div className={chartStyles.measureBody}>{render(v)}</div>
    </section>
  );
}

/** Each card is titled by what it shows; the note says whether it's a change or a look: a new kind fails typecheck until it has a title */
const TITLE: Record<EditView["kind"], string> = {
  changes: "Settings",
  envelope: "Automation",
  midi: "Notes",
  midiStats: "Velocity by pitch",
  timeline: "Timeline",
  mixer: "Tracks",
  fxChain: "Plugin chain",
  routing: "Routing",
  plan: "Plan",
  record: "Record setup",
  lanes: "Lanes",
  modulation: "Modulation",
  pins: "Plugin pins",
  stretch: "Stretch markers",
  render: "Rendered files",
};

/** Listings show what is there; every other edit view is a write that shows before and after */
const LISTINGS = new Set([
  "render_project",
  "render_versions",
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
  "get_record_setup",
  "get_track_lanes",
  "get_fx_param_modulation",
  "get_fx_pins",
  "list_monitoring_fx",
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
    case "render":
      return <Render v={v} />;
    case "record":
      return <Record v={v} />;
    case "lanes":
      return <Lanes v={v} />;
    case "modulation":
      return <Modulation v={v} />;
    case "pins":
      return <Pins v={v} />;
    case "stretch":
      return <Stretch v={v} />;
  }
}
