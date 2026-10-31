import { useEffect, useState } from 'react';
import { settingUrl, type BridgeSettings, type BridgeStatus, type SettingKey } from '../lib/status.js';
import { DEMO } from './demo-mode.js';

const SETTING_FIELD: Record<SettingKey, keyof BridgeSettings> = {
  cfg_paused: 'paused',
  cfg_readonly: 'readonly',
  cfg_open_on_start: 'openOnStart',
  cfg_dev: 'dev',
};

/**
 * Bridge settings as echoed in the status, with the user's last click applied on top until the
 * bridge confirms it (a poll takes up to 500ms, and the toggle shouldn't flicker back meanwhile).
 */
export function useSettings(status: BridgeStatus | null): [BridgeSettings | null, (key: SettingKey, on: boolean) => void] {
  const [pending, setPending] = useState<Partial<BridgeSettings>>({});
  const echoed = status?.settings ?? null;

  useEffect(() => {
    if (!echoed) return;
    setPending((p) => {
      const left = Object.fromEntries(Object.entries(p).filter(([k, v]) => echoed[k as keyof BridgeSettings] !== v));
      return Object.keys(left).length === Object.keys(p).length ? p : left;
    });
  }, [echoed?.paused, echoed?.readonly, echoed?.openOnStart, echoed?.dev]);

  const set = (key: SettingKey, on: boolean) => {
    setPending((p) => ({ ...p, [SETTING_FIELD[key]]: on }));
    if (DEMO) DEMO.set(key, on);
    // A failed write shows up as the toggle snapping back once the bridge's echo disagrees
    else
      fetch(settingUrl(key, on), { cache: 'no-store' }).catch(() =>
        setPending((p) => {
          const rest = { ...p };
          delete rest[SETTING_FIELD[key]];
          return rest;
        }),
      );
  };
  return [echoed ? { ...echoed, ...pending } : null, set];
}
