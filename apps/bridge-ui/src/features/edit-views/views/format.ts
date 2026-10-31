import type { ChangeRow, SlotChange } from '../edit-views.js';
import { fmt } from '../../measurements/index.js';

export const pct = (v: number, min: number, max: number) =>
  max === min ? 0 : Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100));
const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];
export const noteName = (p: number) =>
  `${NOTE_NAMES[p % 12]}${Math.floor(p / 12) - 1}`;
export const clock = (s: number, digits = 0) => {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(digits).padStart(digits ? digits + 3 : 2, "0")}`;
};
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** A number with at most two decimals and a real minus sign */
export const plain = (n: number) => String(+n.toFixed(2)).replace("-", "−");
/** "VST3: Pro-Q 3 (FabFilter)" → "Pro-Q 3"; the full name stays in the tooltip */
export const fxShort = (name: string) =>
  name.replace(/^[A-Z0-9]+i?:\s*/, "").replace(/\s*\([^()]*\)$/, "") || name;
/** A mark's own colour, else one of the page's six hues by position */
export const hueOf = (hex: string, i: number) => hex || `var(--h${i % 6})`;

/** The word a list row carries for what this call did to it */
export const CHANGE_WORD: Record<SlotChange, string> = {
  new: "added",
  moved: "moved",
  changed: "changed",
};
/** "+1 −1" when the call added or removed entries, else how many it changed or moved */
export const changedText = (added: number, removed: number, touched: number) =>
  added || removed ? `+${added} −${removed}` : String(touched);
const BOOL_WORDS: Record<string, [string, string]> = {
  mute: ["on", "muted"],
  solo: ["off", "soloed"],
  recordArm: ["off", "armed"],
  phase: ["normal", "inverted"],
  Freeze: ["live", "frozen"],
};
export const PROP_LABEL: Record<string, string> = {
  volume: "Volume",
  pan: "Pan",
  mute: "Mute",
  solo: "Solo",
  recordArm: "Record arm",
  phase: "Phase",
};
export const panText = (v: number) =>
  Math.abs(v) < 0.005
    ? "C"
    : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? "L" : "R"}`;

export function valueText(
  r: ChangeRow,
  v: number | undefined,
  text: string | undefined,
): string {
  if (v === undefined) return "–";
  switch (r.s) {
    case "db":
      return `${fmt(v)} dB`;
    case "pan":
      return panText(v);
    case "bool":
      return text || (BOOL_WORDS[r.p] ?? ["off", "on"])[v ? 1 : 0];
    case "norm":
      return text || `${Math.round(v * 100)}%`;
  }
}

/** Where a value sits on its row's bar: volume on the meters' −60..+6 dB scale, pan −1..1, the rest 0..1 */
export const barPos = (r: ChangeRow, v: number) =>
  r.s === "db" ? pct(v, -60, 6) : r.s === "pan" ? pct(v, -1, 1) : pct(v, 0, 1);
