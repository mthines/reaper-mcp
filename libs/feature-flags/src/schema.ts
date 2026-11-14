/**
 * The flag-definition schema: the single source of truth that the generator
 * (`scripts/gen-feature-flags.mjs`) projects into typed keys and a
 * language-neutral manifest. A definition is data, not code, and nothing here
 * assumes a Node API, so the bridge page imports it in the browser too.
 */
import { z } from 'zod/v4';

/** Kebab-case, so a flag key is a legal identifier in every target language's naming convention. */
const FLAG_KEY_PATTERN = /^[a-z][a-z0-9-]*$/;

/** The four value types OpenFeature's evaluation API distinguishes. */
export const FlagTypeSchema = z.enum(['boolean', 'string', 'number', 'object']);
export type FlagType = z.infer<typeof FlagTypeSchema>;

/** One arm of an experiment. `weight` values across all variants must sum to 100. */
export const ExperimentVariantSchema = z.object({
  key: z.string().min(1),
  description: z.string().optional(),
  weight: z.number().min(0).max(100),
});
export type ExperimentVariant = z.infer<typeof ExperimentVariantSchema>;

/**
 * A/B (or A/B/n) rollout config. `enabled: false` keeps the arms declared, so
 * the experiment can be re-launched without re-authoring, while every
 * evaluation resolves to `defaultVariant` (reason `static`).
 */
export const ExperimentSchema = z
  .object({
    enabled: z.boolean().default(false),
    variants: z.array(ExperimentVariantSchema).min(2),
  })
  .superRefine((experiment, ctx) => {
    const total = experiment.variants.reduce((sum, v) => sum + v.weight, 0);
    if (Math.abs(total - 100) > 0.001) {
      ctx.addIssue({
        code: 'custom',
        message: `experiment.variants weights must sum to 100, got ${total}`,
      });
    }
    const keys = experiment.variants.map((v) => v.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: 'custom', message: 'experiment.variants keys must be unique' });
    }
  });
export type Experiment = z.infer<typeof ExperimentSchema>;

/** The full JSON value space, matching OpenFeature's `JsonValue`. */
export type JsonPrimitive = boolean | string | number | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.boolean(), z.string(), z.number(), z.null(), z.array(jsonValue), z.record(z.string(), jsonValue)]),
);

export const FlagDefinitionSchema = z
  .object({
    key: z.string().regex(FLAG_KEY_PATTERN, 'flag key must be kebab-case (e.g. "example-new-panel")'),
    description: z.string().min(1),
    type: FlagTypeSchema,
    /** Variant key -> the value returned for that variant. Must include `defaultVariant`. */
    variants: z.record(z.string(), jsonValue),
    defaultVariant: z.string().min(1),
    /** Optional A/B(/n) experiment. Every `experiment.variants[].key` must exist in `variants`. */
    experiment: ExperimentSchema.optional(),
    /** Who owns the flag, surfaced in the manifest for cleanup audits. */
    owner: z.string().min(1),
    tags: z.array(z.string()).default([]),
  })
  .superRefine((def, ctx) => {
    // `Object.hasOwn`, not `in`: `in` walks the prototype chain, so a defaultVariant of "constructor" would pass.
    if (!Object.hasOwn(def.variants, def.defaultVariant)) {
      ctx.addIssue({
        code: 'custom',
        path: ['defaultVariant'],
        message: `defaultVariant "${def.defaultVariant}" is not a key of variants`,
      });
    }
    for (const variant of def.experiment?.variants ?? []) {
      if (!Object.hasOwn(def.variants, variant.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['experiment', 'variants'],
          message: `experiment variant "${variant.key}" is not a key of variants`,
        });
      }
    }
    if (Object.values(def.variants).some((v) => typeof v !== def.type)) {
      ctx.addIssue({
        code: 'custom',
        path: ['variants'],
        message: `all variant values must be of declared type "${def.type}"`,
      });
    }
  });
export type FlagDefinition = z.infer<typeof FlagDefinitionSchema>;

export const FlagRegistrySchema = z.array(FlagDefinitionSchema).superRefine((defs, ctx) => {
  const keys = defs.map((d) => d.key);
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (dupes.length > 0) {
    ctx.addIssue({ code: 'custom', message: `duplicate flag keys: ${[...new Set(dupes)].join(', ')}` });
  }
});

/** Validate a registry, throwing one error that lists every issue. */
export function parseRegistry(input: unknown): readonly FlagDefinition[] {
  const result = FlagRegistrySchema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `Invalid @reaper-mcp/feature-flags registry:\n${result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')}`,
    );
  }
  return result.data;
}
