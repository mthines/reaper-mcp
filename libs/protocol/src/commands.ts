/**
 * Command types sent from MCP server to Lua bridge via JSON files.
 *
 * Flow: MCP Server → writes command_{id}.json → Lua bridge reads & executes
 */

export interface BridgeCommand {
  id: string;
  type: CommandType;
  params: Record<string, unknown>;
  timestamp: number;
}

export type CommandType =
  | 'get_project_info'
  | 'list_tracks'
  | 'get_track_properties'
  | 'set_track_property'
  | 'add_fx'
  | 'remove_fx'
  | 'get_fx_parameters'
  | 'set_fx_parameter'
  | 'read_track_meters'
  | 'read_track_spectrum'
  | 'play'
  | 'stop'
  | 'record'
  | 'get_transport_state'
  | 'set_cursor_position'
  | 'list_available_fx'
  | 'search_fx'
  | 'get_fx_preset_list'
  | 'set_fx_preset'
  | 'snapshot_save'
  | 'snapshot_restore'
  | 'snapshot_list'
  | 'get_track_routing'
  | 'read_track_lufs'
  | 'read_track_correlation'
  | 'read_track_crest';

// --- Per-command param types ---

export type GetProjectInfoParams = Record<string, never>;

export type ListTracksParams = Record<string, never>;

export interface GetTrackPropertiesParams {
  trackIndex: number;
}

export interface SetTrackPropertyParams {
  trackIndex: number;
  property: 'volume' | 'pan' | 'mute' | 'solo';
  value: number;
}

export interface AddFxParams {
  trackIndex: number;
  fxName: string;
  position?: number; // FX chain position, -1 for end (default)
}

export interface RemoveFxParams {
  trackIndex: number;
  fxIndex: number;
}

export interface GetFxParametersParams {
  trackIndex: number;
  fxIndex: number;
}

export interface SetFxParameterParams {
  trackIndex: number;
  fxIndex: number;
  paramIndex: number;
  value: number; // normalized 0.0–1.0
}

export interface ReadTrackMetersParams {
  trackIndex: number;
}

export interface ReadTrackSpectrumParams {
  trackIndex: number;
  fftSize?: number; // default 4096
}

// --- Transport commands ---

export type PlayParams = Record<string, never>;

export type StopParams = Record<string, never>;

export type RecordParams = Record<string, never>;

export type GetTransportStateParams = Record<string, never>;

export interface SetCursorPositionParams {
  position: number; // seconds from project start
}

// --- Phase 1: Mix agent tool param types ---

export interface ListAvailableFxParams {
  category?: string; // optional filter: "eq", "compressor", etc.
}

export interface SearchFxParams {
  query: string; // fuzzy search term
}

export interface GetFxPresetListParams {
  trackIndex: number;
  fxIndex: number;
}

export interface SetFxPresetParams {
  trackIndex: number;
  fxIndex: number;
  presetName: string;
}

export interface SnapshotSaveParams {
  name: string;
  description?: string;
}

export interface SnapshotRestoreParams {
  name: string;
}

export type SnapshotListParams = Record<string, never>;

export interface GetTrackRoutingParams {
  trackIndex: number;
}

// --- Phase 4: Custom JSFX analyzer param types ---

export interface ReadTrackLufsParams {
  trackIndex: number;
}

export interface ReadTrackCorrelationParams {
  trackIndex: number;
}

export interface ReadTrackCrestParams {
  trackIndex: number;
}
