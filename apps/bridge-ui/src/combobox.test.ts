import { describe, expect, it } from 'vitest';
import { initialHighlight, listKey, opensList } from './combobox-logic.js';

const options = [
  { value: '1h', label: 'Last hour' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
];

describe('combobox keyboard', () => {
  it('opens on the selected option', () => {
    expect(initialHighlight(options, '24h')).toBe(1);
    expect(initialHighlight(options, 'nope')).toBe(0);
  });

  it('moves with the arrows and clamps at the ends', () => {
    expect(listKey('ArrowDown', 1, 3)).toEqual({ type: 'move', index: 2 });
    expect(listKey('ArrowDown', 2, 3)).toEqual({ type: 'move', index: 2 });
    expect(listKey('ArrowUp', 0, 3)).toEqual({ type: 'move', index: 0 });
    expect(listKey('End', 0, 3)).toEqual({ type: 'move', index: 2 });
    expect(listKey('Home', 2, 3)).toEqual({ type: 'move', index: 0 });
  });

  it('selects with Enter or Space and closes with Escape or Tab', () => {
    expect(listKey('Enter', 2, 3)).toEqual({ type: 'select', index: 2 });
    expect(listKey(' ', 0, 3)).toEqual({ type: 'select', index: 0 });
    expect(listKey('Escape', 1, 3)).toEqual({ type: 'close' });
    expect(listKey('Tab', 1, 3)).toEqual({ type: 'close' });
    expect(listKey('x', 1, 3)).toEqual({ type: 'none' });
  });

  it('opens from the trigger with the arrows, Enter and Space', () => {
    expect(['ArrowDown', 'ArrowUp', 'Enter', ' '].every(opensList)).toBe(true);
    expect(opensList('Escape')).toBe(false);
  });
});
