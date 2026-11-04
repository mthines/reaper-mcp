import { describe, it, expect } from 'vitest';
import { EXTENSION_API_VERSION, validateManifest } from './manifest.js';

const good = { name: 'vital', version: '1.0.0', apiVersion: EXTENSION_API_VERSION, main: 'dist/index.mjs' };

describe('validateManifest', () => {
  it('accepts a minimal manifest and keeps the optional fields it was given', () => {
    const r = validateManifest({ ...good, lua: 'handlers.lua', description: 'Vital patches', author: 'me' });
    expect(r).toEqual({ ok: true, manifest: { ...good, lua: 'handlers.lua', description: 'Vital patches', author: 'me' } });
  });

  it('refuses something that is not a JSON object', () => {
    for (const bad of [null, 'x', 3, [], undefined]) {
      const r = validateManifest(bad);
      expect(r.ok).toBe(false);
    }
  });

  it.each(['Vital', 'v', '1vital', 'has space', 'under_score', 'a'.repeat(33), ''])('refuses the name %j', (name) => {
    const r = validateManifest({ ...good, name });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/"name"/);
  });

  it('refuses an extension written for another API version and says which one this build runs', () => {
    const r = validateManifest({ ...good, apiVersion: EXTENSION_API_VERSION + 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain(`API ${EXTENSION_API_VERSION}`);
  });

  it.each(['../evil.mjs', '/etc/passwd', 'C:/x.mjs', 'a\\b.mjs', 'a//b.mjs', 'dist/../../x.mjs', ''])(
    'refuses the path %j for main and lua alike',
    (path) => {
      expect(validateManifest({ ...good, main: path }).ok).toBe(false);
      expect(validateManifest({ ...good, lua: path }).ok).toBe(false);
    },
  );

  it('reports every problem at once, not just the first', () => {
    const r = validateManifest({ name: 'Bad', version: 'x', apiVersion: 'y', main: '../z' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBe(4);
  });
});
