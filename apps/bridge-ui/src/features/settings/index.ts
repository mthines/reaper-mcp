// The Settings drawer. Import from here, never the files.
import { LoreKitSetting, PublishSetting } from './LoreKitSettings.js';
import { SettingsPanel } from './SettingsPanel.js';

/** The Settings drawer; its LoreKit groups are `Settings.LoreKit` and `Settings.Publish` */
export const Settings = Object.assign(SettingsPanel, { LoreKit: LoreKitSetting, Publish: PublishSetting });

export { SETTING_NAME } from './SettingsPanel.js';
