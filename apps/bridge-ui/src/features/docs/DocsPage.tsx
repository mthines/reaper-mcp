import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Markdown, type MarkdownDoc } from '../../components/index.js';
import { Gallery } from './Gallery.js';
import { CommandPaletteButton, useCommand } from '../command/index.js';
import { GuideCommands } from './GuideCommands.js';
import { DISCORD_URL, REPO_URL } from '../../lib/links.js';
import { groupGuides, neighbours, pageHeadings, SECTIONS, type Guide, type GuideMeta } from './docs.js';
import { DOCS_BASE, useBridgeLink, useDocsPath, useGuide, useGuideIndex, type GuideState, type IndexState } from './useDocs.js';
import { CodeBlock } from './CodeBlock.js';
import { Logo } from './Logo.js';
import { PromptBox } from './PromptBox.js';
import { VideoEmbed } from './VideoEmbed.js';
import { YourCall } from './YourCall.js';
import styles from './DocsPage.module.css';

/** What a guide's Markdown renders as: images beside the guides, and the two callouts as their own components */
const GUIDE_MARKDOWN: MarkdownDoc = {
  baseUrl: DOCS_BASE,
  code: (text, lang) => <CodeBlock text={text} lang={lang} />,
  callout: (kind, text) => (kind === 'say' ? <PromptBox text={text} /> : <YourCall text={text} />),
  gallery: (title, items) => <Gallery title={title} items={items} />,
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
  onNavigate: (slug: string | undefined, hash?: string) => void;
  demoHref: string;
  /** Where the bridge page this viewer came from lives; offers the way back */
  bridgeUrl?: string;
}) {
  const [navOpen, setNavOpen] = useState(false);
  useCommand({ id: 'go-bridge', label: 'Back to the bridge', group: 'Go to', contextual: true, description: 'status window reaper return', onSelect: () => { if (bridgeUrl) window.location.href = bridgeUrl; } }, Boolean(bridgeUrl));
  useCommand({ id: 'go-all-guides', label: 'All docs', group: 'Go to', contextual: true, description: 'docs home start', onSelect: () => onNavigate(undefined) }, slug !== undefined);
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
    document.title = title ? `${title} · reaper-mcp docs` : 'reaper-mcp docs';
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
  // A link with an anchor (a guide's own `install.md#somethings-off`, or a shared URL) scrolls to its heading once the text is there
  const ready = guide.status === 'ready';
  useEffect(() => {
    if (!ready || !window.location.hash) return;
    // A hand-edited link like `#%E0%A4` can't be decoded; it just doesn't scroll
    const id = safeDecode(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView();
  }, [ready, slug]);
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
    const m = /^\/docs(?:\/([a-z0-9-]+))?\/?(#[\w-]+)?$/.exec(href);
    if (!m) return;
    e.preventDefault();
    setNavOpen(false);
    onNavigate(m[1], m[2]);
  };

  return (
    <div className={styles.page} onClick={intercept}>
      <GuideCommands guides={index.status === 'ready' ? index.guides : undefined} onOpen={onNavigate} fallback={() => onNavigate(undefined)} contextual />
      <a className={styles.skip} href="#guide-main">Skip to the page</a>
      <header className={styles.head} data-testid="site-header">
        <a className={styles.brand} href="/docs">
          <Logo size={26} /> <span className={styles.brandSub}>docs</span>
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
          {navOpen ? 'Hide docs' : current ? `Docs: ${current.title}` : 'All docs'}
        </button>
        <nav className={styles.nav} data-testid="docs-nav" data-open={navOpen} aria-label="Docs" ref={navRef}>
          <span className={styles.rail} aria-hidden="true" />
          {index.status === 'loading' && <p className={styles.hint}>Loading…</p>}
          {index.status === 'error' && <p className={styles.hint}>Couldn’t load the docs.</p>}
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
        <main className={styles.main} data-testid="guide" id="guide-main" ref={mainRef} tabIndex={-1}>
          {slug !== undefined && index.status === 'loading' && <p className={styles.hint}>Loading…</p>}
          {index.status === 'error' && slug !== undefined && <p className={styles.hint}>Couldn’t load this page. <a href={`${REPO_URL}/tree/main/docs/guides`} target="_blank" rel="noreferrer">Read the docs on GitHub</a>.</p>}
          {slug === undefined && <Landing index={index} />}
          {unknown && <NotFound />}
          {current && <Article meta={current} guide={guide} guides={guides} />}
        </main>
      </div>
      <footer className={styles.siteFoot} data-testid="site-footer">
        <span>Stuck, or something here is wrong?</span>
        <a href={DISCORD_URL} target="_blank" rel="noreferrer">Ask on Discord</a>
        <a href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer">Report an issue</a>
        <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a>
      </footer>
    </div>
  );
}

function safeDecode(text: string): string | undefined {
  try {
    return decodeURIComponent(text);
  } catch {
    return undefined;
  }
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
      <section className={styles.hero} data-testid="hero">
        <div className={styles.heroLogo}><Logo size={56} /></div>
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
        <section aria-labelledby="sec-start" data-testid="start">
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
        <section aria-labelledby="sec-try" data-testid="try">
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
        <section aria-labelledby="sec-safe" data-testid="safe">
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
        <section aria-labelledby="sec-know" data-testid="know">
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
      <h1 className={styles.title}>That page isn’t here</h1>
      <p className={styles.lead}>It may have moved, or the link has a typo.</p>
      <p><a className={styles.primary} href="/docs">Back to all docs</a></p>
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
      <nav className={styles.crumbs} data-testid="breadcrumb" aria-label="Breadcrumb">
        <a href="/docs">Docs</a>
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
          Couldn’t load this page. You can read it on{' '}
          <a href={`${REPO_URL}/blob/main/docs/guides/${meta.slug}.md`} target="_blank" rel="noreferrer">GitHub</a>.
        </p>
      )}
      {ready && (
        <div className={styles.cols}>
          <Markdown className={styles.prose} source={ready.body} doc={GUIDE_MARKDOWN} />
          {headings.length > 1 && (
            <Toc headings={headings} />
          )}
        </div>
      )}
      <footer className={styles.pager} data-testid="pager">
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

/** "On this page": the nav's look, with the accent line following the section being read */
function Toc({ headings }: { headings: Array<{ id: string; text: string }> }) {
  const ref = useRef<HTMLElement>(null);
  const [active, setActive] = useState(headings[0]?.id);
  // The section being read: the last heading that has reached the top part of the window; at the very bottom, the last one
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      let current = headings[0]?.id;
      for (const h of headings) {
        const el = document.getElementById(h.id);
        if (el && el.getBoundingClientRect().top <= 120) current = h.id;
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = headings[headings.length - 1]?.id;
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [headings]);
  // Place the line on the active link; the first placement jumps, later ones slide
  useEffect(() => {
    const nav = ref.current;
    const a = nav?.querySelector<HTMLElement>('a[aria-current="location"]');
    if (!nav || !a) return;
    nav.style.setProperty('--rail-y', `${a.offsetTop}px`);
    nav.style.setProperty('--rail-h', `${a.offsetHeight}`);
    const first = !nav.dataset.rail;
    nav.dataset.rail = 'set';
    if (!first) nav.dataset.rail = 'on';
  }, [active]);
  return (
    <nav className={styles.toc} data-testid="toc" aria-label="On this page" ref={ref}>
      <span className={styles.rail} aria-hidden="true" />
      <h2 className={styles.navTitle}>On this page</h2>
      <ul className={styles.navList}>
        {headings.map((h) => (
          <li key={h.id}>
            <a href={`#${h.id}`} aria-current={h.id === active ? 'location' : undefined}>
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
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
