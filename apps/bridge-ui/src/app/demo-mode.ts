import { createDemo, seededRandom } from '../demo/demo.js';

// The hosted build (public demo on Vercel) has no bridge, so it is always the demo.
// Seeded dice: every load logs the same calls under the same numbers, so a link to one (`entry`) opens it again
export const DEMO = __HOSTED__ || new URLSearchParams(location.search).has('demo') ? createDemo({ tour: true, random: seededRandom(42) }) : null;
