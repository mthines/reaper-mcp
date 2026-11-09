import { useEffect, useState } from 'react';
import { compareVersions } from '../../lib/update.js';
import { load, save } from '../../lib/storage.js';

/**
 * The repo's changelog as the page shows it: GitHub releases, whose notes the release job writes as
 * `## What's Changed` followed by one conventional-commit subject per line (`- feat(scope): … (#98)`).
 */
export const RELEASES_LIST_API = 'https://api.github.com/repos/mthines/reaper-mcp/releases?per_page=100';
const CACHE_KEY = 'mcp-bridge-releases';
const CACHE_TTL_MS = 6 * 3600_000; // unauthenticated GitHub API allows 60 requests an hour
export const BETAS_KEY = 'mcp-bridge-changelog-betas';

export type ChangeGroup = 'new' | 'fixes' | 'faster' | 'docs' | 'internal';

export interface Change {
  group: ChangeGroup;
  /** The conventional-commit type (`feat`, `fix`, …), or `''` for a line that isn't one */
  type: string;
  scope: string | null;
  breaking: boolean;
  subject: string;
  pr: number | null;
}

export interface ChangelogRelease {
  version: string;
  url: string;
  /** ISO date the release was published */
  date: string;
  prerelease: boolean;
  changes: Change[];
}

/** The order groups are listed in, with the heading each gets: what users notice first. */
export const GROUPS: { id: ChangeGroup; title: string }[] = [
  { id: 'new', title: 'New' },
  { id: 'fixes', title: 'Fixes' },
  { id: 'faster', title: 'Faster' },
  { id: 'docs', title: 'Docs' },
  { id: 'internal', title: 'Under the hood' },
];

const GROUP_OF: Record<string, ChangeGroup> = { feat: 'new', fix: 'fixes', perf: 'faster', docs: 'docs' };
const CONVENTIONAL = /^([a-z]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/i;
const PR_SUFFIX = /\s*\(#(\d+)\)\s*$/;

/** One release-notes line (`feat(bridge)!: … (#12)`, without the bullet) as a change. */
export function parseChange(line: string): Change {
  let text = line.trim();
  let pr: number | null = null;
  const prMatch = PR_SUFFIX.exec(text);
  if (prMatch) {
    pr = Number(prMatch[1]);
    text = text.slice(0, prMatch.index);
  }
  const m = CONVENTIONAL.exec(text);
  if (!m) return { group: 'internal', type: '', scope: null, breaking: false, subject: text, pr };
  const type = m[1].toLowerCase();
  const subject = m[4].trim();
  return {
    group: GROUP_OF[type] ?? 'internal',
    type,
    scope: m[2]?.trim() || null,
    breaking: Boolean(m[3]) || /BREAKING CHANGE/.test(subject),
    subject,
    pr,
  };
}

/** The changes listed under a release body's `## What's Changed`, minus the release commits themselves. */
export function parseNotes(body: string): Change[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((l) => /^##\s+what'?s changed/i.test(l.trim()));
  const changes: Change[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line.trim())) break;
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    if (!bullet) continue;
    const change = parseChange(bullet[1]);
    if (change.type === 'chore' && change.scope === 'release') continue;
    changes.push(change);
  }
  return changes;
}

interface GitHubRelease {
  tag_name?: string;
  html_url?: string;
  published_at?: string | null;
  created_at?: string;
  prerelease?: boolean;
  draft?: boolean;
  body?: string | null;
}

/** GitHub's release list as the page's releases, newest first; drafts and malformed rows are dropped. */
export function parseReleases(json: unknown): ChangelogRelease[] {
  if (!Array.isArray(json)) return [];
  return (json as GitHubRelease[])
    .filter((r): r is GitHubRelease & { tag_name: string; html_url: string } =>
      Boolean(r) && !r.draft && typeof r.tag_name === 'string' && typeof r.html_url === 'string')
    .map((r) => ({
      version: r.tag_name.replace(/^v/, ''),
      url: r.html_url,
      date: r.published_at ?? r.created_at ?? '',
      prerelease: r.prerelease === true || r.tag_name.includes('-'),
      changes: parseNotes(r.body ?? ''),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** A release's changes in display order, one entry per group that has any. */
export function groupChanges(changes: Change[]): { id: ChangeGroup; title: string; changes: Change[] }[] {
  return GROUPS.map((g) => ({ ...g, changes: changes.filter((c) => c.group === g.id) })).filter((g) => g.changes.length > 0);
}

/** Releases to list: stable ones, plus betas when asked for (only betas newer than the newest stable are useful). */
export function visibleReleases(releases: ChangelogRelease[], betas: boolean): ChangelogRelease[] {
  return betas ? releases : releases.filter((r) => !r.prerelease);
}

/** The newest stable release when it is newer than what is installed. */
export function availableUpdate(releases: ChangelogRelease[], current: string): ChangelogRelease | null {
  const latest = releases.find((r) => !r.prerelease);
  return latest && compareVersions(latest.version, current) > 0 ? latest : null;
}

/** Whether a release is newer than the installed version (a beta of the installed version is not). */
export function isNewer(release: ChangelogRelease, current: string): boolean {
  return compareVersions(release.version, current) > 0;
}

export type ReleasesState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; releases: ChangelogRelease[] };

/**
 * The repo's releases, fetched only while `enabled` (the drawer is open) and cached per browser for 6 hours.
 * `demo` releases skip the network (`?demo` and stories).
 */
export function useReleases(enabled: boolean, demo?: ChangelogRelease[]): ReleasesState {
  const [state, setState] = useState<ReleasesState>(() => {
    if (demo) return { status: 'ready', releases: demo };
    const cached = readCache();
    return cached ? { status: 'ready', releases: cached.releases } : { status: 'loading' };
  });
  useEffect(() => {
    if (!enabled || demo) return;
    const cached = readCache();
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return;
    let cancelled = false;
    fetch(RELEASES_LIST_API, { headers: { Accept: 'application/vnd.github+json' } })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json: unknown) => {
        if (cancelled) return;
        const releases = parseReleases(json);
        save(CACHE_KEY, JSON.stringify({ at: Date.now(), releases }));
        setState({ status: 'ready', releases });
      })
      .catch(() => {
        // offline or rate-limited: keep what the cache had, else say so
        if (!cancelled && !cached) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, demo]);
  return state;
}

function readCache(): { at: number; releases: ChangelogRelease[] } | null {
  try {
    const raw = load(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && Array.isArray(parsed.releases) ? parsed : null;
  } catch {
    return null;
  }
}
