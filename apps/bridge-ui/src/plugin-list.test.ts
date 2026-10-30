import { describe, expect, it } from 'vitest';
import { LIST_END, LIST_START, pluginRow, renderPluginTable, updatePluginList } from './plugin-list.mjs';

const record = (key: string, value: string, tags: string[]) => ({ key, value, tags: ['plugin-knowledge', 'layer::built-in', ...tags] });
const proQ = record('plugins::fabfilter/pro-q-4', '# FabFilter Pro-Q 4\n\n**Category:** eq · **Vendor:** FabFilter · **Preference:** 95/100', ['category::eq', 'preference::95']);
const reaEq = record('plugins::stock-reaper/rea-eq', '# ReaEQ\n\n**Category:** eq · **Vendor:** Cockos · **Preference:** 40/100', ['category::eq', 'preference::40']);
const clear = record('plugins::supertone/clear', '# Clear (Supertone / Antinode Audio)\n\n**Vendor:** Supertone (now sold as Antinode Audio "Clear") · **Preference:** 80/100', ['category::restoration', 'preference::80']);
const ozone = record('plugins::izotope/ozone-9', '# Ozone 9\n\n**Vendor:** iZotope', ['category::limiter', 'category::multiband', 'preference::80']);

describe('the built-in plugin list', () => {
  it('reads name, vendor, categories and preference from a record, without the asides', () => {
    expect(pluginRow(clear)).toEqual({ key: 'plugins::supertone/clear', name: 'Clear', vendor: 'Supertone', categories: ['restoration'], preference: 80 });
    expect(pluginRow(ozone)?.categories).toEqual(['limiter', 'multiband']);
  });

  it('lists only built-in plugin records', () => {
    expect(pluginRow({ key: 'mixing-lessons::x', value: '# X', tags: ['layer::built-in'] })).toBeNull();
    expect(pluginRow({ key: 'user::plugins::a/b', value: '# B', tags: ['plugin-knowledge'] })).toBeNull();
  });

  it('groups by category, the most preferred first', () => {
    const table = renderPluginTable([reaEq, clear, proQ, ozone]);
    const names = table.split('\n').slice(4).map((l) => l.split(' | ')[1]);
    expect(names).toEqual([
      'FabFilter Pro-Q 4',
      'ReaEQ',
      'Ozone 9',
      'Clear',
    ]);
    expect(table).toContain('4 plugins.');
    expect(table).toContain('| limiter, multiband | Ozone 9 | iZotope | 80 |');
  });

  it('replaces only the table between the markers, and is stable', () => {
    const doc = `# Plugins\n\nIntro.\n\n${LIST_START}\nold table\n${LIST_END}\n\n## Add a plugin\n`;
    const once = updatePluginList(doc, [proQ]);
    expect(once.startsWith('# Plugins\n\nIntro.\n\n')).toBe(true);
    expect(once.endsWith(`${LIST_END}\n\n## Add a plugin\n`)).toBe(true);
    expect(once).not.toContain('old table');
    expect(updatePluginList(once, [proQ])).toBe(once);
  });

  it('refuses a page without the markers', () => {
    expect(() => updatePluginList('# Plugins\n', [proQ])).toThrow(/plugin-list:start/);
  });
});
