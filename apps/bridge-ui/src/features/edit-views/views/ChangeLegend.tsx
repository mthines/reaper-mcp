import type { SlotChange } from '../edit-views.js';
import { CHANGE_WORD } from './format.js';
import { cx } from '../../../lib/cx.js';
import mixerStyles from './Mixer.module.css';
import chartStyles from '../../../styles/chart.module.css';

export const ChangeMark = ({ c }: { c?: SlotChange }) =>
  c ? <span className={mixerStyles.evMark} data-change={c}>{CHANGE_WORD[c]}</span> : null;

/** When the drawer is too narrow for a word on each row, rows keep their coloured edge and this names the colours */
export const ChangeLegend = ({ change, removed }: { change: Map<number, SlotChange>; removed: number }) => {
  const kinds = (["new", "moved", "changed"] as SlotChange[]).filter((k) => [...change.values()].includes(k));
  if (!kinds.length && !removed) return null;
  return (
    <div className={cx(chartStyles.measureLegend, mixerStyles.evMarkLegend)}>
      {kinds.map((k) => (
        <span key={k}>
          <i className={chartStyles.lgEdge} data-change={k} /> {CHANGE_WORD[k]}
        </span>
      ))}
      {removed > 0 && <span className={chartStyles.lgStruck}>removed</span>}
    </div>
  );
};

export const Legend = ({ items }: { items: Array<[string, string]> }) => (
  <div className={chartStyles.measureLegend}>
    {items.map(([cls, label]) => (
      <span key={label}>
        <i className={cls} /> {label}
      </span>
    ))}
  </div>
);

// ── Parameter and mix changes ────────────────────────────────────────────────
