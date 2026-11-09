import { describe, expect, it } from 'vitest';
import { parseReleases } from '../src/features/changelog/changelog.js';
// @ts-expect-error plain .mjs build script
import { slimReleases } from './snapshot-releases.mjs';

const row = (over: Record<string, unknown>) => ({
  tag_name: 'v1.0.0',
  html_url: 'https://github.com/mthines/reaper-mcp/releases/tag/v1.0.0',
  published_at: '2026-01-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  prerelease: false,
  draft: false,
  body: "## What's Changed\n\n- feat(bridge): a thing (#1)\n",
  author: { login: 'someone' },
  ...over,
});

describe('release snapshot', () => {
  it('feeds the page the same releases a live fetch would', () => {
    const rows = [row({}), row({ tag_name: 'v1.1.0-beta.1', published_at: '2026-02-01T00:00:00Z', prerelease: true })];
    expect(parseReleases(slimReleases(rows))).toEqual(parseReleases(rows));
  });

  it('leaves out drafts and malformed rows, and everything the page does not read', () => {
    const slim = slimReleases([row({ draft: true }), null, row({ html_url: undefined }), row({ tag_name: 'v2.0.0' })]);
    expect(slim).toHaveLength(1);
    expect(slim[0]).not.toHaveProperty('author');
  });

  it('refuses something that is not a release list', () => {
    expect(() => slimReleases({ message: 'API rate limit exceeded' })).toThrow();
  });
});
