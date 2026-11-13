import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Markdown, type MarkdownDoc } from '../../components/index.js';
import { CommandPaletteButton, useCommand } from '../command/index.js';
import { GuideCommands } from './GuideCommands.js';
import { REPO_URL } from '../../lib/links.js';
import { groupGuides, neighbours, pageHeadings, SECTIONS, type Guide, type GuideMeta } from './docs.js';
import { DOCS_BASE, useBridgeLink, useDocsPath, useGuide, useGuideIndex, type GuideState, type IndexState } from './useDocs.js';
import { CodeBlock } from './CodeBlock.js';
import { PromptBox } from './PromptBox.js';
import { VideoEmbed } from './VideoEmbed.js';
import { YourCall } from './YourCall.js';
import styles from './DocsPage.module.css';

/** What a guide's Markdown renders as: images beside the guides, and the two callouts as their own components */
const GUIDE_MARKDOWN: MarkdownDoc = {
  baseUrl: DOCS_BASE,
  code: (text, lang) => <CodeBlock text={text} lang={lang} />,
  callout: (kind, text) => (kind === 'say' ? <PromptBox text={text} /> : <YourCall text={text} />),
};

/**
 * The guides as a page (`/docs` on the hosted site): a nav grouped by what you want to do, the guide, and the
 * one before and after it. A link to another guide moves without a reload. Each guide is also a raw `.md` file
 * (`/docs/<slug>.md`) and listed in `/llms.txt`, so an agent can read what a person reads.
 */
export function DocsPage({
  index,
  slug,
  guide,
  onNavigate,
  demoHref,
  bridgeUrl,
}: {
  index: IndexState;
  slug: string | undefined;
  guide: GuideState;
  onNavigate: (slug: string | undefined) => void;
  demoHref: string;
  /** Where the bridge page this viewer came from lives; offers the way back */
  bridgeUrl?: string;
}) {
  const [navOpen, setNavOpen] = useState(false);
  useCommand({ id: 'go-bridge', label: 'Back to the bridge', group: 'Go to', contextual: true, description: 'status window reaper return', onSelect: () => { if (bridgeUrl) window.location.href = bridgeUrl; } }, Boolean(bridgeUrl));
  useCommand({ id: 'go-all-guides', label: 'All guides', group: 'Go to', contextual: true, description: 'docs home start', onSelect: () => onNavigate(undefined) }, slug !== undefined);
  const mainRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const moved = useRef(false);
  const guides = index.status === 'ready' ? index.guides : [];
  const current = guides.find((g) => g.slug === slug);
  const unknown = index.status === 'ready' && slug !== undefined && !current;
  const title = current?.title;

  // Each guide is its own tab title, and moving to one hands focus to the page so a keyboard or screen-reader user starts at the top of it
  // Reserve the scrollbar's space, so the page doesn't jump sideways when a short, still-loading guide drops it
  useEffect(() => {
    const root = document.documentElement;
    root.style.scrollbarGutter = 'stable';
    return () => {
      root.style.scrollbarGutter = '';
    };
  }, []);
  useEffect(() => {
    document.title = title ? `${title} · reaper-mcp guides` : 'reaper-mcp guides';
  }, [title]);
  // The accent line beside the nav slides to the open guide: its place is measured from the link and handed to CSS as variables
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const place = () => {
      const a = nav.querySelector<HTMLElement>('a[aria-current="page"]');
      if (!a) {
        nav.dataset.rail = 'off';
        return;
      }
      nav.style.setProperty('--rail-y', `${a.offsetTop}px`);
      nav.style.setProperty('--rail-h', `${a.offsetHeight}`);
      nav.dataset.rail = nav.dataset.rail === 'on' || nav.dataset.rail === 'set' ? 'on' : 'set';
    };
    place();
    // The first placement jumps there; only later moves slide
    const frame = requestAnimationFrame(() => {
      if (nav.dataset.rail === 'set') nav.dataset.rail = 'on';
    });
    window.addEventListener('resize', place);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', place);
    };
  }, [slug, index.status, navOpen]);
  useEffect(() => {
    if (!moved.current) {
      moved.current = true;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
  }, [slug]);

  // A click on a link to another guide (the nav, the article, previous / next) is a move, not a page load
  const intercept = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href');
    if (!a || !href || a.target === '_blank') return;
    const m = /^\/docs(?:\/([a-z0-9-]+))?\/?$/.exec(href);
    if (!m) return;
    e.preventDefault();
    setNavOpen(false);
    onNavigate(m[1]);
  };

  return (
    <div className={styles.page} onClick={intercept}>
      <GuideCommands guides={index.status === 'ready' ? index.guides : undefined} onOpen={onNavigate} fallback={() => onNavigate(undefined)} contextual />
      <a className={styles.skip} href="#guide-main">Skip to the guide</a>
      <header className={styles.head}>
        <a className={styles.brand} href="/docs">
          reaper-mcp <span className={styles.brandSub}>guides</span>
        </a>
        <nav className={styles.headLinks} aria-label="Site">
          <a className={styles.headLink} href="/changelog">What’s new</a>
          <a className={styles.headLink} href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a>
          <CommandPaletteButton />
          {bridgeUrl ? (
            <a className={styles.secondary} href={bridgeUrl}>← Back to the bridge</a>
          ) : (
            <a className={styles.secondary} href={demoHref}>Try the live demo</a>
          )}
        </nav>
      </header>
      <div className={styles.body} data-landing={slug === undefined}>
        <button className={`btn ${styles.navToggle}`} aria-expanded={navOpen} onClick={() => setNavOpen(!navOpen)}>
          {navOpen ? 'Hide guides' : current ? `Guides: ${current.title}` : 'All guides'}
        </button>
        <nav className={styles.nav} data-open={navOpen} aria-label="Guides" ref={navRef}>
          <span className={styles.rail} aria-hidden="true" />
          {index.status === 'loading' && <p className={styles.hint}>Loading…</p>}
          {index.status === 'error' && <p className={styles.hint}>Couldn’t load the guides.</p>}
          {groupGuides(guides).map((section) => (
            <section key={section.key}>
              <p className={styles.navSection}>{section.title}</p>
              <ul className={styles.navList}>
                {section.guides.map((g) => (
                  <li key={g.slug}>
                    <a href={`${DOCS_BASE}/${g.slug}`} aria-current={g.slug === slug ? 'page' : undefined} title={g.summary}>
                      {g.nav ?? g.title}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
        <main className={styles.main} id="guide-main" ref={mainRef} tabIndex={-1}>
          {slug !== undefined && index.status === 'loading' && <p className={styles.hint}>Loading…</p>}
          {index.status === 'error' && slug !== undefined && <p className={styles.hint}>Couldn’t load this guide. <a href={`${REPO_URL}/tree/main/docs/guides`} target="_blank" rel="noreferrer">Read the guides on GitHub</a>.</p>}
          {slug === undefined && <Landing index={index} />}
          {unknown && <NotFound />}
          {current && <Article meta={current} guide={guide} guides={guides} />}
        </main>
      </div>
    </div>
  );
}

/** The tinted thumbnail of a guide's card: its poster when it has one, else a plain gradient, with the video length on it */
function Thumb({ guide, tone }: { guide: GuideMeta; tone: number }) {
  const video = Boolean(guide.youtube || guide.poster || guide.duration);
  return (
    <span className={styles.thumb} data-tone={tone % 4} aria-hidden="true">
      {(guide.poster ?? guide.image) && <img src={`${DOCS_BASE}/${guide.poster ?? guide.image}`} alt="" loading="lazy" />}
      {video && <span className={styles.badge}>▶ {guide.duration ?? 'Video'}</span>}
    </span>
  );
}

function SectionHead({ id, title, blurb }: { id: string; title: string; blurb: string }) {
  return (
    <header className={styles.sectionHead}>
      <h2 id={id}>{title}</h2>
      <p>{blurb}</p>
    </header>
  );
}

/**
 * The front page. One job: get a newcomer to the right first click. A hero with a single way in, then the four
 * sections as different shapes (a numbered path, picture cards, reassurance cards, a plain list) so the eye can tell
 * "start here" from "look it up".
 */
function Landing({ index }: { index: IndexState }) {
  const sections = index.status === 'ready' ? groupGuides(index.guides) : [];
  const of = (key: string) => sections.find((s) => s.key === key);
  const path = of('start');
  const things = of('try');
  const safe = of('safe');
  const know = of('know');
  return (
    <div className={styles.landing}>
      <section className={styles.hero}>
        <h1 className={styles.heroTitle}>A music assistant inside REAPER</h1>
        <p className={styles.heroLead}>
          Tell it what you need in plain words. It names and routes your tracks, measures the mix and builds the plugin you described. You make every call, and everything can be undone.
        </p>
        <ul className={styles.promises}>
          <li>Measures before it touches anything</li>
          <li>Every change is one undo</li>
          <li>Your ears decide</li>
        </ul>
        <div className={styles.actions}>
          <a className={styles.primary} href={`${DOCS_BASE}/what-this-is`}>Start here</a>
          <a className={styles.secondary} href={`${DOCS_BASE}/install`}>Already sold? Jump to install</a>
        </div>
      </section>

      {path && (
        <section aria-labelledby="sec-start">
          <SectionHead id="sec-start" title={path.title} blurb={path.blurb} />
          <ol className={styles.steps}>
            {path.guides.map((g, i) => (
              <li key={g.slug}>
                <a href={`${DOCS_BASE}/${g.slug}`}>
                  <span className={styles.stepNo} aria-hidden="true">{i + 1}</span>
                  <span className={styles.cardText}>
                    <strong>{g.title}</strong>
                    <span>{g.summary}</span>
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </section>
      )}

      {things && (
        <section aria-labelledby="sec-try">
          <SectionHead id="sec-try" title={things.title} blurb={things.blurb} />
          <ul className={styles.picture}>
            {things.guides.map((g, i) => (
              <li key={g.slug}>
                <a href={`${DOCS_BASE}/${g.slug}`}>
                  <Thumb guide={g} tone={i} />
                  <span className={styles.cardText}>
                    <strong>{g.title}</strong>
                    <span>{g.summary}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {safe && (
        <section aria-labelledby="sec-safe">
          <SectionHead id="sec-safe" title={safe.title} blurb={safe.blurb} />
          <ul className={styles.reassure}>
            {safe.guides.map((g) => (
              <li key={g.slug}>
                <a href={`${DOCS_BASE}/${g.slug}`}>
                  <strong>{g.title}</strong>
                  <span>{g.summary}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {know && (
        <section aria-labelledby="sec-know">
          <SectionHead id="sec-know" title={know.title} blurb={know.blurb} />
          <ul className={styles.lookup}>
            {know.guides.map((g) => (
              <li key={g.slug}>
                <a href={`${DOCS_BASE}/${g.slug}`}>
                  <strong>{g.title}</strong>
                  <span>{g.summary}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function NotFound() {
  return (
    <article>
      <h1 className={styles.title}>That guide isn’t here</h1>
      <p className={styles.lead}>It may have moved, or the link has a typo.</p>
      <p><a className={styles.primary} href="/docs">Back to all guides</a></p>
    </article>
  );
}

function Article({ meta, guide, guides }: { meta: GuideMeta; guide: GuideState; guides: GuideMeta[] }) {
  const { previous, next } = neighbours(guides, meta.slug);
  const hasVideo = Boolean(meta.youtube || meta.poster || meta.duration);
  const ready: Guide | null = guide.status === 'ready' ? guide.guide : null;
  const headings = ready ? pageHeadings(ready.body) : [];
  return (
    <article className={styles.article}>
      <nav className={styles.crumbs} aria-label="Breadcrumb">
        <a href="/docs">Guides</a>
        <span aria-hidden="true">/</span>
        <span>{SECTIONS.find((s) => s.key === meta.section)?.title}</span>
        {meta.duration && <span className={styles.crumbTime}>{hasVideo ? '▶ ' : ''}{meta.duration}</span>}
      </nav>
      <h1 className={styles.title}>{meta.title}</h1>
      <p className={styles.lead}>{meta.summary}</p>
      {hasVideo && (
        <VideoEmbed
          youtube={meta.youtube}
          poster={meta.poster ? `${DOCS_BASE}/${meta.poster}` : undefined}
          title={meta.title}
          duration={meta.duration}
        />
      )}
      {guide.status === 'loading' && <p className={styles.hint}>Loading…</p>}
      {(guide.status === 'error' || guide.status === 'missing') && (
        <p className={styles.hint}>
          Couldn’t load this guide. You can read it on{' '}
          <a href={`${REPO_URL}/blob/main/docs/guides/${meta.slug}.md`} target="_blank" rel="noreferrer">GitHub</a>.
        </p>
      )}
      {ready && (
        <div className={styles.cols}>
          <Markdown className={styles.prose} source={ready.body} doc={GUIDE_MARKDOWN} />
          {headings.length > 1 && (
            <nav className={styles.toc} aria-label="On this page">
              <h2 className={styles.navTitle}>On this page</h2>
              <ul className={styles.navList}>
                {headings.map((h) => (
                  <li key={h.id}>
                    <a href={`#${h.id}`}>{h.text}</a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>
      )}
      <footer className={styles.pager}>
        {previous ? (
          <a href={`${DOCS_BASE}/${previous.slug}`} rel="prev">
            <span className={styles.pagerLabel}>Previous</span>
            {previous.title}
          </a>
        ) : (
          <span />
        )}
        {next && (
          <a href={`${DOCS_BASE}/${next.slug}`} rel="next" data-side="next">
            <span className={styles.pagerLabel}>Next</span>
            {next.title}
          </a>
        )}
      </footer>
    </article>
  );
}

/** The page with its data and its address: the index and the guide from the hosted site's /docs files. */
export function DocsPageRoute() {
  const index = useGuideIndex();
  const { slug, go } = useDocsPath();
  const bridgeUrl = useBridgeLink();
  const known = index.status === 'ready' && index.guides.some((g) => g.slug === slug);
  const guide = useGuide(known ? slug : undefined);
  return <DocsPage index={index} slug={slug} guide={guide} onNavigate={go} demoHref={__HOSTED__ ? '/' : '/mcp_bridge.html?demo'} bridgeUrl={bridgeUrl} />;
}
