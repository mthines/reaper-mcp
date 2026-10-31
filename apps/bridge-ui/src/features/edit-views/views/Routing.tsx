import { listDiff, routeIds, type EditView, type Route, type SlotChange } from '../edit-views.js';
import { ChangeLegend, ChangeMark, Legend } from './ChangeLegend.js';
import { ChipLegend } from './Mixer.js';
import { CHANGE_WORD, panText, pct } from './format.js';
import { Measurement, fmt } from '../../measurements/index.js';
import { cx } from '../../../lib/cx.js';
import chartStyles from '../../../styles/chart.module.css';
import mixerStyles from './Mixer.module.css';

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
  // A changed route whose level moved draws its old level as a hollow mark
  const levelMoved = v.routes.some((r, i) => diff.change.get(i) === "changed" && v.was?.[wasIds.indexOf(ids[i])]?.[2] !== r[2]);
  const count = (k: Route[0]) => v.routes.filter((r) => r[0] === k).length;
  return (
    <>
      <div className={chartStyles.measureReadouts}>
        <Measurement.Readout label="Track" value={v.t} />
        <Measurement.Readout label="Sends" value={String(count("s") + count("h"))} />
        <Measurement.Readout label="Receives" value={String(count("r"))} />
      </div>
      {v.routes.length === 0 && diff.removed.length === 0 ? (
        <div className={chartStyles.evMore}>No sends, receives or hardware outputs</div>
      ) : (
        <div className={mixerStyles.evMix}>
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
      {v.routes.length + diff.removed.length > 0 && (
        <div className={chartStyles.measureLegend}>
          {(["s", "r", "h"] as const).filter((k) => [...v.routes, ...diff.removed.map(([, r]) => r[1])].some((r) => r[0] === k)).map((k) => (
            <span key={k}><b className="mono">{ROUTE_KIND[k][0]}</b> {ROUTE_KIND[k][1].replace(/ (to|from)$/, "")}</span>
          ))}
        </div>
      )}
      <ChipLegend flags={v.routes.map((r) => r[4])} />
      {v.was && <ChangeLegend change={diff.change} removed={diff.removed.length} />}
      {levelMoved && (
        <Legend
          items={[
            [chartStyles.lgWas, "Before"],
            [chartStyles.lgRange, "Now"],
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
      className={cx(mixerStyles.evTrk, mixerStyles.evRoute, flags.includes("M") && mixerStyles.evTrkMuted)}
      data-change={gone ? "gone" : c}
      title={`${word} ${other} · ${fmt(db)} dB · pan ${panText(pan)}${flags.includes("M") ? " · muted" : ""}${was ? ` · was ${fmt(was[2])} dB, pan ${panText(was[3])}` : ""}${gone ? " · removed" : c ? ` · ${CHANGE_WORD[c]}` : ""}`}
    >
      <span className={mixerStyles.evRouteKind} aria-label={word}>
        {glyph}
      </span>
      <span className={mixerStyles.evTn}>
        <span className={mixerStyles.evTnText}>{other}</span>
        {gone ? <span className={mixerStyles.evMark} data-change="gone">removed</span> : <ChangeMark c={c} />}
      </span>
      <span className={cx(chartStyles.evBar, mixerStyles.evFader)} role="img" aria-label={`${fmt(db)} dB`}>
        <span className={chartStyles.evZero} style={{ left: `${pct(0, -60, 6)}%` }} />
        <span
          className={cx(chartStyles.evFill, hot ? mixerStyles.evFillHot : '')}
          style={{ left: 0, width: `${pct(db, -60, 6)}%` }}
        />
        {was && was[2] !== db && (
          <span className={chartStyles.evWas} style={{ left: `${pct(was[2], -60, 6)}%` }} />
        )}
      </span>
      <span className={cx(mixerStyles.evTv, "mono")} data-zone={hot ? "hot" : "ok"}>{fmt(db)}</span>
      <span className={mixerStyles.evPan} role="img" aria-label={`pan ${panText(pan)}`}>
        <span className={mixerStyles.evPanC} />
        <span className={mixerStyles.evPanD} style={{ left: `${pct(pan, -1, 1)}%` }} />
      </span>
      <span className={mixerStyles.evChips}>
        <span className={mixerStyles.evChip} data-chip={flags.includes("M") ? "m" : undefined}>M</span>
      </span>
    </div>
  );
}
