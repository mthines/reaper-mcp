// The stat tiles above the timeline. Import from here, never the files.
import { Sparkline } from './Sparkline.js';
import { Stats as StatsView } from './Stats.js';

/** The stat tiles; `Stats.Sparkline` is the last-minute trace each tile draws */
export const Stats = Object.assign(StatsView, { Sparkline });
