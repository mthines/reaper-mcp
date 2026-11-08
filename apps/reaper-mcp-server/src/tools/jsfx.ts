import { z } from 'zod/v4';
import { trace } from '@opentelemetry/api';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getReaperEffectsPath } from '../bridge.js';
import { resolveAssetDir } from '../cli.js';
import { emitLog, getJsfxFindingsCounter } from '../telemetry.js';
import { logToolResult } from '../tool-log.js';
import { inlineToolkit, parseSliders, readVersion, stripGenerated, toolkitVersion, TOOLKIT_FILE, MAX_USER_SLIDERS, type SliderSpec } from '../jsfx/inline.js';
import { errorsOf, lintJsfx, warningsOf, widgetCounts, type LintFinding } from '../jsfx/lint.js';
import { parseAccent, readAccentToken, resolveAccent, type AccentKind } from '../jsfx/accent.js';
import { encodePreset, resolvePresets, writePresetFile, MAX_PRESETS, MAX_PRESET_NAME, type PresetInput } from '../jsfx/presets.js';

/**
 * write_jsfx: writes a generated plugin as one self-contained .jsfx file in
 * `<REAPER>/Effects/reaper-mcp-generated/`. TS-only: no bridge command, nothing changes in REAPER (the
 * skill loads the plugin afterwards with add_fx). The file has no dependency on this server or the bridge.
 *
 * Telemetry (TELEMETRY.md): the span carries the outcome and the plugin's SHAPE as closed values and capped
 * counts. Never the plugin's name, the request, the source or any slider label: those describe what the user
 * is making. The history of a plugin and its source stay on the user's disk.
 */

export const GENERATED_DIR = 'reaper-mcp-generated';
export const OUTCOMES = ['written', 'refused_lint', 'refused_breaking', 'refused_exists', 'refused_name', 'refused_presets', 'refused_accent', 'failed'] as const;
export type WriteOutcome = (typeof OUTCOMES)[number];

const MAX_SOURCE = 128 * 1024;
const MAX_VERSION = 20;

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
}

export function generatedDir(): string {
  return join(getReaperEffectsPath(), GENERATED_DIR);
}

/** REAPER's preset folder (<resource>/presets), next to Effects/. */
export function presetsDir(): string {
  return join(dirname(getReaperEffectsPath()), 'presets');
}


/** Old versions of a plugin live here, never in Effects/, so REAPER does not scan them. */
export function historyDir(slug: string): string {
  return join(process.env.REAPER_MCP_CONFIG_DIR || join(homedir(), '.config', 'reaper-mcp'), 'jsfx-history', slug);
}

let _toolkit: string | undefined;
export function loadToolkit(): string {
  if (_toolkit) return _toolkit;
  const dir = resolveAssetDir(dirname(fileURLToPath(import.meta.url)), 'reaper');
  _toolkit = readFileSync(join(dir, TOOLKIT_FILE), 'utf8');
  return _toolkit;
}

function sizeBucket(bytes: number): string {
  const kb = bytes / 1024;
  return kb < 8 ? '<8k' : kb < 16 ? '8-16k' : kb < 32 ? '16-32k' : kb < 64 ? '32-64k' : '64k+';
}

export interface ShapeInput {
  outcome: WriteOutcome;
  overwrite: boolean;
  sliders?: number;
  widgets?: { core: number; advanced: number };
  bytes?: number;
  version?: number;
  toolkit?: string;
  findings?: LintFinding[];
  presets?: number;
  accent?: AccentKind;
}

/** Everything that may reach a span: closed values and capped counts. Exported so a test can pin it. */
export function shapeAttributes(s: ShapeInput): Record<string, string | number | boolean> {
  const cap = (n: number, max: number) => Math.min(Math.max(0, Math.floor(n)), max);
  return {
    'reaper.jsfx.outcome': s.outcome,
    'reaper.jsfx.overwrite': s.overwrite,
    ...(s.sliders !== undefined ? { 'reaper.jsfx.sliders': cap(s.sliders, MAX_USER_SLIDERS) } : {}),
    ...(s.widgets ? { 'reaper.jsfx.widgets.core': cap(s.widgets.core, 16), 'reaper.jsfx.widgets.advanced': cap(s.widgets.advanced, 16) } : {}),
    ...(s.bytes !== undefined ? { 'reaper.jsfx.size': sizeBucket(s.bytes) } : {}),
    ...(s.version !== undefined ? { 'reaper.jsfx.version': cap(s.version, MAX_VERSION) } : {}),
    ...(s.toolkit ? { 'reaper.jsfx.toolkit_version': s.toolkit } : {}),
    ...(s.presets !== undefined ? { 'reaper.jsfx.presets': cap(s.presets, MAX_PRESETS) } : {}),
    ...(s.accent ? { 'reaper.jsfx.accent': s.accent } : {}),
    ...(s.findings ? { 'reaper.jsfx.lint.errors': cap(errorsOf(s.findings).length, 20), 'reaper.jsfx.lint.warnings': cap(warningsOf(s.findings).length, 20) } : {}),
  };
}

function record(shape: ShapeInput): void {
  trace.getActiveSpan()?.setAttributes(shapeAttributes(shape));
  for (const f of shape.findings ?? []) {
    getJsfxFindingsCounter().add(1, { 'reaper.jsfx.lint.rule': f.rule, 'reaper.jsfx.lint.severity': f.severity });
  }
}

/** The existing slider an edit changed in range, step or option count: saved automation would point at the wrong thing. */
export function breakingChanges(before: SliderSpec[], after: SliderSpec[]): string[] {
  const out: string[] = [];
  for (const old of before) {
    const now = after.find((s) => s.index === old.index);
    if (!now) out.push(`slider${old.index} "${old.name}" was removed`);
    else if (now.min !== old.min || now.max !== old.max || now.step !== old.step || now.options.length !== old.options.length) {
      out.push(`slider${old.index} "${old.name}" changed range, step or options`);
    }
  }
  return out;
}

export interface WriteArgs {
  name: string;
  source: string;
  request?: string;
  overwrite?: boolean;
  breaking?: boolean;
  presets?: PresetInput[];
  /** 'auto', a name (orange, teal, ...) or #rrggbb; left out = keep the plugin's current accent */
  accent?: string;
}

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };
const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });
const fmt = (f: LintFinding) => `- ${f.severity}${f.line ? ` (line ${f.line})` : ''} [${f.rule}]: ${f.message}`;

export function writeJsfx(input: WriteArgs): ToolResult {
  // a file this tool wrote can come back as the source of an edit: drop what it added, it is re-added below
  const args = { ...input, source: stripGenerated(input.source) };
  const overwrite = args.overwrite === true;
  const slug = slugify(args.name);
  if (!slug) {
    record({ outcome: 'refused_name', overwrite });
    return text('Error: the name needs at least one letter or digit (it becomes the file name).', true);
  }

  // the accent: checked before anything else is looked at, so a bad one writes nothing
  let accentToken: string | undefined;
  if (args.accent !== undefined) {
    const parsed = parseAccent(args.accent);
    if ('error' in parsed) {
      record({ outcome: 'refused_accent', overwrite });
      return text(`Error: nothing was written: ${parsed.error}.`, true);
    }
    accentToken = parsed.kind === 'auto' ? 'auto' : parsed.token;
  }

  const dir = generatedDir();
  const path = join(dir, `${slug}.jsfx`);
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  // no accent given: keep the one the source carries, else the one the plugin already has
  accentToken ??= readAccentToken(input.source) ?? (existing !== undefined ? readAccentToken(existing) : undefined);
  const accent = resolveAccent(slug, accentToken === 'auto' ? undefined : accentToken);
  if (existing !== undefined && !overwrite) {
    record({ outcome: 'refused_exists', overwrite });
    return text(`Error: ${slug}.jsfx already exists. Pass overwrite: true to replace it (the old file is kept in the history), or pick another name.`, true);
  }

  const findings = lintJsfx(args.source);
  const sliders = parseSliders(args.source).sliders;
  const widgets = widgetCounts(args.source);
  const toolkit = loadToolkit();
  const shape = { overwrite, sliders: sliders.length, widgets, bytes: Buffer.byteLength(args.source), toolkit: toolkitVersion(toolkit), findings, accent: accent.kind };

  if (errorsOf(findings).length) {
    record({ ...shape, outcome: 'refused_lint' });
    emitLog('warn', 'write_jsfx refused: lint errors', { 'reaper.jsfx.outcome': 'refused_lint', 'reaper.jsfx.lint.rules': [...new Set(errorsOf(findings).map((f) => f.rule))].join(',') });
    return text(`Error: nothing was written, fix these and call write_jsfx again:\n${findings.map(fmt).join('\n')}`, true);
  }

  if (existing !== undefined && !args.breaking) {
    const broken = breakingChanges(parseSliders(existing).sliders, parseSliders(args.source).sliders);
    if (broken.length) {
      record({ ...shape, outcome: 'refused_breaking' });
      emitLog('warn', 'write_jsfx refused: breaking slider change', { 'reaper.jsfx.outcome': 'refused_breaking', 'reaper.jsfx.breaking_count': broken.length });
      return text(`Error: nothing was written. This would break automation saved in projects that use the plugin:\n${broken.map((b) => `- ${b}`).join('\n')}\nKeep existing sliders as they are and add new ones at the end, or pass breaking: true if that is intended.`, true);
    }
  }

  // presets: every value checked against the new sliders before anything is written
  const resolved = args.presets ? resolvePresets(args.presets, sliders) : undefined;
  if (resolved?.errors.length) {
    record({ ...shape, outcome: 'refused_presets' });
    emitLog('warn', 'write_jsfx refused: invalid presets', { 'reaper.jsfx.outcome': 'refused_presets', 'reaper.jsfx.presets': Math.min(args.presets?.length ?? 0, MAX_PRESETS) });
    return text(`Error: nothing was written, fix these presets and call write_jsfx again:\n${resolved.errors.map((e) => `- ${e}`).join('\n')}`, true);
  }

  const version = existing !== undefined ? readVersion(existing) + 1 : 1;
  const history = historyDir(slug);
  const manifestPath = join(history, 'presets.json');
  let presets: { file: string; written: string[]; keptUserEdits: string[]; removed?: boolean } | undefined;
  try {
    if (existing !== undefined) {
      mkdirSync(history, { recursive: true });
      copyFileSync(path, join(history, `${readVersion(existing) || 0}.jsfx`));
      if (existsSync(manifestPath)) copyFileSync(manifestPath, join(history, `${readVersion(existing) || 0}.presets.json`));
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, inlineToolkit(args.source, { toolkit, version, request: args.request, accent: accent.token ?? 'auto', slug, date: new Date().toISOString().slice(0, 10) }));
    const effectPath = `${GENERATED_DIR}/${slug}.jsfx`;
    if (resolved && args.presets) {
      presets = writePresetFile(presetsDir(), effectPath, args.presets.map((p, i) => encodePreset(p.name.trim(), resolved.values[i])), manifestPath);
    } else if (existing !== undefined && args.breaking && existsSync(manifestPath)) {
      // the sliders changed meaning: our old presets would load wrong values, so they go
      presets = { ...writePresetFile(presetsDir(), effectPath, [], manifestPath), removed: true };
    }
  } catch (err) {
    record({ ...shape, outcome: 'failed' });
    throw err; // the tool wrapper marks the span failed and logs it
  }

  record({ ...shape, outcome: 'written', version, ...(presets ? { presets: presets.written.length } : {}) });
  return text(JSON.stringify({
    path,
    fxName: `${GENERATED_DIR}/${slug}`,
    version,
    accent: { color: accent.hex, kind: accent.kind },
    sliders: sliders.map((s) => ({ index: s.index, name: s.name, min: s.min, max: s.max, default: s.default, hidden: s.hidden })),
    ...(presets ? { presets: {
      file: presets.file,
      written: presets.written,
      ...(presets.keptUserEdits.length ? { keptUserEdits: presets.keptUserEdits } : {}),
      ...(args.presets && presets.written.length < args.presets.length ? { skipped: args.presets.map((p) => p.name.trim()).filter((n) => !presets?.written.includes(n)), why: 'a preset of yours already has that name; it was left as it is' } : {}),
      ...(presets.removed ? { removed: 'breaking: the earlier suggested presets were removed (their values meant something else); pass presets again' } : {}),
    } } : {}),
    warnings: warningsOf(findings).map(fmt),
    next: 'remove_fx and add_fx the plugin again on the scratch track (a loaded instance does not recompile). JSFX code does not run until audio is processed, so a plugin that failed to compile loads fine and does nothing: prove it runs by measuring its output against bypass',
  }, null, 2));
}

export function registerJsfxTools(server: McpServer): void {
  server.tool(
    'write_jsfx',
    'Write a generated REAPER plugin (JSFX) as one self-contained file in Effects/reaper-mcp-generated/. Give the plugin source (header, ' +
      'unnamed sliders, @init/@slider/@block/@sample, a @gfx section using the ui_* toolkit): the toolkit is inlined for you, the file is linted first ' +
      'and nothing is written when a rule fails. Use it from the /make-plugin skill. The plugin works without this server or the bridge. ' +
      'An existing slider is never renumbered or re-ranged without breaking: true (saved automation would break). Old versions are kept outside Effects/.',
    {
      name: z.string().min(1).max(60).describe('The plugin\'s display name, e.g. "Mutate Verb". Becomes the file name (lowercase, dashes).'),
      source: z.string().min(1).max(MAX_SOURCE).describe('The plugin source, with or without the import line. May be a file this tool wrote earlier, edited: the old toolkit block is replaced.'),
      request: z.string().max(300).optional().describe('One line of what the user asked for. Written as a comment in the file only; never sent anywhere.'),
      overwrite: z.boolean().optional().describe('Replace an existing plugin of that name (version + 1; the old file goes to the history)'),
      breaking: z.boolean().optional().describe('Allow an existing slider to change range, step or options, or to be removed'),
      accent: z.string().max(20).optional().describe('The plugin\'s accent colour: "auto" (from its name, the default), a name (blue, teal, green, amber, orange, red, pink, violet) or "#rrggbb". Leave it out to keep the current one. To recolour a plugin, call again with only this changed.'),
      presets: z.array(z.object({
        name: z.string().min(1).max(MAX_PRESET_NAME).describe('2-3 words that say the intent, e.g. "Ghost tails"'),
        values: z.record(z.string(), z.coerce.number()).describe('Slider index ("3") or label ("Mix") → value in the slider\'s own units (dB, Hz, 0..1, option index). Sliders left out take their default.'),
      })).max(MAX_PRESETS).optional().describe(`Suggested presets (3-5, at most ${MAX_PRESETS}) that teach how the plugin is meant to be used. They appear in the plugin's preset dropdown; presets the user saved are kept. Every value is checked against its slider: one bad value refuses the whole call.`),
    },
    async (args) => {
      const startedAt = Date.now();
      try {
        const result = writeJsfx(args);
        const slug = slugify(args.name);
        const body = result.isError ? undefined : (JSON.parse(result.content[0].text) as { version: number; sliders: unknown[] });
        logToolResult('write_jsfx', { name: slug, overwrite: args.overwrite === true }, startedAt,
          body ? { name: args.name, slug, version: body.version, sliders: body.sliders.length, ...widgetCounts(args.source), ...(args.presets ? { presets: args.presets.length } : {}) } : null,
          result.isError ? result.content[0].text : undefined);
        return result;
      } catch (err) {
        logToolResult('write_jsfx', { name: slugify(args.name) }, startedAt, null, err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
  );
}
