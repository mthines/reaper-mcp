import { useState } from 'react';
import { embedUrl } from './docs.js';
import styles from './VideoEmbed.module.css';

/**
 * A guide's video. It starts as our own poster with a play button; only a click loads the YouTube player
 * (youtube-nocookie.com), so opening a guide never sends a request to Google. Without a video id yet it says so.
 */
export function VideoEmbed({ youtube, poster, title, duration }: { youtube?: string; poster?: string; title: string; duration?: string }) {
  const [playing, setPlaying] = useState(false);
  if (!youtube) {
    return (
      <div className={styles.soonStrip}>
        {poster && <img className={styles.soonThumb} src={poster} alt="" loading="lazy" />}
        <p className={styles.soon}>
          <strong>Video coming soon{duration ? ` (${duration})` : ''}</strong>
          The steps below cover everything it will show.
        </p>
      </div>
    );
  }
  return (
    <div className={styles.frame} data-state={playing ? 'playing' : 'idle'}>
      {playing ? (
        <iframe
          className={styles.player}
          src={embedUrl(youtube)}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <button className={styles.play} onClick={() => setPlaying(true)} aria-label={`Play video: ${title}`}>
          {poster && <img className={styles.poster} src={poster} alt="" loading="lazy" />}
          <span className={styles.playMark} aria-hidden="true">▶</span>
          <span className={styles.meta}>{duration ? `${duration} · ` : ''}Plays from YouTube when you press it</span>
        </button>
      )}
    </div>
  );
}
