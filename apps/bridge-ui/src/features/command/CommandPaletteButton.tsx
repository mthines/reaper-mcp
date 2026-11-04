import { useCommandPalette } from './CommandProvider.js';
import { formatShortcut } from './shortcut.js';
import styles from './CommandPalette.module.css';

/** The ⌘K trigger for the header; nothing without a provider */
export function CommandPaletteButton() {
  const palette = useCommandPalette();
  if (!palette) return null;
  return (
    <button className={styles.trigger} onClick={() => palette.setOpen(true)} title="Command palette" aria-label="Command palette">
      <kbd className={styles.kbd}>{formatShortcut(['mod+k'])}</kbd>
    </button>
  );
}
