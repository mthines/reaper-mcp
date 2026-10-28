import type { KnowledgeFeed, PluginRecord } from './plugins.js';

// Fixture for the Plugins view in `?demo`: the real built-in records (as of 2026-10-27), a few learned ones,
// and an installed list shaped like a typical setup.

const day = 86_400_000;
const now = Date.now();

const builtIn = (
  key: string,
  name: string,
  vendor: string,
  category: string,
  preference: number,
  style: string,
  matches: string[],
  what: string,
): PluginRecord => ({ key, name, vendor, category, preference, style, matches, layer: 'built-in', updatedAt: now - 0.4 * day, preview: what });

const RECORDS: PluginRecord[] = [
  builtIn('plugins::fabfilter/pro-q-3', 'FabFilter Pro-Q 3', 'FabFilter', 'eq', 90, 'transparent', ['Pro-Q 3', 'VST3: Pro-Q3 (FabFilter)'], 'Surgical and musical parametric EQ with dynamic bands, linear phase and M/S. First choice for corrective and tonal EQ.'),
  builtIn('plugins::fabfilter/pro-c-2', 'FabFilter Pro-C 2', 'FabFilter', 'compressor', 85, 'transparent', ['Pro-C 2', 'VST3: Pro-C2 (FabFilter)'], 'Versatile compressor with eight styles from clean to vintage; sidechain EQ and lookahead.'),
  builtIn('plugins::fabfilter/pro-l-2', 'FabFilter Pro-L 2', 'FabFilter', 'limiter', 92, 'transparent', ['Pro-L 2', 'VST3: Pro-L2 (FabFilter)'], 'True-peak limiter for mastering with loudness metering; preferred for the final stage.'),
  builtIn('plugins::line-6/helix-native', 'Line 6 Helix Native', 'Line 6', 'amp-sim', 82, 'character', ['Helix Native', 'VST3: Helix Native (Line 6)'], 'Full Helix amp and effects modeller. Amp controls live in its GUI; the host sees only Knob/Switch controllers, Master In/Out and Snapshot Index (1-8). Save a full-chunk snapshot before changing presets.'),
  builtIn('plugins::joey-sturgis-tones/jst-heat', 'JST Heat', 'Joey Sturgis Tones', 'saturator', 80, 'character', ['JST Heat', 'VST3: JST Heat (Joey Sturgis Tones)'], 'Saturation and harmonic exciter for guitars, bass and drum buses.'),
  builtIn('plugins::stock-reaper/rea-eq', 'ReaEQ', 'Cockos', 'eq', 40, 'transparent', ['ReaEQ', 'VST: ReaEQ (Cockos)'], "REAPER's built-in parametric EQ. Fallback when no third-party EQ is installed."),
  builtIn('plugins::stock-reaper/rea-comp', 'ReaComp', 'Cockos', 'compressor', 35, 'transparent', ['ReaComp', 'VST: ReaComp (Cockos)'], "REAPER's built-in compressor with sidechain filtering."),
  builtIn('plugins::stock-reaper/rea-limit', 'ReaLimit', 'Cockos', 'limiter', 38, 'transparent', ['ReaLimit', 'VST: ReaLimit (Cockos)'], "REAPER's built-in brickwall limiter."),
  builtIn('plugins::stock-reaper/rea-verb', 'ReaVerb', 'Cockos', 'reverb', 32, 'transparent', ['ReaVerb', 'VST: ReaVerb (Cockos)'], 'Convolution and algorithmic reverb.'),
  builtIn('plugins::stock-reaper/rea-delay', 'ReaDelay', 'Cockos', 'delay', 38, 'transparent', ['ReaDelay', 'VST: ReaDelay (Cockos)'], 'Multi-tap delay with tempo sync.'),
  builtIn('plugins::stock-reaper/rea-gate', 'ReaGate', 'Cockos', 'gate', 40, 'transparent', ['ReaGate', 'VST: ReaGate (Cockos)'], 'Noise gate with sidechain and hysteresis.'),
  builtIn('plugins::stock-reaper/js-1175-compressor', 'JS 1175 Compressor', 'Cockos (JSFX)', 'compressor', 50, 'vintage', ['JS: Dynamics/1175_compressor'], '1176-style FET compressor in JSFX; fast attack for vocals and drums.'),
  {
    key: 'user::plugins::auburn-sounds/graillon-3',
    name: 'Graillon 3',
    vendor: 'Auburn Sounds',
    category: 'pitch',
    preference: 70,
    style: 'character',
    matches: ['Graillon 3', 'VST3: Graillon 3 (Auburn Sounds)'],
    layer: 'user',
    notes: 2,
    updatedAt: now - 5 * day,
    preview: 'Pitch correction and pitch shifting. Learned: correction amount 0.35 keeps it natural on the lead vocal; bypass on backing doubles.',
    source: {
      value: '# Graillon 3\n\n**Vendor:** Auburn Sounds\n\nPitch correction and pitch shifting.\n\n## Learned notes\n- Correction amount 0.35 keeps it natural on the lead vocal\n- Bypass on backing doubles',
      tags: ['plugin-knowledge', 'category::pitch', 'preference::70', 'style::character', 'fx::Graillon 3', 'layer::user'],
    },
  },
  {
    key: 'user::plugins::joey-sturgis-tones/gain-reduction-2',
    name: 'Gain Reduction 2',
    vendor: 'Joey Sturgis Tones',
    category: 'compressor',
    preference: 78,
    style: 'character',
    matches: ['Gain Reduction 2', 'VST3: Gain Reduction 2 (Joey Sturgis Tones)'],
    layer: 'user',
    notes: 1,
    updatedAt: now - 9 * day,
    preview: 'Aggressive vocal compressor. Learned: the "Vibe" knob above 0.6 gets harsh on screams.',
    source: {
      value: '# Gain Reduction 2\n\n**Vendor:** Joey Sturgis Tones\n\nAggressive vocal compressor.\n\n## Learned notes\n- The "Vibe" knob above 0.6 gets harsh on screams',
      tags: ['plugin-knowledge', 'category::compressor', 'preference::78', 'style::character', 'fx::Gain Reduction 2', 'layer::user'],
    },
  },
];

const INSTALLED = [
  'VST3: Pro-Q 3 (FabFilter)',
  'VST3: Helix Native (Line 6)',
  'VST3: JST Heat (Joey Sturgis Tones)',
  'VST3: Gain Reduction 2 (Joey Sturgis Tones)',
  'VST3: Howard Benson Vocals (Joey Sturgis Tones)',
  'VST3: Graillon 3 (Auburn Sounds)',
  'VST3: Melodyne (Celemony)',
  'VST3: ValhallaVintageVerb (Valhalla DSP, LLC)',
  'VST3: Clear (Supertone)',
  'VST3: Remix (Acon Digital)',
  'VST3: Kontakt 7 (Native Instruments)',
  'VST: ReaEQ (Cockos)',
  'VST: ReaComp (Cockos)',
  'VST: ReaLimit (Cockos)',
  'VST: ReaVerb (Cockos)',
  'VST: ReaDelay (Cockos)',
  'VST: ReaGate (Cockos)',
  'JS: Dynamics/1175_compressor',
];

// LoreKit row ids (as of 2026-10-27), so "Open in LoreKit" lands on the real record; the fake learned ones have none
const IDS: Record<string, string> = {
  'plugins::stock-reaper/rea-verb': 'ee3a7217-0792-4895-88f5-ae59ebc87af8',
  'plugins::stock-reaper/rea-limit': '180b5c17-b5f8-4a57-ac97-5b4f77629574',
  'plugins::stock-reaper/rea-gate': '1c197136-3a79-47a9-8995-2bad9d5a1d81',
  'plugins::stock-reaper/rea-eq': '1f6a6ac9-1f83-4d0c-897d-805beee735b1',
  'plugins::stock-reaper/rea-delay': 'c2eb218d-8138-41e3-a065-ebf3d8805160',
  'plugins::stock-reaper/rea-comp': 'f9fc42b5-a31e-4d15-a5de-0305474190b7',
  'plugins::stock-reaper/js-1175-compressor': '2a68dd7f-4dc4-4091-9b7a-5eab50f411ec',
  'plugins::line-6/helix-native': '52780449-21d4-4966-b3db-6f3be2edcbd7',
  'plugins::joey-sturgis-tones/jst-heat': '4deb8d5f-a12b-44a7-a642-19badf365035',
  'plugins::fabfilter/pro-q-3': '84daa88a-5e98-4e52-8cf2-bb3f14ce1a6f',
  'plugins::fabfilter/pro-l-2': '163ba4be-afe0-4253-bada-9c0731a74bc2',
  'plugins::fabfilter/pro-c-2': 'a583716f-b5b4-40cc-be25-bb010c79e3ee',
};

export const DEMO_KNOWLEDGE: KnowledgeFeed = {
  installed: INSTALLED.map((name) => ({ name, type: name.split(':')[0] })),
  records: RECORDS.map((r) => (IDS[r.key] ? { ...r, id: IDS[r.key] } : r)),
  // What the demo project has loaded
  used: [
    { name: 'VST3: Pro-Q3 (FabFilter)', count: 4 },
    { name: 'VST3: Helix Native (Line 6)', count: 2 },
    { name: 'VST3: Melodyne (Celemony)', count: 1 },
    { name: 'VST3: Kontakt 7 (Native Instruments)', count: 1 },
    { name: 'VST: ReaComp (Cockos)', count: 3 },
  ],
  // Pretends the viewer is a reaper-mcp org member, so ?demo shows the Publish flow without LoreKit
  publish: async (record, { removeCopy }) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    return { key: record.key.replace(/^user::/, ''), removedCopy: removeCopy };
  },
};
