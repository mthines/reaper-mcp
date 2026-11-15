/**
 * OpenTelemetry feature-flag attribute names, per the (experimental) OTel semantic conventions:
 * https://opentelemetry.io/docs/specs/semconv/registry/attributes/feature-flag/
 *
 * These are SPAN attributes, not Resource attributes: a variant is decided per evaluation, inside a
 * process that may serve every arm. Filter spans by `feature_flag.result.variant` to compare arms.
 * Never carries the targeting key: the resource already holds the pseudonymous install id.
 */
export const ATTR_FEATURE_FLAG_KEY = 'feature_flag.key';
export const ATTR_FEATURE_FLAG_PROVIDER_NAME = 'feature_flag.provider.name';
export const ATTR_FEATURE_FLAG_RESULT_VARIANT = 'feature_flag.result.variant';
export const ATTR_FEATURE_FLAG_RESULT_REASON = 'feature_flag.result.reason';

/** Span event name emitted on every evaluation. */
export const EVENT_FEATURE_FLAG_EVALUATION = 'feature_flag.evaluation';

/**
 * A resolution reason as a `feature_flag.result.reason` value: OpenFeature's UPPERCASE reasons
 * lowercased (`static`, `split`, `override`, `error`). Absent is `unknown`, never an empty string.
 */
export function flagReasonValue(reason: string | undefined): string {
  return reason ? reason.toLowerCase() : 'unknown';
}
