import { useEffect, useRef, useState } from 'react';
import { cx } from '../lib/cx.js';
import styles from './Mark.module.css';

// How far (in the 512 logo grid) the eye may look toward the cursor while watching.
const EYE_REACH_X = 24;
const EYE_REACH_Y = 18;
// Pointer updates while watching: at most one per this many ms (leading + trailing).
const EYE_THROTTLE_MS = 60;

// The reaper-mcp logo (docs/assets/logo-mark.svg); the dot is an eye that blinks while the bridge is live.
// Easter egg: clicking blinks and toggles "watching", where the eye follows the cursor across the window.
export function Mark({ active }: { active: boolean }) {
  const [watching, setWatching] = useState(false);
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [blinks, setBlinks] = useState(0);
  const [blinking, setBlinking] = useState(false);
  const blinkTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(blinkTimer.current), []);

  useEffect(() => {
    if (!watching) return;
    let last = 0;
    let timer = 0;
    let pending: PointerEvent | null = null;
    const apply = (e: PointerEvent) => {
      last = performance.now();
      setLook({ x: (e.clientX / window.innerWidth - 0.5) * 2, y: (e.clientY / window.innerHeight - 0.5) * 2 });
    };
    const onMove = (e: PointerEvent) => {
      const wait = EYE_THROTTLE_MS - (performance.now() - last);
      if (wait <= 0) {
        apply(e);
        return;
      }
      pending = e; // trailing call lands on the latest position
      if (!timer) {
        timer = window.setTimeout(() => {
          timer = 0;
          if (pending) apply(pending);
        }, wait);
      }
    };
    window.addEventListener('pointermove', onMove);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', onMove);
    };
  }, [watching]);

  const onClick = () => {
    setWatching((w) => !w);
    setLook({ x: 0, y: 0 }); // each watch starts from the middle
    setBlinks((n) => n + 1); // remounts the lid so back-to-back clicks each blink
    setBlinking(true);
    window.clearTimeout(blinkTimer.current);
    blinkTimer.current = window.setTimeout(() => setBlinking(false), 260);
  };

  // The eye rests in the middle unless it is following the cursor
  const eye = watching ? look : { x: 0, y: 0 };
  return (
    <button className={styles.markBtn} onClick={onClick} aria-label="reaper-mcp" aria-pressed={watching}>
      <svg className={cx(styles.mark, active ? styles.markActive : '', blinking ? styles.markBlink : '')} viewBox="0 0 512 512" aria-hidden>
        <defs>
          <linearGradient id="mark-bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#1b1532" />
            <stop offset="0.6" stopColor="#0e0b18" />
            <stop offset="1" stopColor="#220d22" />
          </linearGradient>
          <radialGradient id="mark-glow" cx="0.5" cy="0.66" r="0.42">
            <stop offset="0" stopColor="#ff6a4d" stopOpacity="0.16" />
            <stop offset="1" stopColor="#ff6a4d" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="mark-dot" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffa24c" />
            <stop offset="1" stopColor="#ff4f5e" />
          </linearGradient>
          <clipPath id="mark-eye">
            <circle cx="256" cy="318" r="58" />
          </clipPath>
        </defs>
        <rect width="512" height="512" rx="116" fill="url(#mark-bg)" />
        <rect className={styles.markGlow} width="512" height="512" rx="116" fill="url(#mark-glow)" />
        <rect x="4" y="4" width="504" height="504" rx="112" fill="none" stroke="#fff" strokeOpacity="0.08" strokeWidth="8" />
        <path className={styles.markArc} d="M100 330 A156 156 0 0 1 412 330" fill="none" strokeWidth="56" strokeLinecap="round" />
        <g className={styles.markEye} style={{ transform: `translate(${eye.x * EYE_REACH_X}px, ${eye.y * EYE_REACH_Y}px)` }}>
          <circle className={styles.markDot} cx="256" cy="318" r="58" />
          {/* Eyelid: parked just above the dot, drops over it on a blink */}
          <g clipPath="url(#mark-eye)">
            {/* Outer group: where the lid rests (half-closed on hover); inner ellipse: the blinks */}
            <g className={styles.markLidRest}>
              <ellipse key={blinks} className={styles.markLid} cx="256" cy="180" rx="74" ry="80" fill="#130f1f" />
            </g>
          </g>
        </g>
      </svg>
    </button>
  );
}
