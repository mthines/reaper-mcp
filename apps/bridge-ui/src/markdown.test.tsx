import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown, safeHref } from './markdown.js';

const html = (md: string) => renderToStaticMarkup(<Markdown source={md} />);

describe('Markdown', () => {
  it('renders the formatting records use', () => {
    expect(html('## What it does\n\nA **3-band** *saturator* with `Heat`.')).toBe(
      '<div class="md"><h4>What it does</h4><p>A <strong>3-band</strong> <em>saturator</em> with <code>Heat</code>.</p></div>',
    );
    expect(html('- one\n  - nested\n- two')).toBe('<div class="md"><ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul></div>');
    expect(html('| P | Range |\n|---|---|\n| Drive | 0–10 |')).toContain('<thead><tr><th>P</th><th>Range</th></tr></thead><tbody><tr><td>Drive</td><td>0–10</td></tr></tbody>');
    expect(html('| X | Y |\n|---|---|\n| low\\|high | 1 |')).toContain('<td>low|high</td><td>1</td>');
    expect(html('```\na **b**\n```')).toBe('<div class="md"><pre><code>a **b**</code></pre></div>');
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
