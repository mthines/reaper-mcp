import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs module
import { buildIndex, listAssets } from './reapack-index.mjs';
import { BRIDGE_UI_FILE, REAPER_ASSETS } from './cli.js';

const urlFor = (kind: string, file: string) => `https://example.test/${kind}/${file}`;
const assets = listAssets(join(__dirname, '../../../reaper'));
const index = buildIndex({ version: '1.2.3', urlFor, time: '2026-01-01T00:00:00Z', assets }) as string;
const sources = [...index.matchAll(/<source file="([^"]+)"/g)].map((m) => m[1]);

describe('the ReaPack index', () => {
  it('offers every file `reaper-mcp setup` installs, and the status page', () => {
    expect(sources.sort()).toEqual([...REAPER_ASSETS, BRIDGE_UI_FILE].sort());
  });

  it('registers the bridge and the snapshot actions in the Action List, and nothing else', () => {
    const main = [...index.matchAll(/<source file="([^"]+)" main="main"/g)].map((m) => m[1]).sort();
    expect(main).toEqual(['mcp_bridge.lua', 'mcp_snapshot_next.lua', 'mcp_snapshot_prev.lua', 'mcp_snapshot_quick_save.lua']);
  });

  it('carries the release version and links its changelog', () => {
    expect(index).toContain('<version name="1.2.3"');
    expect(index).toContain('releases/tag/v1.2.3');
  });

  it('puts every file of reaper/ that REAPER loads in the index, so a new library cannot be forgotten', () => {
    for (const f of [...assets.scripts, ...assets.effects]) expect(sources).toContain(f);
  });

  it('is well-formed: one root, escaped URLs', () => {
    const escaped = buildIndex({ version: '1', urlFor: () => 'https://x.test/a?b=1&c=2', time: 'T', assets }) as string;
    expect(escaped).toContain('a?b=1&amp;c=2');
    expect(escaped.startsWith('<?xml')).toBe(true);
  });
});
