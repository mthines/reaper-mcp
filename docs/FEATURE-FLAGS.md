# Feature flags

Ship code dark, turn it on for yourself, ramp it to a share of installs, or run an A/B test, all without a flag service. This is a port of LoreKit's flag system: one registry in `libs/feature-flags`, deterministic bucketing, OpenFeature on the server, and OpenTelemetry attributes so an experiment's arms can be compared.

There is no remote flag service. The registry ships with the code, so a ramp step is a release.

## How a flag resolves

For one flag, in this order:

1. **Override.** A variant you forced on this install or in this browser. Reason `override`.
2. **Experiment split.** If the flag has an `experiment` with `enabled: true`, the install lands in an arm by its weight. Reason `split`.
3. **Default.** `defaultVariant`. Reason `static`.

The targeting key is stable, so an install never moves between arms:

| Where | Targeting key |
| --- | --- |
| MCP server | the per-install id in `~/.reaper-mcp/install-id` (the one telemetry uses) |
| Bridge page | the random id in the browser's `localStorage` (`mcp_bridge.install_id`, the id usage statistics send as `user.id`) |

An enabled experiment evaluated without a targeting key (blocked storage, unwritable home) stays on its default. Bucketing on a constant would put everyone on one arm, which is not a split.

Bucketing is `fnv1a("<flagKey>:<targetingKey>") % 100` against the cumulative variant weights, byte-identical to LoreKit. `libs/feature-flags/src/bucketing.test.ts` pins the hash vectors: never change the hash, it would move every install between arms.

## Add a flag

1. Add an entry to `REGISTRY_INPUT` in `libs/feature-flags/src/registry.ts`:

   ```ts
   {
     key: 'new-eq-panel',
     description: 'What it gates and what turning it on changes.',
     type: 'boolean',
     variants: { off: false, on: true },
     defaultVariant: 'off',   // dark by default
     owner: 'reaper-mcp',
     tags: ['bridge-ui'],
   }
   ```

2. Regenerate the typed keys and the manifest, and commit both:

   ```bash
   node scripts/gen-feature-flags.mjs          # or: pnpm nx run feature-flags:generate
   node scripts/gen-feature-flags.mjs --check  # fails when they have drifted
   ```

3. Read it where it is used.

   Server (inside a tool handler the value is also stamped on that call's span):

   ```ts
   import { evaluateServerFlag } from './flags.js';
   if (await evaluateServerFlag('new-eq-panel')) { /* new path */ }
   ```

   Bridge page:

   ```tsx
   import { useFlag } from '../app/useFlag.js';
   const enabled = useFlag('new-eq-panel');
   ```

   A UI experiment renders one whole component per arm (`Panel.on.tsx`, `Panel.off.tsx` behind a resolver), never inline branches, so removing the losing arm is deleting a file.

Every entry must gate something real. Do not add a placeholder flag so a code path has an example: the tests declare their own fixtures.

## Release it only to yourself

Merge with `defaultVariant: 'off'`, then force it on where you work.

```bash
reaper-mcp flags list                       # every flag, how it resolves here, and why
reaper-mcp flags set new-eq-panel on        # writes ~/.config/reaper-mcp/flags.json
reaper-mcp flags reset new-eq-panel         # or `reset` for all of them
REAPER_MCP_FLAGS='{"new-eq-panel":"on"}' reaper-mcp serve   # one run only
```

An override that names an unknown flag or variant (a stale file after a rename) is ignored, never an error. The server reads the file on every evaluation, so a change applies without a restart.

On the bridge page, turn on developer mode (Settings), then use **Developer: feature flags** to see each flag's resolved variant and reason and to force or reset one. That override lives in this browser only. The palette has **Reset feature flag overrides**.

## Ramp it to a percentage

Add an experiment with the arms and weights (they must sum to 100), then release:

```ts
experiment: {
  enabled: true,
  variants: [
    { key: 'off', weight: 90 },
    { key: 'on', weight: 10 },
  ],
},
```

Ship 10, then 50, then 100 as separate releases, or end the ramp by changing `defaultVariant` to `on` and deleting the entry. Setting `enabled: false` keeps the arms declared while every install resolves to the default.

## Run an A/B test

Same entry with two or more arms (`control` and `treatment`, 50/50). Compare the arms from telemetry:

- **Server:** each tool call's span carries `feature_flag.key`, `feature_flag.provider.name`, `feature_flag.result.variant` and `feature_flag.result.reason` (`static`, `split`, `override`) for the flags it evaluated. They pass the usage-telemetry allow-list; the install id never rides on them. Filter spans (error rate, duration) by `feature_flag.result.variant`.
- **Page:** the first read of a flag per page load sends `bridge_ui.feature_flag_exposed` with `flag`, `variant` and `reason` (see `apps/bridge-ui/tracking-plan.yaml`). Join it to the browser's other events through the shared id.

An `override` row is you forcing an arm: leave it out when counting an experiment.

## Remove a flag

When the rollout is done: make the winning behavior unconditional, delete the `useFlag` / `evaluateServerFlag` call sites and the losing code, delete the registry entry, and regenerate. Leave a stale `flags.json` alone: its entry is ignored.

## Layout

| Path | Role |
| --- | --- |
| `libs/feature-flags/src/registry.ts` | the hand-authored registry, validated at import |
| `libs/feature-flags/src/schema.ts` | the zod schema and its rules (kebab-case key, `defaultVariant` exists, weights sum to 100, value types, no duplicates) |
| `libs/feature-flags/src/resolve.ts` | the pure resolver, shared by server and page |
| `libs/feature-flags/src/index.ts` | browser-safe entry (the page imports this) |
| `libs/feature-flags/src/server.ts` | OpenFeature provider, client and OTel hook (server only) |
| `libs/feature-flags/src/generated/`, `generated/` | generated, never edited |
| `scripts/gen-feature-flags.mjs` | the generator, with `--check` |
| `apps/reaper-mcp-server/src/flags.ts` | install id, `flags.json`, `REAPER_MCP_FLAGS`, the `flags` command |
| `apps/bridge-ui/src/lib/flag-store.ts`, `app/useFlag.ts` | the page's store and hook |
