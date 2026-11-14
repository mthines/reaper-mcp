/** @reaper-mcp/feature-flags, server entry: the OpenFeature client, provider and OTel hook. */
export { createFlagClient, evaluateDefinition, evaluateFlag, evaluateFlagDetails } from './client.js';
export { FlagProvider, PROVIDER_NAME } from './provider.js';
export { featureFlagOtelHook } from './otel-hook.js';
