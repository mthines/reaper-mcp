import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

/** Resolve asset path — checks sibling, parent, and walks up to repo root for dev/source usage */
export function resolveAssetDir(baseDir: string, name: string): string {
  // Check sibling (npm published layout: dist/apps/reaper-mcp-server/reaper/)
  const sibling = join(baseDir, name);
  if (existsSync(sibling)) return sibling;

  // Check parent (esbuild output: dist/apps/reaper-mcp-server/../reaper/)
  const parent = join(baseDir, '..', name);
  if (existsSync(parent)) return parent;

  // Walk up from baseDir to find the asset directory (running from source: src/ -> app/ -> apps/ -> repo root)
  let dir = baseDir;
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
    const up = join(dir, '..');
    if (up === dir) break; // reached filesystem root
    dir = up;
  }

  // Fallback to the original sibling path (will fail gracefully downstream)
  return sibling;
}

/** Recursively copy a directory, returns file count */
export function copyDirSync(src: string, dest: string): number {
  if (!existsSync(src)) return 0;
  mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      count += copyDirSync(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
      count++;
    }
  }
  return count;
}

/** Copy a single file if it exists, returns success */
export function installFile(src: string, dest: string): boolean {
  if (existsSync(src)) {
    copyFileSync(src, dest);
    return true;
  }
  return false;
}

/**
 * Create .mcp.json with reaper server config. It runs `node <serverScript> serve` by
 * absolute path, so it works without `reaper-mcp` on PATH.
 */
export function createMcpJson(targetPath: string, serverScript: string): boolean {
  if (existsSync(targetPath)) return false;
  const config = JSON.stringify({
    mcpServers: {
      reaper: {
        command: 'node',
        args: [resolve(serverScript), 'serve'],
      },
    },
  }, null, 2);
  writeFileSync(targetPath, config + '\n', 'utf-8');
  return true;
}

/** True when Claude Code's user config (~/.claude.json) registers a `reaper` MCP server (`claude mcp add --scope user`) */
export function hasUserMcpServer(claudeJsonPath: string): boolean {
  try {
    const config = JSON.parse(readFileSync(claudeJsonPath, 'utf-8'));
    return Boolean(config?.mcpServers?.reaper);
  } catch {
    return false;
  }
}

/** Expected REAPER asset files that must be in the package */
export const REAPER_ASSETS = [
  'mcp_bridge.lua',
  'mcp_analyzer.jsfx',
  'mcp_lufs_meter.jsfx',
  'mcp_correlation_meter.jsfx',
  'mcp_crest_factor.jsfx',
  'mcp_midi_emitter.jsfx',
  'mcp_gain_trace.jsfx',
  'mcp_snapshot_lib.lua',
  'mcp_plan_lib.lua',
  'mcp_actions_lib.lua',
  'mcp_tracks_lib.lua',
  'mcp_project_lib.lua',
  'mcp_items_lib.lua',
  'mcp_arrange_lib.lua',
  'mcp_envelopes_lib.lua',
  'mcp_recording_lib.lua',
  'mcp_midi_lib.lua',
  'mcp_edit_views_lib.lua',
  'mcp_snapshots_ui_lib.lua',
  'mcp_snapshot_next.lua',
  'mcp_snapshot_prev.lua',
  'mcp_snapshot_quick_save.lua',
] as const;

/** Files earlier versions installed into REAPER's Scripts/ that setup now deletes */
export const RETIRED_ASSETS = ['mcp_snapshot_manager.lua'] as const;

/** Bridge status UI installed into REAPER's reaper_www_root/ (built by apps/bridge-ui) */
export const BRIDGE_UI_FILE = 'mcp_bridge.html';

/** Default port for the REAPER web interface that setup enables (8080 often clashes with dev servers) */
export const DEFAULT_WEB_PORT = 8099;

/**
 * Enable REAPER's web browser interface in reaper.ini text, serving the bridge UI.
 * Control surfaces live in [REAPER] as `csurf_cnt=N` + `csurf_<i>=HTTP <flags> <port> '<user:pass>' '<page>' 0 ''`.
 * An existing HTTP surface is kept as-is (its port is returned) so a user's own setup is never touched.
 * Only safe while REAPER is closed: REAPER rewrites reaper.ini from memory on exit.
 */
export function ensureWebInterface(ini: string, port: number): { ini: string; port: number; changed: boolean } {
  // REAPER loads only csurf_0 … csurf_<cnt-1>; an HTTP line past the count is a leftover it ignores
  const active = Number(ini.match(/^csurf_cnt=(\d+)/m)?.[1] ?? 0);
  for (const m of ini.matchAll(/^csurf_(\d+)=HTTP \S+ (\d+)/gm)) {
    if (Number(m[1]) < active) return { ini, port: Number(m[2]), changed: false };
  }

  const eol = ini.includes('\r\n') ? '\r\n' : '\n';
  const lines = ini.split(/\r?\n/);
  let start = lines.findIndex((l) => l.trim() === '[REAPER]');
  if (start === -1) {
    lines.unshift('[REAPER]');
    start = 0;
  }
  let end = lines.findIndex((l, i) => i > start && l.startsWith('['));
  if (end === -1) end = lines.length;
  // Keep the section free of trailing blank lines before inserting
  while (end - 1 > start && lines[end - 1].trim() === '') end--;

  const cntIdx = lines.findIndex((l, i) => i > start && i < end && l.startsWith('csurf_cnt='));
  const count = cntIdx === -1 ? 0 : Number(lines[cntIdx].slice('csurf_cnt='.length)) || 0;
  const entry = `csurf_${count}=HTTP 0 ${port} '' '${BRIDGE_UI_FILE}' 0 ''`;
  const staleIdx = lines.findIndex((l, i) => i > start && i < end && l.startsWith(`csurf_${count}=`));
  if (staleIdx !== -1) lines[staleIdx] = entry;
  if (cntIdx === -1) {
    lines.splice(end, 0, `csurf_cnt=${count + 1}`, ...(staleIdx === -1 ? [entry] : []));
  } else {
    lines[cntIdx] = `csurf_cnt=${count + 1}`;
    if (staleIdx === -1) lines.splice(end, 0, entry);
  }
  return { ini: lines.join(eol), port, changed: true };
}

/** Snapshot scripts to bind to keys: quick save (named by the time), next, previous */
export const SNAPSHOT_ACTION_SCRIPTS = ['mcp_snapshot_quick_save.lua', 'mcp_snapshot_next.lua', 'mcp_snapshot_prev.lua'];

/**
 * List the snapshot scripts as actions in reaper-kb.ini text (main section), so they show in the Action List
 * ready for a shortcut. A script already listed is kept as-is, with its shortcuts.
 * Only safe while REAPER is closed: REAPER rewrites reaper-kb.ini from memory. When it was open, the
 * bridge registers the missing ones on start (register_actions() in mcp_snapshots_ui_lib.lua).
 */
export function ensureSnapshotActions(kb: string): { kb: string; added: string[] } {
  const listed = (file: string) => kb.split(/\r?\n/).some((l) => l.startsWith('SCR ') && l.includes(file));
  const added = SNAPSHOT_ACTION_SCRIPTS.filter((f) => !listed(f));
  if (!added.length) return { kb, added };
  const eol = kb.includes('\r\n') ? '\r\n' : '\n';
  // SCR <flags> <section> <command id> "<description>" <path relative to Scripts/>; 4 = a ReaScript
  const lines = added.map((f) => `SCR 4 0 RS${createHash('sha1').update(f).digest('hex')} "Custom: ${f}" ${f}`);
  const body = kb === '' || kb.endsWith('\n') ? kb : kb + eol;
  return { kb: body + lines.join(eol) + eol, added };
}

/** All MCP tool names registered by the server */
export const MCP_TOOL_NAMES = [
  // project
  'get_project_info',
  // tracks
  'list_tracks',
  'get_track_properties',
  'set_track_property',
  // fx
  'add_fx',
  'remove_fx',
  'get_fx_parameters',
  'analyze_fx',
  'set_fx_parameter',
  // discovery
  'list_available_fx',
  'search_fx',
  // presets
  'get_fx_preset_list',
  'set_fx_preset',
  // transport
  'play',
  'stop',
  'record',
  'get_transport_state',
  'set_cursor_position',
  // meters
  'read_track_meters',
  'read_track_spectrum',
  // analysis
  'read_track_lufs',
  'read_track_correlation',
  'read_track_crest',
  'measure_tracks',
  // snapshots
  'snapshot_save',
  'snapshot_restore',
  'snapshot_list',
  'snapshot_delete',
  'snapshot_edit',
  // routing
  'get_track_routing',
  // midi
  'create_midi_item',
  'list_midi_items',
  'get_midi_notes',
  'analyze_midi',
  'insert_midi_note',
  'insert_midi_notes',
  'edit_midi_note',
  'edit_midi_notes',
  'delete_midi_note',
  'quantize_midi',
  'transform_midi',
  'import_midi_file',
  'detect_key',
  'get_midi_cc',
  'insert_midi_cc',
  'delete_midi_cc',
  'get_midi_item_properties',
  'set_midi_item_properties',
  'send_midi_cc',
  'send_midi_pc',
  'send_midi_note',
  // media
  'list_media_items',
  'get_media_item_properties',
  'set_media_item_properties',
  'set_media_items_properties',
  'split_media_item',
  'delete_media_item',
  'move_media_item',
  'trim_media_item',
  'add_stretch_marker',
  'get_stretch_markers',
  'delete_stretch_marker',
  // arrangement
  'copy_media_items',
  'insert_time',
  'remove_time',
  'copy_section',
  'process_items',
  // selection & navigation
  'get_selected_tracks',
  'get_time_selection',
  'set_time_selection',
  // markers & regions
  'list_markers',
  'list_regions',
  'add_marker',
  'add_region',
  'delete_marker',
  'delete_region',
  // tempo map
  'get_tempo_map',
  // fx enable/offline
  'set_fx_enabled',
  'set_fx_offline',
  // envelopes
  'get_track_envelopes',
  'get_envelope_points',
  'insert_envelope_point',
  'insert_envelope_points',
  'delete_envelope_point',
  'create_track_envelope',
  'set_envelope_properties',
  'clear_envelope',
  'remove_envelope_points',
  'edit_envelope_points',
  'list_automation_items',
  'insert_automation_item',
  'set_automation_item',
  'delete_automation_item',
  // composite batch tools
  'set_multiple_track_properties',
  'setup_fx_chain',
  'set_multiple_fx_parameters',
  // plan executor
  'run_plan',
  'search_actions',
  'get_action',
  'run_action',
  'set_selected_tracks',
  'set_selected_items',
  // recording setup, fixed lanes and comping
  'get_record_setup',
  'set_track_record',
  'set_record_mode',
  'get_track_lanes',
  'set_track_lanes',
  'comp_lanes',
  // track structure + routing setters
  'add_track',
  'delete_track',
  'move_track',
  'set_track_folder',
  'set_track_info',
  'set_track_group',
  'add_send',
  'set_send',
  'remove_send',
  'add_hardware_output',
  // project ops, tempo map and marker editing
  'undo_project',
  'redo_project',
  'save_project',
  'get_render_settings',
  'set_render_settings',
  'render_project',
  'render_versions',
  'get_project_settings',
  'set_project_settings',
  'add_tempo_marker',
  'edit_tempo_marker',
  'delete_tempo_marker',
  'set_project_tempo',
  'edit_marker',
  'edit_region',
  // items, takes, take FX and FX housekeeping
  'insert_audio_file',
  'list_takes',
  'set_active_take',
  'get_take_fx',
  'add_take_fx',
  'remove_take_fx',
  'set_take_fx_parameter',
  'get_item_appearance',
  'set_item_color',
  'set_item_fades',
  'move_fx',
  'copy_fx',
  'rename_fx',
  'save_fx_chain',
  'load_fx_chain',
  'list_fx_chains',
  'save_track_template',
  'insert_track_template',
  'list_track_templates',
  // progressive discovery
  'list_tool_categories',
  'enable_tool_category',
  'disable_tool_category',
  // semantic audio analysis (requires Python sidecar — opt-in)
  'analyze_track_aesthetics',
  'analyze_track_offline',
  'analyze_audio_file',
  'measure_track_alignment',
  'detect_transients',
  'create_transient_automation',
  // built-in mix knowledge (read-only LoreKit proxy)
  'list_builtin_knowledge',
  'get_builtin_knowledge',
  // Note: 'render_track_to_wav' and 'remove_mcp_meters' (measure_tracks cleanup) are internal
  // Lua bridge commands, NOT public MCP tools.
  // They must NOT be listed here — MCP_TOOL_NAMES drives the Claude Code allowlist.
] as const;

/** Create or update .claude/settings.json with reaper MCP tool permissions */
export function ensureClaudeSettings(settingsPath: string): 'created' | 'updated' | 'unchanged' {
  const allowList = MCP_TOOL_NAMES.map(t => `mcp__reaper__${t}`);

  if (!existsSync(settingsPath)) {
    mkdirSync(join(settingsPath, '..'), { recursive: true });
    const config = { permissions: { allow: allowList } };
    writeFileSync(settingsPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    return 'created';
  }

  // Merge into existing settings, preserving other permissions
  const existing = JSON.parse(readFileSync(settingsPath, 'utf-8'));
  const existingAllow: string[] = existing?.permissions?.allow ?? [];
  const existingSet = new Set(existingAllow);
  const newTools = allowList.filter(t => !existingSet.has(t));

  if (newTools.length === 0) return 'unchanged';

  if (!existing.permissions) existing.permissions = {};
  existing.permissions.allow = [...existingAllow, ...newTools];
  writeFileSync(settingsPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
  return 'updated';
}

/** Resolve asset dir with a fallback name for dev (source tree) vs build layouts.
 *  Build output uses flat names like 'claude-rules'; source tree uses '.claude/rules'. */
export function resolveAssetDirWithFallback(baseDir: string, buildName: string, sourceName: string): string {
  const resolved = resolveAssetDir(baseDir, buildName);
  if (existsSync(resolved)) return resolved;
  return resolveAssetDir(baseDir, sourceName);
}

/** Expected knowledge subdirectories */
export const KNOWLEDGE_DIRS = ['genres', 'plugins', 'workflows', 'reference'] as const;

/** The git clone this build runs from (has scripts/update.sh and .git), walking up from `startDir`; null outside a clone. */
export function findCloneRoot(startDir: string): string | null {
  let dir = resolve(startDir);
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'scripts', 'update.sh')) && existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * mcp_update.conf, installed next to mcp_bridge.lua: where the status page's Update button finds the clone,
 * and the node binary to put first on PATH (REAPER started from the Dock has a bare PATH).
 * Plain key=value lines because the bridge's fallback JSON parser is flat-only.
 */
export function updateConfigText(repo: string, node: string, dev = false): string {
  return `repo=${repo}\nnode=${node}\ndev=${dev ? 1 : 0}\n`;
}

export interface CloneState {
  /** Tracked files with uncommitted changes */
  dirty: boolean;
  branch: string;
  /** Commits not on the upstream branch; null without one */
  ahead: number | null;
}

/**
 * A clone someone develops in (uncommitted work, a feature branch, unpushed commits, no upstream) gets
 * "Rebuild & reload" on the status page instead of pulling releases. The page's Developer mode toggle overrides it.
 */
export function isDevClone({ dirty, branch, ahead }: CloneState): boolean {
  return dirty || branch !== 'main' || ahead === null || ahead > 0;
}
