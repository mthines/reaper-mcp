import { z } from 'zod/v4';
import type { ExtensionApi, ExtensionModule, FxState, ToolResult } from '@reaper-mcp/extension-api';
import { makeVitalState, samplePatch } from './vital-state.js';
import type { VitalPatch } from '../state.js';

export interface FakeFx {
  name: string;
  state: Uint8Array;
}

/**
 * The extension API as the server hands it out, with REAPER replaced by a list of FX per track. Tool inputs
 * go through the tool's own zod shape, as the MCP server does, so a bad argument is refused the same way.
 */
export function fakeApi(tracks: Record<number, FakeFx[]>) {
  const tools: Record<string, { run: (raw: Record<string, unknown>) => Promise<ToolResult> }> = {};
  const writes: { trackIndex: number; fxIndex: number }[] = [];
  const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], ...(isError && { isError }) });

  const api = {
    name: 'vital',
    apiVersion: 1,
    z,
    tool: (name: string, _d: string, shape: Record<string, z.ZodType>, handler: (a: never) => Promise<ToolResult> | ToolResult) => {
      tools[name] = { run: async (raw) => handler(z.object(shape).parse(raw) as never) };
    },
    bridge: async (command: string, params: Record<string, unknown> = {}) => {
      if (command !== 'get_track_properties') return { success: false, error: `unexpected command ${command}` };
      const fx = tracks[params['trackIndex'] as number];
      if (!fx) return { success: false, error: `Track ${String(params['trackIndex'])} not found` };
      return { success: true, data: { fxList: fx.map((f, index) => ({ index, name: f.name })) } };
    },
    call: async () => ({ success: false, error: 'no lua' }),
    fxState: {
      get: async (loc: { trackIndex: number; fxIndex: number }) => {
        const fx = tracks[loc.trackIndex]?.[loc.fxIndex];
        if (!fx) return { ok: false as const, error: `FX ${loc.fxIndex} not found` };
        const value: FxState = { name: fx.name, format: 'vst3', header: new Uint8Array(44), state: fx.state };
        return { ok: true as const, value };
      },
      set: async (loc: { trackIndex: number; fxIndex: number }, state: Uint8Array, opts?: { expectName?: string }) => {
        const fx = tracks[loc.trackIndex]?.[loc.fxIndex];
        if (!fx) return { ok: false as const, error: `FX ${loc.fxIndex} not found` };
        if (opts?.expectName && !fx.name.includes(opts.expectName)) return { ok: false as const, error: 'wrong FX' };
        fx.state = state;
        writes.push(loc);
        return { ok: true as const, value: { name: fx.name } };
      },
    },
    reply: (res: { success: boolean; data?: unknown; error?: string }) => (res.success ? text(JSON.stringify(res.data)) : text(`Error: ${res.error}`, true)),
    json: (data: unknown) => text(JSON.stringify(data, null, 2)),
    error: (message: string) => text(`Error: ${message}`, true),
    describeCategory: () => undefined,
  } as unknown as ExtensionApi;

  return {
    api,
    writes,
    async load(extension: ExtensionModule) {
      await extension.register(api);
    },
    /** Run a tool; returns its parsed JSON, or { error } for an error result. */
    async call(tool: string, args: Record<string, unknown>) {
      const res = await tools[tool].run(args);
      const body = res.content[0].text;
      return res.isError ? { error: body.replace(/^Error: /, '') } : (JSON.parse(body) as Record<string, unknown>);
    },
  };
}

export const vitalFx = (patch: VitalPatch = samplePatch(), name = 'VST3i: Vital (Vital Audio)'): FakeFx => ({ name, state: makeVitalState(patch) });
