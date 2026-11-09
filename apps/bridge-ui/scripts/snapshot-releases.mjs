// Snapshots the repo's GitHub releases into apps/bridge-ui/changelog/releases.snapshot.json for the hosted build
// (BRIDGE_HOSTED=1), so the public changelog page never calls GitHub from a visitor's browser: no rate limit, no
// "couldn't reach GitHub", and it works offline once loaded. The page parses the rows with parseReleases().
// Set GITHUB_TOKEN to lift the unauthenticated 60 requests/hour limit on a busy CI.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const SNAPSHOT_PATH = join(here, '../changelog/releases.snapshot.json');
const API = 'https://api.github.com/repos/mthines/reaper-mcp/releases?per_page=100';

/** The fields parseReleases() reads, so the snapshot stays small and drafts never leave GitHub. */
export function slimReleases(rows) {
  if (!Array.isArray(rows)) throw new Error('GitHub did not return a release list');
  return rows
    .filter((r) => r && !r.draft && typeof r.tag_name === 'string' && typeof r.html_url === 'string')
    .map(({ tag_name, html_url, published_at, created_at, prerelease, body }) => ({
      tag_name,
      html_url,
      published_at,
      created_at,
      prerelease: prerelease === true,
      body: body ?? '',
    }));
}

async function main() {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'reaper-mcp-bridge-ui-build' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(API, { headers });
  if (!res.ok) throw new Error(`GitHub releases: HTTP ${res.status}`);
  const releases = slimReleases(await res.json());
  if (releases.length === 0) throw new Error('GitHub returned no releases; refusing to publish an empty changelog');
  writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(releases, null, 2)}\n`);
  console.log(`changelog: snapshotted ${releases.length} releases`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`changelog snapshot failed: ${err.message}`);
    process.exit(1);
  });
}
