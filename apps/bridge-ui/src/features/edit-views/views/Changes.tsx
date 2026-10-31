import type { ChangeRow } from '../edit-views.js';
import { Legend } from './ChangeLegend.js';
import { PROP_LABEL, barPos, pct, plural, valueText } from './format.js';
import { cx } from '../../../lib/cx.js';
import chartStyles from '../../../styles/chart.module.css';
import styles from './Changes.module.css';

export function Changes({ rows, more = 0 }: { rows: ChangeRow[]; more?: number }) {
  // Rows whose bar draws a before mark: a number that changed
  const moved = rows.filter((r) => r.s !== "bool" && r.a !== undefined && r.b !== undefined && r.a !== r.b);
  return (
    <>
      <div className={chartStyles.evRows}>
        {rows.map((r, i) => {
          const same = r.a !== undefined && r.a === r.b;
          const hot = r.s === "db" && (r.b ?? -150) > 0;
          const before = valueText(r, r.a, r.at);
          const after = valueText(r, r.b, r.bt);
          const label = PROP_LABEL[r.p] ?? r.p;
          return (
            <div
              key={i}
              className={cx(chartStyles.evRow, same ? styles.evSame : '', hot ? chartStyles.evHot : '')}
            >
              <span className={chartStyles.evName} title={`${r.t} · ${label}`}>
                {r.t}
                <small>{label}</small>
              </span>
              <span className={cx(chartStyles.evVal, 'mono')}>
                {same ? (
                  <>{after} · no change</>
                ) : r.a === undefined ? (
                  <b>{after}</b>
                ) : (
                  <>
                    {before} → <b>{after}</b>
                  </>
                )}
                {hot && <span className={chartStyles.evWord}> · above 0</span>}
              </span>
              {r.s !== "bool" && r.b !== undefined && (
                <ChangeBar
                  r={r}
                  b={r.b}
                  label={`${r.t} ${label} from ${before} to ${after}`}
                />
              )}
            </div>
          );
        })}
      </div>
      {more > 0 && (
        <div className={chartStyles.evMore}>+{plural(more, "more parameter")} not drawn</div>
      )}
      {moved.length > 0 && (
        <Legend
          items={[
            [chartStyles.lgWas, "Before"],
            [chartStyles.lgTick, "Now"],
            ...(moved.some((r) => (r.b ?? 0) > (r.a ?? 0)) ? [[styles.lgUp, "Raised"] as [string, string]] : []),
            ...(moved.some((r) => (r.b ?? 0) < (r.a ?? 0)) ? [[styles.lgDown, "Lowered"] as [string, string]] : []),
          ]}
        />
      )}
    </>
  );
}

function ChangeBar({
  r,
  b: after,
  label,
}: {
  r: ChangeRow;
  b: number;
  label: string;
}) {
  const b = barPos(r, after);
  const a = r.a === undefined ? null : barPos(r, r.a);
  const origin = r.s === "pan" ? 50 : 0;
  return (
    <span className={chartStyles.evBar} role="img" aria-label={label}>
      {r.s === "db" && (
        <span className={chartStyles.evZero} style={{ left: `${pct(0, -60, 6)}%` }} />
      )}
      {r.s === "pan" && <span className={chartStyles.evZero} style={{ left: "50%" }} />}
      <span
        className={cx(chartStyles.evFill, styles.evFillRest)}
        style={{
          left: `${Math.min(origin, b)}%`,
          width: `${Math.abs(b - origin)}%`,
        }}
      />
      {a !== null && a !== b && (
        <span
          className={cx(chartStyles.evFill, b < a ? styles.evFillDown : '')}
          style={{ left: `${Math.min(a, b)}%`, width: `${Math.abs(b - a)}%` }}
        />
      )}
      {a !== null && a !== b && (
        <span className={chartStyles.evWas} style={{ left: `${a}%` }} />
      )}
      <span className={chartStyles.evTick} style={{ left: `${b}%` }} />
    </span>
  );
}

// ── Automation ───────────────────────────────────────────────────────────────
