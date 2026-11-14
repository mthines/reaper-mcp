/**
 * `FlagProvider`: the OpenFeature `Provider` backed by the flag registry. There is no remote flag
 * service: the registry IS the config, shipped with the code that reads it, so a ramp step is a release.
 * Swapping in a remote provider later means writing another `Provider`; call sites that go through
 * `evaluateFlag` are unaffected.
 */
import type {
  EvaluationContext,
  JsonValue as OfJsonValue,
  Provider,
  ResolutionDetails,
} from '@openfeature/server-sdk';
import { ErrorCode, StandardResolutionReasons } from '@openfeature/server-sdk';
import { FLAG_OVERRIDES_CONTEXT_KEY, sanitizeFlagOverrides } from './overrides.js';
import { FLAG_REGISTRY } from './registry.js';
import { resolveFlag } from './resolve.js';
import type { FlagDefinition, FlagType } from './schema.js';

export const PROVIDER_NAME = 'reaper-mcp-flags';

/** OpenFeature's reason vocabulary, plus the custom OVERRIDE the semconv permits. */
const REASONS = {
  override: 'OVERRIDE',
  split: StandardResolutionReasons.SPLIT,
  static: StandardResolutionReasons.STATIC,
} as const;

export class FlagProvider implements Provider {
  readonly metadata = { name: PROVIDER_NAME } as const;

  constructor(private readonly registry: readonly FlagDefinition[] = FLAG_REGISTRY) {}

  async resolveBooleanEvaluation(key: string, fallback: boolean, context: EvaluationContext) {
    return this.resolveFor(key, fallback, context, 'boolean');
  }

  async resolveStringEvaluation(key: string, fallback: string, context: EvaluationContext) {
    return this.resolveFor(key, fallback, context, 'string');
  }

  async resolveNumberEvaluation(key: string, fallback: number, context: EvaluationContext) {
    return this.resolveFor(key, fallback, context, 'number');
  }

  async resolveObjectEvaluation<T extends OfJsonValue>(
    key: string,
    fallback: T,
    context: EvaluationContext,
  ) {
    return this.resolveFor(key, fallback, context, 'object');
  }

  private resolveFor<T extends OfJsonValue>(
    key: string,
    fallback: T,
    context: EvaluationContext,
    type: FlagType,
  ): ResolutionDetails<T> {
    const def = this.registry.find((f) => f.key === key);
    if (!def) {
      return { value: fallback, reason: StandardResolutionReasons.ERROR, errorCode: ErrorCode.FLAG_NOT_FOUND };
    }
    if (def.type !== type) {
      return {
        value: fallback,
        reason: StandardResolutionReasons.ERROR,
        errorCode: ErrorCode.TYPE_MISMATCH,
        errorMessage: `flag "${def.key}" is type "${def.type}", not "${type}"`,
      };
    }
    // The context is user-controlled storage by the time it got here: re-validate against THIS registry
    const overrides = sanitizeFlagOverrides(context[FLAG_OVERRIDES_CONTEXT_KEY], this.registry);
    const resolved = resolveFlag(def, { targetingKey: context.targetingKey, overrides });
    return { value: resolved.value as T, variant: resolved.variant, reason: REASONS[resolved.reason] };
  }
}
