import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown, safeHref, type MarkdownDoc } from './Markdown.js';

// The rendered record, inside its wrapper
const html = (md: string) => renderToStaticMarkup(<Markdown source={md} />).replace(/^<div[^>]*>|<\/div>$/g, '');

describe('Markdown', () => {
  it('renders the formatting records use', () => {
    expect(html('## What it does\n\nA **3-band** *saturator* with `Heat`.')).toBe(
      '<h4>What it does</h4><p>A <strong>3-band</strong> <em>saturator</em> with <code>Heat</code>.</p>',
    );
    expect(html('- one\n  - nested\n- two')).toBe('<ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul>');
    expect(html('| P | Range |\n|---|---|\n| Drive | 0–10 |')).toContain('<thead><tr><th>P</th><th>Range</th></tr></thead><tbody><tr><td>Drive</td><td>0–10</td></tr></tbody>');
    expect(html('| X | Y |\n|---|---|\n| low\\|high | 1 |')).toContain('<td>low|high</td><td>1</td>');
    expect(html('```\na **b**\n```')).toBe('<pre><code>a **b**</code></pre>');
  });

  it('shows raw HTML as text, never as markup', () => {
    const out = html('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)> **ok**');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt; <strong>ok</strong>');
  });

  it('keeps links only for http(s) and mailto, opened without a referrer', () => {
    expect(html('[docs](https://lorekit.io/docs)')).toContain('<a href="https://lorekit.io/docs" target="_blank" rel="noopener noreferrer">docs</a>');
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'vbscript:x', '/relative']) {
      const out = html(`[click](${bad})`);
      expect(out).not.toContain('<a');
      expect(out).toContain('click');
    }
    expect(safeHref(' https://x.y ')).toBe('https://x.y');
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c');
  });

  it('does not format inside code spans', () => {
    expect(html('`**not bold**` and **bold**')).toContain('<code>**not bold**</code> and <strong>bold</strong>');
  });
});

describe('Markdown as a guide', () => {
  const doc: MarkdownDoc = {
    baseUrl: '/docs/media',
    callout: (kind, text) => <aside data-kind={kind}>{text}</aside>,
  };
  const guide = (md: string) => renderToStaticMarkup(<Markdown source={md} doc={doc} />).replace(/^<div[^>]*>|<\/div>$/g, '');

  it('hands a fenced block, and its language, to the guide to draw', () => {
    const withCode: MarkdownDoc = { ...doc, code: (text, lang) => <pre data-lang={lang}>{text}</pre> };
    const out = renderToStaticMarkup(<Markdown source={'```bash\nnpm i -g x\nx setup\n```'} doc={withCode} />);
    expect(out).toContain('<pre data-lang="bash">npm i -g x\nx setup</pre>');
  });

  it('keeps heading levels and makes each a link to its own section', () => {
    const out = guide('## What happens next');
    expect(out).toContain('<h2 id="what-happens-next">');
    expect(out).toContain('href="#what-happens-next"');
    expect(out).toContain('What happens next</a>');
  });

  it('shows images from the guide folder only', () => {
    expect(guide('![The mixer](mixer.webp)')).toContain('<img src="/docs/media/mixer.webp" alt="The mixer" loading="lazy"/>');
    for (const bad of ['https://evil.test/x.png', '//evil.test/x.png', '/etc/x.png', '../x.png', 'javascript:alert(1)', 'data:image/svg+xml,x']) {
      const out = guide(`![alt text](${bad})`);
      expect(out).not.toContain('<img');
      expect(out).toContain('alt text');
    }
  });

  it('turns say: and your-call: quotes into callouts and leaves other quotes alone', () => {
    expect(guide('> say: Gain stage my tracks')).toBe('<aside data-kind="say">Gain stage my tracks</aside>');
    expect(guide('> your-call: You pick the target.\n> Always.')).toBe('<aside data-kind="your-call">You pick the target.\nAlways.</aside>');
    expect(guide('> just a quote')).toBe('<blockquote><p>just a quote</p></blockquote>');
  });

  it('collapses a ::: details block and renders its content', () => {
    expect(guide('::: details Transcript\n\nHello **there**.\n\n:::')).toBe('<details><summary>Transcript</summary><p>Hello <strong>there</strong>.</p></details>');
  });

  it('links to sibling guides in the same tab and to other sites in a new one', () => {
    expect(guide('[Install](install.md)')).toContain('<a href="/docs/install">Install</a>');
    expect(guide('[Safety](undo-and-safety.md#your-call)')).toContain('<a href="/docs/undo-and-safety#your-call">Safety</a>');
    expect(guide('[Repo](https://github.com/mthines/reaper-mcp)')).toContain('target="_blank"');
  });

  it('leaves the record renderer alone: no images, no callouts', () => {
    expect(html('![alt](x.png)\n\n> say: hi')).not.toContain('<img');
    expect(html('> say: hi')).toContain('<blockquote>');
  });
});
