// Sprite composition maths (CONTRACTS §11), pure pixel functions shared by the overlay's sprite baker and the web
// editor preview: layer order per direction, colour ramps, mask recolouring (+ the prism/glow/glitter/pulse effects),
// and height by row insertion.

/** Back → front, per direction. 'left' uses the side order (the sprite is mirrored when drawn). */
const ORDER = {
  side: ['wings.back', 'tail', 'body', 'pants', 'shoes', 'shirt', 'arm.far', 'face', 'eyes', 'brows', 'facialHair', 'hair',
    'ear', 'nose', 'eyewear', 'hat', 'hands.cuffs', 'bag', 'hands.gloves', 'arm.near'],
  front: ['wings.back', 'tail', 'body', 'pants', 'shoes', 'shirt', 'arm.far', 'arm.near', 'face', 'eyes', 'brows',
    'facialHair', 'hair', 'ear', 'nose', 'eyewear', 'hat', 'hands.cuffs', 'bag', 'hands.gloves'],
  back: ['body', 'pants', 'shoes', 'shirt', 'arm.far', 'arm.near', 'hair', 'ear', 'hat', 'bag', 'hands.cuffs', 'hands.gloves',
    'tail', 'wings.back'],
};

/**
 * Draw order for a direction (a fresh array; safe to change).
 * @param {'side'|'left'|'right'|'front'|'back'} dir
 * @returns {string[]}
 */
export function layerOrder(dir) {
  return (ORDER[dir === 'left' || dir === 'right' ? 'side' : dir] || ORDER.side).slice();
}

/**
 * HSV (h 0..359, s/v 0..100) → [r, g, b] 0..255.
 * @param {{ h:number, s:number, v:number }} c
 */
export function hsvToRgb({ h, s, v }) {
  const S = s / 100, V = v / 100, C = V * S, hp = (((h % 360) + 360) % 360) / 60, X = C * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] = hp < 1 ? [C, X, 0] : hp < 2 ? [X, C, 0] : hp < 3 ? [0, C, X] : hp < 4 ? [0, X, C] : hp < 5 ? [X, 0, C] : [C, 0, X];
  const m = V - C;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/**
 * [r, g, b] → HSV (whole numbers).
 * @param {number[]} rgb
 */
export function rgbToHsv([r, g, b]) {
  const R = r / 255, G = g / 255, B = b / 255, max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  let h = 0;
  if (d) h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h: Math.round(((h * 60) + 360) % 360) % 360, s: Math.round(max ? (d / max) * 100 : 0), v: Math.round(max * 100) };
}

/** Moves hue `h` toward `target` by up to `deg` degrees along the shorter way round. */
function hueToward(h, target, deg) {
  const diff = ((target - h + 540) % 360) - 180;
  return (h + Math.sign(diff) * Math.min(Math.abs(diff), deg) + 360) % 360;
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/**
 * A pixel-art shading ramp from dark to light for one colour: values climb, shadows lean cool/purple and more
 * saturated, highlights lean warm and less saturated (DESIGN §8.1).
 * @param {{ h:number, s:number, v:number }} hsv
 * @param {number} [steps]  default 6
 * @returns {number[][]} [[r,g,b], …] dark → light
 */
export function rampFor(hsv, steps = 6) {
  const out = [], tinted = hsv.s >= 8;
  for (let i = 0; i < steps; i++) {
    const f = steps === 1 ? 0.7 : i / (steps - 1);            // 0 = deepest shadow, 1 = brightest highlight
    const shade = f < 0.7 ? (0.7 - f) / 0.7 : 0, light = f > 0.7 ? (f - 0.7) / 0.3 : 0;
    let h = hsv.h;
    if (tinted) h = shade ? hueToward(h, 255, 18 * shade) : hueToward(h, 50, 8 * light);
    const s = clamp(hsv.s + 15 * shade - 18 * light, 0, 100);
    const v = clamp(hsv.v * (0.42 + 0.83 * f), 0, 100);
    out.push(hsvToRgb({ h: Math.round(h), s: Math.round(s), v: Math.round(v) }));
  }
  return out;
}

/** A small deterministic integer hash → [0, 1). */
function hash01(a, b) {
  let x = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12;
  return (x >>> 0) / 4294967296;
}

/**
 * The colour of a channel at time t after its effect: prism cycles the hue, glow and pulse breathe the brightness.
 * (Glitter is per pixel, see recolour.)
 * @param {{ h:number, s:number, v:number }} hsv
 * @param {null|'prism'|'glow'|'pulse'|'glitter'} fx
 * @param {number} t  ms
 */
export function fxColor(hsv, fx, t) {
  if (fx === 'prism') return { ...hsv, h: Math.round(hsv.h + t * 0.12) % 360, s: Math.max(hsv.s, 60) };
  if (fx === 'glow') return { ...hsv, v: clamp(Math.round(hsv.v + 15 * (0.5 + 0.5 * Math.sin(t / 300))), 0, 100) };
  if (fx === 'pulse') return { ...hsv, v: clamp(Math.round(hsv.v * (0.75 + 0.25 * Math.sin(t / 250))), 0, 100) };
  return hsv;
}

/**
 * Recolours a layer through its mask. Mask R = channel (0 none, 85 = 1, 170 = 2, 255 = 3), G = shade (0 dark … 255
 * light). Pixels on channel n take ramp[shade] of channels[n-1]; alpha is kept; unmasked pixels are untouched.
 * @param {Uint8ClampedArray|Uint8Array|number[]} rgba
 * @param {Uint8ClampedArray|Uint8Array|number[]} mask   same size
 * @param {({ h:number, s:number, v:number } | { hsv:Object, fx?:string } | null)[]} channels  up to 3
 * @param {number} [t]  ms, for effects
 * @param {{ steps?:number }} [opts]
 * @returns {Uint8ClampedArray} a new buffer
 */
export function recolour(rgba, mask, channels, t = 0, opts = {}) {
  if (rgba.length !== mask.length) throw new RangeError('recolour: image and mask sizes differ');
  const steps = opts.steps || 6, out = new Uint8ClampedArray(rgba);
  const chans = [0, 1, 2].map((i) => {
    const c = channels[i];
    if (!c) return null;
    const hsv = c.hsv || c, fx = c.fx || null;
    return { ramp: rampFor(fxColor(hsv, fx, t), steps), fx };
  });
  const frame = Math.floor(t / 120);
  for (let i = 0; i < out.length; i += 4) {
    const ch = Math.round(mask[i] / 85);
    if (!ch || !chans[ch - 1] || out[i + 3] === 0) continue;
    const c = chans[ch - 1];
    let rgb = c.ramp[Math.min(steps - 1, Math.floor((mask[i + 1] * steps) / 256))];
    if (c.fx === 'glitter' && hash01(i >> 2, frame) < 0.04) rgb = [255, 255, 255];
    out[i] = rgb[0]; out[i + 1] = rgb[1]; out[i + 2] = rgb[2];
  }
  return out;
}

/** Extra rows per height: inserted at each frame's waist and knee rows (short = none). */
export const HEIGHT_ROWS = Object.freeze({ short: [0, 0], medium: [2, 3], tall: [4, 6] });

/**
 * The row insertions for a frame's stretch rows and a height.
 * @param {[number, number]} stretch  [waistY, kneeY]
 * @param {'short'|'medium'|'tall'} height
 * @param {number} [unit]  art pixels per 64-frame pixel (manifest frame.unit, v1.10; 2 for the 128 px art)
 * @returns {{ y:number, n:number }[]}
 */
export function heightRows(stretch, height, unit = 1) {
  const [w, k] = HEIGHT_ROWS[height] || HEIGHT_ROWS.medium;
  const u = Number.isInteger(unit) && unit > 0 ? unit : 1;
  return [{ y: stretch[0], n: w * u }, { y: stretch[1], n: k * u }].filter((r) => r.n > 0);
}

/**
 * Inserts copies of rows (the old sprite trick for taller characters, kept pixel-crisp). Each {y, n} repeats row y
 * n more times right below it. The image grows by Σn rows; the feet move down by that much, so draw it Σn rows higher.
 * @param {Uint8ClampedArray|Uint8Array|number[]} rgba
 * @param {number} w
 * @param {number} h
 * @param {({ y:number, n:number } | [number, number])[]} rows
 * @returns {{ data:Uint8ClampedArray, w:number, h:number }}
 */
export function stretchRows(rgba, w, h, rows) {
  if (rgba.length !== w * h * 4) throw new RangeError('stretchRows: size mismatch');
  const extra = new Map();
  for (const r of rows) {
    const y = Array.isArray(r) ? r[0] : r.y, n = Array.isArray(r) ? r[1] : r.n;
    if (!Number.isInteger(y) || y < 0 || y >= h || !Number.isInteger(n) || n < 0) throw new RangeError('stretchRows: bad row ' + JSON.stringify(r));
    extra.set(y, (extra.get(y) || 0) + n);
  }
  const H = h + [...extra.values()].reduce((s, n) => s + n, 0), out = new Uint8ClampedArray(w * H * 4), rowBytes = w * 4;
  let dy = 0;
  for (let y = 0; y < h; y++) {
    const row = rgba.slice ? rgba.slice(y * rowBytes, (y + 1) * rowBytes) : Array.prototype.slice.call(rgba, y * rowBytes, (y + 1) * rowBytes);
    for (let k = 0; k <= (extra.get(y) || 0); k++) out.set(row, (dy++) * rowBytes);
  }
  return { data: out, w, h: H };
}

/**
 * v1.16: the three body colour channels of a character (CONTRACTS v1.16 "body colours with a coat").
 *  - no coat: [spec.skin, species ch2, species ch3]
 *  - a coat with channels ≥ 1 (a pattern on your own colour): [spec.skin, coat ch2, coat ch3]
 *  - a coat with channels 0 (cat/dog breeds, colour morphs): the coat palette for all three
 * @param {Object} spec
 * @param {{ species?:Object, breeds?:Object }} palettes  art.json `palettes`
 * @param {Object|null} [coatItem]  the catalog item of spec.breed (its `channels`); missing = treated as channels 0
 * @returns {Object[]}  HSV × 3 (entries may be undefined when the pack lacks a palette)
 */
export function bodyColors(spec, palettes = {}, coatItem = null) {
  const sp = (palettes.species && palettes.species[spec.species]) || [];
  const coat = spec.breed && palettes.breeds && palettes.breeds[spec.breed];
  if (coat) return coatItem && coatItem.channels >= 1 ? [spec.skin || coat[0], coat[1], coat[2]] : [coat[0], coat[1], coat[2]];
  return [spec.skin || sp[0], sp[1], sp[2]];
}
