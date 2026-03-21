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
  | 'read_track_spectrum';

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
