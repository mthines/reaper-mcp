import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildNpmReadme } from './npm-readme.mjs';

const root = resolve(__dirname, '../../..');
const options = { repo: 'mthines/reaper-mcp', ref: 'v1.2.3' };
const install = '## 🚀 Install in 3 steps\n\n```bash\nnpm install -g @mthines/reaper-mcp\n```\n';

const build = (readme: string) => buildNpmReadme(readme, install, options) as string;

describe('the README npm shows', () => {
  it('replaces the clone install with the npm install and keeps the rest', () => {
    const out = build('# Title\n\n## Why\n\nWords.\n\n## 🚀 Install in 3 steps\n\ngit clone x\n\n## FAQ\n\nAnswers.\n');
    expect(out).toContain('npm install -g @mthines/reaper-mcp');
    expect(out).not.toContain('git clone x');
    expect(out).toMatch(/## Why[\s\S]*Words\.[\s\S]*## FAQ[\s\S]*Answers\./);
  });

  it('points relative images at raw GitHub and relative links at the release tag', () => {
    const out = build(
      [
        '<img src="docs/assets/hero.svg" width="100%">',
        '<source srcset="docs/assets/logo-dark.svg">',
        '![shot](docs/assets/views/spectrum.png)',
        'See [safety](docs/SAFETY.md) and <a href="docs/PLUGINS.md">plugins</a>.',
        '## 🚀 Install in 3 steps',
        '## End',
      ].join('\n'),
    );
    expect(out).toContain('src="https://raw.githubusercontent.com/mthines/reaper-mcp/v1.2.3/docs/assets/hero.svg"');
    expect(out).toContain('srcset="https://raw.githubusercontent.com/mthines/reaper-mcp/v1.2.3/docs/assets/logo-dark.svg"');
    expect(out).toContain('](https://raw.githubusercontent.com/mthines/reaper-mcp/v1.2.3/docs/assets/views/spectrum.png)');
    expect(out).toContain('](https://github.com/mthines/reaper-mcp/blob/v1.2.3/docs/SAFETY.md)');
    expect(out).toContain('href="https://github.com/mthines/reaper-mcp/blob/v1.2.3/docs/PLUGINS.md"');
  });

  it('leaves absolute URLs, anchors and code blocks alone', () => {
    const out = build(
      [
        '[reaper](https://www.reaper.fm/) [up](#-faq)',
        '```',
        '[not a link](docs/x.md)',
        '```',
        '## 🚀 Install in 3 steps',
        '## End',
      ].join('\n'),
    );
    expect(out).toContain('[reaper](https://www.reaper.fm/) [up](#-faq)');
    expect(out).toContain('[not a link](docs/x.md)');
  });

  it('refuses a README whose install section is gone, rather than shipping the clone steps', () => {
    expect(() => build('# Title\n\n## Why\n')).toThrow(/Install in 3 steps/);
  });

  it('turns the real README into a page with no relative image or link left', () => {
    const out = build(readFileSync(resolve(root, 'README.md'), 'utf-8'));
    expect(out).toContain('npm install -g @mthines/reaper-mcp');
    expect(out).not.toContain('git clone https://github.com/mthines/reaper-mcp.git && cd reaper-mcp && ./scripts/install.sh');
    const withoutCode = out.replace(/```[\s\S]*?```/g, '');
    const relative = [...withoutCode.matchAll(/(?:src|srcset|href)="([^"]+)"|\]\(([^)\s]+)/g)]
      .map((m) => m[1] ?? m[2])
      .filter((url) => !/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url));
    expect(relative).toEqual([]);
  });
});
