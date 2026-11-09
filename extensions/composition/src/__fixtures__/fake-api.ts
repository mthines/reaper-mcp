import { z } from 'zod/v4';
import type { ExtensionApi, ExtensionModule, ToolResult } from '@reaper-mcp/extension-api';

export interface FakeItem {
  position: number;
  length: number;
  notes: { pitch: number; velocity: number; startPosition: number; duration: number }[];
}

/** The extension API as the server hands it out, with REAPER replaced by tracks that hold MIDI items. */
export function fakeApi(opts: { tempo?: number; tracks?: Record<number, FakeItem[]> } = {}) {
  const tracks = opts.tracks ?? { 0: [] };
  const tools: Record<string, (raw: Record<string, unknown>) => Promise<ToolResult>> = {};
  const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], ...(isError && { isError }) });

  const api = {
    name: 'composition',
    apiVersion: 1,
    z,
    tool: (name: string, _d: string, shape: Record<string, z.ZodType>, handler: (a: never) => Promise<ToolResult> | ToolResult) => {
      tools[name] = async (raw) => handler(z.object(shape).parse(raw) as never);
    },
    bridge: async (command: string, raw: Record<string, unknown> = {}) => {
      const p = raw as { trackIndex: number; itemIndex: number; startPosition: number; endPosition: number; notes: FakeItem['notes'] };
      if (command === 'get_project_info') return { success: true, data: { tempo: opts.tempo ?? 120 } };
      const items = tracks[p.trackIndex];
      if (!items) return { success: false, error: `Track ${p.trackIndex} not found` };
      if (command === 'create_midi_item') {
        items.push({ position: p.startPosition, length: p.endPosition - p.startPosition, notes: [] });
        return { success: true, data: { itemIndex: items.length - 1 } };
      }
      const item = items[p.itemIndex];
      if (!item) return { success: false, error: `Item ${p.itemIndex} not found` };
      if (command === 'get_midi_item_properties') return { success: true, data: { length: item.length } };
      if (command === 'insert_midi_notes') {
        item.notes.push(...p.notes);
        return { success: true, data: { inserted: p.notes.length } };
      }
      return { success: false, error: `unexpected command ${command}` };
    },
    call: async () => ({ success: false, error: 'no lua' }),
    reply: (res: { success: boolean; data?: unknown; error?: string }) => (res.success ? text(JSON.stringify(res.data)) : text(`Error: ${res.error}`, true)),
    json: (data: unknown) => text(JSON.stringify(data, null, 2)),
    error: (message: string) => text(`Error: ${message}`, true),
    describeCategory: () => undefined,
  } as unknown as ExtensionApi;

  return {
    api,
    tracks,
    async load(extension: ExtensionModule) {
      await extension.register(api);
    },
    /** Run a tool; returns its parsed JSON, or { error } for an error result. */
    async call(tool: string, args: Record<string, unknown>) {
      const res = await tools[tool](args);
      const body = res.content[0].text;
      return res.isError ? { error: body.replace(/^Error: /, '') } : (JSON.parse(body) as Record<string, any>); // eslint-disable-line @typescript-eslint/no-explicit-any
    },
  };
}
