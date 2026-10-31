import { createRoot } from 'react-dom/client';
// Stylesheet order is the cascade: the root sheet (tokens, base, utilities), then the shared modules,
// then every component's own module (imported by the component), so a component's class wins a tie
import './styles.css';
import './styles/chart.module.css';
import './styles/drawer.module.css';
import './styles/list.module.css';
import { App } from './app/App.js';

const root = createRoot(document.getElementById('root') as HTMLElement);

root.render(<App />);

// Installable app: the service worker is scoped to /mcp_bridge* so REAPER's other web remotes are untouched
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('/mcp_bridge_sw.js', { scope: '/mcp_bridge' }).catch(() => {
    // not installable here (e.g. a non-localhost http origin); the page works the same without it
  });
}
