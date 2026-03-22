import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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

/** Create .mcp.json with reaper server config */
export function createMcpJson(targetPath: string): boolean {
  if (existsSync(targetPath)) return false;
  const config = JSON.stringify({
    mcpServers: {
      reaper: {
        command: 'npx',
        args: ['@mthines/reaper-mcp', 'serve'],
      },
    },
  }, null, 2);
  writeFileSync(targetPath, config + '\n', 'utf-8');
  return true;
}

/** Expected REAPER asset files that must be in the package */
export const REAPER_ASSETS = [
  'mcp_bridge.lua',
  'mcp_analyzer.jsfx',
  'mcp_lufs_meter.jsfx',
  'mcp_correlation_meter.jsfx',
  'mcp_crest_factor.jsfx',
] as const;

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
  // snapshots
  'snapshot_save',
  'snapshot_restore',
  'snapshot_list',
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
  'get_midi_cc',
  'insert_midi_cc',
  'delete_midi_cc',
  'get_midi_item_properties',
  'set_midi_item_properties',
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
  // composite batch tools
  'set_multiple_track_properties',
  'setup_fx_chain',
  'set_multiple_fx_parameters',
  // progressive discovery
  'list_tool_categories',
  'enable_tool_category',
  'disable_tool_category',
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
