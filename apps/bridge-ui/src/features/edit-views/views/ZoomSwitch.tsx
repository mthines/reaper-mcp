import { Icon } from '../../../components/index.js';
import type { Zoom } from '../../../lib/zoom.js';
import styles from './ZoomSwitch.module.css';

/** Around the change or the whole project: a two-way switch, each side saying on hover what it shows */
export function ZoomSwitch({ zoom, onChange, span, total }: { zoom: Zoom; onChange: (z: Zoom) => void; span: string; total: string }) {
  return (
    <div className={styles.switch} role="group" aria-label="Zoom">
      <button aria-pressed={zoom === 'change'} onClick={() => onChange('change')} title={`Zoom in around the change (${span}), so it's easy to see`}>
        <Icon.Focus /> Change
      </button>
      <button aria-pressed={zoom === 'whole'} onClick={() => onChange('whole')} title={`Show the whole project (${total}), to see where the change sits`}>
        <Icon.Whole /> Whole
      </button>
    </div>
  );
}
