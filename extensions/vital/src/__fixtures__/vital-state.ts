import type { VitalPatch } from '../state.js';

const u32be = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];

/**
 * A Vital state laid out as measured on a real instance (2026-11-04): 32 bytes of REAPER wrapper, then a
 * `CcnK` bank (byte size to the end of the state, `FBCh`, version, fxID `Vita`, fxVersion, programs, 120
 * reserved bytes, chunk size), the JSON and a 32-byte trailer (the chunk), then 8 more bytes.
 */
export function makeVitalState(patch: VitalPatch): Uint8Array {
  const json = Buffer.from(JSON.stringify(patch), 'utf8');
  const trailer = new Uint8Array(32);
  trailer.set(Buffer.from('JUCEPrivateData'), 8);
  const chunk = [...json, ...trailer];
  const bankBody = [
    ...Buffer.from('FBCh'), ...u32be(2), ...Buffer.from('Vita'), ...u32be(0x00010505), ...u32be(0),
    ...new Array(120).fill(0), ...u32be(chunk.length),
  ];
  const extra = new Array(8).fill(0);
  const wrapper = new Array(32).fill(0);
  wrapper.splice(8, 4, ...Buffer.from('VstW'));
  return Uint8Array.from([
    ...wrapper, ...Buffer.from('CcnK'), ...u32be(bankBody.length + chunk.length + extra.length), ...bankBody, ...chunk, ...extra,
  ]);
}

/** A small but structurally complete patch. */
export function samplePatch(): VitalPatch {
  const mods = Array.from({ length: 64 }, () => ({ source: '', destination: '' }));
  mods[0] = { source: 'velocity', destination: 'osc_1_level' };
  const settings: VitalPatch['settings'] = {
    osc_1_level: 0.7071067690849304,
    osc_1_on: 1,
    osc_2_level: 0.5,
    osc_2_on: 0,
    osc_3_on: 0,
    filter_1_cutoff: 80,
    filter_1_on: 1,
    wavetables: [0, 1, 2].map((i) => ({ name: `Init ${i + 1}`, author: '', groups: [{ components: [{ type: 'Wave Source', keyframes: [{ position: 0, wave_data: 'AAAA' }] }] }] })),
    lfos: Array.from({ length: 8 }, (_, i) => ({ name: 'Triangle', num_points: 3, points: [0, 1, 0.5, 0, 1, 1], powers: [0, 0, 0], smooth: i === 7 })),
    modulations: mods,
  };
  for (let i = 1; i <= 64; i++) {
    for (const k of ['amount', 'bipolar', 'bypass', 'power', 'stereo']) settings[`modulation_${i}_${k}`] = 0;
  }
  settings['modulation_1_amount'] = 1;
  return { author: 'test', comments: '', macro1: 'MACRO 1', macro2: 'MACRO 2', macro3: 'MACRO 3', macro4: 'MACRO 4', preset_name: 'Init', preset_style: '', settings, synth_version: '1.5.5' };
}
