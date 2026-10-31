// What a write changed or a listing showed, drawn in the drawer. Import from here, never the files.
import { EditViewSection } from './EditViews.js';
import { ChangeLegend, ChangeMark, Legend } from './views/ChangeLegend.js';
import { Changes } from './views/Changes.js';
import { Counts } from './views/Counts.js';
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
import { ZoomSwitch } from './views/ZoomSwitch.js';

/** `EditView.Section` is the drawer's card for a call; the rest draw one kind of view each */
export const EditView = { Section: EditViewSection, Changes, Envelope, PianoRoll, MidiStats, Timeline, Mixer, Plan, FxChains, Routing, Render, Record, Lanes, Modulation, Pins, Stretch, Counts, ZoomSwitch, ChangeMark, ChangeLegend, Legend };

export { editKindOf, editViewOf, type EditView as EditViewData, type SlotChange } from './edit-views.js';
