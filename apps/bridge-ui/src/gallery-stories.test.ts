import { describe, expect, it } from 'vitest';
import { DRAWER_STORIES, EDIT_STORIES, MEASUREMENT_STORIES, galleryAllowed } from './gallery-stories.js';
import { editKindOf, editViewOf } from './edit-views.js';
import { MEASURED_COMMANDS, measurementOf } from './status.js';

describe('who sees the component gallery', () => {
  it('opens for a developer: a local build, or the bridge in developer mode', () => {
    expect(galleryAllowed('?gallery', 'file:', undefined)).toBe(true);
    expect(galleryAllowed('?gallery', 'http:', true)).toBe(true);
  });

  it('is the normal page for everyone else, and without the param', () => {
    expect(galleryAllowed('?gallery', 'http:', false)).toBe(false);
    expect(galleryAllowed('?gallery', 'http:', undefined)).toBe(false); // older bridge, or REAPER unreachable
    expect(galleryAllowed('?demo', 'file:', true)).toBe(false);
  });
});

describe('gallery stories', () => {
  it('show every measuring command, each drawn as a result', () => {
    const shown = new Set(MEASUREMENT_STORIES.filter((s) => measurementOf(s.entry) !== null).map((s) => s.entry.c));
    expect([...shown].sort()).toEqual([...MEASURED_COMMANDS].sort());
  });

  it('show each measurement with a previous call to compare against', () => {
    const compared = new Set(
      MEASUREMENT_STORIES.filter((s) => s.history.some((h) => h.n < s.entry.n && measurementOf(h) !== null)).map((s) => s.entry.c),
    );
    expect([...compared].sort()).toEqual([...MEASURED_COMMANDS].sort());
  });

  it('show every kind of edit view, each drawn', () => {
    const drawn = new Set(EDIT_STORIES.filter((s) => editViewOf(s.entry) !== null).map((s) => editKindOf(s.entry.c)));
    expect([...drawn].sort()).toEqual(['changes', 'envelope', 'midi', 'midiStats', 'mixer', 'plan', 'timeline']);
    expect(EDIT_STORIES.every((s) => editViewOf(s.entry) !== null)).toBe(true);
  });

  it('show the drawer for a failed call and a successful one', () => {
    expect(DRAWER_STORIES.some((s) => !s.entry.ok && s.entry.e)).toBe(true);
    expect(DRAWER_STORIES.some((s) => s.entry.ok)).toBe(true);
  });
});
