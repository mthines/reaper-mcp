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
  | 'analyze_fx'
  | 'set_fx_parameter'
  | 'set_fx_enabled'
  | 'set_fx_offline'
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
  | 'snapshot_delete'
  | 'get_track_routing'
  | 'read_track_lufs'
  | 'read_track_correlation'
  | 'read_track_crest'
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
  // Tempo
  | 'get_tempo_map'
  // Envelopes
  | 'get_track_envelopes'
  | 'get_envelope_points'
  | 'insert_envelope_point'
  | 'insert_envelope_points'
  | 'delete_envelope_point'
  | 'create_track_envelope'
  | 'set_envelope_properties'
  | 'clear_envelope'
  | 'remove_envelope_points'
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
  // Composite batch tools
  | 'set_multiple_track_properties'
  | 'setup_fx_chain'
  | 'set_multiple_fx_parameters'
  // Plan executor
  | 'run_plan'
  // Actions proxy + selection setters
  | 'search_actions'
  | 'get_action'
  | 'run_action'
  | 'set_selected_tracks'
  | 'set_selected_items'
  // Track structure + routing setters
  | 'add_track'
  | 'delete_track'
  | 'move_track'
  | 'set_track_folder'
  | 'set_track_info'
  | 'set_track_group'
  | 'add_send'
  | 'set_send'
  | 'remove_send'
  | 'add_hardware_output'
  // Items, takes, take FX and FX housekeeping
  | 'insert_audio_file'
  | 'list_takes'
  | 'set_active_take'
  | 'get_take_fx'
  | 'add_take_fx'
  | 'remove_take_fx'
  | 'set_take_fx_parameter'
  | 'get_item_appearance'
  | 'set_item_color'
  | 'set_item_fades'
  | 'move_fx'
  | 'copy_fx'
  | 'rename_fx'
  | 'save_fx_chain'
  | 'load_fx_chain'
  | 'list_fx_chains'
  | 'save_track_template'
  | 'insert_track_template'
  | 'list_track_templates'
  // Live MIDI output
  | 'send_midi_cc'
  | 'send_midi_pc'
  | 'send_midi_note'
  // Project ops, tempo map and marker editing
  | 'undo_project'
  | 'redo_project'
  | 'save_project'
  | 'get_render_settings'
  | 'set_render_settings'
  | 'render_project'
  | 'get_project_settings'
  | 'set_project_settings'
  | 'add_tempo_marker'
  | 'edit_tempo_marker'
  | 'delete_tempo_marker'
  | 'set_project_tempo'
  | 'edit_marker'
  | 'edit_region'
  // Semantic audio analysis (requires Python sidecar)
  | 'render_track_to_wav';

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
  namePattern?: string;
  changedOnly?: boolean;
  offset?: number;
  limit?: number;
}

export interface AnalyzeFxParams {
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
  includeFxParams?: boolean;   // default true — capture all FX parameter values
  maxParamsPerFx?: number;     // default 500 — safety cap per plugin
}

export interface SnapshotRestoreParams {
  name: string;
  restoreTrackMeta?: boolean;  // default false — do not rename/recolor tracks
  restoreSendLevels?: boolean; // default true — update existing send volumes
}

export type SnapshotListParams = Record<string, never>;

export interface SnapshotDeleteParams {
  name: string;
}

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

export interface InsertMidiNoteItem {
  pitch: number;         // 0-127
  velocity: number;      // 1-127
  startPosition: number; // beats from item start
  duration: number;      // beats (1.0 = quarter note)
  channel?: number;      // 0-15, default 0
}

export interface InsertMidiNotesParams {
  trackIndex: number;
  itemIndex: number;
  notes: InsertMidiNoteItem[];
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

export interface EditMidiNoteItem {
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
  edits: EditMidiNoteItem[];
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

export interface SetMediaItemsBatchItem {
  trackIndex: number;
  itemIndex: number;
  position?: number;      // seconds
  length?: number;        // seconds
  volume?: number;        // dB
  mute?: number;          // 0 or 1
  fadeInLength?: number;  // seconds
  fadeOutLength?: number; // seconds
  playRate?: number;      // 1.0 = normal
}

export interface SetMediaItemsPropertiesParams {
  items: SetMediaItemsBatchItem[];
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

// --- Envelope param types ---

export interface CreateTrackEnvelopeParams {
  trackIndex: number;
  envelopeName?: string;    // Built-in: "Volume", "Pan", "Mute", "Width", "Trim Volume"
  fxIndex?: number;         // For FX parameter envelopes
  paramIndex?: number;      // For FX parameter envelopes (required if fxIndex provided)
}

export interface SetEnvelopePropertiesParams {
  trackIndex: number;
  envelopeIndex: number;
  active?: boolean;
  visible?: boolean;
  armed?: boolean;
}

export interface ClearEnvelopeParams {
  trackIndex: number;
  envelopeIndex: number;
}

export interface RemoveEnvelopePointsParams {
  trackIndex: number;
  envelopeIndex: number;
  timeStart: number;  // seconds (inclusive)
  timeEnd: number;    // seconds (exclusive)
}

export interface InsertEnvelopePointItem {
  time: number;       // seconds
  value: number;
  shape?: number;     // 0=linear, 1=square, 2=slow, 3=fast start, 4=fast end, 5=bezier
  tension?: number;   // -1.0 to 1.0
}

export interface InsertEnvelopePointsParams {
  trackIndex: number;
  envelopeIndex: number;
  points: InsertEnvelopePointItem[];
}

// --- Composite batch tool param types ---

export interface SetMultipleTrackPropertiesItem {
  trackIndex: number;
  volume?: number;    // dB
  pan?: number;       // -1.0 to 1.0
  mute?: number;      // 0 or 1
  solo?: number;      // 0 or 1
  recordArm?: number; // 0 or 1
  phase?: number;     // 0 or 1
  input?: number;     // REAPER input index, -1 = no input
}

export interface SetMultipleTrackPropertiesParams {
  tracks: SetMultipleTrackPropertiesItem[];
}

export interface SetupFxChainPluginParameter {
  index: number;  // parameter index
  value: number;  // normalized 0.0–1.0
}

export interface SetupFxChainPlugin {
  fxName: string;
  enabled?: number;   // 1 = enabled (default), 0 = disabled (bypassed)
  parameters?: SetupFxChainPluginParameter[];
}

export interface SetupFxChainParams {
  trackIndex: number;
  plugins: SetupFxChainPlugin[];
}

export interface SetMultipleFxParametersItem {
  trackIndex: number;
  fxIndex: number;
  paramIndex: number;
  value: number;  // normalized 0.0–1.0
}

export interface SetMultipleFxParametersParams {
  updates: SetMultipleFxParametersItem[];
}

// --- Live MIDI output param types ---

export interface SendMidiCCParams {
  trackIndex: number;
  cc: number;       // 0-127
  value: number;    // 0-127
  channel?: number; // 0-15, default 0
}

export interface SendMidiPCParams {
  trackIndex: number;
  program: number;    // 0-127
  channel?: number;   // 0-15, default 0
  bankMsb?: number;   // 0-127, optional (CC0 bank select MSB)
  bankLsb?: number;   // 0-127, optional (CC32 bank select LSB)
}

export interface SendMidiNoteParams {
  trackIndex: number;
  pitch: number;       // 0-127
  velocity: number;    // 1-127
  channel?: number;    // 0-15, default 0
  durationMs?: number; // integer ≥ 1, optional — if provided, schedules note-off
}

// --- Semantic audio analysis param types ---

export interface RenderTrackToWavParams {
  trackIndex: number;
  startTime: number;   // seconds from project start
  endTime: number;     // seconds from project start
  commandId: string;   // used to generate a unique temp filename
}

// =============================================================================
// Plan executor (run_plan)
// =============================================================================

/**
 * A track target: 0-based index, exact track name, "{GUID}", or a "$ref"
 * bound by an earlier add_track op. A digit string matches a name first,
 * then falls back to the index.
 */
export type PlanTrackRef = number | string;

/** An FX target: index on the op's track, unique name substring, or a "$ref" bound by add_fx. */
export type PlanFxRef = number | string;

export interface PlanParamValue {
  index: number;
  value: number;
}

export type PlanOp =
  | { op: 'add_track'; name?: string; index?: number; as?: string }
  | {
      op: 'set_track';
      track: PlanTrackRef;
      volume?: number;   // dB
      pan?: number;
      mute?: number;
      solo?: number;
      recordArm?: number;
      phase?: number;
      input?: number;
      name?: string;
    }
  | {
      op: 'add_fx';
      track: PlanTrackRef;
      fxName: string;
      position?: number;
      enabled?: number;
      params?: PlanParamValue[];
      as?: string;
    }
  | { op: 'set_fx_params'; track?: PlanTrackRef; fx: PlanFxRef; params: PlanParamValue[] }
  | { op: 'add_send'; from: PlanTrackRef; to: PlanTrackRef; volume?: number; pan?: number; mute?: number }
  | { op: 'graft_fxchain'; track: PlanTrackRef; from?: PlanTrackRef; fromChunk?: string }
  | { op: 'select_tracks'; tracks: PlanTrackRef[]; mode?: SelectionMode }
  | { op: 'run_action'; action: ActionRef; section?: ActionSection; allowDialog?: boolean };

export interface RunPlanParams {
  /** JSON-encoded PlanOp[] — sent as a string because the bridge's flat parser cannot read nested arrays; mcp_plan_lib.lua decodes it. */
  ops: string;
  dryRun?: boolean;
  idempotencyKey?: string;
  snapshotBefore?: string;
  label?: string;
}

// =============================================================================
// Actions proxy + selection setters
// =============================================================================

/** Sections with a command entry point: main window, MIDI editor, MIDI event list. */
export type ActionSection = 'main' | 'midi_editor' | 'midi_event_list';

/** Command id, named id ("_SWS_…", "_aee8…" — stable across sessions), or exact action name. */
export type ActionRef = number | string;

export type SelectionMode = 'replace' | 'add';

export interface SearchActionsParams {
  query: string;
  section?: ActionSection;
  limit?: number;
}

export interface GetActionParams {
  action: ActionRef;
  section?: ActionSection;
}

export interface RunActionParams {
  action: ActionRef;
  section?: ActionSection;
  /** Allow actions whose name ends in "..." (they open a modal dialog). */
  allowDialog?: boolean;
}

export interface SetSelectedTracksParams {
  /** JSON-encoded PlanTrackRef[] (the bridge's flat parser cannot read nested arrays). */
  tracks: string;
  mode?: SelectionMode;
}

export interface SetSelectedItemsParams {
  /** JSON-encoded { trackIndex, itemIndex }[]. */
  items: string;
  mode?: SelectionMode;
}

// Track structure + routing setters. Track refs: index (-1 = master), exact name, "{GUID}" or "master".

export interface AddTrackParams {
  name?: string;
  index?: number;
}

export interface DeleteTrackParams {
  track: PlanTrackRef;
}

export interface MoveTrackParams {
  track: PlanTrackRef;
  toIndex: number;
}

export interface SetTrackFolderParams {
  track: PlanTrackRef;
  mode?: 'folder' | 'normal' | 'last';
  depth?: number;
  /** 0 = open, 1 = small, 2 = collapsed */
  collapsed?: number;
}

export interface SetTrackInfoParams {
  track: PlanTrackRef;
  name?: string;
  /** "#RRGGBB" or "none" */
  color?: string;
  channels?: number;
  masterSend?: boolean;
}

export type TrackGroupRole =
  | 'volume_lead' | 'volume_follow' | 'vca_lead' | 'vca_follow'
  | 'pan_lead' | 'pan_follow' | 'mute_lead' | 'mute_follow'
  | 'solo_lead' | 'solo_follow' | 'recarm_lead' | 'recarm_follow'
  | 'polarity_lead' | 'polarity_follow' | 'automode_lead' | 'automode_follow';

export interface SetTrackGroupParams {
  track: PlanTrackRef;
  /** 1-64 */
  group: number;
  /** JSON-encoded TrackGroupRole[]. */
  roles: string;
  enable?: boolean;
}

export type SendMode = 'post-fader' | 'pre-fx' | 'post-fx';
export type SendCategory = 'send' | 'receive' | 'hardware';

interface SendLevel {
  /** dB */
  volume?: number;
  pan?: number;
  mute?: boolean;
  mode?: SendMode;
}

export interface AddSendParams extends SendLevel {
  from: PlanTrackRef;
  to: PlanTrackRef;
  /** First channel of a stereo pair, 1-based (3 = 3/4). */
  srcChannel?: number;
  destChannel?: number;
}

export interface AddHardwareOutputParams extends SendLevel {
  track: PlanTrackRef;
  outputChannel?: number;
  mono?: boolean;
}

export interface SetSendParams extends SendLevel {
  track: PlanTrackRef;
  category?: SendCategory;
  index: number;
  srcChannel?: number;
  destChannel?: number;
  outputChannel?: number;
  mono?: boolean;
}

export interface RemoveSendParams {
  track: PlanTrackRef;
  category?: SendCategory;
  index: number;
}
// =============================================================================
// Project ops, tempo map and marker editing
// =============================================================================

export interface SaveProjectParams {
  /** Absolute .rpp path to write a copy to; the open project keeps its own path. Without it, a never-saved project is refused (no Save As dialog is ever opened). */
  path?: string;
  /** Replace an existing file at `path`. */
  overwrite?: boolean;
}

export type RenderFormat = 'wav' | 'aiff' | 'flac' | 'mp3' | 'ogg' | 'opus';
export type RenderBounds = 'custom' | 'project' | 'time_selection' | 'all_regions' | 'selected_items' | 'selected_regions';

export interface SetRenderSettingsParams {
  outputDirectory?: string;
  filePattern?: string;
  format?: RenderFormat;
  /** Second file written by the same render; 'none' disables it. */
  secondaryFormat?: RenderFormat | 'none';
  bounds?: RenderBounds;
  /** Seconds; used when bounds is "custom". */
  startTime?: number;
  endTime?: number;
  /** 0 = project sample rate. */
  sampleRate?: number;
  channels?: number;
}

export interface RenderProjectParams {
  /** Delete existing target files first (otherwise refused: REAPER would prompt). */
  overwrite?: boolean;
}

export interface SetProjectSettingsParams {
  sampleRate?: number;
  useProjectSampleRate?: boolean;
  title?: string;
  author?: string;
  notes?: string;
  repeat?: boolean;
  /** Global REAPER option, not stored in the project. */
  metronome?: boolean;
}

export interface AddTempoMarkerParams {
  position: number;
  bpm: number;
  timeSigNumerator?: number;
  timeSigDenominator?: number;
  linear?: boolean;
}

export interface EditTempoMarkerParams {
  index: number;
  position?: number;
  bpm?: number;
  timeSigNumerator?: number;
  timeSigDenominator?: number;
  linear?: boolean;
}

export interface DeleteTempoMarkerParams {
  index: number;
}

export interface SetProjectTempoParams {
  bpm: number;
}

export interface EditMarkerParams {
  markerIndex: number;
  name?: string;
  position?: number;
  color?: number;
}

export interface EditRegionParams {
  regionIndex: number;
  name?: string;
  start?: number;
  end?: number;
  color?: number;
}

// =============================================================================
// Items, takes, take FX and FX housekeeping
// =============================================================================

export interface InsertAudioFileParams {
  trackIndex: number;
  /** Absolute path of an audio file REAPER can read. */
  filePath: string;
  /** Seconds; defaults to the edit cursor. */
  position?: number;
}

export interface ItemRefParams {
  trackIndex: number;
  itemIndex: number;
}

export interface SetActiveTakeParams extends ItemRefParams {
  takeIndex: number;
}

export interface TakeRefParams extends ItemRefParams {
  /** Defaults to the active take. */
  takeIndex?: number;
}

export interface GetTakeFxParams extends TakeRefParams {
  /** When given, the result also lists that FX's parameters. */
  fxIndex?: number;
  offset?: number;
  limit?: number;
}

export interface AddTakeFxParams extends TakeRefParams {
  fxName: string;
}

export interface RemoveTakeFxParams extends TakeRefParams {
  fxIndex: number;
}

export interface SetTakeFxParameterParams extends TakeRefParams {
  fxIndex: number;
  paramIndex: number;
  value: number;
}

export interface SetItemColorParams extends ItemRefParams {
  /** "#RRGGBB", or "none" for the default color. */
  color: string;
}

/** Fade shape: 0 linear, 1 fast start, 2 fast end, 3 fast start steep, 4 fast end steep, 5 slow start/end, 6 slow start/end steep. */
export type FadeShape = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface SetItemFadesParams extends ItemRefParams {
  fadeInLength?: number;
  fadeOutLength?: number;
  fadeInShape?: FadeShape;
  fadeOutShape?: FadeShape;
  /** -1..1 */
  fadeInCurve?: number;
  /** -1..1 */
  fadeOutCurve?: number;
}

export interface TransferFxParams {
  trackIndex: number;
  fxIndex: number;
  /** Defaults to the same track. */
  toTrackIndex?: number;
  /** Defaults to the end of the target chain. */
  toIndex?: number;
}

export interface RenameFxParams {
  trackIndex: number;
  fxIndex: number;
  /** "" restores the plugin's own name. */
  name: string;
}

export interface SaveFxChainParams {
  trackIndex: number;
  /** Name under <resource>/FXChains/ (subfolders allowed, no "..", no absolute path). */
  name: string;
  overwrite?: boolean;
}

export interface LoadFxChainParams {
  trackIndex: number;
  /** Name under <resource>/FXChains/, or an absolute path to a .RfxChain file. */
  name: string;
  mode?: 'append' | 'replace';
}

export interface SaveTrackTemplateParams {
  trackIndex: number;
  /** Name under <resource>/TrackTemplates/ (subfolders allowed, no "..", no absolute path). */
  name: string;
  includeItems?: boolean;
  overwrite?: boolean;
}

export interface InsertTrackTemplateParams {
  /** Name under <resource>/TrackTemplates/, or an absolute path to a .RTrackTemplate file. */
  name: string;
  /** 0-based insert position; defaults to the end. */
  index?: number;
}
