import { useRef, useState } from 'react';
import { Icon, type GalleryItem } from '../../components/index.js';
import styles from './Gallery.module.css';

/** A guide's `::: gallery` block: a row of cards that scrolls sideways, with Previous / Next buttons for a mouse. */
export function Gallery({ title, items }: { title: string; items: GalleryItem[] }) {
  const track = useRef<HTMLUListElement>(null);
  const [edge, setEdge] = useState<{ start: boolean; end: boolean }>({ start: true, end: items.length <= 1 });

  const measure = () => {
    const el = track.current;
    if (!el) return;
    const start = el.scrollLeft <= 2;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
    if (start !== edge.start || end !== edge.end) setEdge({ start, end });
  };
  const step = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    const card = el.querySelector('li');
    const width = card ? card.getBoundingClientRect().width + 14 : el.clientWidth * 0.8;
    el.scrollBy({ left: dir * width });
  };

  return (
    <section className={styles.gallery} aria-roledescription="carousel" aria-label={title} data-testid="gallery">
      <div className={styles.head}>
        <h3 className={styles.title}>{title}</h3>
        <span className={styles.count}>{items.length}</span>
        <div className={styles.buttons}>
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
              <img className={styles.picture} src={item.image.src} alt={item.image.alt} loading="lazy" onLoad={measure} />
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
    </section>
  );
}
