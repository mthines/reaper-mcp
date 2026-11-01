// What a measuring command read, drawn in the drawer. Import from here, never the files.
import { Aesthetics } from './Aesthetics.js';
import { Alignment } from './Alignment.js';
import { Key } from './Key.js';
import { Chords } from './Chords.js';
import { Loudness } from './Loudness.js';
import { LoudnessCurve } from './LoudnessCurve.js';
import { Masking } from './Masking.js';
import { MeasurementView } from './Measurement.js';
import { Offline } from './OfflineAnalysis.js';
import { Level, Readout, Scale } from './Readout.js';
import { Spectrum } from './Spectrum.js';
import { Stems } from './Stems.js';
import { StereoBands } from './StereoBands.js';
import { Waveform } from './Waveform.js';

/** A call's result (`<Measurement entry … />`), one part per kind, and the readouts they are built from */
export const Measurement = Object.assign(MeasurementView, { Readout, Level, Scale, Loudness, Spectrum, Waveform, Offline, Alignment, Aesthetics, Key, Chords, LoudnessCurve, StereoBands, Masking, Stems });

export { fmt, zoneOf, type Zone } from './format.js';
