/**
 * An OpenFeature `Hook` that stamps every flag evaluation onto the active OTel span: the mechanism an
 * A/B test runs on. Inside an MCP tool call the active span is the `tools/call` span, so every span
 * the tool opens can be filtered by arm. Attributes (see otel-attributes.ts) are the key, provider
 * name, result variant and result reason; a `feature_flag.evaluation` event carries the same.
 *
 * The usage-telemetry allow-list (telemetry-consent.ts) keeps exactly these four attributes and drops
 * span events. Never the targeting key.
 */
import type { EvaluationDetails, FlagValue, Hook, HookContext } from '@openfeature/server-sdk';
import { trace, type Span } from '@opentelemetry/api';
import {
  ATTR_FEATURE_FLAG_KEY,
  ATTR_FEATURE_FLAG_PROVIDER_NAME,
  ATTR_FEATURE_FLAG_RESULT_REASON,
  ATTR_FEATURE_FLAG_RESULT_VARIANT,
  EVENT_FEATURE_FLAG_EVALUATION,
  flagReasonValue,
} from './otel-attributes.js';

function stampSpan(span: Span, attrs: Record<string, string>): void {
  for (const [key, value] of Object.entries(attrs)) span.setAttribute(key, value);
  span.addEvent(EVENT_FEATURE_FLAG_EVALUATION, attrs);
}

function baseAttributes(hookContext: Readonly<HookContext>): Record<string, string> {
  return {
    [ATTR_FEATURE_FLAG_KEY]: hookContext.flagKey,
    [ATTR_FEATURE_FLAG_PROVIDER_NAME]: hookContext.providerMetadata.name,
  };
}

export const featureFlagOtelHook: Hook = {
  after(hookContext: Readonly<HookContext>, details: EvaluationDetails<FlagValue>) {
    const span = trace.getActiveSpan();
    if (!span) return;
    const attrs = baseAttributes(hookContext);
    if (details.variant) attrs[ATTR_FEATURE_FLAG_RESULT_VARIANT] = details.variant;
    attrs[ATTR_FEATURE_FLAG_RESULT_REASON] = flagReasonValue(details.reason);
    stampSpan(span, attrs);
  },
  error(hookContext: Readonly<HookContext>, error: unknown) {
    const span = trace.getActiveSpan();
    if (!span) return;
    stampSpan(span, baseAttributes(hookContext));
    if (error instanceof Error) span.recordException(error);
  },
};
