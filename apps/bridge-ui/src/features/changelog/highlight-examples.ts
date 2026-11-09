import type { Highlight } from './highlights.js';

/**
 * Fixed highlights for the stories, one per kind: the committed What's new clip and its still (served from
 * apps/bridge-ui/changelog by Storybook's staticDirs) and a small house-style graphic.
 */
const GRAPHIC = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000">
<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="180" y1="0" x2="1420" y2="0"><stop offset="0" stop-color="#7cc4ff"/><stop offset="1" stop-color="#c4a5ff"/></linearGradient></defs>
<rect width="1600" height="1000" fill="#0e0f11"/>
<g font-family="-apple-system, Inter, sans-serif" font-size="44" fill="#e7e9ec">
<rect x="180" y="400" width="360" height="200" rx="28" fill="#1b1d21" stroke="#2f333a" stroke-width="3"/><text x="360" y="512" text-anchor="middle">Track</text>
<rect x="1060" y="400" width="360" height="200" rx="28" fill="#1b1d21" stroke="url(#g)" stroke-width="4"/><text x="1240" y="512" text-anchor="middle">Bus</text>
</g>
<path d="M560 500 H1040" stroke="url(#g)" stroke-width="10" stroke-linecap="round" stroke-dasharray="24 22">
<animate attributeName="stroke-dashoffset" from="92" to="0" dur="1.2s" repeatCount="indefinite"/></path>
</svg>`;

export const EXAMPLE_HIGHLIGHTS: Highlight[] = [
  {
    id: 'whats-new-drawer',
    version: '0.80.0',
    kind: 'animation',
    group: 'new',
    title: 'What’s new, right on the bridge page',
    blurb: 'A pill tells you when a new release is out. Open it to see every change and update in one click.',
    tryIt: '⌘K → What’s new',
    media: '/changelog/media/whats-new-drawer.mp4',
    poster: '/changelog/media/whats-new-drawer.webp',
    alt: 'The Update available pill opens the What’s new drawer',
  },
  {
    id: 'send-graphic',
    pr: 102,
    kind: 'graphic',
    group: 'faster',
    title: 'Sends render in one pass',
    blurb: 'Tracks that feed a bus now render together, so measuring a mix takes one pass instead of one per track.',
    media: `data:image/svg+xml,${encodeURIComponent(GRAPHIC)}`,
    alt: 'A track wired into a bus with signal flowing along the wire',
  },
  {
    id: 'drawer-screenshot',
    pr: 100,
    kind: 'screenshot',
    group: 'fixes',
    title: 'Links open the right view',
    blurb: 'A link from an agent’s reply now opens the call it made, on the Calls view.',
    media: '/changelog/media/whats-new-drawer.webp',
    alt: 'The What’s new drawer',
  },
];
