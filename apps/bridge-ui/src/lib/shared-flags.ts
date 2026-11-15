// Feature-flag overrides shared with the bridge: ~/.config/reaper-mcp/flags.json, kept by the bridge
// (reaper/mcp_prefs_lib.lua), is the one list the CLI (`reaper-mcp flags`), the MCP server and this page all read,
// so forcing a flag in the Developer drawer applies to MCP tool calls too. The page reads it through ExtState and
// writes through a request carrying the bridge's per-run control token, like the shared LoreKit token.
import type { FlagOverrides } from '@reaper-mcp/feature-flags';
import { parseExtStateKey } from './status.js';

export interface SharedFlags {
  overrides: FlagOverrides;
  /** The id of the last request the bridge handled, so the page knows its own write has landed */
  req: string | null;
  /** False when the bridge has no home folder to keep the file in */
  writable: boolean;
}

export const sharedFlagsUrl = () => '/_/GET/EXTSTATE/MCPBridge/flag_overrides';

const hex = (text: string) => [...new TextEncoder().encode(text)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** The bridge's request to replace flags.json with these overrides. Hex, so no character needs URL or `;` escaping */
export function saveSharedFlagsUrl(id: string, controlToken: string, overrides: FlagOverrides): string {
  return `/_/SET/EXTSTATE/MCPBridge/flags_req/${id}-${controlToken}-${hex(JSON.stringify(overrides))}`;
}

export function parseSharedFlags(body: string): SharedFlags | null {
  const v = parseExtStateKey(body, 'flag_overrides') as { overrides?: unknown; req?: unknown; writable?: unknown } | null;
  if (!v || typeof v !== 'object') return null;
  // Only string variants: whether a flag or variant still exists is the flag store's call (adopt)
  const raw = typeof v.overrides === 'object' && v.overrides !== null && !Array.isArray(v.overrides) ? Object.entries(v.overrides) : [];
  const overrides: FlagOverrides = {};
  for (const [key, variant] of raw) if (typeof variant === 'string') overrides[key] = variant;
  return { overrides, req: typeof v.req === 'string' ? v.req : null, writable: v.writable === true };
}
