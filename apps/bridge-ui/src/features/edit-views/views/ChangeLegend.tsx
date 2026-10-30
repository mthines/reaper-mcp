import type { SlotChange } from '../edit-views.js';
import { CHANGE_WORD } from './format.js';

export const ChangeMark = ({ c }: { c?: SlotChange }) =>
  c ? <span className={`ev-mark ev-mark-${c}`}>{CHANGE_WORD[c]}</span> : null;

/** When the drawer is too narrow for a word on each row, rows keep their coloured edge and this names the colours */
export const ChangeLegend = ({ change, removed }: { change: Map<number, SlotChange>; removed: number }) => {
  const kinds = (["new", "moved", "changed"] as SlotChange[]).filter((k) => [...change.values()].includes(k));
  if (!kinds.length && !removed) return null;
  return (
    <div className="measure-legend ev-mark-legend">
      {kinds.map((k) => (
        <span key={k}>
          <i className={`lg-edge lg-edge-${k}`} /> {CHANGE_WORD[k]}
        </span>
      ))}
      {removed > 0 && <span className="lg-struck">removed</span>}
    </div>
  );
};

export const Legend = ({ items }: { items: Array<[string, string]> }) => (
  <div className="measure-legend">
    {items.map(([cls, label]) => (
      <span key={label}>
        <i className={cls} /> {label}
      </span>
    ))}
  </div>
);

// ── Parameter and mix changes ────────────────────────────────────────────────
