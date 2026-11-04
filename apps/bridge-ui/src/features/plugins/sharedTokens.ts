import { useEffect, useState } from 'react';
import { fetchText } from '../../lib/fetch-text.js';
import { parseExtStateKey } from '../../lib/status.js';
import { LOREKIT_PUBLISH_TOKEN_KEY, LOREKIT_TOKEN_KEY, loadLoreKitToken, saveLoreKitToken } from './useKnowledge.js';

/**
 * The read-only LoreKit token (lk_ro_) lives in ~/.config/reaper-mcp/lorekit.json, kept by the bridge
 * (reaper/mcp_prefs_lib.lua), so the dev server, REAPER's own page and an installed app share it and a cleared browser
 * loses nothing. localStorage stays as the offline copy. The page reads the file through ExtState and writes through a
 * request carrying the bridge's per-run control token.
 *
 * The publish token (lk_rw_) never goes through here: REAPER's web interface answers anyone who can reach its port,
 * and that token can write LoreKit's built-in layer. It stays in this browser's localStorage only.
 */
export interface SharedTokens {
  read: string | null;
  /** False when the bridge has no home folder to keep it in */
  writable: boolean;
}

export const sharedTokensUrl = () => '/_/GET/EXTSTATE/MCPBridge/lorekit_tokens';

const hex = (text: string) => [...new TextEncoder().encode(text)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** The bridge's request to replace the read token; empty removes it. Hex, so no character needs URL or `;` escaping */
export function saveSharedTokensUrl(id: string, controlToken: string, read: string | null): string {
  return `/_/SET/EXTSTATE/MCPBridge/tokens_req/${id}-${controlToken}-${hex(read ?? '')}`;
}

export function parseSharedTokens(body: string): SharedTokens | null {
  const v = parseExtStateKey(body, 'lorekit_tokens') as { read?: unknown; writable?: unknown } | null;
  if (!v || typeof v !== 'object') return null;
  return { read: typeof v.read === 'string' && v.read ? v.read : null, writable: v.writable === true };
}

const send = (controlToken: string, read: string | null) => {
  void fetchText(saveSharedTokensUrl(String(Date.now()), controlToken, read));
};

/**
 * The read token (shared through the bridge) and the publish token (this browser only). The file wins when the page
 * opens; a read token only this browser has is written to it, so one saved before this existed carries over.
 * Without a bridge (the demo, the bridge down) both are just this browser's.
 */
export function useLoreKitTokens(enabled: boolean, controlToken: string | undefined) {
  const [read, setReadState] = useState(() => loadLoreKitToken(LOREKIT_TOKEN_KEY));
  const [publish, setPublishState] = useState(() => loadLoreKitToken(LOREKIT_PUBLISH_TOKEN_KEY));
  const [shared, setShared] = useState(false);

  useEffect(() => {
    if (!enabled || !controlToken) return;
    let cancelled = false;
    void fetchText(sharedTokensUrl()).then((body) => {
      const file = body === null ? null : parseSharedTokens(body);
      if (cancelled || !file?.writable) return;
      const next = file.read ?? loadLoreKitToken(LOREKIT_TOKEN_KEY);
      setReadState(next);
      saveLoreKitToken(next, LOREKIT_TOKEN_KEY);
      // A token the file doesn't have yet (saved before it existed) goes in
      if (next !== file.read) send(controlToken, next);
      setShared(true);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, controlToken]);

  const setRead = (token: string | null) => {
    saveLoreKitToken(token, LOREKIT_TOKEN_KEY);
    setReadState(token);
    if (shared && controlToken) send(controlToken, token);
  };
  const setPublish = (token: string | null) => {
    saveLoreKitToken(token, LOREKIT_PUBLISH_TOKEN_KEY);
    setPublishState(token);
  };
  return { read, publish, setRead, setPublish, shared };
}
