import type { Guide } from './docs.js';

/** Fixed guides for the stories: one with a video, one waiting for its video, one plain page */
export const EXAMPLE_GUIDES: Guide[] = [
  { slug: 'install', title: 'Install and connect', summary: 'Three commands, then start REAPER.', section: 'start', order: 1, youtube: 'dQw4w9WgXcQ', duration: '3 min', body: '## The three commands\n\nPaste these.\n\n```bash\nnpm install -g @mthines/reaper-mcp\nreaper-mcp setup\n```\n\n> say: reaper-mcp setup\n\n## Something is off?\n\nRun `reaper-mcp doctor`.' },
  { slug: 'what-this-is', title: 'What this is', summary: 'An assistant, not a composer.', section: 'start', order: 2, body: 'It does the tedious parts.\n\n> your-call: Taste stays with you.' },
  { slug: 'second-opinion', title: 'Get a second opinion on your mix', summary: 'Ask it to roast your mix.', section: 'try', order: 1, poster: 'media/loudness-curve.png', duration: '5 min', body: '## Say this\n\n> say: /critique Roast my mix\n\n> your-call: A critique is a to-do list.\n\n::: details Transcript\n\nHello.\n\n:::' },
  { slug: 'glossary', title: 'Words you will hear', summary: 'Plain-language explanations.', section: 'know', order: 1, body: '## Gain staging\n\nSetting levels first.' },
];
