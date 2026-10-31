// What a measuring command read, drawn in the drawer. Import from here, never the files.
import { Aesthetics } from './Aesthetics.js';
import { Alignment } from './Alignment.js';
import { Key } from './Key.js';
import { Loudness } from './Loudness.js';
import { MeasurementView } from './Measurement.js';
import { Offline } from './OfflineAnalysis.js';
import { Level, Readout, Scale } from './Readout.js';
import { Spectrum } from './Spectrum.js';
import { Waveform } from './Waveform.js';

/** A call's result (`<Measurement entry … />`), one part per kind, and the readouts they are built from */
export const Measurement = Object.assign(MeasurementView, { Readout, Level, Scale, Loudness, Spectrum, Waveform, Offline, Alignment, Aesthetics, Key });

export { fmt, zoneOf, type Zone } from './format.js';
