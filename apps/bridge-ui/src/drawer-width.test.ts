import { describe, expect, it } from 'vitest';
import { dragDrawerWidth, drawerFractionFromWidth, drawerWidthCss, drawerWidthPx, keyboardDrawerWidth, parseDrawerFraction } from './drawer-width.js';

describe('drawer width', () => {
  it('defaults to 400px and clamps to max(320px, 15vw)..70vw', () => {
    expect(drawerWidthPx(null, 1600)).toBe(400);
    expect(drawerWidthPx(0.05, 1600)).toBe(320);
    expect(drawerWidthPx(0.05, 3000)).toBe(450);
    expect(drawerWidthPx(0.9, 1600)).toBe(1120);
  });

  it('widens when the left edge is dragged left', () => {
    expect(dragDrawerWidth(400, 1200, 1100)).toBe(500);
    expect(drawerFractionFromWidth(500, 1000)).toBe(0.5);
  });

  it('steps with the arrow keys and jumps with Home/End', () => {
    expect(keyboardDrawerWidth('ArrowLeft', false, 400, 1600)).toBe(432);
    expect(keyboardDrawerWidth('ArrowRight', true, 400, 1600)).toBe(320);
    expect(keyboardDrawerWidth('Home', false, 400, 1600)).toBe(320);
    expect(keyboardDrawerWidth('End', false, 400, 1600)).toBe(1120);
    expect(keyboardDrawerWidth('a', false, 400, 1600)).toBeNull();
  });

  it('renders the same clamp in CSS', () => {
    expect(drawerWidthCss(null)).toBe('clamp(max(320px, 15vw), 400px, 70vw)');
    expect(drawerWidthCss(0.3125)).toBe('clamp(max(320px, 15vw), 31.25vw, 70vw)');
  });

  it('ignores a stored value that is not a fraction', () => {
    expect(parseDrawerFraction('0.4')).toBe(0.4);
    expect(parseDrawerFraction(null)).toBeNull();
    expect(parseDrawerFraction('wide')).toBeNull();
    expect(parseDrawerFraction('3')).toBeNull();
  });
});
