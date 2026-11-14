import { createRoot } from 'react-dom/client';
// Stylesheet order is the cascade: the root sheet (tokens, base, utilities), then the shared modules,
// then every component's own module (imported by the component), so a component's class wins a tie
import './styles.css';
import './styles/chart.module.css';
import './styles/drawer.module.css';
import './styles/list.module.css';
import { App } from './app/App.js';
import { Changelog } from './features/changelog/index.js';
import { Docs } from './features/docs/index.js';
import { CommandProvider } from './features/command/index.js';
import { startSiteAnalytics } from './lib/analytics.js';

const root = createRoot(document.getElementById('root') as HTMLElement);

// `?page=changelog` (and /changelog on the hosted site) is the changelog on a page of its own, with no bridge behind it
const changelogPage = new URLSearchParams(location.search).get('page') === 'changelog' || location.pathname === '/changelog';

// `?page=docs` (and /docs on the hosted site) is the guides, also with no bridge behind it
const docsPage = new URLSearchParams(location.search).get('page') === 'docs' || /^\/docs(\/|$)/.test(location.pathname);

// The hosted site's guides and changelog report page views, web events and a session replay (a no-op elsewhere)
if (docsPage || changelogPage) startSiteAnalytics(docsPage ? 'docs' : 'changelog');

// mcp_bridge.html opts out of browser translation: a translator rewrites the text nodes React swaps as the bridge goes
// offline and back, and React's next update then fails (NotFoundError). The guides and changelog are mostly static
// prose worth reading in your own language, so they opt back in.
if (docsPage || changelogPage) document.documentElement.removeAttribute('translate');

root.render(
  <CommandProvider>
    {docsPage ? <Docs.PageRoute /> : changelogPage ? <Changelog.PageRoute /> : <App />}
  </CommandProvider>,
);

// Installable app: the service worker is scoped to /mcp_bridge* so REAPER's other web remotes are untouched
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('/mcp_bridge_sw.js', { scope: '/mcp_bridge' }).catch(() => {
    // not installable here (e.g. a non-localhost http origin); the page works the same without it
  });
}
