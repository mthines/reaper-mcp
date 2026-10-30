import type { EditView } from '../edit-views.js';
import { Measurement } from '../../measurements/index.js';

export function Plan({ v }: { v: Extract<EditView, { kind: "plan" }> }) {
  return (
    <>
      <div className="measure-readouts">
        <Measurement.Readout label="Ops" value={String(v.total)} />
        <Measurement.Readout label="Mode" value={v.dryRun ? "Dry run" : "Applied"} />
      </div>
      <ol className="ev-plan">
        {v.ops.map(([op, what], i) => (
          <li key={i}>
            <span className="ev-op-n mono">{i + 1}</span>
            <span className="ev-op mono">{op}</span>
            <span className="ev-op-what" title={what}>
              {what}
            </span>
          </li>
        ))}
      </ol>
      {v.total > v.ops.length && (
        <div className="ev-more">
          +{v.total - v.ops.length} more ops not listed
        </div>
      )}
      {v.dryRun && (
        <div className="ev-more">A dry run: checked, nothing written.</div>
      )}
    </>
  );
}

// ── FX chain ─────────────────────────────────────────────────────────────────
