import { describe, expect, it } from 'vitest';
import { parseFlagOverrides, serializeFlagOverrides } from './overrides.js';
import { parseRegistry } from './schema.js';

const registry = parseRegistry([
  {
    key: 'example-panel',
    description: 'fixture',
    type: 'string',
    variants: { a: 'A', b: 'B' },
    defaultVariant: 'a',
    owner: 'tests',
  },
]);

describe('parseFlagOverrides', () => {
  it('keeps a valid override', () => {
    expect(parseFlagOverrides('{"example-panel":"b"}', registry)).toEqual({ 'example-panel': 'b' });
  });

  it.each([
    ['malformed JSON', '{nope'],
    ['an array', '["example-panel"]'],
    ['an unknown flag', '{"gone-flag":"b"}'],
    ['an unknown variant', '{"example-panel":"c"}'],
    ['a prototype key as the variant', '{"example-panel":"toString"}'],
    ['a non-string variant', '{"example-panel":1}'],
    ['nothing', ''],
  ])('drops %s instead of throwing', (_name, raw) => {
    expect(parseFlagOverrides(raw, registry)).toEqual({});
  });

  it('keeps the valid entries beside a bad one', () => {
    expect(parseFlagOverrides('{"gone":"x","example-panel":"b"}', registry)).toEqual({ 'example-panel': 'b' });
  });

  it('round-trips through serialize', () => {
    const overrides = { 'example-panel': 'b' };
    expect(parseFlagOverrides(serializeFlagOverrides(overrides), registry)).toEqual(overrides);
  });
});
