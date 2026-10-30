import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { dragDrawerWidth, parseDrawerFraction, drawerFractionFromWidth, drawerWidthBounds, drawerWidthCss, drawerWidthPx, keyboardDrawerWidth } from './drawer-width.js';

const STORAGE_KEY = 'mcp_bridge.drawer_width';

/** The sidebar width every details drawer shares, kept per viewer as a fraction of the viewport. */
export function useDrawerWidth(): { fraction: number | null; style: { width: string }; setFraction: (f: number | null) => void } {
  const [fraction, set] = useState<number | null>(() => {
    try {
      return parseDrawerFraction(localStorage.getItem(STORAGE_KEY));
    } catch {
      return null;
    }
  });
  const setFraction = useCallback((f: number | null) => {
    set(f);
    try {
      if (f === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, String(f));
    } catch {
      // per-viewer convenience only
    }
  }, []);
  return { fraction, style: { width: drawerWidthCss(fraction) }, setFraction };
}

// A pointer must travel this far before a press becomes a drag (a double-click jitters a pixel or two)
const DRAG_THRESHOLD_PX = 3;
const RESIZE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

/**
 * The draggable left edge of a details sidebar, a WAI-ARIA window splitter: drag it, or focus it and use
 * ← / → (Shift for bigger steps), Home / End; double-click resets the width. During a gesture it writes the
 * drawer's style.width directly and commits once at the end, so the drawer doesn't re-render per pointer move.
 */
export function ResizeHandle({ fraction, onCommit }: { fraction: number | null; onCommit: (fraction: number | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number; moved: boolean } | null>(null);
  const pending = useRef<number | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const drawer = () => ref.current?.closest<HTMLElement>('.drawer') ?? null;

  const show = (next: number) => {
    const el = drawer();
    if (!el) return;
    pending.current = next;
    el.style.width = drawerWidthCss(next);
    setPreview(next);
  };

  const revert = () => {
    pending.current = null;
    setPreview(null);
    const el = drawer();
    if (el) el.style.width = drawerWidthCss(fraction);
  };

  const commit = () => {
    const next = pending.current;
    if (next === null) return;
    const vw = window.innerWidth;
    // A drag that ended where it began, or an arrow at a bound: nothing to store
    if (Math.round(drawerWidthPx(next, vw)) === Math.round(drawerWidthPx(fraction, vw))) return revert();
    pending.current = null;
    setPreview(null);
    onCommit(next);
  };

  const onPointerDown = (ev: PointerEvent<HTMLDivElement>) => {
    if (ev.button !== 0 || !ev.isPrimary || drag.current) return;
    const el = drawer();
    if (!el) return;
    ev.preventDefault(); // no text selection, and focus stays where it was
    try {
      ev.currentTarget.setPointerCapture(ev.pointerId);
    } catch {
      // pointer no longer active; the drag still works over the handle
    }
    drag.current = { pointerId: ev.pointerId, startX: ev.clientX, startWidth: el.getBoundingClientRect().width, moved: false };
    setDragging(true);
  };

  const onPointerMove = (ev: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== ev.pointerId) return;
    if (!d.moved && Math.abs(ev.clientX - d.startX) < DRAG_THRESHOLD_PX) return;
    d.moved = true;
    show(drawerFractionFromWidth(dragDrawerWidth(d.startWidth, d.startX, ev.clientX), window.innerWidth));
  };

  const endDrag = (ev: PointerEvent<HTMLDivElement>, outcome: 'commit' | 'revert') => {
    const d = drag.current;
    if (!d || d.pointerId !== ev.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (ev.currentTarget.hasPointerCapture(ev.pointerId)) ev.currentTarget.releasePointerCapture(ev.pointerId);
    if (outcome === 'commit') commit();
    else revert();
  };

  const onKeyDown = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return; // browser back and text shortcuts
    const vw = window.innerWidth;
    const next = keyboardDrawerWidth(ev.key, ev.shiftKey, drawerWidthPx(pending.current ?? fraction, vw), vw);
    if (next === null) return;
    ev.preventDefault();
    ev.stopPropagation(); // the list's ↑/↓ and the page shortcuts stay out of it
    show(drawerFractionFromWidth(next, vw));
  };

  const vw = typeof window === 'undefined' ? 0 : window.innerWidth;
  const bounds = drawerWidthBounds(vw);
  const now = Math.round(drawerWidthPx(preview ?? fraction, vw));

  return (
    <div
      ref={ref}
      className="resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={Math.round(bounds.min)}
      aria-valuemax={Math.round(bounds.max)}
      aria-valuenow={now}
      aria-valuetext={`${now} pixels wide`}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      data-resizing={dragging ? '' : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(ev) => endDrag(ev, 'commit')}
      onPointerCancel={(ev) => endDrag(ev, 'revert')}
      onLostPointerCapture={(ev) => endDrag(ev, 'commit')}
      onDoubleClick={() => {
        pending.current = null;
        setPreview(null);
        if (fraction !== null) onCommit(null);
      }}
      onKeyDown={onKeyDown}
      onKeyUp={(ev) => RESIZE_KEYS.has(ev.key) && commit()}
      onBlur={() => !drag.current && commit()}
    />
  );
}
