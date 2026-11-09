import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/index.js';
import { isVideo, type Highlight } from './highlights.js';
import styles from './HighlightCard.module.css';

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * One highlight in the house frame: the media on a 16:10 stage, then the title, a sentence and where to try it.
 * Every entry looks the same whatever its media; only the tint (the release-notes group) changes.
 */
export function HighlightCard({ highlight }: { highlight: Highlight }) {
  const [failed, setFailed] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const still = reducedMotion() && highlight.kind === 'animation';
  return (
    <figure className={styles.card} data-group={highlight.group} data-kind={highlight.kind}>
      <div className={styles.stage}>
        {!failed && (
          <button className={styles.enlarge} onClick={() => setEnlarged(true)} aria-label={`Enlarge: ${highlight.title}`} title="Enlarge" />
        )}
        {failed ? (
          <span className={styles.missing}>{highlight.alt}</span>
        ) : isVideo(highlight) ? (
          <video
            className={styles.media}
            src={highlight.media}
            poster={highlight.poster}
            aria-label={highlight.alt}
            autoPlay={!still}
            controls={still}
            muted
            loop
            playsInline
            preload={still ? 'none' : 'metadata'}
            onError={() => setFailed(true)}
          />
        ) : (
          <img
            className={styles.media}
            src={still && highlight.poster ? highlight.poster : highlight.media}
            alt={highlight.alt}
            loading="lazy"
            onError={() => setFailed(true)}
          />
        )}
      </div>
      <figcaption className={styles.caption}>
        <b className={styles.title}>{highlight.title}</b>
        <span className={styles.blurb}>{highlight.blurb}</span>
        {highlight.tryIt && (
          <span className={styles.tryIt}>
            Try it: <kbd>{highlight.tryIt}</kbd>
          </span>
        )}
      </figcaption>
      {/* On body: the drawer's slide-in transform would otherwise hold a fixed overlay inside it */}
      {enlarged && createPortal(<Enlarged highlight={highlight} still={still} onClose={() => setEnlarged(false)} />, document.body)}
    </figure>
  );
}

/** The media at full size over the page; Esc or a click outside closes it (and only it, not the drawer) */
function Enlarged({ highlight, still, onClose }: { highlight: Highlight; still: boolean; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Focus moves into the dialog, and back to what opened it when it closes
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    close.current?.focus();
    return () => opener?.focus();
  }, []);
  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={highlight.title}
      onClick={(ev) => ev.target === ev.currentTarget && onClose()}
      onKeyDown={(ev) => {
        if (ev.key !== 'Escape') return;
        ev.stopPropagation();
        onClose();
      }}
    >
      <div className={styles.overlayFrame}>
        {isVideo(highlight) ? (
          <video src={highlight.media} poster={highlight.poster} aria-label={highlight.alt} autoPlay={!still} controls muted loop playsInline />
        ) : (
          <img src={highlight.media} alt={highlight.alt} />
        )}
        <span className={styles.overlayCaption}>{highlight.title}</span>
      </div>
      <button ref={close} className={styles.overlayClose} onClick={onClose} aria-label="Close" title="Close (Esc)">
        <Icon.Close />
      </button>
    </div>
  );
}
