import { Fragment, type ReactNode } from 'react';
import { cx } from '../lib/cx.js';
import styles from './Markdown.module.css';

/**
 * A small Markdown renderer for LoreKit records: headings, paragraphs, lists (two levels), tables,
 * fenced code, blockquotes, rules, and inline bold / italic / code / links.
 *
 * Safe by construction: it builds React elements and never sets HTML, so every character of the
 * source is rendered as text (React escapes it); raw HTML in a record shows up literally. Links keep
 * an href only for http(s) and mailto URLs and always open in a new tab without a referrer.
 */
export function Markdown({ source, className }: { source: string; className?: string }) {
  return <div className={className ? cx(styles.md, className) : styles.md}>{blocks(source.replace(/\r\n?/g, '\n'))}</div>;
}

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

export function safeHref(url: string): string | undefined {
  const trimmed = url.trim();
  return SAFE_URL.test(trimmed) ? trimmed : undefined;
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;

function blocks(source: string): ReactNode[] {
  const lines = source.split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  const key = () => out.length;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++; // closing fence (or end of input)
      out.push(
        <pre key={key()}>
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      // Records start at #; inside a drawer the biggest heading is a small one
      const level = Math.min(heading[1].length + 2, 6);
      const Tag = `h${level}` as 'h3' | 'h4' | 'h5' | 'h6';
      out.push(<Tag key={key()}>{inline(heading[2])}</Tag>);
      i++;
      continue;
    }

    if (RULE.test(line)) {
      out.push(<hr key={key()} />);
      i++;
      continue;
    }

    if (line.trim().startsWith('|') && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      out.push(
        <div key={key()} className={styles.mdTable}>
          <table>
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j}>{inline(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, j) => (
                <tr key={j}>
                  {head.map((_, k) => (
                    <td key={k}>{inline(r[k] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quoted.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(<blockquote key={key()}>{blocks(quoted.join('\n'))}</blockquote>);
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const items: Array<{ indent: number; ordered: boolean; text: string }> = [];
      while (i < lines.length) {
        const m = lines[i].match(LIST_ITEM);
        if (m) {
          items.push({ indent: m[1].replace(/\t/g, '  ').length, ordered: /\d/.test(m[2]), text: m[3] });
          i++;
        } else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) {
          items[items.length - 1].text += ` ${lines[i].trim()}`; // continuation line
          i++;
        } else break;
      }
      out.push(list(items, key()));
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !LIST_ITEM.test(lines[i]) &&
      !/^\s*(#{1,6}\s|>|`{3,}|~{3,})/.test(lines[i]) &&
      !RULE.test(lines[i]) &&
      !(lines[i].trim().startsWith('|') && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1]))
    ) {
      para.push(lines[i++]);
    }
    out.push(
      <p key={key()}>
        {para.map((l, j) => (
          <Fragment key={j}>
            {j > 0 && (/\s{2,}$/.test(para[j - 1]) ? <br /> : ' ')}
            {inline(l.trim())}
          </Fragment>
        ))}
      </p>,
    );
  }
  return out;
}

/** Split a table row on unescaped pipes; `\|` stays a literal pipe in the cell. */
function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));
}

/** Two levels: items indented past the first item nest under the item before them. */
function list(items: Array<{ indent: number; ordered: boolean; text: string }>, key: number): ReactNode {
  const base = items[0].indent;
  const top: Array<{ text: string; children: string[]; ordered: boolean }> = [];
  for (const item of items) {
    if (item.indent > base && top.length) top[top.length - 1].children.push(item.text);
    else top.push({ text: item.text, children: [], ordered: item.ordered });
  }
  const List = items[0].ordered ? 'ol' : 'ul';
  return (
    <List key={key}>
      {top.map((t, j) => (
        <li key={j}>
          {inline(t.text)}
          {t.children.length > 0 && (
            <ul>
              {t.children.map((c, k) => (
                <li key={k}>{inline(c)}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </List>
  );
}

// Earliest match wins; code spans first so their content is never formatted
const INLINE = [
  { re: /`([^`]+)`/, render: (m: RegExpMatchArray, k: number) => <code key={k}>{m[1]}</code> },
  {
    re: /\[([^\]]+)\]\(([^()\s]+)\)/,
    render: (m: RegExpMatchArray, k: number) => {
      const href = safeHref(m[2]);
      return href ? (
        <a key={k} href={href} target="_blank" rel="noopener noreferrer">
          {inline(m[1])}
        </a>
      ) : (
        <Fragment key={k}>{inline(m[1])}</Fragment>
      );
    },
  },
  { re: /\*\*(.+?)\*\*|__(.+?)__/, render: (m: RegExpMatchArray, k: number) => <strong key={k}>{inline(m[1] ?? m[2])}</strong> },
  { re: /(?<![*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\*)|(?<![_\w])_(?!\s)(.+?)(?<!\s)_(?![_\w])/, render: (m: RegExpMatchArray, k: number) => <em key={k}>{inline(m[1] ?? m[2])}</em> },
];

export function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  while (rest) {
    let best: { m: RegExpMatchArray; render: (m: RegExpMatchArray, k: number) => ReactNode } | null = null;
    for (const rule of INLINE) {
      const m = rest.match(rule.re);
      if (m && m.index !== undefined && (!best || m.index < (best.m.index ?? 0))) best = { m, render: rule.render };
    }
    if (!best || best.m.index === undefined) {
      out.push(rest);
      break;
    }
    if (best.m.index > 0) out.push(rest.slice(0, best.m.index));
    out.push(best.render(best.m, out.length));
    rest = rest.slice(best.m.index + best.m[0].length);
  }
  return out;
}
