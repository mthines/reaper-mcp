# @reaper-mcp/feature-flags

Feature flags with a typed registry, deterministic A/B and percentage bucketing, owner-only overrides, and OpenTelemetry span attributes. A port of LoreKit's `packages/feature-flags`. Guide: [docs/FEATURE-FLAGS.md](../../docs/FEATURE-FLAGS.md).

## Rules

- **`src/registry.ts` is the only hand-authored source.** Never edit `src/generated/flags.generated.ts` or `generated/flags.manifest.json`; run `node scripts/gen-feature-flags.mjs`. `--check` and `generated-artifacts.test.ts` fail on drift.
- **No placeholder flags.** An entry must gate something real. Tests declare their own `FlagDefinition` fixtures through `parseRegistry`.
- **Two entry points.** `@reaper-mcp/feature-flags` is browser-safe (schema, registry, bucketing, overrides, pure `resolveFlag`): the bridge page imports it. `@reaper-mcp/feature-flags/server` adds the OpenFeature provider, client and OTel hook: only the MCP server imports it. Never import the server entry from the page.
- **The server calls `evaluateFlag` / `evaluateFlagDetails` only**, never `OpenFeature.*` or `FlagProvider` directly.
- **Bucketing is frozen.** `"<flagKey>:<targetingKey>"` through FNV-1a, `% 100`, cumulative weights: byte-identical to LoreKit. `bucketing.test.ts` pins the vectors; changing the hash moves every user between arms.
- **No targeting key, no split.** An enabled experiment without a targeting key resolves to `defaultVariant`.
- **Telemetry carries no targeting key.** `feature_flag.key`, `.provider.name`, `.result.variant`, `.result.reason` only.
- Imports use `.js` extensions (bundler resolution, like the other libs); the generator bundles `registry.ts` with esbuild, so no Node loader flag is needed.
