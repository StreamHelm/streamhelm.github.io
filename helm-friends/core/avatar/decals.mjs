// The jersey number (CONTRACTS §3.2 `wear.shirt.extra.number`, items tagged 'number'): one shared drawing rule for the
// reference compositor (devkit/hf-art/lib/compose.js), the overlay baker and the web editor preview, so the number
// looks the same everywhere. Pure pixels, no atlas: a 3×5 pixel digit set (narrow enough for the slimmest torso between the sleeves) in the jersey's colour 2 with a
// 1-px dark outline (colour 2's deepest ramp shade), centred on the chest anchor (front / back views only).
//
// Heights: the number is RIGID — draw it on the finished (height-stretched) frame, moved down by the rows the height
// inserted above its top row (core heightRows), never stretched. Clipping: only over pixels where the shirt's torso
// layer is the top-most layer before the height stretch (so it never sits on a bare arm, a bag or outside the shirt).

import { rampFor } from './compose.mjs';

/** 3×5 glyphs ('#' = ink). */
export const JERSEY_DIGITS = Object.freeze({
  0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['##.', '..#', '.#.', '#..', '###'],
  3: ['##.', '..#', '.#.', '..#', '##.'], 4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '##.', '..#', '##.'],
  6: ['.##', '#..', '###', '#.#', '###'], 7: ['###', '..#', '.#.', '.#.', '.#.'], 8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '##.'],
});
const GW = 3, GH = 5, ADV = 4;

/**
 * The number to print, or null (no shirt / not a numbered item / no number).
 * @param {Object} spec
 * @param {Object|null} shirtItem  the catalog item of spec.wear.shirt (needs `tags`)
 * @returns {string|null}  '0'..'99'
 */
export function jerseyNumberOf(spec, shirtItem) {
  const w = spec && spec.wear && spec.wear.shirt;
  if (!w || !shirtItem || !Array.isArray(shirtItem.tags) || !shirtItem.tags.includes('number') || shirtItem.lockedColors) return null;
  const raw = w.extra && w.extra.number != null ? String(w.extra.number) : '0';
  return /^\d{1,2}$/.test(raw) ? String(Number(raw)) : null;
}

/** The colour the number is drawn in: the shirt's colour 2 (the art's default when the spec has none). */
export function jerseyColorOf(spec, defaults = []) {
  const c = spec && spec.wear && spec.wear.shirt && spec.wear.shirt.colors;
  return (c && c[1]) || defaults[1] || { h: 0, s: 0, v: 96 };
}

/**
 * Where the number goes in the UNSTRETCHED frame (art pixels): { x, y, w, h } of the block incl. its outline, or null
 * for side views. `chest` = art.json anchors[prop][anim|dir].chest[f].
 */
export function jerseyBox(number, chest, dir) {
  if (!number || !chest || (dir !== 'front' && dir !== 'back')) return null;
  const n = number.length, w = n * ADV + 1, h = GH + 2;
  // placed 1 px left of and 4 px below the anchor: measured over every body proportion × idle / walk / cheer / dance /
  // victory / startled / sad frames, that keeps it clear of the sleeves (3/4 views), the collar and a dipping chin
  return { x: Math.round(chest[0] - w / 2) - 1, y: Math.round(chest[1] - h / 2) + 4, w, h };
}

/**
 * Draws the number into an RGBA buffer.
 * @param {Uint8ClampedArray|Uint8Array} dst  W×H RGBA (the finished frame)
 * @param {number} W
 * @param {number} H
 * @param {string} number
 * @param {{h,s,v}} color  colour 2 of the shirt
 * @param {{x,y,w,h}} box  from jerseyBox (unstretched coordinates)
 * @param {{ shift?:number, clip?:(x:number, y:number)=>boolean }} [o]  shift = rows to move down (heights); clip(x, y) in
 *   UNSTRETCHED coordinates → true where the shirt torso is visible
 * @returns {number} pixels drawn
 */
export function drawJerseyNumber(dst, W, H, number, color, box, o = {}) {
  if (!box) return 0;
  const ramp = rampFor(color, 6), ink = ramp[4], edge = ramp[0], shift = o.shift || 0, clip = o.clip || null;
  const cells = new Map();   // 'x,y' → 1 ink | 2 outline (unstretched, relative to box)
  [...number].forEach((ch, n) => {
    const g = JERSEY_DIGITS[ch]; if (!g) return;
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) if (g[j][i] === '#') cells.set(`${1 + n * ADV + i},${1 + j}`, 1);
  });
  for (const k of [...cells.keys()]) {
    const [x, y] = k.split(',').map(Number);
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) { const q = `${x + a},${y + b}`; if (!cells.has(q)) cells.set(q, 2); }
  }
  let drawn = 0;
  for (const [k, v] of cells) {
    const [cx, cy] = k.split(',').map(Number), ux = box.x + cx, uy = box.y + cy;
    if (clip && !clip(ux, uy)) continue;
    const X = ux, Y = uy + shift;
    if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
    const c = v === 1 ? ink : edge, i = (Y * W + X) * 4;
    dst[i] = c[0]; dst[i + 1] = c[1]; dst[i + 2] = c[2]; dst[i + 3] = 255; drawn++;
  }
  return drawn;
}

/** Rows a height inserts above unstretched row y (core heightRows output). */
export function rowsAbove(rows, y) {
  return (rows || []).filter((r) => r.y < y).reduce((s, r) => s + r.n, 0);
}
