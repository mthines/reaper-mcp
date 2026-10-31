// What a write changed or a listing showed, drawn in the drawer. Import from here, never the files.
import { EditViewSection } from './EditViews.js';
import { ChangeLegend, ChangeMark, Legend } from './views/ChangeLegend.js';
import { Changes } from './views/Changes.js';
import { Envelope } from './views/Envelope.js';
import { FxChains } from './views/FxChains.js';
import { MidiStats } from './views/MidiStats.js';
import { Mixer } from './views/Mixer.js';
import { PianoRoll } from './views/PianoRoll.js';
import { Plan } from './views/Plan.js';
import { Render } from './views/Render.js';
import { Routing } from './views/Routing.js';
import { Timeline } from './views/Timeline.js';

/** `EditView.Section` is the drawer's card for a call; the rest draw one kind of view each */
export const EditView = { Section: EditViewSection, Changes, Envelope, PianoRoll, MidiStats, Timeline, Mixer, Plan, FxChains, Routing, Render, ChangeMark, ChangeLegend, Legend };

export { editKindOf, editViewOf, type EditView as EditViewData, type SlotChange } from './edit-views.js';
