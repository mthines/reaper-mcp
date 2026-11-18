import type { CommandEntry } from './commands.js';

/** The command that installs the Python sidecar's default parts */
export const SETUP_SIDECAR_COMMAND = 'reaper-mcp setup-sidecar';

/** Tools that run in the sidecar: a success from one means it is installed */
const SIDECAR_TOOLS = new Set([
  'analyze_track_offline', 'analyze_audio_file', 'measure_track_alignment', 'verify_edit', 'analyze_track_aesthetics',
  'analyze_loudness_curve', 'analyze_stereo_bands', 'measure_masking', 'separate_stems', 'detect_key', 'detect_chords',
  'transcribe_voice_sketch', 'detect_transients', 'create_transient_automation', 'align_audio_to_guide', 'quantize_audio',
]);

/** Whether an error says the sidecar, or a part of it, is not installed (mirrors `isSidecarMissing` in the server's sidecar-hint.ts) */
export function isSidecarMissing(text: string | undefined): boolean {
  return !!text && /sidecar not installed|needs the Python sidecar|(?:audiobox-aesthetics|Stem separation|chord model|FluidSynth native library)[^.]*(?:is )?not installed/i.test(text);
}

/** The install line an error names (`reaper-mcp setup-sidecar --with-separation`), else the plain command */
export function sidecarFixCommand(text: string): string {
  return text.match(/reaper-mcp setup-sidecar(?: --[\w-]+)*/)?.[0] ?? SETUP_SIDECAR_COMMAND;
}

/** The bridge request that installs what a failed tool asked for */
export function sidecarAction(command: string): 'sidecar' | 'sidecarsep' | 'sidecarchords' {
  if (command.includes('--with-separation')) return 'sidecarsep';
  if (command.includes('--with-chords')) return 'sidecarchords';
  return 'sidecar';
}

/**
 * The sidecar's missing part to tell the user about: the newest failure that says so, unless a sidecar tool
 * has worked since (`recent` is newest first).
 */
export function missingSidecar(recent: CommandEntry[]): { command: string; tool: string } | null {
  for (const e of recent) {
    if (!e.ok && isSidecarMissing(e.e)) return { command: sidecarFixCommand(e.e ?? ''), tool: e.c };
    if (e.ok && SIDECAR_TOOLS.has(e.c)) return null;
  }
  return null;
}
