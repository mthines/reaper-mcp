/**
 * Every generated plugin has its own accent colour: the knob value arc, hover and active states, the
 * Advanced title, the toggle's on state, the footer hover and a faint tint in the background. The toolkit
 * gets it once, as `ui_theme($xRRGGBB)` in the inlined metadata block.
 *
 * - auto (default): derived from the plugin's slug, so the same plugin always gets the same colour. The hue
 *   comes from a hash and skips the hues the toolkit uses for meaning (meter green, amber, red), at a fixed
 *   lightness and chroma (OKLCH) tuned for the dark UI.
 * - named: blue, teal, green, amber, orange, red, pink, violet, mapped to tuned values.
 * - custom: any `#rrggbb`.
 *
 * A named or custom accent is kept in the file as `// accent: orange` / `// accent: #ff8800`, so a later
 * write_jsfx without `accent` keeps it; `accent: "auto"` drops it.
 */

export type AccentKind = 'auto' | 'named' | 'custom';

export interface Accent {
  /** `#rrggbb`, lower case */
  hex: string;
  kind: AccentKind;
  /** What the file keeps in its `// accent:` line: the name or the hex. Absent for auto. */
  token?: string;
}

/** The page background the accent is drawn on (toolkit ui_cBg). */
export const ACCENT_BG = '#0e0f11';
/** Every accent must be at least this readable on the background (WCAG contrast ratio). */
export const MIN_ACCENT_CONTRAST = 7;

const L = 0.78;
const C = 0.13;
/** Hues (OKLCH degrees) of the toolkit's meaning colours: live #4ade80, warn #f5b84b, bad #f87171. */
const SEMANTIC = ['#4ade80', '#f5b84b', '#f87171'];
const AVOID = 22;

// ---- colour maths (OKLab, Björn Ottosson) -------------------------------------------------------

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255) as [number, number, number];
}

function rgbToHex(rgb: [number, number, number]): string {
  return '#' + rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
}

function oklchToLinear(l: number, c: number, h: number): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

function hueOf(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
}

/** OKLCH at the accent lightness, chroma lowered until it fits in sRGB. */
export function accentForHue(h: number): string {
  for (let c = C; c > 0; c -= 0.005) {
    const lin = oklchToLinear(L, c, h);
    if (lin.every((v) => v >= -0.0005 && v <= 1.0005)) return rgbToHex(lin.map(fromLinear) as [number, number, number]);
  }
  return rgbToHex(oklchToLinear(L, 0, h).map(fromLinear) as [number, number, number]);
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two colours (1..21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ---- the three kinds -----------------------------------------------------------------------------

export const NAMED_ACCENTS: Readonly<Record<string, string>> = Object.freeze({
  blue: '#7cc4ff', // the bridge page's own accent
  teal: accentForHue(195),
  green: accentForHue(150),
  amber: accentForHue(80),
  orange: accentForHue(55),
  red: accentForHue(25),
  pink: accentForHue(350),
  violet: accentForHue(300),
});

const ALLOWED_HUES: number[] = (() => {
  const semantic = SEMANTIC.map(hueOf);
  const out: number[] = [];
  for (let h = 0; h < 360; h++) {
    if (semantic.every((s) => Math.min(Math.abs(h - s), 360 - Math.abs(h - s)) > AVOID)) out.push(h);
  }
  return out;
})();

/** The hues a slug can land on (exported for tests: none near the meaning colours). */
export const autoHues = (): readonly number[] => ALLOWED_HUES;

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (const ch of text) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** The auto accent of a plugin: the same slug always gives the same colour. */
export function slugAccent(slug: string): string {
  return accentForHue(ALLOWED_HUES[fnv1a(slug) % ALLOWED_HUES.length]);
}

/** Reads a user's accent input. `auto` (or nothing) is the slug colour; an unknown name or bad hex is an error. */
export function parseAccent(input: string): { token?: string; kind: AccentKind } | { error: string } {
  const v = input.trim().toLowerCase();
  if (v === '' || v === 'auto') return { kind: 'auto' };
  if (NAMED_ACCENTS[v]) return { token: v, kind: 'named' };
  if (/^#[0-9a-f]{6}$/.test(v)) return { token: v, kind: 'custom' };
  return { error: `accent "${input}" is neither "auto", a name (${Object.keys(NAMED_ACCENTS).join(', ')}) nor a #rrggbb colour` };
}

/** The accent a plugin is drawn with: its kept token (name or hex), else the slug colour. */
export function resolveAccent(slug: string, token?: string): Accent {
  const parsed = token ? parseAccent(token) : { kind: 'auto' as const };
  if ('error' in parsed || parsed.kind === 'auto' || !parsed.token) return { hex: slugAccent(slug), kind: 'auto' };
  return parsed.kind === 'named'
    ? { hex: NAMED_ACCENTS[parsed.token], kind: 'named', token: parsed.token }
    : { hex: parsed.token, kind: 'custom', token: parsed.token };
}

/** The accent a file keeps (`// accent: orange`), or undefined. */
export function readAccentToken(text: string): string | undefined {
  const m = text.match(/^\/\/ accent: *(\S+)/m);
  if (!m) return undefined;
  const parsed = parseAccent(m[1]);
  return 'error' in parsed ? undefined : parsed.token;
}
