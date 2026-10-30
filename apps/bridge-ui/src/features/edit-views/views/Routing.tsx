import { listDiff, routeIds, type EditView, type Route, type SlotChange } from '../edit-views.js';
import { ChangeLegend, ChangeMark, Legend } from './ChangeLegend.js';
import { CHANGE_WORD, panText, pct } from './format.js';
import { Readout } from '../../measurements/Readout.js';
import { fmt } from '../../measurements/format.js';

const ROUTE_KIND: Record<Route[0], [string, string]> = {
  s: ["→", "Send to"],
  r: ["←", "Receive from"],
  h: ["⇥", "Hardware output"],
};
const sameRoute = (a: Route, b: Route) =>
  a[2] === b[2] && a[3] === b[3] && a[4] === b[4];

export function Routing({ v }: { v: Extract<EditView, { kind: "routing" }> }) {
  const ids = routeIds(v.routes);
  const wasIds = v.was ? routeIds(v.was) : [];
  const diff = listDiff(
    v.routes.map((r, i): [string, Route] => [ids[i], r]),
    v.was?.map((r, i): [string, Route] => [wasIds[i], r]),
    (r) => r[0],
    (a, b) => sameRoute(a[1], b[1]),
  );
  const count = (k: Route[0]) => v.routes.filter((r) => r[0] === k).length;
  return (
    <>
      <div className="measure-readouts">
        <Readout label="Track" value={v.t} />
        <Readout label="Sends" value={String(count("s") + count("h"))} />
        <Readout label="Receives" value={String(count("r"))} />
      </div>
      {v.routes.length === 0 && diff.removed.length === 0 ? (
        <div className="ev-more">No sends, receives or hardware outputs</div>
      ) : (
        <div className="ev-mix">
          {v.routes.map((r, i) => {
            const c = diff.change.get(i);
            const before = c === "changed" ? v.was?.[wasIds.indexOf(ids[i])] : undefined;
            return <RouteRow key={ids[i]} r={r} c={c} was={before} />;
          })}
          {diff.removed.map(([i, r]) => (
            <RouteRow key={`gone${wasIds[i]}`} r={r[1]} gone />
          ))}
        </div>
      )}
      {v.was && <ChangeLegend change={diff.change} removed={diff.removed.length} />}
      {v.was && diff.change.size + diff.removed.length > 0 && (
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

function RouteRow({ r, c, was, gone }: { r: Route; c?: SlotChange; was?: Route; gone?: boolean }) {
  const [kind, other, db, pan, flags] = r;
  const [glyph, word] = ROUTE_KIND[kind];
  const hot = db > 0;
  return (
    <div
      className={`ev-trk ev-route ${flags.includes("M") ? "ev-trk-muted" : ""} ${gone ? "ev-slot-gone" : ""} ${c ? `ev-slot-${c}` : ""}`}
      title={`${word} ${other} · ${fmt(db)} dB · pan ${panText(pan)}${flags.includes("M") ? " · muted" : ""}${was ? ` · was ${fmt(was[2])} dB, pan ${panText(was[3])}` : ""}${gone ? " · removed" : c ? ` · ${CHANGE_WORD[c]}` : ""}`}
    >
      <span className="ev-route-kind" aria-label={word}>
        {glyph}
      </span>
      <span className="ev-tn">
        <span className="ev-tn-text">{other}</span>
        {gone ? <span className="ev-mark ev-mark-gone">removed</span> : <ChangeMark c={c} />}
      </span>
      <span className="ev-bar ev-fader" role="img" aria-label={`${fmt(db)} dB`}>
        <span className="ev-zero" style={{ left: `${pct(0, -60, 6)}%` }} />
        <span
          className={`ev-fill ${hot ? "ev-fill-hot" : ""}`}
          style={{ left: 0, width: `${pct(db, -60, 6)}%` }}
        />
        {was && was[2] !== db && (
          <span className="ev-was" style={{ left: `${pct(was[2], -60, 6)}%` }} />
        )}
      </span>
      <span className={`ev-tv mono zone-${hot ? "hot" : "ok"}`}>{fmt(db)}</span>
      <span className="ev-pan" role="img" aria-label={`pan ${panText(pan)}`}>
        <span className="ev-pan-c" />
        <span className="ev-pan-d" style={{ left: `${pct(pan, -1, 1)}%` }} />
      </span>
      <span className="ev-chips">
        <span className={`ev-chip ${flags.includes("M") ? "ev-chip-m" : ""}`}>M</span>
      </span>
    </div>
  );
}
