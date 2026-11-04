import { z } from 'zod/v4';
import type { ExtensionApi, ExtensionModule, ToolResult } from '@reaper-mcp/extension-api';

type Bridge = (command: string, params: Record<string, unknown>) => { success: boolean; data?: unknown; error?: string };

/** The extension API with REAPER replaced by `bridge`. Tool input goes through the tool's own zod shape. */
export function fakeApi(bridge: Bridge = () => ({ success: false, error: 'no reaper' })) {
  const tools: Record<string, (raw: Record<string, unknown>) => Promise<ToolResult>> = {};
  const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], ...(isError && { isError }) });
  const api = {
    name: 'helix', apiVersion: 1, z,
    tool: (name: string, _d: string, shape: Record<string, z.ZodType>, handler: (a: never) => Promise<ToolResult> | ToolResult) => {
      tools[name] = async (raw) => handler(z.object(shape).parse(raw) as never);
    },
    bridge: async (c: string, p: Record<string, unknown> = {}) => bridge(c, p),
    call: async () => ({ success: false, error: 'no lua' }),
    fxState: {},
    reply: (r: { success: boolean; data?: unknown; error?: string }) => (r.success ? text(JSON.stringify(r.data)) : text(`Error: ${r.error}`, true)),
    json: (d: unknown) => text(JSON.stringify(d, null, 2)),
    error: (m: string) => text(`Error: ${m}`, true),
    describeCategory: () => undefined,
  } as unknown as ExtensionApi;
  return {
    async load(ext: ExtensionModule) { await ext.register(api); },
    async call(tool: string, args: Record<string, unknown>) {
      const res = await tools[tool](args);
      const body = res.content[0].text;
      if (res.isError) return { error: body.replace(/^Error: /, '') };
      try { return JSON.parse(body) as Record<string, unknown>; } catch { return { text: body }; }
    },
  };
}
