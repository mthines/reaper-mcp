/**
 * What align_audio_to_guide answers the agent, through a stubbed bridge and sidecar.
 * The bridge's own behaviour is tested in mixing-lib.test.ts, the pairing in align.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bridge.js', () => ({ sendCommand: vi.fn() }));
vi.mock('../sidecar.js', () => ({ getSidecarClient: vi.fn() }));

import { sendCommand } from '../bridge.js';
import { getSidecarClient } from '../sidecar.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAlignTools } from './align.js';

const sendCommandMock = vi.mocked(sendCommand);
type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };
type ToolCallback = (params: Record<string, unknown>) => Promise<ToolResult>;

function tool(n: string): ToolCallback {
  const tools: Record<string, ToolCallback> = {};
  registerAlignTools({ tool: (t: string, _d: string, _s: unknown, cb: ToolCallback) => { tools[t] = cb; } } as unknown as McpServer);
  return tools[n];
}
const json = (r: ToolResult) => JSON.parse(r.content[0].text);
const ok = (data: unknown) => ({ id: 't', success: true, data, timestamp: 0 });
const fail = (error: string) => ({ id: 't', success: false, error, timestamp: 0 });

// Guide on track 0 at project 10 s, doubles on tracks 1 and 2 at the same spot
const ITEMS: Record<string, Record<string, unknown>> = {
  '0': { isMidi: false, sourceFile: '/a/guide.wav', startOffset: 0, playRate: 1, length: 6, position: 10 },
  '1': { isMidi: false, sourceFile: '/a/double1.wav', startOffset: 0, playRate: 1, length: 6, position: 10 },
  '2': { isMidi: false, sourceFile: '/a/double2.wav', startOffset: 0, playRate: 1, length: 6, position: 10 },
};
const HITS: Record<string, { time: number; strength: number; band?: string }[]> = {
  '/a/guide.wav': [{ time: 1.0, strength: 0.9 }, { time: 2.0, strength: 0.8 }, { time: 3.0, strength: 0.7 }],
  '/a/double1.wav': [{ time: 1.08, strength: 0.9, band: 'high' }, { time: 2.1, strength: 0.8 }, { time: 2.95, strength: 0.7 }],
  '/a/double2.wav': [{ time: 4.5, strength: 0.9 }], // nowhere near the guide
};

function setup(opts: { available?: boolean; guideMarkers?: number } = {}) {
  const client = {
    isAvailable: () => opts.available ?? true,
    transients: vi.fn(async ({ path }: { path: string }) => ({ transients: HITS[path] })),
  };
  vi.mocked(getSidecarClient).mockReturnValue(client as unknown as ReturnType<typeof getSidecarClient>);
  const sent: { type: string; params: Record<string, unknown> }[] = [];
  sendCommandMock.mockImplementation(async (type, params) => {
    const p = params as Record<string, unknown>;
    sent.push({ type, params: p });
    if (type === 'get_media_item_properties') return ok(ITEMS[String(p['trackIndex'])]);
    if (type === 'get_stretch_markers') return ok({ total: opts.guideMarkers ?? 0, markers: [] });
    if (type === 'align_audio_to_guide') {
      return ok({ placed: 3, moved: 3, dryRun: p['dryRun'], offsetBefore: { avgMs: 78, maxMs: 100 }, offsetAfter: { avgMs: 0, maxMs: 0 } });
    }
    return ok({});
  });
  return { client, sent };
}

beforeEach(() => {
  sendCommandMock.mockReset();
  vi.mocked(getSidecarClient).mockReset();
});

const GUIDE = { trackIndex: 0, itemIndex: 0 };
// The tool's schema defaults (a stubbed registration skips zod, so the test applies them)
const DEFAULTS = { strength: 1, maxShiftMs: 120, protectConsonants: true, consonantMs: 80, dryRun: false, sensitivity: 0.5, minGapMs: 60, minStrength: 0.2 };
const align = (params: Record<string, unknown>) => tool('align_audio_to_guide')({ ...DEFAULTS, ...params });

describe('align_audio_to_guide', () => {
  it('pairs the double\'s hits with the guide\'s and returns the bridge\'s offset before and after', async () => {
    const { sent } = setup();
    const res = await align({ guide: GUIDE, doubles: [{ trackIndex: 1, itemIndex: 0 }], protectConsonants: false });
    expect(res.isError).toBeUndefined();
    const out = json(res);
    expect(out.aligned).toBe(1);
    // the offset after is smaller than before
    expect(out.results[0].offsetAfter.avgMs).toBeLessThan(out.results[0].offsetBefore.avgMs);
    const write = sent.find((s) => s.type === 'align_audio_to_guide');
    expect(JSON.parse(String(write?.params['pairs']))).toEqual([
      { src: 1.08, to: 11 }, { src: 2.1, to: 12 }, { src: 2.95, to: 13 },
    ]);
    expect(write?.params['guideTrackIndex']).toBe(0);
  });

  it('dry run is passed through, so the bridge reports the plan and writes nothing', async () => {
    const { sent } = setup();
    const res = await align({ guide: GUIDE, doubles: [{ trackIndex: 1, itemIndex: 0 }], dryRun: true });
    expect(json(res).dryRun).toBe(true);
    expect(sent.find((s) => s.type === 'align_audio_to_guide')?.params['dryRun']).toBe(true);
  });

  it('gives a high-band hit a rigid tail unless protectConsonants is off', async () => {
    const { sent } = setup();
    await align({ guide: GUIDE, doubles: [{ trackIndex: 1, itemIndex: 0 }], protectConsonants: true, consonantMs: 80 });
    const pairs = JSON.parse(String(sent.find((s) => s.type === 'align_audio_to_guide')?.params['pairs']));
    expect(pairs.filter((p: { extra?: boolean }) => p.extra)).toHaveLength(1);
  });

  it('aligns several doubles and reports each; one that cannot be aligned does not stop the others', async () => {
    setup();
    const res = await align({ guide: GUIDE, doubles: [{ trackIndex: 1, itemIndex: 0 }, { trackIndex: 2, itemIndex: 0 }] });
    expect(res.isError).toBeUndefined();
    const out = json(res);
    expect(out.aligned).toBe(1);
    expect(out.failed).toBe(1);
    expect(out.results[0].ok).toBe(true);
    expect(out.results[1].ok).toBe(false);
    expect(out.results[1].error).toMatch(/within 120 ms/);
  });

  it('reports an error when no double could be aligned', async () => {
    setup();
    const res = await align({ guide: GUIDE, doubles: [{ trackIndex: 2, itemIndex: 0 }] });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Nothing aligned');
  });

  it('refuses a guide with stretch markers and writes nothing', async () => {
    const { sent } = setup({ guideMarkers: 3 });
    const res = await align({ guide: GUIDE, doubles: [{ trackIndex: 1, itemIndex: 0 }] });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('stretch markers');
    expect(sent.some((s) => s.type === 'align_audio_to_guide')).toBe(false);
  });

  it('says the sidecar is missing when it is not installed', async () => {
    setup({ available: false });
    const res = await align({ guide: GUIDE, doubles: [{ trackIndex: 1, itemIndex: 0 }] });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('setup-sidecar');
  });

  it('passes a bridge refusal for a double through as that double\'s error', async () => {
    setup();
    sendCommandMock.mockImplementation(async (type, params) => {
      const p = params as Record<string, unknown>;
      if (type === 'get_media_item_properties') return ok(ITEMS[String(p['trackIndex'])]);
      if (type === 'get_stretch_markers') return ok({ total: 0 });
      return fail('No hit could be placed — nothing changed');
    });
    const res = await align({ guide: GUIDE, doubles: [{ trackIndex: 1, itemIndex: 0 }] });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('No hit could be placed');
  });
});
