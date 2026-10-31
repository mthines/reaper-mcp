// The Plugins tab: which installed plugins the mix skills know, and publishing what you taught them.
// Import from here, never the files (scripts/ import the .mjs logic directly, outside the page).
import { PluginDetails } from './PluginDetails.js';
import { PluginsView } from './PluginsView.js';
import { PublishAll } from './PublishAll.js';
import { PublishRecord } from './PublishRecord.js';
import { TeachMenu } from './TeachMenu.js';

/** The Plugins tab; its parts are `Plugins.Details`, `Plugins.TeachMenu`, `Plugins.PublishRecord` and `Plugins.PublishAll` */
export const Plugins = Object.assign(PluginsView, { Details: PluginDetails, TeachMenu, PublishRecord, PublishAll });

export { pluginCoverage, type Coverage, type InstalledFx, type KnowledgeFeed, type PluginRecord, type PluginRow, type PublishResult, type UsedFx } from './plugins.js';
export { LOREKIT_PUBLISH_TOKEN_KEY, loadLoreKitToken, saveLoreKitToken, useKnowledge } from './useKnowledge.js';
export type { TeachOption } from './TeachMenu.js';
