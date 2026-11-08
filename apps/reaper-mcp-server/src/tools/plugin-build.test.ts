import { describe, it, expect } from 'vitest';
import { buildAttributes, BUILD_OUTCOMES, BUILD_EXAMPLES } from './plugin-build.js';

describe('report_plugin_build attributes', () => {
  it('sends the outcome, the example it started from and capped counts', () => {
    expect(buildAttributes({ outcome: 'shipped', example: 'tape-sat', rounds: 2, checksPassed: 4, checksFailed: 0, cleanedUp: true, seconds: 310 })).toEqual({
      'reaper.plugin_build.outcome': 'shipped', 'reaper.plugin_build.example': 'tape-sat', 'reaper.plugin_build.rounds': 2,
      'reaper.plugin_build.checks_passed': 4, 'reaper.plugin_build.checks_failed': 0, 'reaper.plugin_build.cleaned_up': true, 'reaper.plugin_build.duration_s': 310,
    });
  });

  it('turns anything outside the fixed lists into "other", so free text never reaches a span', () => {
    const a = buildAttributes({ outcome: 'it was great', example: 'my secret reverb' });
    expect(a['reaper.plugin_build.outcome']).toBe('other');
    expect(a['reaper.plugin_build.example']).toBe('other');
    for (const v of BUILD_OUTCOMES) expect(buildAttributes({ outcome: v })['reaper.plugin_build.outcome']).toBe(v);
    for (const v of BUILD_EXAMPLES) expect(buildAttributes({ outcome: 'shipped', example: v })['reaper.plugin_build.example']).toBe(v);
  });

  it('caps counts and leaves out what was not given, so a missing value never reads as zero seconds', () => {
    const a = buildAttributes({ outcome: 'abandoned', rounds: 400, checksPassed: 99 });
    expect(a['reaper.plugin_build.rounds']).toBe(10);
    expect(a['reaper.plugin_build.checks_passed']).toBe(8);
    expect(a).not.toHaveProperty('reaper.plugin_build.duration_s');
    expect(a).not.toHaveProperty('reaper.plugin_build.cleaned_up');
  });
});
