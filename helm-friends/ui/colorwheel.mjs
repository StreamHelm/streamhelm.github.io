// The HSV colour wheel (DESIGN §10): a hue ring around a saturation/value square, a value slider, H/S/V number boxes,
// a hex box, quick presets and recently used colours. Fully keyboard operable: on the ring ←/→ (or ↑/↓) move the hue
// by 1 (Shift: 10); on the square ←/→ move saturation and ↑/↓ value. Colours are CONTRACTS HSV objects.

import { hsvToRgb, rgbToHsv, clampHsv } from '../core/index.mjs';
import { h } from './h.mjs';
import { safeStorage } from './store.mjs';
import { announce, trapFocus } from './a11y.mjs';

const PAD = 240, R_OUT = 118, R_IN = 92, SQ = 116, SQ0 = (PAD - SQ) / 2;
const RECENT_KEY = 'hf.recentColors';

export const toHex = (c) => '#' + hsvToRgb(c).map((x) => x.toString(16).padStart(2, '0')).join('');
export function fromHex(s) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(s).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return rgbToHsv([(n >> 16) & 255, (n >> 8) & 255, n & 255]);
}
export const cssColor = (c) => toHex(clampHsv(c));
export const describeHsv = (c) => `hue ${c.h}, saturation ${c.s}, value ${c.v}`;

/** Recently used colours (most recent first, max 8). */
export function recentColors() { return safeStorage.getJson(RECENT_KEY, []).filter((c) => c && typeof c.h === 'number').slice(0, 8); }
function remember(c) {
  const list = [c, ...recentColors().filter((x) => toHex(x) !== toHex(c))].slice(0, 8);
  safeStorage.setJson(RECENT_KEY, list);
}

/**
 * The wheel itself (an element you can put anywhere). onChange fires on every change (live preview).
 * @param {{ value:Object, onChange:(hsv:Object)=>void, presets?:{name:string, hsv:Object}[], label?:string }} o
 */
export function colorWheel({ value, onChange, presets = [], label = 'Colour' }) {
  let c = clampHsv(value);
  const ringCv = h('canvas', { width: PAD, height: PAD, 'aria-hidden': 'true' });
  const sqCv = h('canvas', { width: SQ, height: SQ, 'aria-hidden': 'true', class: 'cw-sq-canvas' });
  sqCv.style.left = SQ0 + 'px'; sqCv.style.top = SQ0 + 'px'; sqCv.style.width = SQ + 'px'; sqCv.style.height = SQ + 'px';
  const hueKnob = h('span', { class: 'cw-knob' }), svKnob = h('span', { class: 'cw-knob' });
  const ring = h('div', { class: 'cw-ring', role: 'slider', tabindex: 0, 'aria-label': `${label}: hue`, 'aria-valuemin': 0, 'aria-valuemax': 359, 'data-fk': 'cw-ring' });
  const square = h('div', { class: 'cw-square', role: 'slider', tabindex: 0, 'aria-label': `${label}: saturation and brightness`, 'aria-valuemin': 0, 'aria-valuemax': 100, 'data-fk': 'cw-square' });
  const pad = h('div', { class: 'cw-pad' }, ringCv, sqCv, ring, square, hueKnob, svKnob);
  const num = (k, max, name) => h('input', { type: 'number', min: 0, max, step: 1, inputmode: 'numeric', 'aria-label': name, 'data-cw': k,
    oninput: (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) set({ ...c, [k]: v }, { from: k }); } });
  const hIn = num('h', 359, 'Hue (0 to 359)'), sIn = num('s', 100, 'Saturation (0 to 100)'), vIn = num('v', 100, 'Value / brightness (0 to 100)');
  const hexIn = h('input', { type: 'text', maxlength: 7, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Hex colour code',
    onchange: (e) => { const x = fromHex(e.target.value); if (x) set(x, { from: 'hex' }); else e.target.value = toHex(c); } });
  const vSlider = h('input', { type: 'range', min: 0, max: 100, step: 1, class: 'cw-value', 'aria-label': 'Brightness', oninput: (e) => set({ ...c, v: Number(e.target.value) }, { from: 'slider' }) });
  const swatchRow = (title, list) => list.length ? h('div', { class: 'swatches', role: 'group', 'aria-label': title },
    h('span', { class: 'small muted' }, title),
    list.map((p) => {
      const hsv = p.hsv || p, name = p.name || toHex(hsv);
      const b = h('button', { type: 'button', class: 'swatch small', 'aria-label': `${title}: ${name}`, title: name, onclick: () => set(hsv) });
      b.style.background = toHex(hsv);
      return b;
    })) : null;

  const el = h('div', { class: 'cw' }, pad, vSlider,
    h('div', { class: 'cw-nums' },
      h('label', null, 'H', hIn), h('label', null, 'S', sIn), h('label', null, 'V', vIn), h('label', null, 'Hex', hexIn)),
    swatchRow('Presets', presets), swatchRow('Recent', recentColors()));

  drawRing();
  sync();

  function set(next, { from = null, quiet = false } = {}) {
    c = clampHsv(next, c);
    sync(from);
    if (!quiet) onChange(c);
  }
  function sync(from) {
    const a = ((c.h - 90) * Math.PI) / 180, rm = (R_OUT + R_IN) / 2;
    hueKnob.style.left = PAD / 2 + Math.cos(a) * rm + 'px'; hueKnob.style.top = PAD / 2 + Math.sin(a) * rm + 'px';
    hueKnob.style.background = toHex({ h: c.h, s: 100, v: 100 });
    svKnob.style.left = SQ0 + (c.s / 100) * SQ + 'px'; svKnob.style.top = SQ0 + (1 - c.v / 100) * SQ + 'px';
    svKnob.style.background = toHex(c);
    ring.setAttribute('aria-valuenow', c.h); ring.setAttribute('aria-valuetext', `hue ${c.h} degrees`);
    square.setAttribute('aria-valuenow', c.s); square.setAttribute('aria-valuetext', `saturation ${c.s}, brightness ${c.v}`);
    if (from !== 'h') hIn.value = c.h;
    if (from !== 's') sIn.value = c.s;
    if (from !== 'v') vIn.value = c.v;
    if (from !== 'hex') hexIn.value = toHex(c);
    if (from !== 'slider') vSlider.value = c.v;
    drawSquare();
  }
  function drawRing() {
    const x = ringCv.getContext('2d');
    for (let d = 0; d < 360; d++) {
      x.beginPath();
      x.strokeStyle = toHex({ h: d, s: 100, v: 100 });
      x.lineWidth = R_OUT - R_IN;
      const a0 = ((d - 90.6) * Math.PI) / 180, a1 = ((d - 89.4 + 0.6) * Math.PI) / 180;
      x.arc(PAD / 2, PAD / 2, (R_OUT + R_IN) / 2, a0, a1);
      x.stroke();
    }
  }
  function drawSquare() {
    const x = sqCv.getContext('2d');
    x.fillStyle = toHex({ h: c.h, s: 100, v: 100 }); x.fillRect(0, 0, SQ, SQ);
    const w = x.createLinearGradient(0, 0, SQ, 0); w.addColorStop(0, '#fff'); w.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = w; x.fillRect(0, 0, SQ, SQ);
    const b = x.createLinearGradient(0, 0, 0, SQ); b.addColorStop(0, 'rgba(0,0,0,0)'); b.addColorStop(1, '#000');
    x.fillStyle = b; x.fillRect(0, 0, SQ, SQ);
  }

  // pointer: drag on the ring (hue) or the square (s/v)
  const local = (e) => { const r = pad.getBoundingClientRect(); const k = PAD / r.width; return [(e.clientX - r.left) * k, (e.clientY - r.top) * k]; };
  const hueAt = (e) => { const [x, y] = local(e); return Math.round(((Math.atan2(y - PAD / 2, x - PAD / 2) * 180) / Math.PI + 90 + 360) % 360) % 360; };
  const svAt = (e) => { const [x, y] = local(e); return { s: Math.round(Math.max(0, Math.min(1, (x - SQ0) / SQ)) * 100), v: Math.round(Math.max(0, Math.min(1, 1 - (y - SQ0) / SQ)) * 100) }; };
  const drag = (target, fn) => {
    target.addEventListener('pointerdown', (e) => {
      e.preventDefault(); target.focus(); target.setPointerCapture(e.pointerId); fn(e);
      const move = (m) => fn(m), up = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); };
      target.addEventListener('pointermove', move); target.addEventListener('pointerup', up);
    });
  };
  drag(ring, (e) => set({ ...c, h: hueAt(e) }));
  drag(square, (e) => set({ ...c, ...svAt(e) }));

  const keys = (target, map) => target.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 10 : 1, f = map[e.key];
    if (!f) return;
    e.preventDefault();
    set(f(step));
    announce(target === ring ? `Hue ${c.h}` : `Saturation ${c.s}, brightness ${c.v}`);
  });
  keys(ring, {
    ArrowRight: (s) => ({ ...c, h: (c.h + s) % 360 }), ArrowUp: (s) => ({ ...c, h: (c.h + s) % 360 }),
    ArrowLeft: (s) => ({ ...c, h: (c.h - s + 360) % 360 }), ArrowDown: (s) => ({ ...c, h: (c.h - s + 360) % 360 }),
    PageUp: () => ({ ...c, h: (c.h + 30) % 360 }), PageDown: () => ({ ...c, h: (c.h + 330) % 360 }),
    Home: () => ({ ...c, h: 0 }), End: () => ({ ...c, h: 359 }),
  });
  keys(square, {
    ArrowRight: (s) => ({ ...c, s: c.s + s }), ArrowLeft: (s) => ({ ...c, s: c.s - s }),
    ArrowUp: (s) => ({ ...c, v: c.v + s }), ArrowDown: (s) => ({ ...c, v: c.v - s }),
    Home: () => ({ ...c, s: 0 }), End: () => ({ ...c, s: 100 }),
  });

  return { el, get: () => c, set: (v) => set(v, { quiet: true }), remember: () => remember(c) };
}

/**
 * The wheel in a modal dialog with Done / Cancel. onInput gets every change (live preview); onClose(hsv|null) gets the
 * final colour, or null when cancelled (the caller restores the original).
 * @param {{ title:string, value:Object, presets?:Object[], onInput:(c:Object)=>void, onClose:(c:Object|null)=>void }} o
 */
export function openColorDialog({ title, value, presets = [], onInput, onClose }) {
  const original = clampHsv(value);
  let done = false;
  // closing blurs a text box, which can fire one last 'change': ignore anything after Done / Cancel
  const wheel = colorWheel({ value: original, presets, label: title, onChange: (c) => { if (!done) onInput(c); } });
  const finish = (ok) => {
    if (done) return; done = true;
    if (ok) wheel.remember(); else onInput(original);
    dlg.close(); dlg.remove();
    onClose(ok ? wheel.get() : null);
  };
  const heading = h('h2', { id: 'cw-title' }, title);
  const dlg = h('dialog', { class: 'hf-dialog', 'aria-labelledby': 'cw-title' },
    heading, wheel.el,
    h('div', { class: 'cw-actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => finish(false) }, 'Cancel'),
      h('button', { type: 'button', class: 'btn primary', 'data-cw-done': '1', onclick: () => finish(true) }, 'Done')));
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); });
  document.body.append(dlg);
  trapFocus(dlg);   // v1.14: Tab stays inside, focus returns to the opener
  dlg.showModal();
  dlg.querySelector('.cw-ring').focus();
  return { dialog: dlg, wheel, close: finish };
}
