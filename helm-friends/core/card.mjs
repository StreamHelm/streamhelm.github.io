// The Helm Friends profile card (v1.11, Discord `/helmcard`): your character + name, balance, title, check-in streak and
// bounty on one PNG-ready RGBA image. Pure: the character frame comes in as RGBA (core sprite.mjs composeFrame), the
// text is drawn with a built-in 5×7 pixel font, so the PC and the cloud render the same card with no browser and no fonts.
// Only public game facts go on it (display name, Dollahs, titles) — never ids, tokens or anything private.

import { fmt } from './format.mjs';

// 5×7 glyphs, one string of 35 bits (row by row) per character. Lowercase is drawn as uppercase.
const G = {
  A: '01110100011000111111100011000110001', B: '11110100011000111110100011000111110', C: '01110100011000010000100001000101110',
  D: '11110100011000110001100011000111110', E: '11111100001000011110100001000011111', F: '11111100001000011110100001000010000',
  G: '01110100011000010111100011000101111', H: '10001100011000111111100011000110001', I: '01110001000010000100001000010001110',
  J: '00111000100001000010000101001001100', K: '10001100101010011000101001001010001', L: '10000100001000010000100001000011111',
  M: '10001110111010110101100011000110001', N: '10001100011100110101100111000110001', O: '01110100011000110001100011000101110',
  P: '11110100011000111110100001000010000', Q: '01110100011000110001101011001001101', R: '11110100011000111110101001001010001',
  S: '01111100001000001110000010000111110', T: '11111001000010000100001000010000100', U: '10001100011000110001100011000101110',
  V: '10001100011000110001100010101000100', W: '10001100011000110101101011010101010', X: '10001100010101000100010101000110001',
  Y: '10001100010101000100001000010000100', Z: '11111000010001000100010001000011111',
  0: '01110100011001110101110011000101110', 1: '00100011000010000100001000010001110', 2: '01110100010000100010001000100011111',
  3: '11111000100010000010000011000101110', 4: '00010001100101010010111110001000010', 5: '11111100001111000001000011000101110',
  6: '00110010001000011110100011000101110', 7: '11111000010001000100010000100001000', 8: '01110100011000101110100011000101110',
  9: '01110100011000101111000010001001100', ' ': '0'.repeat(35), '.': '00000000000000000000000000110001100',
  ',': '00000000000000000000001100010001000', '!': '00100001000010000100001000000000100', '?': '01110100010000100010001000000000100',
  "'": '00100001000100000000000000000000000', '-': '00000000000000011111000000000000000', '+': '00000001000010011111001000010000000',
  ':': '00000011000110000000011000110000000', '×': '00000100010101000100010101000100000', '#': '01010010101111101010111110101001010',
  '%': '11000110010001000100010001001100011', '/': '00001000010001000100010001000010000', '∞': '00000000000101010101010100000000000',
  '_': '00000000000000000000000000000011111', '@': '01110100011011110101101111000001111',
};

/** Pixel width of `text` at `scale` (6 px per character incl. spacing). */
export const textWidth = (text, scale = 1) => String(text).length * 6 * scale - scale;

/** Fits text into `maxW` pixels at `scale` (cuts with "..."). */
export function fitText(text, maxW, scale) {
  let s = String(text ?? '');
  if (textWidth(s, scale) <= maxW) return s;
  while (s.length > 1 && textWidth(s + '...', scale) > maxW) s = s.slice(0, -1);
  return s + '...';
}

/** A blank RGBA image. */
export const image = (w, h) => ({ w, h, data: new Uint8ClampedArray(w * h * 4) });

function px(img, x, y, c) {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
  const i = (y * img.w + x) * 4, a = c[3] == null ? 255 : c[3];
  if (a >= 255) { img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255; return; }
  const k = a / 255;
  img.data[i] = Math.round(c[0] * k + img.data[i] * (1 - k)); img.data[i + 1] = Math.round(c[1] * k + img.data[i + 1] * (1 - k));
  img.data[i + 2] = Math.round(c[2] * k + img.data[i + 2] * (1 - k)); img.data[i + 3] = 255;
}
export function rect(img, x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(img, x + i, y + j, c); }

/** Draws text with the pixel font; returns the width drawn. */
export function text(img, s, x, y, scale, c) {
  let cx = x;
  for (const ch of String(s)) {
    const g = G[ch] || G[ch.toUpperCase()] || G['?'];
    for (let r = 0; r < 7; r++) for (let k = 0; k < 5; k++) if (g[r * 5 + k] === '1') rect(img, cx + k * scale, y + r * scale, scale, scale, c);
    cx += 6 * scale;
  }
  return cx - x;
}

/** Copies an RGBA sprite in, nearest-neighbour scaled, bottom-centred on (cx, baseY). */
export function blit(img, spr, cx, baseY, scale) {
  const x0 = Math.round(cx - (spr.w * scale) / 2), y0 = baseY - spr.h * scale;
  for (let y = 0; y < spr.h; y++) for (let x = 0; x < spr.w; x++) {
    const i = (y * spr.w + x) * 4; if (!spr.data[i + 3]) continue;
    rect(img, x0 + x * scale, y0 + y * scale, scale, scale, [spr.data[i], spr.data[i + 1], spr.data[i + 2], spr.data[i + 3]]);
  }
}

export const CARD = Object.freeze({ w: 480, h: 200 });
const PAL = { bg1: [34, 16, 52], bg2: [12, 8, 22], neon: [57, 255, 20], gold: [255, 208, 0], purple: [162, 75, 216], white: [240, 236, 248], red: [255, 70, 90], grey: [150, 140, 170] };

/**
 * The card. Every field is optional except `name`.
 * @param {{ name:string, balance?:number, earned?:number, title?:string|null, streak?:number, bounty?:number|null,
 *   tier?:string|null, frame?:{ w:number, h:number, data:Uint8ClampedArray }|null, season?:string }} o
 * @returns {{ w:number, h:number, data:Uint8ClampedArray }}
 */
export function renderCard(o) {
  const { w, h } = CARD, img = image(w, h);
  for (let y = 0; y < h; y++) { const t = y / (h - 1); rect(img, 0, y, w, 1, PAL.bg1.map((v, i) => Math.round(v + (PAL.bg2[i] - v) * t))); }
  // a starfield, seeded by the name so the same person always gets the same sky
  let seed = 0; for (const ch of String(o.name)) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  for (let i = 0; i < 40; i++) { seed = (seed * 1103515245 + 12345) >>> 0; const sx = seed % w; seed = (seed * 1103515245 + 12345) >>> 0; px(img, sx, seed % h, [200, 190, 255, 120 + (seed % 120)]); }
  // neon frame
  rect(img, 0, 0, w, 3, PAL.neon); rect(img, 0, h - 3, w, 3, PAL.neon); rect(img, 0, 0, 3, h, PAL.neon); rect(img, w - 3, 0, 3, h, PAL.neon);
  rect(img, 6, 6, w - 12, 1, PAL.purple); rect(img, 6, h - 7, w - 12, 1, PAL.purple);
  // the character on a little stage
  rect(img, 20, 168, 140, 6, [60, 30, 90]); rect(img, 20, 168, 140, 1, PAL.purple);
  const cx = o.pet && o.pet.w ? 76 : 90;   // v1.12: a pet sits beside its owner
  if (o.frame && o.frame.w) { const sc = Math.max(1, Math.floor(150 / Math.max(o.frame.w, o.frame.h))); blit(img, o.frame, cx, 172, sc); }
  if (o.pet && o.pet.w) { const ps = Math.max(1, Math.floor(64 / Math.max(o.pet.w, o.pet.h))); blit(img, o.pet, 136, 172 + Math.round((o.pet.h - o.pet.ay) * ps), ps); }
  // text
  const X = 176, maxW = w - X - 16;
  const ns = textWidth(o.name, 3) <= maxW ? 3 : 2;   // long names drop a size before they get cut
  text(img, fitText(o.name, maxW, ns), X, ns === 3 ? 22 : 28, ns, PAL.white);
  const bal = o.balance == null ? '' : o.balance < 0 ? '∞' : fmt(o.balance);
  if (bal) { const bw = text(img, bal, X, 58, 4, PAL.gold); text(img, 'DOLLAHS', X + bw + 8, 72, 2, PAL.gold); }
  let y = 102;
  if (o.title) { text(img, fitText(o.title.toUpperCase(), maxW, 2), X, y, 2, PAL.neon); y += 22; }
  if (o.streak) { text(img, fitText(`CHECK-IN STREAK: ${o.streak} DAY${o.streak === 1 ? '' : 'S'}`, maxW, 2), X, y, 2, PAL.white); y += 22; }
  if (o.bounty) { text(img, fitText(`WANTED: ${fmt(o.bounty)} BOUNTY`, maxW, 2), X, y, 2, PAL.red); y += 22; }
  if (o.tier && y < 170) text(img, fitText(`HELM FRIENDS ${String(o.tier).toUpperCase()}`, maxW, 1), X, Math.max(y, 172), 1, PAL.grey);
  text(img, "PEPE'S HELM FRIENDS", w - textWidth("PEPE'S HELM FRIENDS", 1) - 12, h - 18, 1, PAL.purple);
  return img;
}
