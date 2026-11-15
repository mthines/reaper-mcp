/**
 * @reaper-mcp/feature-flags, browser-safe entry: the schema, registry, bucketing, overrides and the
 * pure resolver. The bridge page imports this. The OpenFeature-backed server surface (`evaluateFlag`,
 * the provider, the OTel hook) is `@reaper-mcp/feature-flags/server`, which pulls in Node-side SDKs.
 *
 * Guide: docs/FEATURE-FLAGS.md.
 */
export { assignExperimentVariant, bucketOf, fnv1aHash } from './bucketing.js';
export { FLAG_REGISTRY, getFlagDefinition } from './registry.js';
export { resolveFlag, type FlagReason, type FlagResolution, type FlagResolveContext } from './resolve.js';
export {
  FLAG_OVERRIDES_CONTEXT_KEY,
  parseFlagOverrides,
  sanitizeFlagOverrides,
  serializeFlagOverrides,
  type FlagOverrides,
} from './overrides.js';
export {
  ExperimentSchema,
  ExperimentVariantSchema,
  FlagDefinitionSchema,
  FlagRegistrySchema,
  FlagTypeSchema,
  parseRegistry,
  type Experiment,
  type ExperimentVariant,
  type FlagDefinition,
  type FlagType,
  type JsonValue,
} from './schema.js';
export {
  ATTR_FEATURE_FLAG_KEY,
  ATTR_FEATURE_FLAG_PROVIDER_NAME,
  ATTR_FEATURE_FLAG_RESULT_REASON,
  ATTR_FEATURE_FLAG_RESULT_VARIANT,
  EVENT_FEATURE_FLAG_EVALUATION,
  flagReasonValue,
} from './otel-attributes.js';
export { FLAG_KEYS } from './generated/flags.generated.js';
export type { FlagKey, FlagValue, FlagValueMap } from './generated/flags.generated.js';
