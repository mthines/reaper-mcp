import { useMemo, useState } from 'react';
import { publishAll, type PublishOutcome } from './lorekit.js';
import type { KnowledgeFeed, PluginRecord } from './plugins.js';
import { cx } from '../../lib/cx.js';
import publishRecordStyles from './PublishRecord.module.css';
import drawerStyles from '../../styles/drawer.module.css';

type PublishAllState = { step: 'confirm' } | { step: 'busy'; done: number; total: number } | { step: 'done'; outcomes: PublishOutcome[] };

/**
 * Publish every one of the viewer's records into the built-in layer in one go (the header's Publish N), confirmed
 * inline. The list is fixed when confirmed: archiving copies changes the feed underneath while it runs.
 */
export function PublishAll({
  records,
  builtIn,
  publish,
  onClose,
}: {
  records: PluginRecord[];
  builtIn: PluginRecord[];
  publish: NonNullable<KnowledgeFeed['publish']>;
  onClose: () => void;
}) {
  const [state, setState] = useState<PublishAllState>({ step: 'confirm' });
  const [removeCopy, setRemoveCopy] = useState(true);
  const builtInKeys = useMemo(() => new Set(builtIn.filter((r) => r.layer === 'built-in').map((r) => r.key)), [builtIn]);
  const replacing = records.filter((r) => builtInKeys.has(r.key.replace(/^user::/, ''))).length;
  const run = async (list: PluginRecord[]) => {
    setState({ step: 'busy', done: 0, total: list.length });
    const outcomes = await publishAll(list, (r) => publish(r, { removeCopy }), (done) => setState({ step: 'busy', done, total: list.length }));
    setState({ step: 'done', outcomes });
  };

  if (state.step === 'done') {
    const failed = state.outcomes.filter((o): o is Extract<PublishOutcome, { error: string }> => 'error' in o);
    const ok = state.outcomes.length - failed.length;
    const warnings = state.outcomes.flatMap((o) => ('result' in o && o.result.warning ? [`${o.record.name}: ${o.result.warning}`] : []));
    return (
      <div className={cx(publishRecordStyles.knPublish, publishRecordStyles.knPublishDone)} role="status">
        <div>
          Published {ok} of {state.outcomes.length} to the built-in layer
          {ok > 0 && state.outcomes.some((o) => 'result' in o && o.result.removedCopy) ? '; your copies are archived (restorable in LoreKit)' : ''}.
        </div>
        {[...failed.map((o) => `${o.record.name}: ${o.error}`), ...warnings].map((line) => (
          <div key={line} className={publishRecordStyles.knPublishWarn}>
            {line}
          </div>
        ))}
        <div className={publishRecordStyles.knPublishActions}>
          {failed.length > 0 && (
            <button className={cx(publishRecordStyles.knPublishBtn, 'btn btn-sm')} onClick={() => run(failed.map((o) => o.record))}>
              Retry {failed.length} failed
            </button>
          )}
          <button className="btn btn-sm" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    );
  }
  const busy = state.step === 'busy';
  return (
    <div className={publishRecordStyles.knPublish}>
      <p className={drawerStyles.drawerNote}>
        Writes your {records.length} record{records.length === 1 ? '' : 's'} to the built-in layer for everyone
        {replacing > 0 ? `, replacing ${replacing} current built-in record${replacing === 1 ? '' : 's'}` : ''}:{' '}
        {records.map((r) => r.name).join(', ')}.
      </p>
      <label className={publishRecordStyles.knPublishCheck}>
        <input type="checkbox" checked={removeCopy} disabled={busy} onChange={(ev) => setRemoveCopy(ev.target.checked)} />
        Archive my copies afterwards (they would keep overriding the built-in ones)
      </label>
      <div className={publishRecordStyles.knPublishActions}>
        <button className={cx(publishRecordStyles.knPublishBtn, 'btn btn-sm')} onClick={() => run(records)} disabled={busy}>
          {busy ? `Publishing ${state.done + 1} of ${state.total}…` : `Publish ${records.length}`}
        </button>
        <button className="btn btn-sm" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
