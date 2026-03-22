import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCategoryTools, TOOL_CATEGORIES } from './categories.js';

function captureTools() {
  const tools: Record<string, { handler: (...args: unknown[]) => unknown }> = {};
  const mockServer = {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: (...args: unknown[]) => unknown) => {
      tools[name] = { handler };
    }),
  } as unknown as McpServer;
  registerCategoryTools(mockServer);
  return tools;
}

describe('category tools', () => {
  let tools: ReturnType<typeof captureTools>;

  beforeEach(() => {
    tools = captureTools();
  });

  it('registers all 3 category tools', () => {
    expect(tools['list_tool_categories']).toBeDefined();
    expect(tools['enable_tool_category']).toBeDefined();
    expect(tools['disable_tool_category']).toBeDefined();
  });

  describe('TOOL_CATEGORIES map', () => {
    it('defines all expected categories', () => {
      const expectedCategories = [
        'project', 'tracks', 'fx', 'transport', 'midi', 'media',
        'selection', 'markers', 'tempo', 'envelopes', 'analysis',
        'discovery', 'snapshots', 'routing',
      ];
      for (const cat of expectedCategories) {
        expect(TOOL_CATEGORIES[cat]).toBeDefined();
        expect(TOOL_CATEGORIES[cat].name).toBe(cat);
        expect(TOOL_CATEGORIES[cat].tools.length).toBeGreaterThan(0);
        expect(TOOL_CATEGORIES[cat].description).toBeTruthy();
      }
    });

    it('includes composite batch tools in tracks category', () => {
      expect(TOOL_CATEGORIES['tracks'].tools).toContain('set_multiple_track_properties');
    });

    it('includes composite batch tools in fx category', () => {
      expect(TOOL_CATEGORIES['fx'].tools).toContain('setup_fx_chain');
      expect(TOOL_CATEGORIES['fx'].tools).toContain('set_multiple_fx_parameters');
    });

    it('has no duplicate tool names across categories', () => {
      const allTools: string[] = [];
      for (const cat of Object.values(TOOL_CATEGORIES)) {
        allTools.push(...cat.tools);
      }
      const uniqueTools = new Set(allTools);
      expect(uniqueTools.size).toBe(allTools.length);
    });
  });

  describe('list_tool_categories', () => {
    it('returns all categories with toolCount, tools, and totalTools', async () => {
      const result = await tools['list_tool_categories'].handler({});
      expect(result).toMatchObject({
        content: [{ type: 'text' }],
      });

      const content = (result as { content: Array<{ text: string }> }).content[0].text;
      const parsed = JSON.parse(content) as { categories: Array<{ name: string; toolCount: number; tools: string[]; description: string }>; totalTools: number };

      expect(parsed.categories).toBeDefined();
      expect(Array.isArray(parsed.categories)).toBe(true);
      expect(parsed.totalTools).toBeGreaterThan(0);

      // Verify each category has required fields
      for (const cat of parsed.categories) {
        expect(cat.name).toBeTruthy();
        expect(cat.description).toBeTruthy();
        expect(typeof cat.toolCount).toBe('number');
        expect(cat.toolCount).toBeGreaterThan(0);
        expect(Array.isArray(cat.tools)).toBe(true);
        expect(cat.tools.length).toBe(cat.toolCount);
      }
    });

    it('totalTools matches sum of all category toolCounts', async () => {
      const result = await tools['list_tool_categories'].handler({});
      const content = (result as { content: Array<{ text: string }> }).content[0].text;
      const parsed = JSON.parse(content) as { categories: Array<{ toolCount: number }>; totalTools: number };

      const sum = parsed.categories.reduce((acc, c) => acc + c.toolCount, 0);
      expect(parsed.totalTools).toBe(sum);
    });

    it('includes all category names from TOOL_CATEGORIES', async () => {
      const result = await tools['list_tool_categories'].handler({});
      const content = (result as { content: Array<{ text: string }> }).content[0].text;
      const parsed = JSON.parse(content) as { categories: Array<{ name: string }> };
      const names = parsed.categories.map((c) => c.name);

      for (const key of Object.keys(TOOL_CATEGORIES)) {
        expect(names).toContain(key);
      }
    });
  });

  describe('enable_tool_category', () => {
    it('returns category info for a valid category', async () => {
      const result = await tools['enable_tool_category'].handler({ category: 'tracks' });
      expect(result).toMatchObject({
        content: [{ type: 'text' }],
      });

      const content = (result as { content: Array<{ text: string }> }).content[0].text;
      const parsed = JSON.parse(content) as {
        category: string;
        description: string;
        toolCount: number;
        tools: string[];
        status: string;
      };

      expect(parsed.category).toBe('tracks');
      expect(parsed.status).toBe('ready');
      expect(parsed.tools).toContain('list_tracks');
      expect(parsed.tools).toContain('get_track_properties');
      expect(parsed.tools).toContain('set_track_property');
      expect(parsed.tools).toContain('set_multiple_track_properties');
      expect(parsed.toolCount).toBe(parsed.tools.length);
    });

    it('returns fx category with all batch tools', async () => {
      const result = await tools['enable_tool_category'].handler({ category: 'fx' });
      const content = (result as { content: Array<{ text: string }> }).content[0].text;
      const parsed = JSON.parse(content) as { tools: string[]; status: string };

      expect(parsed.status).toBe('ready');
      expect(parsed.tools).toContain('add_fx');
      expect(parsed.tools).toContain('set_fx_parameter');
      expect(parsed.tools).toContain('setup_fx_chain');
      expect(parsed.tools).toContain('set_multiple_fx_parameters');
    });

    it('returns error for unknown category', async () => {
      const result = await tools['enable_tool_category'].handler({ category: 'nonexistent' });
      expect(result).toMatchObject({ isError: true });
      const text = (result as { content: Array<{ text: string }> }).content[0].text;
      expect(text).toContain('Unknown category "nonexistent"');
      expect(text).toContain('Available categories:');
    });

    it('returns midi category with all 14 tools', async () => {
      const result = await tools['enable_tool_category'].handler({ category: 'midi' });
      const content = (result as { content: Array<{ text: string }> }).content[0].text;
      const parsed = JSON.parse(content) as { toolCount: number };
      expect(parsed.toolCount).toBe(14);
    });
  });

  describe('disable_tool_category', () => {
    it('returns disabled status for a valid category', async () => {
      const result = await tools['disable_tool_category'].handler({ category: 'midi' });
      expect(result).not.toMatchObject({ isError: true });

      const content = (result as { content: Array<{ text: string }> }).content[0].text;
      const parsed = JSON.parse(content) as { category: string; status: string; note: string };

      expect(parsed.category).toBe('midi');
      expect(parsed.status).toBe('disabled');
      expect(parsed.note).toBeTruthy();
    });

    it('includes re-enable hint in note', async () => {
      const result = await tools['disable_tool_category'].handler({ category: 'envelopes' });
      const content = (result as { content: Array<{ text: string }> }).content[0].text;
      const parsed = JSON.parse(content) as { note: string };
      expect(parsed.note).toContain('enable_tool_category');
    });

    it('returns error for unknown category', async () => {
      const result = await tools['disable_tool_category'].handler({ category: 'unknown_cat' });
      expect(result).toMatchObject({ isError: true });
      const text = (result as { content: Array<{ text: string }> }).content[0].text;
      expect(text).toContain('Unknown category "unknown_cat"');
    });
  });
});
