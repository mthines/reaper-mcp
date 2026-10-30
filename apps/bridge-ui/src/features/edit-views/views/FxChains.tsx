import { listDiff, type EditView, type FxChain, type FxSlot } from '../edit-views.js';
import { ChangeMark } from './ChangeLegend.js';
import { changedText } from './format.js';
import { Readout } from '../../measurements/Readout.js';

/** "VST3: Pro-Q 3 (FabFilter)" → "Pro-Q 3"; the full name stays in the tooltip */
const fxShort = (name: string) =>
  name.replace(/^[A-Z0-9]+i?:\s*/, "").replace(/\s*\([^()]*\)$/, "") || name;
const sameSlot = (a: FxSlot, b: FxSlot) =>
  a[0] === b[0] && a[1] === b[1] && a[3] === b[3];

export function FxChains({ v }: { v: Extract<EditView, { kind: "fxChain" }> }) {
  const diffs = v.chains.map((c) =>
    listDiff(c.fx, c.was, (f, i) => f[2] || `${i}:${f[0]}`, sameSlot),
  );
  const added = diffs.reduce(
    (n, d) => n + [...d.change.values()].filter((c) => c === "new").length,
    0,
  );
  const removed = diffs.reduce((n, d) => n + d.removed.length, 0);
  const touched = diffs.reduce((n, d) => n + d.change.size, 0) + removed;
  const write = v.chains.some((c) => c.was);
  const all = v.chains.flatMap((c) => c.fx);
  return (
    <>
      <div className="measure-readouts">
        <Readout
          label={v.chains.length > 1 ? "Tracks" : "Track"}
          value={v.chains.map((c) => c.t).join(" → ")}
        />
        <Readout label="FX" value={String(all.length)} />
        {write ? (
          <Readout label="Changed" value={changedText(added, removed, touched)} />
        ) : (
          <Readout
            label="Bypassed"
            value={String(all.filter((f) => f[1].includes("B")).length)}
          />
        )}
      </div>
      {v.chains.map((c, ci) => (
        <FxChainList key={ci} chain={c} diff={diffs[ci]} named={v.chains.length > 1} />
      ))}
      {write && touched === 0 && (
        <div className="ev-more">Nothing in the chain changed</div>
      )}
    </>
  );
}

function FxChainList({
  chain,
  diff,
  named,
}: {
  chain: FxChain;
  diff: ReturnType<typeof listDiff<FxSlot>>;
  named: boolean;
}) {
  return (
    <div className="ev-chain">
      {named && <div className="ev-lane-name">{chain.t}</div>}
      {chain.fx.length === 0 && diff.removed.length === 0 && (
        <div className="ev-more">No FX on this track</div>
      )}
      <ol className="ev-slots">
        {chain.fx.map((f, i) => {
          const c = diff.change.get(i);
          const was = chain.was?.find((w) => w[2] && w[2] === f[2]);
          return (
            <li
              key={`${f[2]}${i}`}
              className={`ev-slot ${f[1].includes("B") ? "ev-slot-bypassed" : ""} ${f[1].includes("O") ? "ev-slot-offline" : ""} ${c ? `ev-slot-${c}` : ""}`}
              title={[f[0], f[3] && `preset ${f[3]}`, was && was[0] !== f[0] && `was ${was[0]}`].filter(Boolean).join(" · ")}
            >
              <span className="ev-op-n mono">{i + 1}</span>
              <span className="ev-slot-name">
                {fxShort(f[0])}
                {f[3] && <small>{f[3]}</small>}
              </span>
              <span className="ev-slot-state">
                {f[1].includes("O") ? "offline" : f[1].includes("B") ? "bypassed" : ""}
                <ChangeMark c={c} />
              </span>
            </li>
          );
        })}
        {diff.removed.map(([i, f]) => (
          <li key={`gone${f[2]}${i}`} className="ev-slot ev-slot-gone" title={`Removed: ${f[0]}`}>
            <span className="ev-op-n mono">{i + 1}</span>
            <span className="ev-slot-name">{fxShort(f[0])}</span>
            <span className="ev-slot-state">
              <span className="ev-mark ev-mark-gone">removed</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── Routing ──────────────────────────────────────────────────────────────────
