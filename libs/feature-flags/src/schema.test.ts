import { describe, expect, it } from 'vitest';
import { parseRegistry } from './schema.js';
import { FLAG_REGISTRY } from './registry.js';

const valid = {
  key: 'example-panel',
  description: 'A fixture flag',
  type: 'boolean',
  variants: { off: false, on: true },
  defaultVariant: 'off',
  owner: 'tests',
};

describe('parseRegistry', () => {
  it('accepts a valid flag and fills the defaults', () => {
    const [flag] = parseRegistry([valid]);
    expect(flag.tags).toEqual([]);
  });

  it('accepts a valid experiment', () => {
    const [flag] = parseRegistry([
      { ...valid, experiment: { variants: [{ key: 'off', weight: 90 }, { key: 'on', weight: 10 }] } },
    ]);
    expect(flag.experiment?.enabled).toBe(false);
  });

  it('ships an empty registry that validates', () => {
    expect(FLAG_REGISTRY).toEqual([]);
  });

  it.each([
    ['a key that is not kebab-case', { ...valid, key: 'Bad_Key' }, /kebab-case/],
    ['a defaultVariant that is not a variant', { ...valid, defaultVariant: 'maybe' }, /defaultVariant/],
    ['a defaultVariant that is only on the prototype', { ...valid, defaultVariant: 'constructor' }, /defaultVariant/],
    ['a variant value of the wrong type', { ...valid, variants: { off: false, on: 'yes' } }, /declared type/],
    [
      'experiment weights that do not sum to 100',
      { ...valid, experiment: { variants: [{ key: 'off', weight: 60 }, { key: 'on', weight: 60 }] } },
      /weights must sum to 100/,
    ],
    [
      'an experiment variant that is not a variant',
      { ...valid, experiment: { variants: [{ key: 'off', weight: 50 }, { key: 'nope', weight: 50 }] } },
      /not a key of variants/,
    ],
    [
      'duplicate experiment variant keys',
      { ...valid, experiment: { variants: [{ key: 'off', weight: 50 }, { key: 'off', weight: 50 }] } },
      /unique/,
    ],
    ['a missing owner', { ...valid, owner: '' }, /owner/],
  ])('throws on %s', (_name, input, message) => {
    expect(() => parseRegistry([input])).toThrow(message);
  });

  it('throws on duplicate flag keys', () => {
    expect(() => parseRegistry([valid, valid])).toThrow(/duplicate flag keys: example-panel/);
  });
});
