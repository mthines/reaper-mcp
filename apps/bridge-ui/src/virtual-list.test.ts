import { describe, expect, it } from 'vitest';
import { prependedCount, scrollToRow, visibleRows } from './virtual-list.js';

describe('visibleRows', () => {
  it('renders the rows in the viewport plus the overscan', () => {
    expect(visibleRows(0, 100, 20, 1000, 0)).toEqual({ start: 0, end: 5 });
    expect(visibleRows(210, 100, 20, 1000, 2)).toEqual({ start: 8, end: 18 });
  });
  it('clamps to the list and accounts for the top padding', () => {
    expect(visibleRows(0, 100, 20, 3, 5)).toEqual({ start: 0, end: 3 });
    expect(visibleRows(24, 100, 20, 1000, 0, 4)).toEqual({ start: 1, end: 6 });
  });
});

describe('scrollToRow', () => {
  it('leaves the scroll alone when the row is visible', () => {
    expect(scrollToRow(100, 200, 20, 6)).toBe(100);
  });
  it('scrolls up or down by the least amount', () => {
    expect(scrollToRow(100, 200, 20, 2)).toBe(40);
    expect(scrollToRow(100, 200, 20, 20)).toBe(220);
  });
  it('scrolls to the very top for the first row, padding included', () => {
    expect(scrollToRow(50, 200, 20, 0, 4)).toBe(0);
  });
});

describe('prependedCount', () => {
  it('counts the rows that arrived above the previous first row', () => {
    expect(prependedCount(10, [13, 12, 11, 10, 9])).toBe(3);
  });
  it('is 0 when nothing came in or the row is gone', () => {
    expect(prependedCount(10, [10, 9])).toBe(0);
    expect(prependedCount(10, [8, 7])).toBe(0);
    expect(prependedCount(undefined, [8])).toBe(0);
  });
});
