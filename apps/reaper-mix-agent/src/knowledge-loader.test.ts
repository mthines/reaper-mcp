import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadKnowledge,
  loadPlugins,
  loadGenre,
  loadWorkflow,
  loadReference,
} from './knowledge-loader.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const PLUGIN_MD = `---
name: Test EQ
fx_match: ["TestEQ", "VST: TestEQ"]
category: eq
style: transparent
vendor: TestVendor
preference: 80
---

# Test EQ

A test equalizer for unit tests.
`;

const GENRE_MD = `---
name: Test Rock
id: test-rock
parent: rock
---

# Test Rock

Rock conventions for unit tests.
`;

const WORKFLOW_MD = `---
name: Test Workflow
id: test-workflow
description: A test workflow
---

# Test Workflow

Steps for a test workflow.
`;

const REFERENCE_MD = `---
name: Test Reference
---

# Test Reference

Reference data for unit tests.
`;

const MALFORMED_MD = `No frontmatter here — just raw content.
`;

const TEMPLATE_MD = `---
name: Plugin Template
fx_match: []
category: eq
---

# Template
`;

let tmpDir: string;

beforeAll(async () => {
  tmpDir = join(tmpdir(), `knowledge-loader-test-${Date.now()}`);

  // Create directory structure
  await mkdir(join(tmpDir, 'plugins', 'test-vendor'), { recursive: true });
  await mkdir(join(tmpDir, 'genres'), { recursive: true });
  await mkdir(join(tmpDir, 'workflows'), { recursive: true });
  await mkdir(join(tmpDir, 'reference'), { recursive: true });

  // Write fixture files
  await writeFile(join(tmpDir, 'plugins', 'test-vendor', 'test-eq.md'), PLUGIN_MD);
  await writeFile(join(tmpDir, 'genres', 'test-rock.md'), GENRE_MD);
  await writeFile(join(tmpDir, 'workflows', 'test-workflow.md'), WORKFLOW_MD);
  await writeFile(join(tmpDir, 'reference', 'test-ref.md'), REFERENCE_MD);
  await writeFile(join(tmpDir, 'plugins', '_template.md'), TEMPLATE_MD);
  await writeFile(join(tmpDir, 'reference', 'malformed.md'), MALFORMED_MD);
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// loadKnowledge
// ---------------------------------------------------------------------------

describe('loadKnowledge', () => {
  it('loads all typed knowledge files', async () => {
    const files = await loadKnowledge(tmpDir);
    // Should include plugin, genre, workflow, reference but NOT template
    const types = files.map((f) => f.type);
    expect(types).toContain('plugin');
    expect(types).toContain('genre');
    expect(types).toContain('workflow');
    expect(types).toContain('reference');
  });

  it('excludes _template files', async () => {
    const files = await loadKnowledge(tmpDir);
    const names = files.map((f) => f.frontmatter['name']);
    expect(names).not.toContain('Plugin Template');
  });

  it('returns the correct number of non-template files', async () => {
    const files = await loadKnowledge(tmpDir);
    // plugin + genre + workflow + reference + malformed-reference = 5
    expect(files.length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

describe('frontmatter parsing', () => {
  it('parses string values', async () => {
    const files = await loadKnowledge(tmpDir);
    const plugin = files.find((f) => f.type === 'plugin');
    expect(plugin?.frontmatter['name']).toBe('Test EQ');
    expect(plugin?.frontmatter['vendor']).toBe('TestVendor');
  });

  it('parses number values', async () => {
    const files = await loadKnowledge(tmpDir);
    const plugin = files.find((f) => f.type === 'plugin');
    expect(plugin?.frontmatter['preference']).toBe(80);
  });

  it('parses array values', async () => {
    const files = await loadKnowledge(tmpDir);
    const plugin = files.find((f) => f.type === 'plugin');
    expect(Array.isArray(plugin?.frontmatter['fx_match'])).toBe(true);
    expect(plugin?.frontmatter['fx_match']).toContain('TestEQ');
    expect(plugin?.frontmatter['fx_match']).toContain('VST: TestEQ');
  });

  it('handles file with no frontmatter (malformed)', async () => {
    const files = await loadKnowledge(tmpDir);
    const malformed = files.find(
      (f) =>
        f.type === 'reference' &&
        Object.keys(f.frontmatter).length === 0,
    );
    expect(malformed).toBeDefined();
    expect(malformed?.content).toContain('No frontmatter here');
  });

  it('includes content body after frontmatter', async () => {
    const files = await loadKnowledge(tmpDir);
    const plugin = files.find((f) => f.type === 'plugin');
    expect(plugin?.content).toContain('A test equalizer for unit tests.');
    // Content should not include the frontmatter delimiters
    expect(plugin?.content).not.toContain('---');
  });
});

// ---------------------------------------------------------------------------
// loadPlugins
// ---------------------------------------------------------------------------

describe('loadPlugins', () => {
  it('returns only plugin files', async () => {
    const plugins = await loadPlugins(tmpDir);
    for (const p of plugins) {
      expect(p.type).toBe('plugin');
    }
  });

  it('filters by category', async () => {
    const eqPlugins = await loadPlugins(tmpDir, 'eq');
    expect(eqPlugins.length).toBeGreaterThan(0);
    for (const p of eqPlugins) {
      expect(p.frontmatter['category']).toBe('eq');
    }
  });

  it('returns empty array for unknown category', async () => {
    const plugins = await loadPlugins(tmpDir, 'nonexistent-category');
    expect(plugins).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// loadGenre
// ---------------------------------------------------------------------------

describe('loadGenre', () => {
  it('loads a genre by id', async () => {
    const genre = await loadGenre(tmpDir, 'test-rock');
    expect(genre).not.toBeNull();
    expect(genre?.frontmatter['name']).toBe('Test Rock');
  });

  it('returns null for unknown genre', async () => {
    const genre = await loadGenre(tmpDir, 'nonexistent-genre');
    expect(genre).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// loadWorkflow
// ---------------------------------------------------------------------------

describe('loadWorkflow', () => {
  it('loads a workflow by id', async () => {
    const workflow = await loadWorkflow(tmpDir, 'test-workflow');
    expect(workflow).not.toBeNull();
    expect(workflow?.frontmatter['name']).toBe('Test Workflow');
  });

  it('returns null for unknown workflow', async () => {
    const workflow = await loadWorkflow(tmpDir, 'nonexistent-workflow');
    expect(workflow).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// loadReference
// ---------------------------------------------------------------------------

describe('loadReference', () => {
  it('returns only reference files', async () => {
    const refs = await loadReference(tmpDir);
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) {
      expect(r.type).toBe('reference');
    }
  });
});
