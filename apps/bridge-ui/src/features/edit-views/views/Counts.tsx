import { Measurement } from '../../measurements/index.js';

/**
 * What a write added and removed, as words: one readout per count that isn't zero ("Removed 1", never "+0 −1").
 * With nothing added or removed, `changed` says how many were edited in place.
 */
export function Counts({ added, removed, changed = 0 }: { added: number; removed: number; changed?: number }) {
  const counts = (added || removed ? [['Added', added], ['Removed', removed]] : [['Changed', changed]]) as [string, number][];
  const shown = counts.filter(([, n]) => n > 0);
  if (!shown.length) return <Measurement.Readout label="Changed" value="nothing" />;
  return (
    <>
      {shown.map(([label, n]) => (
        <Measurement.Readout key={label} label={label} value={String(n)} />
      ))}
    </>
  );
}
