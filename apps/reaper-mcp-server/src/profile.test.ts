import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from './server.js';
import { PROFILES, resolveProfile } from './profile.js';
import { TOOL_CATEGORIES, setVisibleCategories } from './tools/categories.js';

const toolsOf = (profile?: string) => Object.keys((createServer(resolveProfile(profile)) as unknown as { _registeredTools: Record<string, unknown> })._registeredTools);

afterEach(() => setVisibleCategories(null));

describe('REAPER_MCP_PROFILE', () => {
  it('registers every tool when unset or "full"', () => {
    const all = toolsOf('');
    expect(toolsOf('full')).toEqual(all);
    expect(all).toContain('write_jsfx');
  });

  it.each(Object.keys(PROFILES))('%s registers exactly its categories\' tools plus the category tools', (name) => {
    const expected = new Set(PROFILES[name].flatMap((c) => TOOL_CATEGORIES[c]?.tools ?? []));
    const got = toolsOf(name).filter((t) => !['list_tool_categories', 'enable_tool_category', 'disable_tool_category'].includes(t));
    expect(new Set(got)).toEqual(expected);
  });

  it('keeps every profile under the 128 tools some clients allow, and narrower than full', () => {
    const full = toolsOf('full').length;
    for (const name of Object.keys(PROFILES)) {
      const n = toolsOf(name).length;
      expect(n, name).toBeLessThan(128);
      expect(n, name).toBeLessThan(full);
    }
  });

  it('takes a list of profiles and categories', () => {
    const tools = toolsOf('minimal,midi');
    expect(tools).toContain('insert_midi_notes');
    expect(tools).toContain('list_tracks');
    expect(tools).not.toContain('measure_masking');
  });

  it('leaves tools that are in no core category alone, so extensions still register', () => {
    const server = createServer(resolveProfile('minimal'));
    expect(() => server.tool('vital_read_patch', 'x', {}, async () => ({ content: [] }))).not.toThrow();
    expect(Object.keys((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools)).toContain('vital_read_patch');
  });

  it('shows only the profile\'s categories in list_tool_categories', async () => {
    const server = createServer(resolveProfile('minimal'));
    const tool = (server as unknown as { _registeredTools: Record<string, { handler: (a: unknown, e: unknown) => Promise<{ content: { text: string }[] }> }> })._registeredTools['list_tool_categories'];
    const out = JSON.parse((await tool.handler({}, {})).content[0].text) as { categories: { name: string }[] };
    expect(out.categories.map((c) => c.name).sort()).toEqual([...PROFILES['minimal']].sort());
  });

  it('names an extension it does not know so the server can warn once extensions have loaded', () => {
    expect(resolveProfile('mixing,composition')).toMatchObject({ extensions: ['composition'] });
    expect(resolveProfile('mixing,midi').extensions).toEqual([]);
  });
});
