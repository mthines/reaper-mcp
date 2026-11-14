import { useId } from 'react';
import styles from './Logo.module.css';

/** The app icon (the fermata: an arc and the dot it holds), drawn inline so it needs no file and works in both themes */
export function LogoMark({ size = 28 }: { size?: number }) {
  const id = useId();
  return (
    <svg className={styles.mark} viewBox="0 0 512 512" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1b1532" />
          <stop offset="0.6" stopColor="#0e0b18" />
          <stop offset="1" stopColor="#220d22" />
        </linearGradient>
        <radialGradient id={`${id}glow`} cx="0.5" cy="0.66" r="0.42">
          <stop offset="0" stopColor="#ff6a4d" stopOpacity="0.16" />
          <stop offset="1" stopColor="#ff6a4d" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}arc`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#d9d3e6" />
        </linearGradient>
        <linearGradient id={`${id}dot`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffa24c" />
          <stop offset="1" stopColor="#ff4f5e" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill={`url(#${id}bg)`} />
      <rect width="512" height="512" rx="116" fill={`url(#${id}glow)`} />
      <rect x="2" y="2" width="508" height="508" rx="114" fill="none" stroke="#ffffff" strokeOpacity="0.1" strokeWidth="4" />
      <path d="M100 330 A156 156 0 0 1 412 330" fill="none" stroke={`url(#${id}arc)`} strokeWidth="56" strokeLinecap="round" />
      <circle cx="256" cy="318" r="58" fill={`url(#${id}dot)`} />
    </svg>
  );
}

/** The icon and the name, "reaper" in the text colour and "-mcp" in the logo's orange */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className={styles.logo} style={{ fontSize: size * 0.8 }}>
      <LogoMark size={size} />
      <span className={styles.word}>
        reaper<span className={styles.accent}>-mcp</span>
      </span>
    </span>
  );
}
