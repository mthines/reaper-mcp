import type { ChangeRow } from '../edit-views.js';
import { Legend } from './ChangeLegend.js';
import { PROP_LABEL, barPos, pct, plural, valueText } from './format.js';

export function Changes({ rows, more = 0 }: { rows: ChangeRow[]; more?: number }) {
  return (
    <>
      <div className="ev-rows">
        {rows.map((r, i) => {
          const same = r.a !== undefined && r.a === r.b;
          const hot = r.s === "db" && (r.b ?? -150) > 0;
          const before = valueText(r, r.a, r.at);
          const after = valueText(r, r.b, r.bt);
          const label = PROP_LABEL[r.p] ?? r.p;
          return (
            <div
              key={i}
              className={`ev-row ${same ? "ev-same" : ""} ${hot ? "ev-hot" : ""}`}
            >
              <span className="ev-name" title={`${r.t} · ${label}`}>
                {r.t}
                <small>{label}</small>
              </span>
              <span className="ev-val mono">
                {same ? (
                  <>{after} · no change</>
                ) : r.a === undefined ? (
                  <b>{after}</b>
                ) : (
                  <>
                    {before} → <b>{after}</b>
                  </>
                )}
                {hot && <span className="ev-word"> · above 0</span>}
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
        <div className="ev-more">+{plural(more, "more parameter")} not drawn</div>
      )}
      {rows.some((r) => r.a !== undefined && r.a !== r.b) && (
        <Legend
          items={[
            ["lg-was", "Before"],
            ["lg-tick", "After"],
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
    <span className="ev-bar" role="img" aria-label={label}>
      {r.s === "db" && (
        <span className="ev-zero" style={{ left: `${pct(0, -60, 6)}%` }} />
      )}
      {r.s === "pan" && <span className="ev-zero" style={{ left: "50%" }} />}
      <span
        className="ev-fill ev-fill-rest"
        style={{
          left: `${Math.min(origin, b)}%`,
          width: `${Math.abs(b - origin)}%`,
        }}
      />
      {a !== null && a !== b && (
        <span
          className={`ev-fill ${b < a ? "ev-fill-down" : ""}`}
          style={{ left: `${Math.min(a, b)}%`, width: `${Math.abs(b - a)}%` }}
        />
      )}
      {a !== null && a !== b && (
        <span className="ev-was" style={{ left: `${a}%` }} />
      )}
      <span className="ev-tick" style={{ left: `${b}%` }} />
    </span>
  );
}

// ── Automation ───────────────────────────────────────────────────────────────
