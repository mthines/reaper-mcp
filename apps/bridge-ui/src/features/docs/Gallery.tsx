import { useEffect, useEffectEvent, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Icon, type GalleryItem } from '../../components/index.js';
import { cx } from '../../lib/cx.js';
import { headingId } from '../../lib/heading-id.js';
import { isString, useUrlState } from '../../lib/url-state.js';
import styles from './Gallery.module.css';

/** How long the overlay's exit runs, in ms (matches the transitions in Gallery.module.css) */
const CLOSE_MS = 280;

/**
 * A guide's `::: gallery` block: a row of cards that scrolls sideways, with Previous / Next buttons for a mouse and a
 * full screen view (the page blurred behind it, one big card at a time) from the button or a click on a picture.
 */
export function Gallery({ title, items }: { title: string; items: GalleryItem[] }) {
  const track = useRef<HTMLUListElement>(null);
  // The full screen view lives in the address (`?gallery=<title>&card=<name>`), so a link reopens it on the same card
  const id = headingId(title);
  const [shown, setShown] = useUrlState('gallery', '', { validate: isString });
  const [card, setCard] = useUrlState('card', '', { validate: isString });
  const [closing, setClosing] = useState(false);
  const open = shown === id && items.length > 0;
  const openAt = (i: number) => {
    setClosing(false);
    setShown(id);
    setCard(headingId(items[i].name));
  };
  const [edge, setEdge] = useState<{ start: boolean; end: boolean }>({ start: true, end: items.length <= 1 });

  const measure = () => {
    const el = track.current;
    if (!el) return;
    const start = el.scrollLeft <= 2;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
    setEdge((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  };
  useEffect(() => {
    const el = track.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(el);
    return () => observer.disconnect();
  });
  const step = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    const card = el.querySelector('li');
    const width = card ? card.getBoundingClientRect().width + 14 : el.clientWidth * 0.8;
    el.scrollBy({ left: dir * width });
  };

  /** The card the row is showing now: the first one whose left edge is not scrolled out of view */
  const firstVisible = () => {
    const el = track.current;
    if (!el) return 0;
    const left = el.getBoundingClientRect().left;
    const cards = [...el.querySelectorAll('li')];
    const i = cards.findIndex((c) => c.getBoundingClientRect().right > left + 24);
    return Math.max(0, i);
  };

  return (
    <section className={styles.gallery} aria-roledescription="carousel" aria-label={title} data-testid="gallery">
      <div className={styles.head}>
        <h3 className={styles.title}>{title}</h3>
        <span className={styles.count}>{items.length}</span>
        <div className={styles.buttons}>
          <button type="button" className={styles.button} onClick={() => openAt(firstVisible())} aria-label="Full screen" aria-haspopup="dialog">
            <Icon.Expand />
          </button>
          <button type="button" className={styles.button} onClick={() => step(-1)} disabled={edge.start} aria-label="Previous">
            <Icon.Chevron className={styles.back} />
          </button>
          <button type="button" className={styles.button} onClick={() => step(1)} disabled={edge.end} aria-label="Next">
            <Icon.Chevron />
          </button>
        </div>
      </div>
      <ul className={styles.track} ref={track} onScroll={measure} tabIndex={0} aria-label={`${title}, scroll sideways`}>
        {items.map((item, i) => (
          <li key={item.name} className={styles.card} aria-roledescription="slide" aria-label={`${i + 1} of ${items.length}: ${item.name}`}>
            {item.image ? (
              <button type="button" className={styles.zoom} onClick={() => openAt(i)} aria-label={`${item.name}, full screen`} aria-haspopup="dialog">
                <img className={styles.picture} src={item.image.src} alt={item.image.alt} loading="lazy" onLoad={measure} />
              </button>
            ) : (
              <div className={styles.placeholder} aria-hidden="true">
                {item.name}
              </div>
            )}
            <h4 className={styles.name}>{item.name}</h4>
            <p className={styles.text}>{item.text}</p>
          </li>
        ))}
      </ul>
      {open && (
        <Overlay
          title={title}
          items={items}
          start={Math.max(0, items.findIndex((item) => headingId(item.name) === card))}
          closing={closing}
          onClose={() => setClosing(true)}
          onClosed={() => {
            // One history entry for both, so Back reopens it
            setShown('');
            setCard('');
            setClosing(false);
          }}
          onCard={(i) => setCard(headingId(items[i].name), 'replace')}
        />
      )}
    </section>
  );
}

/** The full screen view: a modal dialog (focus kept inside, Esc closes), the page blurred behind it, one big card centred */
function Overlay({ title, items, start, closing, onClose, onClosed, onCard }: { title: string; items: GalleryItem[]; start: number; closing: boolean; onClose: () => void; onClosed: () => void; onCard: (index: number) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const track = useRef<HTMLUListElement>(null);
  // Where it opened; the address follows the card you move to, and must not move the view back
  const [first] = useState(start);
  const [active, setActive] = useState(first);

  // Open as a modal, keep the page from scrolling behind it, and land on the card that was asked for
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    d.showModal();
    const was = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    track.current?.children[first]?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'instant' });
    return () => {
      document.body.style.overflow = was;
      if (d.open) d.close();
    };
  }, [first]);

  // The exit plays for CLOSE_MS (not at all with reduced motion), then the overlay is removed
  // Close the dialog before React removes it, so the browser hands focus back to the button that opened it
  const finish = useEffectEvent(() => {
    dialog.current?.close();
    onClosed();
  });
  useEffect(() => {
    if (!closing) return;
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = setTimeout(finish, still ? 0 : CLOSE_MS);
    return () => clearTimeout(timer);
  }, [closing]);

  const go = (i: number) => {
    const next = Math.min(items.length - 1, Math.max(0, i));
    track.current?.children[next]?.scrollIntoView({ inline: 'center', block: 'nearest' }); // the row's CSS decides smooth or not (reduced motion: not)
  };
  // The slide whose centre is nearest the middle of the row is the one you are on
  const measure = () => {
    const el = track.current;
    if (!el) return;
    const mid = el.getBoundingClientRect().left + el.clientWidth / 2;
    let best = 0;
    let gap = Infinity;
    [...el.children].forEach((c, i) => {
      const r = c.getBoundingClientRect();
      const d = Math.abs(r.left + r.width / 2 - mid);
      if (d < gap) {
        gap = d;
        best = i;
      }
    });
    if (best !== active) {
      setActive(best);
      onCard(best);
    }
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowRight') go(active + 1);
    else if (e.key === 'ArrowLeft') go(active - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else return;
    e.preventDefault();
  };

  return (
    <dialog
      ref={dialog}
      className={styles.overlay}
      data-state={closing ? 'closing' : 'open'}
      data-testid="gallery-overlay"
      aria-label={`${title}, full screen`}
      onKeyDown={onKeyDown}
      // Esc is taken in onKeyDown; this catches the other ways a browser cancels a dialog (Android's back gesture)
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // A click on the dim area (not on a card or a control) closes it
      onClick={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.dismiss !== undefined) onClose();
      }}
    >
      <header className={styles.bar}>
        <h3 className={styles.barTitle}>{title}</h3>
        <span className={styles.position} aria-live="polite">
          {active + 1} / {items.length}
        </span>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close full screen" autoFocus>
          <Icon.Close />
        </button>
      </header>
      <div className={styles.stage} data-dismiss>
        <button type="button" className={cx(styles.arrow, styles.arrowBack)} onClick={() => go(active - 1)} disabled={active === 0} aria-label="Previous">
          <Icon.Chevron className={styles.back} />
        </button>
        <ul className={styles.big} ref={track} onScroll={measure} aria-roledescription="carousel" aria-label={title} data-dismiss>
          {items.map((item, i) => (
            <li key={item.name} className={styles.slide} style={{ '--i': Math.min(i, 5) } as CSSProperties} aria-roledescription="slide" aria-label={`${i + 1} of ${items.length}: ${item.name}`} aria-current={i === active}>
              <div className={styles.panel}>
                <div className={styles.shot}>
                  {item.image ? <img src={item.image.src} alt={item.image.alt} /> : <span aria-hidden="true">{item.name}</span>}
                </div>
                <div className={styles.copy}>
                  <p className={styles.kicker}>{String(i + 1).padStart(2, '0')}</p>
                  <h4 className={styles.bigName}>{item.name}</h4>
                  <p className={styles.bigText}>{item.text}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <button type="button" className={cx(styles.arrow, styles.arrowNext)} onClick={() => go(active + 1)} disabled={active === items.length - 1} aria-label="Next">
          <Icon.Chevron />
        </button>
      </div>
      <div className={styles.dots} role="group" aria-label="Choose a card">
        {items.map((item, i) => (
          <button key={item.name} type="button" className={styles.dot} data-active={i === active || undefined} onClick={() => go(i)} aria-label={`${i + 1}: ${item.name}`} aria-current={i === active} />
        ))}
      </div>
    </dialog>
  );
}
