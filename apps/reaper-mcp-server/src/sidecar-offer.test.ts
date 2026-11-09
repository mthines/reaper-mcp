import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { offerSidecarSetup } from './sidecar-offer.js';

/** A terminal that answers `answer` (or closes without one) and records what setup printed. */
function terminal(answer: string | null, interactive = true) {
  const input = new PassThrough();
  const output = new PassThrough();
  let printed = '';
  output.on('data', (d: Buffer) => { printed += d.toString(); });
  setImmediate(() => (answer === null ? input.end() : input.end(`${answer}\n`)));
  return { io: { input, output, interactive }, printed: () => printed };
}

describe('offerSidecarSetup', () => {
  it('installs the sidecar when the person says yes', async () => {
    const t = terminal('y');
    const install = vi.fn(async () => undefined);

    expect(await offerSidecarSetup(t.io, false, install)).toBe('installed');
    expect(install).toHaveBeenCalled();
    expect(t.printed()).toContain('Audio analysis needs the Python sidecar');
  });

  it.each(['', 'n', null])('installs nothing on "%s" and says how to add it later', async (answer) => {
    const t = terminal(answer);
    const install = vi.fn(async () => undefined);

    expect(await offerSidecarSetup(t.io, false, install)).toBe('declined');
    expect(install).not.toHaveBeenCalled();
    expect(t.printed()).toContain('Add it any time: reaper-mcp setup-sidecar');
  });

  it('asks nothing without a terminal, only says how to add it', async () => {
    const t = terminal(null, false);
    const install = vi.fn(async () => undefined);

    expect(await offerSidecarSetup(t.io, false, install)).toBe('told');
    expect(install).not.toHaveBeenCalled();
    expect(t.printed()).not.toContain('[y/N]');
    expect(t.printed()).toContain('Add it any time: reaper-mcp setup-sidecar');
  });

  it('says nothing when the sidecar is already installed', async () => {
    const t = terminal('y');

    expect(await offerSidecarSetup(t.io, true, async () => undefined)).toBe('present');
    expect(t.printed()).toBe('');
  });
});
