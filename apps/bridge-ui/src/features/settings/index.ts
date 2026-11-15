// The Settings drawer. Import from here, never the files.
import { LoreKitSetting, PublishSetting } from './LoreKitSettings.js';
import { DeveloperSettings } from './DeveloperSettings.js';
import { SettingsPanel } from './SettingsPanel.js';

/** The Settings drawer; its LoreKit groups are `Settings.LoreKit` and `Settings.Publish`, its developer-mode flags `Settings.Developer` */
export const Settings = Object.assign(SettingsPanel, { LoreKit: LoreKitSetting, Publish: PublishSetting, Developer: DeveloperSettings });

export { SETTING_NAME } from './SettingsPanel.js';
