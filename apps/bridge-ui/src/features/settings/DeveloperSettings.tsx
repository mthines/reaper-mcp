import type { FlagRow } from '../../lib/flags.js';
import settingsPanelStyles from './SettingsPanel.module.css';
import styles from './DeveloperSettings.module.css';

const FOLLOW_REGISTRY = '';

/**
 * Developer mode's feature flags: how each flag resolves for this browser, and a way to force a variant
 * (an override that lives in this browser only, so a dark feature can be tried before anyone else sees it).
 * Declared in libs/feature-flags/src/registry.ts; docs/FEATURE-FLAGS.md.
 */
export function DeveloperSettings({
  rows,
  onSet,
  onResetAll,
}: {
  rows: FlagRow[];
  /** A variant to force, or null to follow the registry again */
  onSet: (key: string, variant: string | null) => void;
  onResetAll: () => void;
}) {
  const hasOverrides = rows.some((r) => r.override !== undefined);
  return (
    <div className={settingsPanelStyles.settingGroup}>
      <h3>Developer: feature flags</h3>
      <p className={settingsPanelStyles.settingHint}>
        Forcing a variant changes this browser only. The bridge server has its own overrides: <code>reaper-mcp flags</code>.
      </p>
      {rows.length === 0 ? (
        <div className={settingsPanelStyles.rowHint}>No feature flags are declared.</div>
      ) : (
        rows.map((row) => (
          <div key={row.key} className={styles.flag}>
            <div className={styles.flagHead}>
              <span className={`${styles.flagKey} mono`}>{row.key}</span>
              <span className={styles.flagState} data-reason={row.reason}>
                {row.variant} · {row.reason}
              </span>
            </div>
            <p className={styles.flagDesc}>{row.description}</p>
            {row.split && <div className={settingsPanelStyles.rowHint}>Experiment: {row.split}</div>}
            <div className={styles.flagControls}>
              <select
                className={styles.flagSelect}
                aria-label={`${row.key} variant`}
                value={row.override ?? FOLLOW_REGISTRY}
                onChange={(ev) => onSet(row.key, ev.target.value === FOLLOW_REGISTRY ? null : ev.target.value)}
              >
                <option value={FOLLOW_REGISTRY}>Follow the registry</option>
                {row.variants.map((v) => (
                  <option key={v} value={v}>
                    Force {v}
                  </option>
                ))}
              </select>
              {row.override !== undefined && (
                <button className="btn btn-sm" onClick={() => onSet(row.key, null)} aria-label={`Reset ${row.key}`}>
                  Reset
                </button>
              )}
            </div>
          </div>
        ))
      )}
      {hasOverrides && (
        <div className={styles.flagActions}>
          <button className="btn btn-sm" onClick={onResetAll}>
            Reset all overrides
          </button>
        </div>
      )}
    </div>
  );
}
