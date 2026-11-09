import { describe, expect, it } from 'vitest';
import { availableUpdate, groupChanges, isNewer, parseChange, parseNotes, parseReleases, visibleReleases } from './changelog.js';

const body = (lines: string[]) => `## What's Changed\n\n${lines.map((l) => `- ${l}`).join('\n')}\n\n## Install\n\n- not a change\n`;
const gh = (tag: string, at: string, lines: string[], prerelease = false) => ({
  tag_name: tag,
  html_url: `https://github.com/mthines/reaper-mcp/releases/tag/${tag}`,
  published_at: at,
  prerelease,
  body: body(lines),
});

describe('release notes', () => {
  it('reads a conventional-commit line with scope, breaking mark and PR number', () => {
    expect(parseChange('feat(bridge)!: what’s new drawer (#101)')).toEqual({
      group: 'new',
      type: 'feat',
      scope: 'bridge',
      breaking: true,
      subject: 'what’s new drawer',
      pr: 101,
    });
  });

  it('keeps a line that is not a conventional commit, under the hood', () => {
    expect(parseChange('Bump things')).toMatchObject({ group: 'internal', type: '', subject: 'Bump things', pr: null });
  });

  it('lists only the What’s Changed section, without the release commit', () => {
    const changes = parseNotes(body(['fix: a bug', 'chore(release): v1.2.0', 'docs: a guide']));
    expect(changes.map((c) => c.subject)).toEqual(['a bug', 'a guide']);
  });

  it('groups changes in the order users care about', () => {
    const groups = groupChanges(parseNotes(body(['ci: speed up', 'fix: b', 'feat: a', 'perf: c'])));
    expect(groups.map((g) => g.title)).toEqual(['New', 'Fixes', 'Faster', 'Under the hood']);
  });
});

describe('releases', () => {
  const releases = parseReleases([
    gh('v0.79.0', '2026-11-01T00:00:00Z', ['feat: old']),
    gh('v0.80.0-beta.104.1', '2026-11-09T00:00:00Z', ['feat: beta'], true),
    gh('v0.80.0', '2026-11-08T00:00:00Z', ['feat: new']),
    { tag_name: 'v0.81.0', html_url: 'x', draft: true, body: '' },
    { nonsense: true },
  ]);

  it('lists newest first and drops drafts and malformed rows', () => {
    expect(releases.map((r) => r.version)).toEqual(['0.80.0-beta.104.1', '0.80.0', '0.79.0']);
  });

  it('hides betas unless asked for', () => {
    expect(visibleReleases(releases, false).map((r) => r.version)).toEqual(['0.80.0', '0.79.0']);
    expect(visibleReleases(releases, true)).toHaveLength(3);
  });

  it('offers the newest stable release only when it is newer than the install', () => {
    expect(availableUpdate(releases, '0.79.0')?.version).toBe('0.80.0');
    expect(availableUpdate(releases, '0.80.0')).toBeNull();
  });

  it('does not count a beta of the installed version as newer', () => {
    const beta = parseReleases([gh('v0.80.0-beta.1.1', '2026-11-09T00:00:00Z', [], true)])[0];
    expect(isNewer(beta, '0.80.0')).toBe(false);
    expect(isNewer(beta, '0.79.0')).toBe(true);
  });

  it('reads anything that is not a list as no releases', () => {
    expect(parseReleases({ message: 'API rate limit exceeded' })).toEqual([]);
  });
});
