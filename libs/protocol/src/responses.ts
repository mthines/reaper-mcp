/**
 * Response types sent from Lua bridge back to MCP server via JSON files.
 *
 * Flow: Lua bridge → writes response_{id}.json → MCP server reads & returns to client
 */

export interface BridgeResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
  timestamp: number;
}

// --- Per-command response data types ---

export interface ProjectInfo {
  name: string;
  path: string;
  trackCount: number;
  tempo: number;
  timeSignatureNumerator: number;
  timeSignatureDenominator: number;
  sampleRate: number;
  isPlaying: boolean;
  isRecording: boolean;
  cursorPosition: number;
}

export interface TrackInfo {
  index: number;
  name: string;
  volume: number;       // dB
  volumeRaw: number;    // raw 0.0–4.0 scale
  pan: number;          // -1.0 to 1.0
  mute: boolean;
  solo: boolean;
  recordArm: boolean;
  phase: boolean;       // true = phase inverted
  inputChannel: number; // REAPER input index (-1 = no input)
  fxCount: number;
  receiveCount: number;
  sendCount: number;
  depth: number;        // folder depth (0 = top level)
  parentIndex: number;  // -1 if no parent
  color: number;        // REAPER native color int
}

export interface TrackProperties extends TrackInfo {
  fxList: FxInfo[];
}

export interface FxInfo {
  index: number;
  name: string;
  enabled: boolean;
  offline: boolean;
  preset: string;
}

export interface FxParameterInfo {
  index: number;
  name: string;
  value: number;          // normalized 0.0–1.0
  formattedValue: string; // human-readable (e.g. "-6.0 dB")
  minValue: number;
  maxValue: number;
}

export interface TrackMeters {
  trackIndex: number;
  peakL: number;  // dB
  peakR: number;  // dB
  rmsL: number;   // dB
  rmsR: number;   // dB
}

export interface TrackSpectrum {
  trackIndex: number;
  fftSize: number;
  sampleRate: number;
  binCount: number;
  frequencyResolution: number; // Hz per bin
  peakDb: number;
  rmsDb: number;
  /** Magnitude in dB for each frequency bin, from 0 Hz to Nyquist */
  bins: number[];
}

export interface TransportState {
  playing: boolean;
  recording: boolean;
  paused: boolean;
  cursorPosition: number;  // edit cursor, seconds
  playPosition: number;    // play cursor, seconds (only meaningful while playing)
  tempo: number;
  timeSignatureNumerator: number;
  timeSignatureDenominator: number;
}

// --- Phase 1: Mix agent response types ---

export interface AvailableFx {
  name: string;   // full name as shown in REAPER
  type: string;   // "VST", "VST3", "JS", "CLAP", "AU"
  path?: string;  // file path if available
}

export interface FxPresetInfo {
  index: number;
  name: string;
}

export interface Snapshot {
  name: string;
  description?: string;
  timestamp: number;
  version?: number;     // 1 = legacy (bypass only), 2 = full (FX params, sends, meta)
  trackCount?: number;
}

export interface TrackRouting {
  trackIndex: number;
  sends: Array<{
    destTrackIndex: number;
    destTrackName: string;
    volume: number;
    pan: number;
    muted: boolean;
  }>;
  receives: Array<{
    srcTrackIndex: number;
    srcTrackName: string;
    volume: number;
    pan: number;
    muted: boolean;
  }>;
  parentTrackIndex: number;
  isFolder: boolean;
  folderDepth: number;
}

// --- Phase 4: Custom JSFX analyzer response types ---

export interface LufsData {
  trackIndex: number;
  integrated: number;   // LUFS (running average since measurement start)
  shortTerm: number;    // LUFS (3-second sliding window)
  momentary: number;    // LUFS (400ms sliding window)
  truePeakL: number;    // dBTP (inter-sample peak, left channel)
  truePeakR: number;    // dBTP (inter-sample peak, right channel)
  duration: number;     // seconds since measurement start
}

export interface CorrelationData {
  trackIndex: number;
  correlation: number;  // -1.0 (out of phase) to +1.0 (mono), 0 = uncorrelated
  stereoWidth: number;  // 0.0 (mono) to 2.0 (very wide), 1.0 = normal stereo
  midLevel: number;     // dB (mid channel RMS)
  sideLevel: number;    // dB (side channel RMS)
}

export interface CrestFactorData {
  trackIndex: number;
  crestFactor: number;  // dB (peak - RMS); higher = more dynamic
  peakLevel: number;    // dB (peak hold level)
  rmsLevel: number;     // dB (RMS level over window)
}

// --- MIDI editing response types ---

export interface MidiItemInfo {
  itemIndex: number;
  position: number;      // seconds
  length: number;        // seconds
  noteCount: number;
  ccCount: number;
  muted: boolean;
}

export interface MidiNoteInfo {
  noteIndex: number;
  pitch: number;         // 0-127
  velocity: number;      // 0-127
  startPosition: number; // beats from item start
  duration: number;      // beats
  channel: number;       // 0-15
  selected: boolean;
  muted: boolean;
}

export interface MidiCCInfo {
  ccIndex: number;
  ccNumber: number;   // 0-127
  value: number;       // 0-127
  position: number;    // beats from item start
  channel: number;     // 0-15
}

export interface MidiItemProperties {
  trackIndex: number;
  itemIndex: number;
  position: number;
  length: number;
  noteCount: number;
  ccCount: number;
  muted: boolean;
  loopSource: boolean;
}

export interface MidiPitchStats {
  pitch: number;        // 0-127
  count: number;
  minVelocity: number;
  maxVelocity: number;
  avgVelocity: number;
  stdDev: number;
  maxConsecutiveSameVelocity: number; // machine gun detection
}

export interface MidiAnalysis {
  trackIndex: number;
  itemIndex: number;
  totalNotes: number;
  totalCC: number;
  durationBeats: number;
  pitchStats: MidiPitchStats[];
  velocityHistogram: number[]; // 13 buckets: 0-9, 10-19, ..., 120-127
  machineGunWarnings: Array<{
    pitch: number;
    maxConsecutive: number;
    sequences: number; // how many runs of 3+ identical velocities
  }>;
}

// --- Media item editing response types ---

export interface MediaItemInfo {
  itemIndex: number;
  position: number;      // seconds
  length: number;        // seconds
  name: string;
  volume: number;        // dB
  volumeRaw: number;     // linear 0.0–4.0 scale
  muted: boolean;
  fadeInLength: number;  // seconds
  fadeOutLength: number; // seconds
  fadeInShape: number;   // 0=linear, 1-6=curve shapes
  fadeOutShape: number;  // 0=linear, 1-6=curve shapes
  playRate: number;
  pitch: number;         // semitones
  startOffset: number;   // seconds into source
  loopSource: boolean;
  isMidi: boolean;
  takeName: string;
  sourceFile: string;
  locked: boolean;
}

export interface StretchMarkerInfo {
  index: number;
  position: number;       // seconds within item
  sourcePosition: number; // seconds in source
}

// --- Selection & navigation response types ---

export interface SelectedTrackInfo {
  index: number;
  name: string;
}

export interface TimeSelectionInfo {
  start: number;   // seconds
  end: number;     // seconds
  length: number;  // seconds
  empty: boolean;  // true if no time selection
}

// --- Markers & regions response types ---

export interface MarkerInfo {
  index: number;       // marker/region index number
  name: string;
  position: number;    // seconds
  color: number;       // REAPER native color (0 = default)
}

export interface RegionInfo {
  index: number;       // marker/region index number
  name: string;
  start: number;       // seconds
  end: number;         // seconds
  color: number;
}

// --- Tempo map response types ---

export interface TempoMapPoint {
  index: number;
  position: number;                 // seconds
  beatPosition: number;             // beats from project start
  tempo: number;                    // BPM
  timeSignatureNumerator: number;
  timeSignatureDenominator: number;
  linearTempo: boolean;             // true = linear tempo change to next point
}

// --- Envelope response types ---

export interface TrackEnvelopeInfo {
  index: number;
  name: string;
  pointCount: number;
  active: boolean;
  visible: boolean;
  armed: boolean;
}

export interface EnvelopePointInfo {
  pointIndex: number;
  time: number;       // seconds
  value: number;
  shape: number;      // 0=linear, 1=square, 2=slow, 3=fast start, 4=fast end, 5=bezier
  tension: number;    // -1.0 to 1.0
  selected: boolean;
}

// --- Combined measurement response types ---

export interface TrackMeasurement {
  trackIndex: number;
  lufs?: LufsData;
  crest?: CrestFactorData;
  correlation?: CorrelationData;
  spectrum?: TrackSpectrum;
}

export interface MeasureTracksResult {
  tracks: TrackMeasurement[];
  durationSeconds: number;
  startPosition: number;
  endPosition: number;
}
