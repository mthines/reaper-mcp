import { describe, expect, it } from 'vitest';
import { resolveFlag } from './resolve.js';
import { parseRegistry } from './schema.js';

const [staticFlag, experimentFlag] = parseRegistry([
  {
    key: 'static-flag',
    description: 'fixture',
    type: 'boolean',
    variants: { off: false, on: true },
    defaultVariant: 'off',
    owner: 'tests',
  },
  {
    key: 'ramp-flag',
    description: 'fixture',
    type: 'boolean',
    variants: { off: false, on: true },
    defaultVariant: 'off',
    owner: 'tests',
    experiment: { enabled: true, variants: [{ key: 'off', weight: 50 }, { key: 'on', weight: 50 }] },
  },
]);

describe('resolveFlag', () => {
  it('returns the default variant, reason static, with no experiment', () => {
    expect(resolveFlag(staticFlag, { targetingKey: 'a' })).toEqual({ variant: 'off', value: false, reason: 'static' });
  });

  it('splits an enabled experiment by the targeting key', () => {
    const arms = new Set(Array.from({ length: 100 }, (_, i) => resolveFlag(experimentFlag, { targetingKey: `i-${i}` }).variant));
    expect(arms).toEqual(new Set(['off', 'on']));
    expect(resolveFlag(experimentFlag, { targetingKey: 'i-1' }).reason).toBe('split');
  });

  it('lets a valid override beat the split', () => {
    const forced = resolveFlag(experimentFlag, { targetingKey: 'i-1', overrides: { 'ramp-flag': 'on' } });
    expect(forced).toEqual({ variant: 'on', value: true, reason: 'override' });
  });

  it('ignores an override naming an unknown variant', () => {
    const result = resolveFlag(staticFlag, { overrides: { 'static-flag': 'constructor' } });
    expect(result.reason).toBe('static');
  });

  it('keeps an enabled experiment on its default variant when there is no targeting key', () => {
    expect(resolveFlag(experimentFlag, {}).reason).toBe('static');
  });

  it('keeps a disabled experiment dark', () => {
    const dark = { ...experimentFlag, experiment: { ...experimentFlag.experiment!, enabled: false } };
    expect(resolveFlag(dark, { targetingKey: 'i-1' }).reason).toBe('static');
  });
});
