import { useEffect, useState } from 'react';

/** Chromium's install prompt event (not in lib.dom). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// 'window': the bridge's own Chromium --app window, which looks standalone but is not the installed app
export type InstallState = 'installed' | 'window' | 'available' | 'unavailable';

// Chromium fires the event once, early, often before Settings is opened, so hold on to it here
let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((fn) => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault(); // we offer it from Settings instead of the browser's own banner
    deferred = ev as BeforeInstallPromptEvent;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    changed();
  });
}

function runningAsApp(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: window-controls-overlay)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** The bridge opens its window at `?app=window`; the installed app starts at the manifest's `?app`. */
function bridgeWindow(): boolean {
  return new URLSearchParams(location.search).get('app') === 'window';
}

export function installState(): InstallState {
  if (installed) return 'installed';
  if (runningAsApp()) return bridgeWindow() ? 'window' : 'installed';
  return deferred ? 'available' : 'unavailable';
}

/** Show the browser's install dialog; resolves true when the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const ev = deferred;
  if (!ev) return false;
  deferred = null; // a prompt event can only be used once
  await ev.prompt();
  const { outcome } = await ev.userChoice;
  changed();
  return outcome === 'accepted';
}

export function useInstallState(): InstallState {
  const [state, setState] = useState(installState);
  useEffect(() => {
    const update = () => setState(installState());
    listeners.add(update);
    update();
    return () => {
      listeners.delete(update);
    };
  }, []);
  return state;
}

/** Reopen the page in a normal browser tab, where the browser offers to install it; `?install` opens Settings there. */
export function openInBrowserToInstall(): void {
  window.open(`${location.origin}${location.pathname}?install`, '_blank', 'noopener');
}

/** Where to find the install command when the browser gives the page no prompt to show. */
export function manualInstallHint(userAgent: string): string {
  if (/Edg\//.test(userAgent)) return 'In Edge, open the … menu → Apps → Install this site as an app.';
  if (/Firefox\//.test(userAgent)) return 'Firefox can’t install web apps. Open this page in Chrome, Edge or Safari to install it.';
  if (/Chrome\//.test(userAgent))
    return 'In Chrome, open the ⋮ menu → Cast, save and share → Install page as app. Already installed? Use “Open in MCP Bridge” in the address bar.';
  if (/Safari\//.test(userAgent) && /Macintosh/.test(userAgent)) return 'In Safari, choose File → Add to Dock.';
  return 'Use your browser’s “Install app” or “Add to Dock” command.';
}
