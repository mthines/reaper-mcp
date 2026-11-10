import { createInterface } from 'node:readline';
import { streamEnded } from './stream-ended.js';
import { SETUP_SIDECAR_COMMAND } from './sidecar-hint.js';

export interface OfferIO {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  /** A person at a terminal who can answer (TTY, not CI) */
  interactive: boolean;
}

export type SidecarOffer = 'present' | 'installed' | 'declined' | 'told';

export const SIDECAR_OFFER_TEXT =
  'Audio analysis needs the Python sidecar, which this setup does not install: analyze_audio_file, ' +
  'analyze_track_offline, detect_key and detect_chords on audio, detect_transients, separate_stems and the mix checks ' +
  'fail without it. It needs Python 3.10+ and downloads PyTorch (CPU) and audio libraries (~0.5-1 GB; up to ' +
  '~2.5 GB on Linux), then lets you pick the optional models.';

/**
 * The end of `reaper-mcp setup`. People who try an audio tool without the sidecar get a failure on their
 * first call, and some never make a second one, so setup offers it: one question in a terminal (default
 * no, since it downloads a lot), and without a terminal one line saying how to add it later.
 * @param install - Runs `setup-sidecar` (its own picker asks which parts).
 */
export async function offerSidecarSetup(io: OfferIO, installed: boolean, install: () => Promise<void>): Promise<SidecarOffer> {
  if (installed) return 'present';
  io.output.write(`\n${SIDECAR_OFFER_TEXT}\n`);
  if (!io.interactive) {
    io.output.write(`Add it any time: ${SETUP_SIDECAR_COMMAND}\n`);
    return 'told';
  }
  io.output.write('Set it up now? [y/N] ');
  // 'line' always fires before 'close'; Ctrl+D or a closed stdin counts as Enter (no), also when it closed before this question
  let answer = '';
  if (!streamEnded(io.input)) {
    const rl = createInterface({ input: io.input, output: io.output, terminal: false });
    answer = await new Promise<string>((resolve) => {
      rl.once('line', resolve);
      rl.once('close', () => resolve(''));
    }).then((a) => a.trim().toLowerCase());
    rl.close();
  }
  if (answer !== 'y' && answer !== 'yes') {
    io.output.write(`Skipped. Add it any time: ${SETUP_SIDECAR_COMMAND}\n`);
    return 'declined';
  }
  await install();
  return 'installed';
}
