import type { Preset } from '../hlx.js';

const flow = (model: string, extra: Record<string, unknown> = {}) => ({ '@model': model, ...extra });
const paths = (out0: number) => ({
  inputA: flow('HD2_AppDSPFlow1Input', { '@input': 1, noiseGate: false, decay: 0.5, threshold: -48 }),
  inputB: flow('HD2_AppDSPFlow2Input', { '@input': 0 }),
  outputA: flow('HD2_AppDSPFlowOutput', { '@output': out0 }),
  outputB: flow('HD2_AppDSPFlowOutput', { '@output': 0 }),
  split: flow('HD2_AppDSPFlowSplitY', { '@position': 0, '@enabled': true }),
  join: flow('HD2_AppDSPFlowJoin', { '@position': 8, '@enabled': true }),
});
const fx = (model: string, type: number, position: number, params: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  '@model': model, '@position': position, '@path': 0, '@type': type, '@enabled': true, '@no_snapshot_bypass': false, ...extra, ...params,
});

/** A small two-path donor: amp + dual cab + drive on path 1, delay + reverb + EQ on path 2. */
export function donor(): Preset {
  const snap = (name: string, valid: boolean) => ({
    '@name': name, '@valid': valid, '@tempo': 120, '@ledcolor': 1, '@pedalstate': 2,
    blocks: { dsp0: { block0: true, block1: true, block2: true }, dsp1: { block0: true, block1: true, block2: true } },
    controllers: {},
  });
  const tone: Record<string, unknown> = {
    dsp0: {
      ...paths(2),
      block0: fx('HD2_AmpArchetypeLead', 1, 3, { Drive: 0.5, Master: 0.4, ChVol: 0.5 }, { '@bypassvolume': 1 }),
      block1: fx('HD2_Cab4X12CaliV30', 4, 5, { LowCut: 80, HighCut: 8000 }, { '@cab': 'cab0', '@mic': 5 }),
      cab0: { '@model': 'HD2_Cab4X12CaliV30', '@mic': 15 },
      block2: fx('HD2_DistMinotaur', 0, 1, { Gain: 0.3, Level: 0.5 }),
    },
    dsp1: {
      ...paths(1),
      block0: fx('HD2_DelaySimpleDelay', 7, 3, { Time: 0.4, Mix: 0.3, Feedback: 0.4 }, { '@trails': false }),
      block1: fx('HD2_ReverbPlateaux', 7, 4, { Mix: 0.3, Decay: 0.5 }, { '@trails': false }),
      block2: fx('HD2_EQParametric', 0, 5, { LowCut: 80, HighCut: 8000, MidFreq: 1000, MidGain: 0 }),
    },
    global: { '@model': '@global_params', '@tempo': 120, '@current_snapshot': 0 },
    controller: {},
    footswitch: { dsp0: { block0: { '@fs_label': 'Archetype Lead', '@fs_index': 2 } } },
    variax: { '@model': '@variax' },
  };
  for (let i = 0; i < 8; i++) tone[`snapshot${i}`] = snap(`Snapshot ${i + 1}`, i < 2);
  return {
    schema: 'L6Preset', version: 6, meta: { original: 0 },
    data: { meta: { name: 'Donor', application: 'Helix Native' }, device: 2162944, device_version: 57737216, tone: tone as never },
  } as Preset;
}
