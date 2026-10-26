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

export interface FxParametersResult {
  trackIndex: number;
  fxIndex: number;
  fxName: string;
  parameterCount: number;
  matchedCount: number;
  returned: number;
  offset: number;
  hasMore: boolean;
  parameters: FxParameterInfo[];
}

export interface FxAnalysisNotableParam {
  index: number;
  name: string;
  value: number;
  formattedValue: string;
}

export interface FxAnalysisEqBand {
  bandIndex: number;
  enabled: boolean;
  frequency: string;
  gain: string;
  q: string;
  shape: string;
  paramIndices: number[];
}

export interface FxAnalysisCompressorSettings {
  threshold?: FxAnalysisNotableParam;
  ratio?: FxAnalysisNotableParam;
  attack?: FxAnalysisNotableParam;
  release?: FxAnalysisNotableParam;
  makeup?: FxAnalysisNotableParam;
  knee?: FxAnalysisNotableParam;
}

export interface FxAnalysis {
  trackIndex: number;
  fxIndex: number;
  fxName: string;
  presetName: string;
  parameterCount: number;
  notableParamCount: number;
  pluginType: 'eq' | 'compressor' | 'generic';
  eqBands?: FxAnalysisEqBand[];
  compressorSettings?: FxAnalysisCompressorSettings;
  notableParams: FxAnalysisNotableParam[];
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

/** Fields the routing setters added; 1-based first channel of a pair, srcChannel -1 = none. */
interface RouteDetail {
  index?: number;
  mode?: 'post-fader' | 'pre-fx' | 'post-fx';
  srcChannel?: number;
  destChannel?: number;
}

export interface HardwareOutput {
  index: number;
  volume: number;
  pan: number;
  muted: boolean;
  mode: 'post-fader' | 'pre-fx' | 'post-fx';
  srcChannel: number;
  outputChannel: number;
  mono: boolean;
}

export interface TrackRouting {
  trackIndex: number;
  sends: Array<RouteDetail & {
    destTrackIndex: number;
    destTrackName: string;
    volume: number;
    pan: number;
    muted: boolean;
  }>;
  receives: Array<RouteDetail & {
    srcTrackIndex: number;
    srcTrackName: string;
    volume: number;
    pan: number;
    muted: boolean;
  }>;
  parentTrackIndex: number;
  isFolder: boolean;
  folderDepth: number;
  hardwareOutputs?: HardwareOutput[];
  /** Absent on the master track. */
  masterSend?: boolean;
  channels?: number;
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

// --- Composite batch tool response types ---

export interface SetMultipleTrackPropertiesResult {
  updated: number;
  total: number;
  errors?: string[];
}

export interface SetupFxChainAddedPlugin {
  pluginIndex: number;  // index in the input plugins array
  fxName: string;       // resolved FX name as shown in REAPER
  fxIndex: number;      // FX chain index where it was added
}

export interface SetupFxChainResult {
  trackIndex: number;
  added: number;
  total: number;
  plugins: SetupFxChainAddedPlugin[];
  errors?: string[];
}

export interface SetMultipleFxParametersResult {
  updated: number;
  total: number;
  errors?: string[];
}

// --- Live MIDI output response types ---

export interface SendMidiResult {
  sent: boolean;
  timestampMs: number;
}

// --- Semantic audio analysis response types ---

export interface RenderTrackToWavResult {
  trackIndex: number;
  trackName: string;
  wavPath: string;        // absolute path to temp WAV file
  durationSeconds: number;
  sampleRate: number;
  channelCount: number;
}

export interface AestheticsResult {
  trackIndex: number;
  trackName: string;
  productionQuality: number;       // PQ axis, 0-10
  productionComplexity: number;    // PC axis, 0-10
  contentEnjoyment: number;        // CE axis, 0-10
  contentUsefulness: number;       // CU axis, 0-10
  startTime: number;               // seconds
  endTime: number;                 // seconds
  durationSeconds: number;
  modelVersion: string;            // "facebook/audiobox-aesthetics"
  tempFilePath?: string;           // debug only — will be deleted after response
}

// =============================================================================
// Plan executor (run_plan)
// =============================================================================

export interface RunPlanConflict {
  op: number;      // 0-based op index
  type: string;    // op type
  error: string;
}

export interface RunPlanDryRunResult {
  dryRun: true;
  valid: boolean;
  ops: { index: number; op: string }[];
  conflicts: RunPlanConflict[];
  warnings: { op: number; type: string; warning: string }[];
}

export interface RunPlanAppliedResult {
  success: true;
  applied: number;
  results: { index: number; op: string; result: Record<string, unknown> }[];
  idempotencyKey?: string;
}

export interface RunPlanAlreadyAppliedResult {
  alreadyApplied: true;
  idempotencyKey: string;
  result: RunPlanAppliedResult;
}

export type RunPlanResult = RunPlanDryRunResult | RunPlanAppliedResult | RunPlanAlreadyAppliedResult;

// =============================================================================
// Actions proxy + selection setters
// =============================================================================

export interface ActionInfo {
  id: number;
  /** Stable id for custom actions, scripts and extensions; absent for native actions. */
  namedId?: string;
  name: string;
  section: string;
  /** -1 when the action is not a toggle, else 0 (off) / 1 (on). */
  toggle: number;
  shortcuts: string[];
  opensDialog: boolean;
  /** Reason the action is always refused, if it is. */
  denied?: string;
}

export interface SearchActionsResult {
  section: string;
  query: string;
  total: number;
  returned: number;
  actions: ActionInfo[];
}

export interface ActionDetails extends ActionInfo {
  kind: 'native' | 'extension' | 'custom' | 'script';
  steps?: { action: string; id?: number; name: string }[];
  scriptPath?: string;
}

export interface RunActionResult extends ActionInfo {
  ran: true;
}

export interface SelectedTracksResult {
  selected: { index: number; name: string }[];
}

export interface SelectedItemsResult {
  selected: { trackIndex: number; itemIndex: number }[];
}

// =============================================================================
// Project ops, tempo map and marker editing
// =============================================================================

export interface UndoRedoResult {
  undone?: string;
  redone?: string;
  nextUndo?: string;
  nextRedo?: string;
}

export interface SaveProjectResult {
  saved: true;
  path: string;
  projectPath?: string;
  /** True when `path` was written as a copy and the open project kept its own path. */
  savedAsCopy?: boolean;
}

export interface RenderSettings {
  outputDirectory: string;
  filePattern: string;
  /** "other:<fourcc>" for a sink outside the supported list. */
  format: string | null;
  /** 'none' when no secondary file is rendered. */
  secondaryFormat: string;
  bounds: string;
  startTime: number;
  endTime: number;
  sampleRate: number;
  channels: number;
  /** Files a render would write, as REAPER resolves them. */
  targets: string[];
}

export interface RenderProjectResult {
  rendered: true;
  files: string[];
  missing: string[];
  bounds: string;
  format: string | null;
}

export interface ProjectSettings {
  path: string;
  sampleRate: number;
  useProjectSampleRate: boolean;
  title: string;
  author: string;
  notes: string;
  repeat: boolean;
  metronome: boolean;
}

export interface TempoMapResult {
  markers: {
    index: number;
    position: number;
    bpm: number;
    timeSigNumerator: number;
    timeSigDenominator: number;
    linearTempo: boolean;
  }[];
  count: number;
  /** Real tempo markers; 0 means `markers` holds the project tempo only. */
  tempoMarkerCount: number;
}

// =============================================================================
// Items, takes, take FX and FX housekeeping
// =============================================================================

export interface InsertAudioFileResult {
  trackIndex: number;
  itemIndex: number;
  position: number;
  length: number;
  takeName: string;
  sourceFile: string;
}

/** An empty take slot is listed as { takeIndex, empty: true } only. */
export interface TakeInfo {
  takeIndex: number;
  empty?: true;
  name?: string;
  active?: boolean;
  isMidi?: boolean;
  sourceFile?: string;
  fxCount?: number;
}

export interface TakesResult {
  trackIndex: number;
  itemIndex: number;
  activeTakeIndex: number;
  takes: TakeInfo[];
}

export interface TakeFxInfo {
  fxIndex: number;
  name: string;
  enabled: boolean;
  paramCount: number;
}

export interface TakeFxResult {
  trackIndex: number;
  itemIndex: number;
  takeIndex: number;
  fx: TakeFxInfo[];
  fxIndex?: number;
  fxName?: string;
  removedFxIndex?: number;
  params?: { paramIndex: number; name: string; value: number; min: number; max: number; formatted: string }[];
}

export interface ItemAppearance {
  trackIndex: number;
  itemIndex: number;
  /** "#RRGGBB", or "none" for the default color. */
  color: string;
  fadeInLength: number;
  fadeInShape: number;
  fadeInCurve: number;
  fadeOutLength: number;
  fadeOutShape: number;
  fadeOutCurve: number;
}

export interface TransferFxResult {
  trackIndex: number;
  fxIndex: number;
  toTrackIndex: number;
  toIndex: number;
  /** Source chain after the move/copy. */
  fx: string[];
  /** Target chain, when it is another track. */
  toFx?: string[];
}

export interface FxChainFileResult {
  trackIndex: number;
  name: string;
  path: string;
  fx: string[];
  fxCount?: number;
  mode?: 'append' | 'replace';
  loaded?: number;
  fxCountBefore?: number;
}

export interface TrackTemplateInsertResult {
  name: string;
  path: string;
  inserted: { index: number; name: string; fx: string[] }[];
}

export interface ResourceFileList {
  folder: string;
  names: string[];
  total: number;
  truncated: boolean;
}

