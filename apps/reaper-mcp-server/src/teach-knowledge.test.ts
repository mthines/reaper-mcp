import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCP_TOOL_NAMES } from './cli.js';

// /teach links concepts from knowledge/reference/reaper-concepts.md: every link must land, every tool named there
// must exist, and the glossary may only send a beginner to REAPER's own site.
const ROOT = join(__dirname, '../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const CONCEPTS = read('knowledge/reference/reaper-concepts.md');
const slug = (heading: string) => heading.toLowerCase().replace(/[()]/g, '').replace(/[^a-z0-9 -]/g, '').trim().replace(/ +/g, '-');
const anchors = new Set([...CONCEPTS.matchAll(/^## (.+)$/gm)].map((m) => slug(m[1])));
const sections = CONCEPTS.split(/^## /m).slice(1);

describe('/teach concept links', () => {
  const files = ['knowledge/reference/teaching.md', '.claude/skills/teach/SKILL.md'];

  it('links only concept headings that exist', () => {
    const links = files.flatMap((f) => [...read(f).matchAll(/reaper-concepts\.md#([a-z0-9-]+)/g)].map((m) => m[1]));
    expect(links.length).toBeGreaterThan(0);
    expect(links.filter((l) => !anchors.has(l))).toEqual([]);
  });

  it('gives every concept the four parts the protocol reads', () => {
    const missing = sections.filter((s) => !['**What it is:**', '**By hand:**', '**Tools:**', '**Learn more:**'].every((k) => s.includes(k)));
    expect(missing.map((s) => s.split('\n')[0])).toEqual([]);
  });

  it('names only tools the server has', () => {
    const known = new Set<string>(MCP_TOOL_NAMES);
    const named = sections.flatMap((s) => [...(s.match(/\*\*Tools:\*\*(.*)/)?.[1] ?? '').replace(/\([^)]*\)/g, '').matchAll(/`([a-z_]+)`/g)].map((m) => m[1]));
    expect(named.length).toBeGreaterThan(20);
    expect(named.filter((t) => !known.has(t))).toEqual([]);
  });

  it("links only REAPER's own site", () => {
    const urls = [...CONCEPTS.matchAll(/https?:\/\/[^\s>)]+/g)].map((m) => m[0]);
    expect(urls.filter((u) => !u.startsWith('https://www.reaper.fm/'))).toEqual([]);
  });

  it('keeps /teach slash-only', () => {
    expect(read('.claude/skills/teach/SKILL.md')).toMatch(/^disable-model-invocation: true$/m);
  });
});
