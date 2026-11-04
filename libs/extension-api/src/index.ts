export { EXTENSION_API_VERSION, MANIFEST_FILE, validateManifest, isSafeRelativePath } from './manifest.js';
export type { ExtensionManifest, ManifestResult } from './manifest.js';
export { VST3_HEADER_BYTES, isVst3StateConsistent, isVst3WrapperCoherent, withVst3Lengths } from './vst3-state.js';
export { createFxStateClient } from './fx-state.js';
export type { FxStateHost } from './fx-state.js';
export type {
  BridgeResult,
  ToolResult,
  ToolShape,
  Result,
  FxLocation,
  FxState,
  FxStateClient,
  ExtensionApi,
  ExtensionModule,
} from './types.js';

import type { ExtensionApi, ExtensionModule } from './types.js';

/** Declare an extension's entry point with its types checked: `export default defineExtension({ register(api) { … } })`. */
export function defineExtension(module: ExtensionModule): ExtensionModule {
  return module;
}
