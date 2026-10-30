import { describe, expect, it } from 'vitest';
import { MEASURED_COMMANDS, measurementOf } from '../lib/commands.js';
import { DRAWER_EXAMPLES, EDIT_EXAMPLES, MEASUREMENT_EXAMPLES, SNAPSHOT_EXAMPLES } from './examples.js';
import { editKindOf, editViewOf } from '../features/edit-views/index.js';

// The stories draw these examples, so a new measuring command or view state without one is missing from Storybook
describe('the examples the stories draw', () => {
  it('cover every measuring command, each drawn as a result', () => {
    const shown = new Set(MEASUREMENT_EXAMPLES.filter((x) => measurementOf(x.entry) !== null).map((x) => x.entry.c));
    expect([...shown].sort()).toEqual([...MEASURED_COMMANDS].sort());
  });

  it('show each measurement with a previous call to compare against', () => {
    const compared = new Set(
      MEASUREMENT_EXAMPLES.filter((x) => x.history.some((h) => h.n < x.entry.n && measurementOf(h) !== null)).map((x) => x.entry.c),
    );
    expect([...compared].sort()).toEqual([...MEASURED_COMMANDS].sort());
  });

  it('cover every kind of edit view, each drawn', () => {
    const drawn = new Set(EDIT_EXAMPLES.filter((x) => editViewOf(x.entry) !== null).map((x) => editKindOf(x.entry.c)));
    expect([...drawn].sort()).toEqual(['changes', 'envelope', 'fxChain', 'midi', 'midiStats', 'mixer', 'plan', 'routing', 'timeline']);
    expect(EDIT_EXAMPLES.every((x) => editViewOf(x.entry) !== null)).toBe(true);
  });

  it('show the Snapshots view in every request state, blocked, empty and before the list arrives', () => {
    const states = new Set(SNAPSHOT_EXAMPLES.map((x) => (x.request ? (x.request.state === 'done' ? `done-${x.request.result.ok}` : x.request.state) : 'none')));
    expect([...states].sort()).toEqual(['done-false', 'done-true', 'lost', 'none', 'pending']);
    expect(SNAPSHOT_EXAMPLES.some((x) => x.blocked)).toBe(true);
    expect(SNAPSHOT_EXAMPLES.some((x) => x.feed?.snapshots.length === 0)).toBe(true);
    expect(SNAPSHOT_EXAMPLES.some((x) => x.feed === null)).toBe(true);
    expect(SNAPSHOT_EXAMPLES.some((x) => x.saveForm?.confirm)).toBe(true);
  });

  it('show the drawer for a failed call and a successful one', () => {
    expect(DRAWER_EXAMPLES.some((x) => !x.entry.ok && x.entry.e)).toBe(true);
    expect(DRAWER_EXAMPLES.some((x) => x.entry.ok)).toBe(true);
  });
});
