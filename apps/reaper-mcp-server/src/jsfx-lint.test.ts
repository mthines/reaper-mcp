import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Find the reaper/ directory containing JSFX files.
 * Works from both source (src/) and built output (dist/).
 */
function findJsfxDir(): string {
  const candidates = [
    join(__dirname, '..', '..', '..', 'reaper'),         // from src/
    join(__dirname, '..', '..', '..', '..', 'reaper'),   // from dist/
  ];
  for (const dir of candidates) {
    try {
      const files = readdirSync(dir);
      if (files.some((f) => f.endsWith('.jsfx'))) return dir;
    } catch {
      // try next
    }
  }
  throw new Error('Could not find reaper/ directory with JSFX files');
}

/**
 * Parse a JSFX file into sections. Returns a map of section name to content.
 * Sections are @init, @slider, @block, @sample, @gfx, @serialize.
 */
function parseJsfxSections(source: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = source.split('\n');
  let currentSection = 'header';
  let sectionLines: string[] = [];

  for (const line of lines) {
    const sectionMatch = line.match(/^@(init|slider|block|sample|gfx|serialize)/);
    if (sectionMatch) {
      sections.set(currentSection, sectionLines.join('\n'));
      currentSection = sectionMatch[1];
      sectionLines = [];
    } else {
      sectionLines.push(line);
    }
  }
  sections.set(currentSection, sectionLines.join('\n'));
  return sections;
}

describe('JSFX EEL2 lint checks', () => {
  const jsfxDir = findJsfxDir();
  const jsfxFiles = readdirSync(jsfxDir).filter((f) => f.endsWith('.jsfx'));

  it('should find JSFX files to lint', () => {
    expect(jsfxFiles.length).toBeGreaterThan(0);
  });

  for (const file of jsfxFiles) {
    describe(file, () => {
      const source = readFileSync(join(jsfxDir, file), 'utf-8');
      const sections = parseJsfxSections(source);

      it('should not use local() in @sample section', () => {
        const sampleSection = sections.get('sample');
        if (!sampleSection) return; // no @sample section

        // Match local() calls that are NOT inside a function() definition
        // local() is valid inside function() blocks but not at section top level
        const lines = sampleSection.split('\n');
        const violations: string[] = [];

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          // Skip lines inside function definitions (indented differently)
          // A top-level or block-level local() is the problem
          if (line.match(/^\s*local\s*\(/i)) {
            violations.push(`  line ${i + 1}: ${line}`);
          }
        }

        if (violations.length > 0) {
          expect.fail(
            `${file} @sample contains local() calls which crash EEL2 at runtime:\n${violations.join('\n')}\n\n` +
              'EEL2 does not support local() in @sample sections. ' +
              'Remove local() declarations — variables are global by default.'
          );
        }
      });

      it('should not use local() in @block section', () => {
        const blockSection = sections.get('block');
        if (!blockSection) return;

        const lines = blockSection.split('\n');
        const violations: string[] = [];

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.match(/^\s*local\s*\(/i)) {
            violations.push(`  line ${i + 1}: ${line}`);
          }
        }

        if (violations.length > 0) {
          expect.fail(
            `${file} @block contains local() calls which may crash EEL2:\n${violations.join('\n')}`
          );
        }
      });
    });
  }
});
