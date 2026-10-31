import { createDemo, seededRandom } from '../demo/demo.js';

// Seeded dice: every load logs the same calls under the same numbers, so a link to one (`entry`) opens it again
export const DEMO = new URLSearchParams(location.search).has('demo') ? createDemo({ tour: true, random: seededRandom(42) }) : null;
