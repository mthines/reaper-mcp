import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { Gallery } from './Gallery.js';
import { developerMode, galleryAllowed } from './gallery-stories.js';
import { parseExtStateReply } from './status.js';
import './styles.css';

const root = createRoot(document.getElementById('root') as HTMLElement);

// `?gallery` shows the component gallery from a local build, or when the bridge says it runs in developer
// mode; otherwise the param is ignored and the page opens as usual
async function start() {
  const search = location.search;
  if (!new URLSearchParams(search).has('gallery')) return root.render(<App />);
  let dev: boolean | undefined;
  if (location.protocol !== 'file:') {
    try {
      const res = await fetch('/_/GET/EXTSTATE/MCPBridge/status', { cache: 'no-store' });
      dev = parseExtStateReply(await res.text())?.settings?.dev;
    } catch {
      // REAPER unreachable: the developer mode it last reported decides
    }
  }
  root.render(galleryAllowed(search, location.protocol, developerMode(dev)) ? <Gallery /> : <App />);
}
void start();

// Installable app: the service worker is scoped to /mcp_bridge* so REAPER's other web remotes are untouched
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('/mcp_bridge_sw.js', { scope: '/mcp_bridge' }).catch(() => {
    // not installable here (e.g. a non-localhost http origin); the page works the same without it
  });
}
