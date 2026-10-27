import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

createRoot(document.getElementById('root') as HTMLElement).render(<App />);

// Installable app: the service worker is scoped to /mcp_bridge* so REAPER's other web remotes are untouched
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('/mcp_bridge_sw.js', { scope: '/mcp_bridge' }).catch(() => {
    // not installable here (e.g. a non-localhost http origin); the page works the same without it
  });
}
