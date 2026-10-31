import { useState } from 'react';
import { track } from '../../lib/analytics.js';
import type { KnowledgeFeed, PluginRecord, PublishResult } from './plugins.js';
import { Icon } from '../../components/index.js';
import { cx } from '../../lib/cx.js';
import pluginsViewStyles from './PluginsView.module.css';
import drawerStyles from '../../styles/drawer.module.css';
import styles from './PublishRecord.module.css';

type PublishState = { step: 'idle' | 'confirm' | 'busy' } | { step: 'done'; result: PublishResult } | { step: 'error'; message: string };

/** Publish one of the viewer's records into the built-in layer (reaper-mcp org members), confirmed inline. */
export function PublishRecord({ record, shadows, publish }: { record: PluginRecord; shadows?: PluginRecord; publish: NonNullable<KnowledgeFeed['publish']> }) {
  const [state, setState] = useState<PublishState>({ step: 'idle' });
  const [removeCopy, setRemoveCopy] = useState(true);
  const target = record.key.replace(/^user::/, '');
  const run = async () => {
    setState({ step: 'busy' });
    try {
      const result = await publish(record, { removeCopy });
      track({ name: 'plugin_publish_completed', outcome: 'published', removed_copy: result.removedCopy, replaced: Boolean(shadows) });
      setState({ step: 'done', result });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // "refused" = LoreKit or the record checks said no; "failed" = network or server trouble
      const refused = /refused|not allowed|must|needs/i.test(message);
      track({ name: 'plugin_publish_completed', outcome: refused ? 'refused' : 'failed', removed_copy: false, replaced: Boolean(shadows) });
      setState({ step: 'error', message });
    }
  };

  if (state.step === 'done') {
    return (
      <div className={cx(styles.knPublish, styles.knPublishDone)} role="status">
        <div>
          Published as <span className="mono">{state.result.key}</span>
          {state.result.removedCopy ? '. Your copy is archived (restorable in LoreKit).' : '.'}
        </div>
        {state.result.warning && <div className={styles.knPublishWarn}>{state.result.warning}</div>}
      </div>
    );
  }
  if (state.step === 'idle') {
    return (
      <button className={cx(pluginsViewStyles.knContribute, styles.knPublishBtn, 'btn btn-block')} onClick={() => setState({ step: 'confirm' })} title="Writes the record to the built-in layer in LoreKit">
        <Icon.Share /> Publish to built-in
      </button>
    );
  }
  return (
    <div className={styles.knPublish}>
      <p className={drawerStyles.drawerNote}>
        Writes <span className="mono">{target}</span> to the built-in layer for everyone
        {shadows ? ', replacing the current built-in record' : ''}.
      </p>
      <label className={styles.knPublishCheck}>
        <input type="checkbox" checked={removeCopy} disabled={state.step === 'busy'} onChange={(ev) => setRemoveCopy(ev.target.checked)} />
        Archive my copy afterwards (it would keep overriding the built-in one)
      </label>
      {state.step === 'error' && (
        <div className={styles.knPublishWarn} role="alert">
          {state.message}
        </div>
      )}
      <div className={styles.knPublishActions}>
        <button className={cx(styles.knPublishBtn, 'btn btn-sm')} onClick={run} disabled={state.step === 'busy'}>
          {state.step === 'busy' ? 'Publishing…' : state.step === 'error' ? 'Try again' : 'Publish'}
        </button>
        <button className="btn btn-sm" onClick={() => setState({ step: 'idle' })} disabled={state.step === 'busy'}>
          Cancel
        </button>
      </div>
    </div>
  );
}
