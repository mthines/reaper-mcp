import { useEffect, useEffectEvent } from 'react';
import { Icon, ResizeHandle, useDrawerWidth } from '../../components/index.js';
import { cx } from '../../lib/cx.js';
import type { FlagRow } from '../../lib/flags.js';
import drawerStyles from '../../styles/drawer.module.css';
import listStyles from '../../styles/list.module.css';
import styles from './DeveloperPanel.module.css';

/** Wider than Settings by default: a flag's key, description, split and controls sit on one row */
const DEVELOPER_DRAWER_WIDTH_PX = 640;

/** A variant key as a segment label: `off` reads "Off" */
const label = (variant: string) => variant.charAt(0).toUpperCase() + variant.slice(1);

/**
 * Developer tools: how each feature flag resolves for this browser, and a way to force a variant (an override
 * that lives in this browser only, so a dark feature can be tried before anyone else sees it). Open from
 * Settings or the palette in developer mode; its open state is the `developer` URL param.
 * Flags are declared in libs/feature-flags/src/registry.ts; docs/FEATURE-FLAGS.md.
 */
export function DeveloperPanel({
  rows,
  onSet,
  onResetAll,
  onClose,
}: {
  rows: FlagRow[];
  /** A variant to force, or null to follow the registry again */
  onSet: (key: string, variant: string | null) => void;
  onResetAll: () => void;
  onClose: () => void;
}) {
  const width = useDrawerWidth(DEVELOPER_DRAWER_WIDTH_PX);
  const onEscape = useEffectEvent(onClose);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && onEscape();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const overridden = rows.filter((r) => r.override !== undefined).length;

  return (
    <aside className={cx(drawerStyles.drawer, styles.drawer)} aria-label="Developer" style={width.style}>
      <ResizeHandle fraction={width.fraction} onCommit={width.setFraction} defaultPx={DEVELOPER_DRAWER_WIDTH_PX} />
      <div className={drawerStyles.drawerHead}>
        <div className={drawerStyles.drawerTitle}>Developer</div>
        <button className="icon-btn" onClick={onClose} aria-label="Close developer tools" title="Close (Esc)">
          <Icon.Close />
        </button>
      </div>
      <div className={drawerStyles.drawerBody}>
        <section className={styles.section} aria-labelledby="developer-flags">
          <div className={styles.sectionHead}>
            <h3 id="developer-flags">Feature flags</h3>
            {overridden > 0 && (
              <button className="btn btn-sm" onClick={onResetAll}>
                Reset all overrides ({overridden})
              </button>
            )}
          </div>
          <p className={styles.hint}>
            Flags hide unfinished features. Forcing one on is unsupported and may break things; reset it to undo. A forced variant
            changes this browser only. The bridge server has its own overrides: <code>reaper-mcp flags</code>.
          </p>
          {rows.length === 0 ? (
            <div className={styles.hint}>No feature flags are declared.</div>
          ) : (
            <ul className={styles.flags}>
              {rows.map((row) => (
                <li key={row.key} className={styles.flag}>
                  <div className={styles.flagInfo}>
                    <div className={styles.flagHead}>
                      <span className={`${styles.flagKey} mono`}>{row.key}</span>
                      <span className={styles.flagState} data-reason={row.reason}>
                        {row.variant} · {row.reason}
                      </span>
                    </div>
                    <p className={styles.flagDesc}>{row.description}</p>
                    {row.split && <div className={styles.hint}>Experiment: {row.split}</div>}
                  </div>
                  <div className={cx(listStyles.seg, listStyles.segSm)} role="tablist" aria-label={`${row.key} variant`}>
                    <button role="tab" aria-selected={row.override === undefined} onClick={() => onSet(row.key, null)} title="Use what the registry says">
                      Follow
                    </button>
                    {row.variants.map((v) => (
                      <button key={v} role="tab" aria-selected={row.override === v} onClick={() => onSet(row.key, v)} title={`Force ${v}`}>
                        {label(v)}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </aside>
  );
}
