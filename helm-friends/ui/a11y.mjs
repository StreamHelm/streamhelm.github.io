// Accessibility helpers: a polite live region, focus restore across re-renders, and the WCAG contrast maths the
// tests use to check the palette.

import { h } from './h.mjs';

let region = null;

/** The screen-reader announcer (one per page). */
export function liveRegion() {
  if (!region || !region.isConnected) {
    region = h('div', { class: 'sr-only', 'aria-live': 'polite', 'aria-atomic': 'true', id: 'hf-announcer' });
    document.body.append(region);
  }
  return region;
}

/** Says `text` to screen readers (politely, without moving focus). */
export function announce(text) {
  const r = liveRegion();
  r.textContent = '';
  // a fresh text node in the next frame makes repeated identical messages be read again
  requestAnimationFrame(() => { r.textContent = String(text); });
}

/**
 * Re-renders `fn()` into `container` and puts focus back on the element that had it, matched by `data-fk`
 * (screens re-render on every change; this keeps keyboard users where they were).
 */
export function renderKeepingFocus(container, fn) {
  const active = document.activeElement;
  const key = active && container.contains(active) ? active.dataset.fk : null;
  const sel = active && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
  fn();
  if (!key) return;
  const again = container.querySelector(`[data-fk="${CSS.escape(key)}"]`);
  if (again && again !== document.activeElement) {
    again.focus({ preventScroll: true });
    if (sel && 'setSelectionRange' in again) { try { again.setSelectionRange(sel[0], sel[1]); } catch { /* not a text input */ } }
  }
}

/**
 * v1.14: keeps Tab / Shift+Tab inside a modal (a native <dialog> makes the page inert, but Tab past the last control
 * still leaves for the browser's own UI) and gives focus back to whatever opened it when it closes.
 * @param {HTMLDialogElement} dlg
 */
export function trapFocus(dlg) {
  const opener = document.activeElement;
  const focusables = () => [...dlg.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((e) => !e.disabled && e.getClientRects().length);
  dlg.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const list = focusables();
    if (!list.length) return;
    const first = list[0], last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  const fk = opener && opener.dataset ? opener.dataset.fk : null;
  dlg.addEventListener('close', () => setTimeout(() => {
    if (document.querySelector('dialog[open]') || (document.activeElement && document.activeElement !== document.body)) return;   // someone already moved focus on purpose
    // the screen may have re-rendered while the dialog was open: find the same control again by its focus key
    const back = opener && opener.isConnected ? opener : fk ? document.querySelector(`[data-fk="${CSS.escape(fk)}"]`) : null;
    if (back && typeof back.focus === 'function') back.focus({ preventScroll: true });
  }, 0));
}

/** Relative luminance of '#rrggbb'. */
export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** WCAG contrast ratio between two '#rrggbb' colours. */
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** True when the viewer asked for less motion. */
export function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
