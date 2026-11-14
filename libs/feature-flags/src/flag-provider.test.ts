import { describe, expect, it } from 'vitest';
import { createFlagClient, evaluateDefinition } from './client.js';
import { FlagProvider } from './provider.js';
import { parseRegistry } from './schema.js';

const registry = parseRegistry([
  {
    key: 'ramp-flag',
    description: 'fixture',
    type: 'boolean',
    variants: { off: false, on: true },
    defaultVariant: 'off',
    owner: 'tests',
    experiment: { enabled: true, variants: [{ key: 'off', weight: 50 }, { key: 'on', weight: 50 }] },
  },
  {
    key: 'copy-flag',
    description: 'fixture',
    type: 'string',
    variants: { short: 'Hi', long: 'Hello there' },
    defaultVariant: 'short',
    owner: 'tests',
  },
  {
    key: 'limit-flag',
    description: 'fixture',
    type: 'number',
    variants: { low: 1, high: 10 },
    defaultVariant: 'low',
    owner: 'tests',
  },
  {
    key: 'shape-flag',
    description: 'fixture',
    type: 'object',
    variants: { a: { n: 1 }, b: { n: 2 } },
    defaultVariant: 'a',
    owner: 'tests',
  },
]);

const provider = new FlagProvider(registry);

describe('FlagProvider resolution order', () => {
  it('prefers a valid override over the split', async () => {
    const result = await provider.resolveBooleanEvaluation('ramp-flag', false, {
      targetingKey: 'install-1',
      flagOverrides: { 'ramp-flag': 'on' },
    });
    expect(result).toMatchObject({ value: true, variant: 'on', reason: 'OVERRIDE' });
  });

  it('falls through to the split when the override names an unknown variant', async () => {
    const result = await provider.resolveBooleanEvaluation('ramp-flag', false, {
      targetingKey: 'install-1',
      flagOverrides: { 'ramp-flag': 'nope' },
    });
    expect(result.reason).toBe('SPLIT');
  });

  it('uses the split for an enabled experiment and the static default otherwise', async () => {
    const split = await provider.resolveBooleanEvaluation('ramp-flag', false, { targetingKey: 'install-1' });
    const fixed = await provider.resolveStringEvaluation('copy-flag', '', { targetingKey: 'install-1' });
    expect(split.reason).toBe('SPLIT');
    expect(fixed).toMatchObject({ value: 'Hi', variant: 'short', reason: 'STATIC' });
  });

  it('resolves number and object flags', async () => {
    expect((await provider.resolveNumberEvaluation('limit-flag', 0, {})).value).toBe(1);
    expect((await provider.resolveObjectEvaluation('shape-flag', {}, {})).value).toEqual({ n: 1 });
  });

  it('reports an unknown flag and a type mismatch as errors carrying the caller default', async () => {
    const unknown = await provider.resolveBooleanEvaluation('gone', true, {});
    const mismatch = await provider.resolveBooleanEvaluation('copy-flag', true, {});
    expect(unknown).toMatchObject({ value: true, reason: 'ERROR', errorCode: 'FLAG_NOT_FOUND' });
    expect(mismatch).toMatchObject({ value: true, reason: 'ERROR', errorCode: 'TYPE_MISMATCH' });
  });
});

describe('createFlagClient', () => {
  it('evaluates through OpenFeature with the override from the context', async () => {
    const client = createFlagClient(registry, 'provider-test');
    const def = registry.find((f) => f.key === 'ramp-flag')!;

    const natural = await evaluateDefinition(client, def, { targetingKey: 'install-1' });
    const forced = await evaluateDefinition(client, def, {
      targetingKey: 'install-1',
      flagOverrides: { 'ramp-flag': natural.variant === 'on' ? 'off' : 'on' },
    });

    expect(natural.reason).toBe('SPLIT');
    expect(forced.reason).toBe('OVERRIDE');
    expect(forced.variant).not.toBe(natural.variant);
  });
});
