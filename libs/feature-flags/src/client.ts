/**
 * The server-side evaluation surface. Application code calls `evaluateFlag` / `evaluateFlagDetails`,
 * never `OpenFeature` or `FlagProvider` directly, so the OTel hook and the registry stay the only way
 * a flag is resolved.
 */
import {
  OpenFeature,
  type Client,
  type EvaluationContext,
  type EvaluationDetails,
  type FlagValue as OpenFeatureFlagValue,
} from '@openfeature/server-sdk';
import { featureFlagOtelHook } from './otel-hook.js';
import { FlagProvider } from './provider.js';
import { FLAG_REGISTRY, getFlagDefinition } from './registry.js';
import type { FlagDefinition, JsonValue } from './schema.js';
import type { FlagKey, FlagValue } from './generated/flags.generated.js';

const DEFAULT_DOMAIN = 'reaper-mcp-feature-flags';
const clients = new Map<string, Client>();

/**
 * An OpenFeature client bound to its own provider (over `registry`) and the OTel hook, created once
 * per domain. Use a distinct domain per fixture registry in tests.
 */
export function createFlagClient(registry: readonly FlagDefinition[] = FLAG_REGISTRY, domain = DEFAULT_DOMAIN): Client {
  let client = clients.get(domain);
  if (!client) {
    OpenFeature.setProvider(domain, new FlagProvider(registry));
    client = OpenFeature.getClient(domain);
    client.addHooks(featureFlagOtelHook);
    clients.set(domain, client);
  }
  return client;
}

/** Evaluate one definition through a client, returning value, variant and reason. */
export async function evaluateDefinition(
  client: Client,
  def: FlagDefinition,
  context: EvaluationContext = {},
): Promise<EvaluationDetails<OpenFeatureFlagValue>> {
  const fallback = def.variants[def.defaultVariant];
  switch (def.type) {
    case 'boolean':
      return client.getBooleanDetails(def.key, fallback as boolean, context);
    case 'string':
      return client.getStringDetails(def.key, fallback as string, context);
    case 'number':
      return client.getNumberDetails(def.key, fallback as number, context);
    case 'object':
      return client.getObjectDetails(def.key, fallback as JsonValue, context);
  }
}

function requireDefinition(key: string): FlagDefinition {
  const def = getFlagDefinition(key);
  if (!def) throw new Error(`@reaper-mcp/feature-flags: unknown flag "${key}", run node scripts/gen-feature-flags.mjs`);
  return def;
}

/** Evaluate a flag by its generated, typed key; an unknown key is a compile error. */
export async function evaluateFlag<K extends FlagKey>(key: K, context: EvaluationContext = {}): Promise<FlagValue<K>> {
  const details = await evaluateDefinition(createFlagClient(), requireDefinition(key), context);
  return details.value as unknown as FlagValue<K>;
}

/** Like {@link evaluateFlag}, with the variant and reason alongside the value. */
export async function evaluateFlagDetails<K extends FlagKey>(
  key: K,
  context: EvaluationContext = {},
): Promise<EvaluationDetails<OpenFeatureFlagValue>> {
  return evaluateDefinition(createFlagClient(), requireDefinition(key), context);
}
