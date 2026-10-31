// The page's build-time constants, shared by vite.config.ts (the page), vitest.config.ts and Storybook.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = dirname(fileURLToPath(import.meta.url));

/** `__VERSION__`, the LoreKit token and API, and the Dash0 destination, as Vite `define` entries. */
export function buildConstants() {
  const { version } = JSON.parse(readFileSync(join(here, '../reaper-mcp-server/package.json'), 'utf-8'));

  // The public read-only LoreKit token + endpoint for the built-in plugin records, read from the server's
  // knowledge tool so there's one source of truth. The page calls LoreKit's REST API (CORS-enabled);
  // the server's /mcp endpoint is not reachable from a browser.
  const knowledgeSrc = readFileSync(join(here, '../reaper-mcp-server/src/tools/knowledge.ts'), 'utf-8');
  const lorekitToken = knowledgeSrc.match(/BUILTIN_LOREKIT_TOKEN = '(lk_ro_[A-Za-z0-9]+)'/)?.[1];
  const lorekitMcpUrl = knowledgeSrc.match(/LOREKIT_DEFAULT_URL = '(https:\/\/[^']+)\/mcp'/)?.[1];
  if (!lorekitToken || !lorekitMcpUrl) throw new Error('bridge-ui: could not read the LoreKit token/URL from tools/knowledge.ts');

  // Usage statistics go where the server's default telemetry goes (an ingest-only token for one Dash0
  // dataset, safe to ship), read from telemetry-consent.ts so there's one source of truth. An empty token
  // there means no built-in destination, and the page sends nothing.
  const consentSrc = readFileSync(join(here, '../reaper-mcp-server/src/telemetry-consent.ts'), 'utf-8');
  const destination = consentSrc.match(/DEFAULT_DESTINATION = \{([\s\S]*?)\n\};/)?.[1] ?? '';
  const field = (name) => destination.match(new RegExp(`${name}: '([^']*)'`))?.[1];
  const dash0 = { endpoint: field('endpoint'), dataset: field('dataset'), token: field('token') ?? '' };
  if (!dash0.endpoint || !dash0.dataset) throw new Error('bridge-ui: could not read DEFAULT_DESTINATION from telemetry-consent.ts');

  return {
    __VERSION__: JSON.stringify(version),
    __LOREKIT_TOKEN__: JSON.stringify(lorekitToken),
    __LOREKIT_API__: JSON.stringify(lorekitMcpUrl),
    __DASH0_ENDPOINT__: JSON.stringify(dash0.endpoint),
    __DASH0_DATASET__: JSON.stringify(dash0.dataset),
    __DASH0_TOKEN__: JSON.stringify(dash0.token),
  };
}

/**
 * Babel options for @vitejs/plugin-react that turn on the React Compiler: the page, its tests and Storybook alike.
 * `all_errors` fails the build and tests on a component the compiler would otherwise skip without a word.
 */
export const reactCompilerBabel = { plugins: [['babel-plugin-react-compiler', { panicThreshold: 'all_errors' }]] };
