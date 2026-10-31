import { labelSessions, type Session } from '../lib/sessions.js';
import { deriveSeries, type Sample } from '../lib/log.js';
import { createDemo, seededRandom } from './demo.js';
import { EXAMPLE_NOW } from './examples.js';

/**
 * A fixed bridge feed for stories: the ?demo bridge on a frozen clock and seeded dice, so every load draws the
 * same 47 minutes of agent traffic.
 */
export function exampleFeed() {
  const demo = createDemo({ now: () => EXAMPLE_NOW, random: seededRandom(7) });
  const { status, history, longHistory, log = [] } = demo.tick();
  const sessions = new Map<string, Session>(labelSessions(status.sessions ?? []).map((s) => [s.id, s]));
  // A minute of 1 s counter samples for the stat sparklines
  const samples: Sample[] = Array.from({ length: 60 }, (_, i) => {
    const t = EXAMPLE_NOW - (59 - i) * 1000;
    const done = log.filter((e) => e.t <= t);
    return { t, commands: done.length, errors: done.filter((e) => !e.ok).length, deferMs: 33 + (i % 5) * 0.3 };
  });
  return { status, history, longHistory, log, sessions, series: deriveSeries(samples, log) };
}
