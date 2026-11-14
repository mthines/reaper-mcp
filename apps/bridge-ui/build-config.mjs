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

  // The hosted build (BRIDGE_HOSTED=1, the public demo + changelog on Vercel) has no bridge to talk to: it runs the demo
  // and shows real releases from a snapshot taken at build time (scripts/snapshot-releases.mjs), so a visitor's browser
  // never calls GitHub. A hosted build without the snapshot fails here rather than publishing an empty changelog.
  const hosted = process.env.BRIDGE_HOSTED === '1';
  const readJson = (name) => JSON.parse(readFileSync(join(here, 'changelog', name), 'utf-8'));
  let releasesSnapshot = null;
  let highlightsSnapshot = null;
  if (hosted) {
    try {
      releasesSnapshot = readJson('releases.snapshot.json');
    } catch {
      throw new Error('bridge-ui: BRIDGE_HOSTED=1 needs apps/bridge-ui/changelog/releases.snapshot.json (node apps/bridge-ui/scripts/snapshot-releases.mjs)');
    }
    highlightsSnapshot = readJson('highlights.json');
  }

  return {
    __HOSTED__: JSON.stringify(hosted),
    __SITE_ENV__: JSON.stringify(siteEnvironment()),
    __SITE_VCS__: JSON.stringify(siteVcs()),
    __RELEASES_SNAPSHOT__: JSON.stringify(releasesSnapshot),
    __HIGHLIGHTS_SNAPSHOT__: JSON.stringify(highlightsSnapshot),
    __VERSION__: JSON.stringify(version),
    __LOREKIT_TOKEN__: JSON.stringify(lorekitToken),
    __LOREKIT_API__: JSON.stringify(lorekitMcpUrl),
    __DASH0_ENDPOINT__: JSON.stringify(dash0.endpoint),
    __DASH0_DATASET__: JSON.stringify(dash0.dataset),
    __DASH0_TOKEN__: JSON.stringify(dash0.token),
  };
}

/**
 * The hosted site's `deployment.environment.name`: Vercel's own (production / preview / development) on a Vercel
 * build, `local` anywhere else, so a preview deploy or a local hosted build never reads as production.
 */
function siteEnvironment() {
  const env = process.env.VERCEL_ENV;
  return env === 'production' || env === 'preview' || env === 'development' ? env : 'local';
}

/** The git context of a Vercel build (its system env), as the Web SDK's `vcs` option; empty off Vercel. */
function siteVcs() {
  const { VERCEL_GIT_PROVIDER: provider, VERCEL_GIT_REPO_OWNER: owner, VERCEL_GIT_REPO_SLUG: slug, VERCEL_GIT_COMMIT_REF: ref, VERCEL_GIT_COMMIT_SHA: sha, VERCEL_GIT_PULL_REQUEST_ID: pr } = process.env;
  const vcs = {};
  if (provider) vcs.providerName = provider;
  if (owner) vcs.ownerName = owner;
  if (slug) vcs.repositoryName = slug;
  if (owner && slug && provider === 'github') vcs.repositoryUrlFull = `https://github.com/${owner}/${slug}`;
  if (ref) vcs.refHeadName = ref;
  if (sha) vcs.refHeadRevision = sha;
  if (pr) vcs.changeId = pr;
  return vcs;
}

/**
 * The page's `<meta name="referrer">`, as a Vite `transformIndexHtml` tag.
 *
 * The Web SDK copies `document.referrer` into every page view as it is, with no scrubber of its own, and the referrer is
 * the page that linked here: on REAPER's page that is this page again, host (a LAN IP), port and query (search text, the
 * open entry) included. So the page sets what browsers put there. The page REAPER serves sends none at all; the hosted
 * site sends only its origin, so GitHub still sees where a visitor came from but no path and no `?bridge=` address.
 * A policy covers only what this page sends: a visit from another page carries whatever that page's policy allows.
 */
export function referrerMetaTag(hosted) {
  return { tag: 'meta', attrs: { name: 'referrer', content: hosted ? 'strict-origin' : 'no-referrer' }, injectTo: 'head-prepend' };
}

/**
 * Babel options for @vitejs/plugin-react that turn on the React Compiler: the page, its tests and Storybook alike.
 * `all_errors` fails the build and tests on a component the compiler would otherwise skip without a word.
 */
export const reactCompilerBabel = { plugins: [['babel-plugin-react-compiler', { panicThreshold: 'all_errors' }]] };
