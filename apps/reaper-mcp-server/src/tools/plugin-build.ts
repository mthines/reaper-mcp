import { z } from 'zod/v4';
import { trace } from '@opentelemetry/api';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { activeTelemetryMode } from '../telemetry.js';
import { runSeconds } from './plugin-research.js';

/**
 * report_plugin_build: the /make-plugin skill's last call, so usage telemetry can answer the question
 * write_jsfx cannot: did the plugins that were written actually load and pass their checks. TS-only,
 * nothing changes in REAPER.
 *
 * Same privacy rule as report_plugin_research: every attribute is a closed value or a capped count. No
 * name, no request text, no control labels; the example a plugin started from is one of the shipped
 * example slugs or "other". The scratch track's tag is used to time the run in memory and never reaches a span.
 */

export const BUILD_OUTCOMES = ['shipped', 'compile_failed', 'checks_failed', 'abandoned'] as const;
/** The examples the skill ships; a plugin started from none of them is "none". */
export const BUILD_EXAMPLES = ['mutate-verb', 'tape-sat', 'width-bass-mono', 'none'] as const;
const MAX = { rounds: 10, checks: 8 } as const;

function closed<T extends string>(allowed: readonly T[], value: string | undefined): T | 'other' {
  const candidate = value?.trim().toLowerCase();
  return candidate !== undefined && (allowed as readonly string[]).includes(candidate) ? (candidate as T) : 'other';
}

export function buildAttributes(args: {
  outcome: string;
  example?: string;
  rounds?: number;
  checksPassed?: number;
  checksFailed?: number;
  cleanedUp?: boolean;
  seconds?: number;
}): Record<string, string | number | boolean> {
  return {
    'reaper.plugin_build.outcome': closed(BUILD_OUTCOMES, args.outcome),
    'reaper.plugin_build.example': closed(BUILD_EXAMPLES, args.example ?? 'none'),
    'reaper.plugin_build.rounds': Math.min(args.rounds ?? 1, MAX.rounds),
    'reaper.plugin_build.checks_passed': Math.min(args.checksPassed ?? 0, MAX.checks),
    'reaper.plugin_build.checks_failed': Math.min(args.checksFailed ?? 0, MAX.checks),
    ...(args.cleanedUp !== undefined ? { 'reaper.plugin_build.cleaned_up': args.cleanedUp } : {}),
    ...(args.seconds !== undefined ? { 'reaper.plugin_build.duration_s': args.seconds } : {}),
  };
}

export function registerPluginBuildTools(server: McpServer): void {
  server.tool(
    'report_plugin_build',
    'Call once at the end of a /make-plugin run, after the scratch track is deleted, also when the run stopped early. Records how it went in ' +
      'pseudonymous usage telemetry as fixed values and counts — never the plugin\'s name or what it does. The result shows exactly what was sent. ' +
      'Changes nothing in REAPER.',
    {
      outcome: z.string().describe('shipped: loaded (ok = 1) and every check passed; compile_failed: ok stayed 0; checks_failed: it loaded but a check failed and was not fixed; abandoned: stopped early'),
      example: z.string().optional().describe('The shipped example the plugin started from: mutate-verb, tape-sat, width-bass-mono, or none'),
      rounds: z.coerce.number().int().min(1).optional().describe('write_jsfx → load → check rounds it took (default 1)'),
      checksPassed: z.coerce.number().int().min(0).optional().describe('Verification checks that passed in the last round'),
      checksFailed: z.coerce.number().int().min(0).optional().describe('Verification checks that failed in the last round'),
      cleanedUp: z.boolean().optional().describe('The scratch track was deleted and nothing else changed'),
      scratchTag: z.string().optional().describe('The <TAG> of your "[MCP] make-plugin <TAG>" track, so the server can time the run. Never sent.'),
    },
    async (args) => {
      const attributes = buildAttributes({ ...args, seconds: runSeconds(args.scratchTag) });
      trace.getActiveSpan()?.setAttributes(attributes);
      const mode = activeTelemetryMode();
      return { content: [{ type: 'text' as const, text: JSON.stringify({ telemetry: mode, sent: mode === 'off' ? {} : attributes }, null, 2) }] };
    },
  );
}
