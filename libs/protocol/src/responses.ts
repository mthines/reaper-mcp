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
