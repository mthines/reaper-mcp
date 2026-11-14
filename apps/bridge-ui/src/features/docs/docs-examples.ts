import type { GalleryItem } from '../../components/index.js';
import type { Guide } from './docs.js';

/** Fixed guides for the stories: one with a video, one waiting for its video, one plain page */
export const EXAMPLE_GUIDES: Guide[] = [
  { slug: 'install', title: 'Install and connect', summary: 'Three commands, then start REAPER.', section: 'start', order: 1, youtube: 'dQw4w9WgXcQ', duration: '3 min', body: '## The three commands\n\nPaste these.\n\n```bash\nnpm install -g @mthines/reaper-mcp\nreaper-mcp setup\n```\n\n> say: reaper-mcp setup\n\n## Something is off?\n\nRun `reaper-mcp doctor`.' },
  { slug: 'what-this-is', title: 'What this is', summary: 'An assistant, not a composer.', section: 'start', order: 2, body: 'It does the tedious parts.\n\n> your-call: Taste stays with you.' },
  { slug: 'second-opinion', title: 'Get a second opinion on your mix', summary: 'Ask it to roast your mix.', section: 'try', order: 1, poster: 'media/loudness-curve.png', duration: '5 min', body: '## Say this\n\n> say: /critique Roast my mix\n\n> your-call: A critique is a to-do list.\n\n::: details Transcript\n\nHello.\n\n:::' },
  { slug: 'glossary', title: 'Words you will hear', summary: 'Plain-language explanations.', section: 'know', order: 1, body: '## Gain staging\n\nSetting levels first.' },
];

const PLUGIN_PICTURE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220"><rect width="320" height="220" fill="#15181d"/><text x="20" y="34" fill="#f59e0b" font-family="sans-serif" font-size="16" font-weight="700">Tape Sat</text><circle cx="80" cy="130" r="38" fill="none" stroke="#f59e0b" stroke-width="6"/><circle cx="200" cy="130" r="38" fill="none" stroke="#444" stroke-width="6"/></svg>');

/** The make-a-plugin gallery's cards for the stories: some with a picture, some without */
export const GALLERY_EXAMPLE: GalleryItem[] = [
  { name: 'Tape Sat', image: { src: PLUGIN_PICTURE, alt: 'Tape Sat: Drive, Tone, Mix and Output knobs' }, text: 'Warm saturation with a tone control.' },
  { name: 'Multiband Compressor', text: 'Three bands you drag on a spectrum.' },
  { name: 'Drum Pads', text: 'Eight drum sounds you play with the mouse or keyboard.' },
  { name: 'Step Sequencer', text: 'Draw a drum loop on a grid.' },
];
