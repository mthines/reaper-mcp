// Fixed feature-flag rows the Developer settings stories draw: resolved by default, by a running split, and forced.
import type { FlagRow } from '../lib/flags.js';

export const EXAMPLE_FLAG_ROWS: FlagRow[] = [
  {
    key: 'example-panel',
    description: 'A fixture flag that gates a new panel, shipped dark and forced on for the owner only.',
    variants: ['off', 'on'],
    variant: 'off',
    reason: 'static',
  },
  {
    key: 'example-ramp',
    description: 'A fixture experiment that shows the new layout to a share of browsers.',
    variants: ['control', 'wide'],
    variant: 'control',
    reason: 'split',
    split: 'control 90% / wide 10%',
  },
  {
    key: 'example-forced',
    description: 'A flag the viewer has forced to a variant.',
    variants: ['off', 'on'],
    variant: 'on',
    reason: 'override',
    override: 'on',
  },
];
