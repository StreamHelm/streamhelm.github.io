// Shop try-on previews (launch audit, Sky): every wearable item is shown ON a character instead of the art pack's bare
// item / floating-head preview — head items (hair, hats, glasses, piercings, faces, ears…) as a head-and-shoulders bust,
// everything else as the full small character. It uses the viewer's own character when they're logged in (else the
// default human) and the same compositor as the editor (avatar-render.mjs). Rendered lazily (only cards on screen),
// cached per item + look. Pets and vehicle parts keep their own preview pictures (they aren't worn). Boxing gloves are
// drawn on the hands (on stream they only go on in fights) as a torso + hands close-up; necklaces / back items / held
// items go on too.
//
//   createTryOn({ art, catalog, baseSpec }) → { attach(img, item) }   img keeps its static preview until the render is ready

import { defaultSpec } from '../core/index.mjs';

const HEAD = new Set(['eyes', 'brows', 'hair', 'hairfx', 'facialHair', 'hat', 'eyewear', 'ear', 'nose', 'ears']);
const BODY = new Set(['species', 'breed', 'wings', 'shirt', 'pants', 'shoes', 'gloves', 'neck', 'back', 'held']);
const WEAR = new Set(['hat', 'eyewear', 'ear', 'nose', 'shirt', 'pants', 'shoes']);
const EXTRAS = new Set(['neck', 'back', 'held']);   // spec.extras.<slot> (the aura is particles on stream, not a sprite)
/** Show-only gear a try-on draws for that item (boxing gloves only go on in fights, so the card puts them on). */
export const tryOnEquips = (it) => (it && it.slot === 'gloves' ? ['gloves'] : []);
const OUT = 64;   // the card's preview box (CSS px); drawn at 2× for sharp pixels on hi-dpi screens

/** The base look wearing `it`, or null when the item isn't worn on the body (pets, vehicles, unknown slots). */
export function tryOnSpec(base, it) {
  if (!it || !(HEAD.has(it.slot) || BODY.has(it.slot))) return null;
  const fits = (sp) => !it.species || !it.species.length || it.species.includes(sp);
  let s = JSON.parse(JSON.stringify(base || defaultSpec('human')));
  if (it.slot === 'species') s = { ...defaultSpec(it.id.replace(/^species\./, '')), model: s.model, body: s.body, height: s.height, wear: s.wear };
  else if (!fits(s.species)) s = { ...defaultSpec(it.species[0]), model: s.model, body: s.body, height: s.height, wear: s.wear };
  switch (it.slot) {
    case 'eyes': s.eyes = { ...(s.eyes || {}), shape: it.id }; break;
    case 'brows': s.brows = it.id; break;
    case 'hair': s.hair = { ...(s.hair || {}), style: it.id }; break;
    case 'hairfx': s.hair = { ...(s.hair || {}), style: s.hair && s.hair.style && s.hair.style !== 'hair.bald' ? s.hair.style : 'hair.short', fx: it.id }; break;
    case 'facialHair': s.facialHair = { ...(s.facialHair || { color: { h: 25, s: 60, v: 30 } }), style: it.id }; break;
    case 'breed': s.breed = it.id; break;
    case 'ears': s.ears = it.id; break;
    case 'wings': s.wings = { ...(s.wings || { color: { h: 150, s: 50, v: 45 } }), style: it.id }; break;
    case 'gloves': { const prev = s.gloves; s.gloves = { item: it.id, colors: prev && prev.item === it.id && prev.colors ? prev.colors : [] }; break; }   // [] = the item's own art colours
    case 'neck': case 'back': case 'held': if (EXTRAS.has(it.slot)) { const prev = s.extras && s.extras[it.slot]; s.extras = { ...(s.extras || {}), [it.slot]: { item: it.id, colors: prev && prev.item === it.id && prev.colors ? prev.colors : [] } }; } break;
    default: if (WEAR.has(it.slot)) { const prev = s.wear && s.wear[it.slot]; s.wear = { ...(s.wear || {}), [it.slot]: { item: it.id, colors: prev && prev.colors ? prev.colors : [] } }; }
  }
  if (it.slot === 'hat' || it.slot === 'hair') s.unique = null;
  return s;
}

/** Crop box over the drawn pixels: head items → head + shoulders, the rest → the whole character (square, centred). */
/**
 * Glove close-up: the square around the pixels the gloves change (`withG` vs `without`, same frame), widened to show the
 * chest and both hands (head cut at the chin). null when nothing differs (no glove art).
 */
export function handsBox(withG, without) {
  const a = withG.data, b = without.data, w = withG.w, h = Math.min(withG.h, without.h);
  if (withG.w !== without.w || withG.h !== without.h) return null;
  let x0 = w, y0 = h, x1 = -1, y1 = -1, top = h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (b[i + 3] > 8 && y < top) top = y;
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const gw = x1 - x0 + 1, gh = y1 - y0 + 1;
  const side = Math.round(Math.max(gw + 8, gh * 2.6));
  // the gloves sit in the lower part of the square, the chest above them (never higher than the character's top)
  const y = Math.max(top, Math.round(y1 + 4 - side));
  return { x: Math.round((x0 + x1) / 2 - side / 2), y, s: side };
}

export function cropBox(data, w, h, head) {   // head: true = bust, else the full character
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  if (head) {
    const side = Math.max(Math.round(bh * 0.64), Math.min(bw, Math.round(bh * 0.72)));   // the head + shoulders and chest (never a floating head)
    const cx = Math.round((x0 + x1) / 2);
    return { x: cx - Math.round(side / 2), y: y0 - Math.round(side * 0.04), s: side };
  }
  const side = Math.max(bw, bh) + 4;
  return { x: Math.round((x0 + x1) / 2 - side / 2), y: Math.round((y0 + y1) / 2 - side / 2), s: side };
}

export function createTryOn({ art, catalog, baseSpec }) {
  const cache = new Map(), queue = [];
  let pack = null, busy = false, io = null, settled = false;
  const giveUp = () => { settled = true; pack = null; for (const q of queue.splice(0)) delete q.img.dataset.tryon; for (const img of document.querySelectorAll('img[data-tryon=pending]')) delete img.dataset.tryon; };
  art.then((p) => { if (!p) return giveUp(); pack = p; settled = true; pump(); }, giveUp);   // no art pack: the static previews stay
  const keyOf = (it, spec) => it.id + '|' + JSON.stringify([spec.species, spec.model, spec.body, spec.height, spec.skin, spec.breed, spec.hair, spec.wear && spec.wear.shirt]);

  async function render(it) {
    const spec = tryOnSpec(baseSpec(), it);
    if (!spec || !pack) return null;
    const k = keyOf(it, spec);
    if (cache.has(k)) return cache.get(k);
    const p = (async () => {
      const r = await pack.compose(spec, catalog(), { anim: 'idle', dir: 'front', frame: 0, equips: tryOnEquips(it) });
      // gloves: a close-up of the torso + hands, centred on the gloves' own pixels (with vs without them), so they fill the card
      const box = it.slot === 'gloves' ? handsBox(r, await pack.compose(spec, catalog(), { anim: 'idle', dir: 'front', frame: 0 })) || cropBox(r.data, r.w, r.h, false)
        : cropBox(r.data, r.w, r.h, HEAD.has(it.slot));
      if (!box) return null;
      const src = document.createElement('canvas'); src.width = r.w; src.height = r.h;
      src.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.data), r.w, r.h), 0, 0);
      const c = document.createElement('canvas'); c.width = c.height = OUT * 2;
      const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
      ctx.drawImage(src, box.x, box.y, box.s, box.s, 0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    })().catch(() => null);
    cache.set(k, p);
    return p;
  }
  async function pump() {
    if (busy || !pack) return;
    busy = true;
    try {
      while (queue.length) {
        const { img, it } = queue.shift();
        if (!img.isConnected) continue;
        const url = await render(it);
        if (url && img.isConnected) { img.src = url; img.dataset.tryon = HEAD.has(it.slot) ? 'bust' : 'full'; }
        else if (img.isConnected) img.dataset.tryon = 'failed';   // couldn't draw it: the static preview stays (the tests count these)
        await new Promise((r) => setTimeout(r, 0));   // keep scrolling smooth
      }
    } finally { busy = false; }
  }
  function attach(img, it) {
    if (!tryOnSpec(null, it) || (settled && !pack)) return img;
    img.dataset.tryon = 'pending';
    const go = () => { queue.push({ img, it }); pump(); };
    if (typeof IntersectionObserver === 'undefined') { go(); return img; }
    if (!io) io = new IntersectionObserver((ents) => { for (const e of ents) if (e.isIntersecting) { io.unobserve(e.target); const q = e.target.__tryon; if (q) { queue.push(q); pump(); } } }, { rootMargin: '200px' });
    img.__tryon = { img, it };
    io.observe(img);
    return img;
  }
  return { attach, render };
}
