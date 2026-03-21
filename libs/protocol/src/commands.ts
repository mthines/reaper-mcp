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
  | 'read_track_crest'
  // MIDI editing
  | 'create_midi_item'
  | 'list_midi_items'
  | 'get_midi_notes'
  | 'analyze_midi'
  | 'insert_midi_note'
  | 'insert_midi_notes'
  | 'edit_midi_note'
  | 'edit_midi_notes'
  | 'delete_midi_note'
  | 'get_midi_cc'
  | 'insert_midi_cc'
  | 'delete_midi_cc'
  | 'set_midi_item_properties'
  | 'get_midi_item_properties'
  // Media item editing
  | 'list_media_items'
  | 'get_media_item_properties'
  | 'set_media_item_properties'
  | 'set_media_items_properties'
  | 'split_media_item'
  | 'delete_media_item'
  | 'move_media_item'
  | 'trim_media_item'
  | 'add_stretch_marker'
  | 'get_stretch_markers'
  | 'delete_stretch_marker'
  // Selection & navigation
  | 'get_selected_tracks'
  | 'get_time_selection'
  | 'set_time_selection'
  // Markers & regions
  | 'list_markers'
  | 'list_regions'
  | 'add_marker'
  | 'add_region'
  | 'delete_marker'
  | 'delete_region'
  // Tempo map
  | 'get_tempo_map'
  // FX enable/offline
  | 'set_fx_enabled'
  | 'set_fx_offline'
  // Envelopes
  | 'get_track_envelopes'
  | 'get_envelope_points'
  | 'insert_envelope_point'
  | 'delete_envelope_point';

// --- Per-command param types ---

export type GetProjectInfoParams = Record<string, never>;

export type ListTracksParams = Record<string, never>;

export interface GetTrackPropertiesParams {
  trackIndex: number;
}

export interface SetTrackPropertyParams {
  trackIndex: number;
  property: 'volume' | 'pan' | 'mute' | 'solo' | 'recordArm' | 'phase' | 'input';
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

// --- MIDI editing param types ---

export interface CreateMidiItemParams {
  trackIndex: number;
  startPosition: number; // seconds from project start
  endPosition: number;   // seconds from project start
}

export interface ListMidiItemsParams {
  trackIndex: number;
}

export interface GetMidiNotesParams {
  trackIndex: number;
  itemIndex: number;
  offset?: number; // skip first N notes (default 0)
  limit?: number;  // max notes to return (default all)
}

export interface AnalyzeMidiParams {
  trackIndex: number;
  itemIndex: number;
}

export interface InsertMidiNoteParams {
  trackIndex: number;
  itemIndex: number;
  pitch: number;         // 0-127 (60 = C4/Middle C)
  velocity: number;      // 1-127
  startPosition: number; // beats from item start
  duration: number;      // beats (1.0 = quarter note)
  channel?: number;      // 0-15, default 0
}

export interface InsertMidiNotesParams {
  trackIndex: number;
  itemIndex: number;
  notes: string; // JSON string array of { pitch, velocity, startPosition, duration, channel? }
}

export interface EditMidiNoteParams {
  trackIndex: number;
  itemIndex: number;
  noteIndex: number;
  pitch?: number;
  velocity?: number;
  startPosition?: number; // beats from item start
  duration?: number;      // beats
  channel?: number;
}

export interface EditMidiNotesParams {
  trackIndex: number;
  itemIndex: number;
  edits: string; // JSON string array of { noteIndex, pitch?, velocity?, startPosition?, duration?, channel? }
}

export interface DeleteMidiNoteParams {
  trackIndex: number;
  itemIndex: number;
  noteIndex: number;
}

export interface GetMidiCCParams {
  trackIndex: number;
  itemIndex: number;
  ccNumber?: number; // optional filter by CC number
}

export interface InsertMidiCCParams {
  trackIndex: number;
  itemIndex: number;
  ccNumber: number;      // 0-127
  value: number;         // 0-127
  position: number;      // beats from item start
  channel?: number;      // 0-15, default 0
}

export interface DeleteMidiCCParams {
  trackIndex: number;
  itemIndex: number;
  ccIndex: number;
}

export interface SetMidiItemPropertiesParams {
  trackIndex: number;
  itemIndex: number;
  position?: number; // seconds
  length?: number;   // seconds
  mute?: number;     // 0 or 1
  loopSource?: number; // 0 or 1
}

export interface GetMidiItemPropertiesParams {
  trackIndex: number;
  itemIndex: number;
}

// --- Media item editing param types ---

export interface ListMediaItemsParams {
  trackIndex: number;
}

export interface GetMediaItemPropertiesParams {
  trackIndex: number;
  itemIndex: number;
}

export interface SetMediaItemPropertiesParams {
  trackIndex: number;
  itemIndex: number;
  position?: number;  // seconds
  length?: number;    // seconds
  volume?: number;    // dB
  mute?: number;      // 0 or 1
  fadeInLength?: number;  // seconds
  fadeOutLength?: number; // seconds
  playRate?: number;      // 1.0 = normal
}

export interface SetMediaItemsPropertiesParams {
  items: string; // JSON string array of { trackIndex, itemIndex, position?, length?, volume?, mute?, fadeInLength?, fadeOutLength?, playRate? }
}

export interface SplitMediaItemParams {
  trackIndex: number;
  itemIndex: number;
  position: number; // seconds (absolute project position)
}

export interface DeleteMediaItemParams {
  trackIndex: number;
  itemIndex: number;
}

export interface MoveMediaItemParams {
  trackIndex: number;
  itemIndex: number;
  newPosition?: number;    // seconds
  newTrackIndex?: number;  // move to different track
}

export interface TrimMediaItemParams {
  trackIndex: number;
  itemIndex: number;
  trimStart?: number; // seconds to trim from start (positive = trim in, negative = extend)
  trimEnd?: number;   // seconds to trim from end (positive = trim in, negative = extend)
}

export interface AddStretchMarkerParams {
  trackIndex: number;
  itemIndex: number;
  position: number;       // seconds within item
  sourcePosition?: number; // seconds in source audio
}

export interface GetStretchMarkersParams {
  trackIndex: number;
  itemIndex: number;
}

export interface DeleteStretchMarkerParams {
  trackIndex: number;
  itemIndex: number;
  markerIndex: number;
}

// --- FX enable/offline param types ---

export interface SetFxEnabledParams {
  trackIndex: number;
  fxIndex: number;
  enabled: number; // 0 = disabled (bypassed), 1 = enabled
}

export interface SetFxOfflineParams {
  trackIndex: number;
  fxIndex: number;
  offline: number; // 0 = online, 1 = offline
}

// --- Selection & navigation param types ---

export type GetSelectedTracksParams = Record<string, never>;

export type GetTimeSelectionParams = Record<string, never>;

export interface SetTimeSelectionParams {
  start: number;  // seconds
  end: number;    // seconds
}

// --- Markers & regions param types ---

export type ListMarkersParams = Record<string, never>;

export type ListRegionsParams = Record<string, never>;

export interface AddMarkerParams {
  position: number;   // seconds
  name?: string;
  color?: number;     // REAPER native color int (0 = default)
}

export interface AddRegionParams {
  start: number;      // seconds
  end: number;        // seconds
  name?: string;
  color?: number;
}

export interface DeleteMarkerParams {
  markerIndex: number; // marker/region index number (not enumeration index)
}

export interface DeleteRegionParams {
  regionIndex: number; // marker/region index number (not enumeration index)
}

// --- Tempo map param types ---

export type GetTempoMapParams = Record<string, never>;

// --- Envelope param types ---

export interface GetTrackEnvelopesParams {
  trackIndex: number;
}

export interface GetEnvelopePointsParams {
  trackIndex: number;
  envelopeIndex: number;
  offset?: number;
  limit?: number;
}

export interface InsertEnvelopePointParams {
  trackIndex: number;
  envelopeIndex: number;
  time: number;       // seconds
  value: number;      // envelope-dependent scale
  shape?: number;     // 0=linear, 1=square, 2=slow start/end, 3=fast start, 4=fast end, 5=bezier
  tension?: number;   // -1.0 to 1.0 (for bezier shape)
}

export interface DeleteEnvelopePointParams {
  trackIndex: number;
  envelopeIndex: number;
  pointIndex: number;
}
