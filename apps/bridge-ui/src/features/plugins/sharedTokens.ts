import { useEffect, useState } from 'react';
import { fetchText } from '../../lib/fetch-text.js';
import { parseExtStateKey } from '../../lib/status.js';
import { LOREKIT_PUBLISH_TOKEN_KEY, LOREKIT_TOKEN_KEY, loadLoreKitToken, saveLoreKitToken } from './useKnowledge.js';

/**
 * The LoreKit tokens live in ~/.config/reaper-mcp/lorekit.json, kept by the bridge (reaper/mcp_prefs_lib.lua), so the
 * dev server, REAPER's own page and an installed app all see the same ones and a cleared browser loses nothing.
 * localStorage stays as the offline copy. The page reads the file through ExtState and writes through a request
 * carrying the bridge's per-run control token.
 */
export interface SharedTokens {
  read: string | null;
  publish: string | null;
  /** False when the bridge has no home folder to keep them in */
  writable: boolean;
}

export const sharedTokensUrl = () => '/_/GET/EXTSTATE/MCPBridge/lorekit_tokens';

const hex = (text: string) => [...new TextEncoder().encode(text)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** The bridge's request to replace both tokens; an empty one removes it. Hex, so no character needs URL or `;` escaping */
export function saveSharedTokensUrl(id: string, controlToken: string, read: string | null, publish: string | null): string {
  return `/_/SET/EXTSTATE/MCPBridge/tokens_req/${id}-${controlToken}-${hex(read ?? '')}-${hex(publish ?? '')}`;
}

export function parseSharedTokens(body: string): SharedTokens | null {
  const v = parseExtStateKey(body, 'lorekit_tokens') as { read?: unknown; publish?: unknown; writable?: unknown } | null;
  if (!v || typeof v !== 'object') return null;
  const token = (x: unknown) => (typeof x === 'string' && x ? x : null);
  return { read: token(v.read), publish: token(v.publish), writable: v.writable === true };
}

const send = (controlToken: string, read: string | null, publish: string | null) => {
  void fetchText(saveSharedTokensUrl(String(Date.now()), controlToken, read, publish));
};

/**
 * The read (lk_ro_) and publish (lk_rw_) tokens, shared through the bridge. The file wins when the page opens;
 * a token only this browser has is written to it, so tokens saved before this existed carry over.
 * Without a bridge (the demo, the bridge down) they are just this browser's.
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
      const nextRead = file.read ?? loadLoreKitToken(LOREKIT_TOKEN_KEY);
      const nextPublish = file.publish ?? loadLoreKitToken(LOREKIT_PUBLISH_TOKEN_KEY);
      setReadState(nextRead);
      setPublishState(nextPublish);
      saveLoreKitToken(nextRead, LOREKIT_TOKEN_KEY);
      saveLoreKitToken(nextPublish, LOREKIT_PUBLISH_TOKEN_KEY);
      // A token the file doesn't have yet (saved before it existed) goes in
      if (nextRead !== file.read || nextPublish !== file.publish) send(controlToken, nextRead, nextPublish);
      setShared(true);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, controlToken]);

  const setRead = (token: string | null) => {
    saveLoreKitToken(token, LOREKIT_TOKEN_KEY);
    setReadState(token);
    if (shared && controlToken) send(controlToken, token, publish);
  };
  const setPublish = (token: string | null) => {
    saveLoreKitToken(token, LOREKIT_PUBLISH_TOKEN_KEY);
    setPublishState(token);
    if (shared && controlToken) send(controlToken, read, token);
  };
  return { read, publish, setRead, setPublish, shared };
}
