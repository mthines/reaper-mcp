// Geometry for the resizable details sidebar, ported from LoreKit's memory panel (mthines/lorekit#728).
// The width is kept as a fraction of the viewport, so it scales between screens, and is clamped to
// max(320px, 15vw) .. 70vw.

export const DRAWER_MIN_WIDTH_PX = 320;
export const DRAWER_MIN_VIEWPORT_FRACTION = 0.15;
export const DRAWER_MAX_VIEWPORT_FRACTION = 0.7;
export const DRAWER_DEFAULT_WIDTH_PX = 400;
export const DRAWER_KEYBOARD_STEP_PX = 32;
export const DRAWER_KEYBOARD_LARGE_STEP_PX = 128;

export function drawerWidthBounds(viewportWidth: number): { min: number; max: number } {
  const min = Math.max(DRAWER_MIN_WIDTH_PX, viewportWidth * DRAWER_MIN_VIEWPORT_FRACTION);
  return { min, max: Math.max(min, viewportWidth * DRAWER_MAX_VIEWPORT_FRACTION) };
}

export function clampDrawerWidth(widthPx: number, viewportWidth: number): number {
  const { min, max } = drawerWidthBounds(viewportWidth);
  return Math.min(max, Math.max(min, widthPx));
}

/** The rendered width for a stored fraction (`null` = the default width). */
export function drawerWidthPx(fraction: number | null, viewportWidth: number): number {
  return clampDrawerWidth(fraction === null ? DRAWER_DEFAULT_WIDTH_PX : fraction * viewportWidth, viewportWidth);
}

export function drawerFractionFromWidth(widthPx: number, viewportWidth: number): number {
  if (viewportWidth <= 0) return 0;
  return Math.round((clampDrawerWidth(widthPx, viewportWidth) / viewportWidth) * 10_000) / 10_000;
}

/** The CSS width: the same clamp in CSS, so the drawer follows the window without a re-render. */
export function drawerWidthCss(fraction: number | null): string {
  const preferred = fraction === null ? `${DRAWER_DEFAULT_WIDTH_PX}px` : `${Math.round(fraction * 10_000) / 100}vw`;
  return `clamp(max(${DRAWER_MIN_WIDTH_PX}px, ${DRAWER_MIN_VIEWPORT_FRACTION * 100}vw), ${preferred}, ${DRAWER_MAX_VIEWPORT_FRACTION * 100}vw)`;
}

/** The drawer is on the right, so dragging its left edge leftwards widens it. */
export function dragDrawerWidth(startWidthPx: number, startX: number, clientX: number): number {
  return startWidthPx + (startX - clientX);
}

export function keyboardDrawerWidth(key: string, shiftKey: boolean, currentWidthPx: number, viewportWidth: number): number | null {
  const step = shiftKey ? DRAWER_KEYBOARD_LARGE_STEP_PX : DRAWER_KEYBOARD_STEP_PX;
  const { min, max } = drawerWidthBounds(viewportWidth);
  switch (key) {
    case 'ArrowLeft':
      return clampDrawerWidth(currentWidthPx + step, viewportWidth);
    case 'ArrowRight':
      return clampDrawerWidth(currentWidthPx - step, viewportWidth);
    case 'Home':
      return min;
    case 'End':
      return max;
    default:
      return null;
  }
}

/** A stored fraction, or `null` for anything that isn't one (missing, corrupt, out of range). */
export function parseDrawerFraction(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : null;
}
