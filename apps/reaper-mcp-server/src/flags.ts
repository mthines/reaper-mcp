/**
 * Feature flags on the server: where the owner's overrides live, which targeting key the install uses,
 * and the `reaper-mcp flags` command. The registry, bucketing and OpenFeature plumbing are in
 * `libs/feature-flags`; this file only binds them to this machine.
 *
 * "Visible only to me": ship a flag dark (default variant off), then force it on here
 * (`reaper-mcp flags set <key> <variant>`, or `REAPER_MCP_FLAGS='{"<key>":"<variant>"}'`). Nobody else's
 * install has that override. Ramping and experiments are `experiment` entries in the registry, bucketed
 * by the install id.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  FLAG_REGISTRY,
  resolveFlag,
  sanitizeFlagOverrides,
  type FlagDefinition,
  type FlagOverrides,
  type FlagKey,
  type FlagValue,
} from '@reaper-mcp/feature-flags';
import { createFlagClient, evaluateDefinition } from '@reaper-mcp/feature-flags/server';
import { readInstallId } from './telemetry.js';

export const FLAGS_FILE = 'flags.json';
export const FLAGS_ENV = 'REAPER_MCP_FLAGS';

export function defaultFlagsDir(): string {
  return join(homedir(), '.config', 'reaper-mcp');
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * The owner's overrides: `flags.json` in the config dir, then `REAPER_MCP_FLAGS` on top (JSON, so a
 * single run can force a variant). Only entries naming a real flag and one of its variants survive: a
 * hand-edited file or a stale entry never breaks evaluation.
 */
export function readFlagOverrides(
  dir = defaultFlagsDir(),
  env: NodeJS.ProcessEnv = process.env,
  registry: readonly FlagDefinition[] = FLAG_REGISTRY,
): FlagOverrides {
  let fromFile: unknown;
  try {
    fromFile = parseJson(readFileSync(join(dir, FLAGS_FILE), 'utf-8'));
  } catch {
    fromFile = undefined;
  }
  const fromEnv = env[FLAGS_ENV] ? parseJson(env[FLAGS_ENV]) : undefined;
  return { ...sanitizeFlagOverrides(fromFile, registry), ...sanitizeFlagOverrides(fromEnv, registry) };
}

export function writeFlagOverrides(overrides: FlagOverrides, dir = defaultFlagsDir()): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, FLAGS_FILE), JSON.stringify(overrides, null, 2) + '\n', 'utf-8');
}

export interface ServerFlagsOptions {
  registry?: readonly FlagDefinition[];
  dir?: string;
  env?: NodeJS.ProcessEnv;
  /** The stable per-install id used to bucket experiments; defaults to telemetry's install id. */
  installId?: () => string | undefined;
  /** OpenFeature domain; tests pass a distinct one per fixture registry. */
  domain?: string;
}

export interface FlagRow {
  key: string;
  variant: string;
  reason: string;
  /** The variant the owner forced, when one is set and valid. */
  override?: string;
  experiment?: { enabled: boolean; split: string };
  description: string;
}

export interface ServerFlags {
  /** The evaluation context for this install: the targeting key and the owner's overrides. */
  /** The evaluation context. `withTargetingKey` reads (and may create) the install id; only an enabled experiment needs it. */
  context(withTargetingKey?: boolean): { targetingKey?: string; flagOverrides: FlagOverrides };
  /** Evaluate through OpenFeature, so the active span (a tool call) is stamped with the result. */
  details(key: string): Promise<{ variant?: string; reason?: string; value: unknown }>;
  /** Every flag with how it resolves right now, without touching spans. */
  rows(): FlagRow[];
}

export function createServerFlags(options: ServerFlagsOptions = {}): ServerFlags {
  const registry = options.registry ?? FLAG_REGISTRY;
  const installId = options.installId ?? (() => readInstallId());
  const context = (withTargetingKey = true): { targetingKey?: string; flagOverrides: FlagOverrides } => {
    const targetingKey = withTargetingKey ? installId() : undefined;
    return {
      ...(targetingKey && { targetingKey }),
      flagOverrides: readFlagOverrides(options.dir, options.env, registry),
    };
  };
  const client = () => createFlagClient(registry, options.domain);

  return {
    context,
    async details(key) {
      const def = registry.find((f) => f.key === key);
      if (!def) throw new Error(`unknown flag "${key}"`);
      return evaluateDefinition(client(), def, context(def.experiment?.enabled === true));
    },
    rows() {
      const { flagOverrides } = context(false);
      return registry.map((def) => {
        const resolved = resolveFlag(def, { targetingKey: installId, overrides: flagOverrides });
        return {
          key: def.key,
          variant: resolved.variant,
          reason: resolved.reason,
          ...(flagOverrides[def.key] !== undefined && { override: flagOverrides[def.key] }),
          ...(def.experiment && {
            experiment: {
              enabled: def.experiment.enabled,
              split: def.experiment.variants.map((v) => `${v.key} ${v.weight}%`).join(' / '),
            },
          }),
          description: def.description,
        };
      });
    },
  };
}

const defaultFlags = createServerFlags();

/** Evaluate a registered flag for this install. A tool handler calling this stamps its own span. */
export async function evaluateServerFlag<K extends FlagKey>(key: K): Promise<FlagValue<K>> {
  return (await defaultFlags.details(key)).value as FlagValue<K>;
}

// ---------------------------------------------------------------------------
// reaper-mcp flags list | set <key> <variant> | reset [key]
// ---------------------------------------------------------------------------

export interface FlagsCommandIO {
  log(line: string): void;
  error(line: string): void;
}

export interface FlagsCommandOptions extends ServerFlagsOptions {
  io?: FlagsCommandIO;
}

const USAGE = [
  'Usage:',
  '  reaper-mcp flags list                   Every flag, how it resolves for this install, and why',
  '  reaper-mcp flags set <key> <variant>    Force a variant on this install only',
  '  reaper-mcp flags reset [key]            Drop one override, or all of them',
];

/** Returns the exit code. Overrides live in `flags.json` (never in the registry), so they are yours alone. */
export function flagsCommand(args: string[], options: FlagsCommandOptions = {}): number {
  const io = options.io ?? { log: console.log, error: console.error };
  const registry = options.registry ?? FLAG_REGISTRY;
  const dir = options.dir ?? defaultFlagsDir();
  const flags = createServerFlags({ ...options, registry, dir });
  const [sub = 'list', key, variant] = args;

  if (sub === 'list') {
    const rows = flags.rows();
    if (rows.length === 0) {
      io.log('No feature flags are declared.');
      return 0;
    }
    for (const row of rows) {
      const note = row.override ? ' (override)' : row.experiment?.enabled ? ` (experiment: ${row.experiment.split})` : '';
      io.log(`${row.key}  ${row.variant}  reason=${row.reason}${note}`);
    }
    return 0;
  }

  if (sub === 'set') {
    if (!key || !variant) {
      io.error(USAGE.join('\n'));
      return 1;
    }
    const def = registry.find((f) => f.key === key);
    if (!def) {
      io.error(`Unknown flag "${key}". Known flags: ${registry.map((f) => f.key).join(', ') || 'none'}.`);
      return 1;
    }
    if (!Object.hasOwn(def.variants, variant)) {
      io.error(`"${variant}" is not a variant of ${key}. Variants: ${Object.keys(def.variants).join(', ')}.`);
      return 1;
    }
    // Rewrite from the file alone: REAPER_MCP_FLAGS is a per-run override and must not be baked into it
    const stored = readFlagOverrides(dir, {}, registry);
    writeFlagOverrides({ ...stored, [key]: variant }, dir);
    io.log(`${key} forced to "${variant}" on this install. It applies from the next evaluation, no restart needed.`);
    return 0;
  }

  if (sub === 'reset') {
    const stored = readFlagOverrides(dir, {}, registry);
    if (key) {
      const { [key]: dropped, ...rest } = stored;
      writeFlagOverrides(rest, dir);
      io.log(dropped === undefined ? `${key} had no override.` : `${key} override removed.`);
    } else {
      writeFlagOverrides({}, dir);
      io.log('All flag overrides removed.');
    }
    return 0;
  }

  io.error(USAGE.join('\n'));
  return 1;
}
