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
