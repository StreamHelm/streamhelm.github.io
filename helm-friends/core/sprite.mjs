// One character frame from the art pack (CONTRACTS §11.1), as plain RGBA — the shared core path the overlay, the web
// editor and devkit/hf-art/lib/compose.js all describe, made pure so the PC / cloud can draw a character without a browser
// (v1.11: the Discord profile card). It reads the pack through two injected functions, so core never touches files:
//   pack = { m: art.json manifest, item(id) → catalog item | null, atlas(i) → { w, h, data }, mask(i) → { w, h, data } }
// Drawing rules (layer order, head anchors, recolour masks, ramps, height rows, rigid parts) are core's own compose.mjs.

import { recolour, stretchRows, heightRows, bodyColors } from './avatar/compose.mjs';

/** The part names a spec uses, in no particular order (art.json `parts` decides the slot). */
export function partsForSpec(pack, spec, opts = {}) {
  const m = pack.m, P = m.parts || {}, has = (n) => !!P[n];
  const ex = opts.expr || 'neutral', t = opts.t || 0;
  const frameOf = (id) => { const it = pack.item(id); return it && it.anim && it.anim.kind === 'frames' ? '#' + (Math.floor(t / 1000 * it.anim.fps) % it.anim.frames) : ''; };
  const out = [], push = (n, src) => { if (has(n)) out.push({ name: n, src }); };
  push('body.far'); push('body'); push('body.near');
  const variant = `${spec.species}.${spec.model}.${spec.body}`;
  for (const n of ['tail', 'shell']) if (m.layers[`${n}|${variant}|idle|side`]) push(n);
  if (spec.wings && spec.wings.style) push(spec.wings.style, 'wings');
  if (spec.breed) { push(spec.breed); push(spec.breed + '@head'); }
  push('head');
  if (m.layers[`head.top|${spec.species}|h0|front`]) push('head.top');
  if (spec.ears) push(spec.ears);
  push(`${spec.eyes.shape}:${ex}`, 'eyes'); push(`${spec.brows}:${ex}`, 'brows'); push('mouth:' + ex);
  const hat = spec.wear && spec.wear.hat && pack.item(spec.wear.hat.item), hides = (hat && hat.hides) || [];
  if (spec.hair && spec.hair.style) {
    push(spec.hair.style + (hides.includes('hair.top') ? '~hat' : ''), 'hair');
    if (!hides.includes('hair.back')) push(spec.hair.style + '.back', 'hair');
  }
  if (spec.facialHair && spec.facialHair.style) push(spec.facialHair.style, 'facialHair');
  for (const slot of ['hat', 'eyewear', 'ear', 'nose', 'shirt', 'pants', 'shoes']) {
    const w = spec.wear && spec.wear[slot]; if (!w) continue;
    const fr = frameOf(w.item);
    for (const suf of ['', '.far', '.near', '.top']) push(w.item + suf + fr, slot);
  }
  return out;
}

/** Recolour channels for one part. */
export function channelsFor(pack, spec, partName) {
  const m = pack.m, p = m.parts[partName];
  const hairFx = spec.hair && spec.hair.fx ? (pack.item(spec.hair.fx) || {}).anim : null;
  switch (p.colors) {
    case 'body': {
      if (!m.palettes) return [spec.skin, spec.skin, spec.skin];
      const c = bodyColors(spec, m.palettes, spec.breed ? pack.item(spec.breed) : null);   // v1.16: coats with channels 1 keep spec.skin
      return c[0] ? c.map((x) => x || c[0]) : [];
    }
    case 'hair': return [{ hsv: spec.hair.color, fx: hairFx ? hairFx.fx : null }];
    case 'facialHair': return [spec.facialHair.color];
    case 'eyes': return [spec.eyes.color];
    case 'item': {
      const id = p.item, it = pack.item(id); if (!it || it.lockedColors) return [];
      const fx = it.anim && it.anim.kind === 'fx' ? it.anim.fx : null;
      let cols;
      if (id.startsWith('wings.')) cols = [spec.wings.color, ...((m.itemColors || {})[id] || []).slice(1)];
      else { const w = Object.values(spec.wear || {}).find((x) => x && x.item === id); cols = w && w.colors && w.colors.length ? w.colors : (m.itemColors || {})[id] || []; }
      return cols.slice(0, Math.max(it.channels || 0, 0)).map((c) => ({ hsv: c, fx }));
    }
    default: return [];
  }
}

const crop = (A, x, y, w, h) => {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < h; j++) px.set(A.data.subarray(((y + j) * A.w + x) * 4, ((y + j) * A.w + x + w) * 4), j * w * 4);
  return px;
};

/**
 * One frame → { w, h, data, extra } (h = frame height + the rows a tall character gains). Missing layers are skipped,
 * so a pack still being drawn never breaks the card.
 * @param {{ m:Object, item:(id:string)=>Object|null, atlas:(i:number)=>{w:number,h:number,data:Uint8Array|Uint8ClampedArray}, mask:(i:number)=>Object }} pack
 * @param {Object} spec
 * @param {{ anim?:string, dir?:string, frame?:number, expr?:string, t?:number }} [opts]
 */
export function composeFrame(pack, spec, opts = {}) {
  const m = pack.m, anim = opts.anim || 'idle', dir = opts.dir || 'front', f = opts.frame || 0;
  const prop = `${spec.model}.${spec.body}`, variant = spec.species === 'mecha' ? 'mecha.1.average' : `${spec.species}.${prop}`;
  const W = m.frame.w, H = m.frame.h;
  const anc = (m.anchors[prop] || m.anchors['1.average'] || {})[`${anim}|${dir}`];
  if (!anc) return { w: W, h: H, data: new Uint8ClampedArray(W * H * 4), extra: 0 };
  const head = anc.head[f % anc.head.length], pose = head[2] || 0;
  const list = partsForSpec(pack, spec, opts);
  const st = ((m.stretch || {})[`${anim}|${dir}`] || [])[f] || [-1, -1];
  const rows = st[0] < 0 || !spec.height || spec.height === 'short' ? [] : heightRows(st, spec.height, (m.frame && m.frame.unit) || 1);   // v1.11 art: 128 px frames, unit 2
  const extra = rows.reduce((s, r) => s + r.n, 0), OH = H + extra;
  const final = new Uint8ClampedArray(W * OH * 4);
  let out = null, rigid = false;
  const flush = () => {
    if (!out) return;
    let src = out, sh = 0;
    if (extra && !rigid) src = stretchRows(out, W, H, rows).data;
    else if (extra) { let top = H; for (let i = 3; i < out.length; i += 4) if (out[i]) { top = Math.floor(i / 4 / W); break; } sh = rows.filter((r) => r.y < top).reduce((s, r) => s + r.n, 0); }
    for (let i = 0; i < W * (extra && !rigid ? OH : H); i++) {
      if (!src[i * 4 + 3]) continue;
      const o = (i + sh * W) * 4; if (o >= final.length) continue;
      final[o] = src[i * 4]; final[o + 1] = src[i * 4 + 1]; final[o + 2] = src[i * 4 + 2]; final[o + 3] = 255;
    }
    out = null;
  };
  for (const slot of m.order[dir] || []) {
    for (const { name } of list) {
      const p = m.parts[name]; if (p.slot !== slot) continue;
      let key, dx = 0, dy = 0, fi = f;
      if (p.attach === 'body') { if (p.anims && !p.anims.includes(anim)) continue; key = `${name}|${p.by === 'variant' ? variant : prop}|${anim}|${dir}`; }
      else { key = `${name}|${p.by === '*' ? '*' : spec.species}|h${pose}|${dir}`; dx = head[0]; dy = head[1]; fi = p.frames ? Math.floor((opts.t || 0) / 1000 * 12) % p.frames : 0; }
      const L = m.layers[key]; if (!L) continue;
      const r = L.rects[fi % L.rects.length]; if (!r || !r[2]) continue;
      const [x, y, w, h, ox, oy] = r;
      let px = crop(pack.atlas(L.atlas), x, y, w, h);
      if (L.mask) {
        const ch = channelsFor(pack, spec, name);
        if (ch.length) { const mk = L.mask === true ? crop(pack.mask(L.atlas), x, y, w, h) : crop(pack.atlas(L.mask.atlas), ...L.mask.rects[fi % L.mask.rects.length].slice(0, 4)); px = new Uint8ClampedArray(recolour(px, mk, ch, opts.t || 0)); }
      }
      if (!out || rigid !== !!p.rigid) { flush(); out = new Uint8ClampedArray(W * H * 4); rigid = !!p.rigid; }
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const si = (j * w + i) * 4; if (!px[si + 3]) continue;
        const X = dx + ox + i, Y = dy + oy + j; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const di = (Y * W + X) * 4; out[di] = px[si]; out[di + 1] = px[si + 1]; out[di + 2] = px[si + 2]; out[di + 3] = 255;
      }
      if (rigid) flush();
    }
  }
  flush();
  return { w: W, h: OH, data: final, extra };
}

/**
 * v1.12: one pet frame (art.json `pets`), recoloured with spec.pet.colors like an item (locked-colour pets as drawn).
 * @returns {{ w:number, h:number, data:Uint8ClampedArray, ax:number, ay:number }|null}  null = no pet / no art for it
 */
export function composePet(pack, spec, opts = {}) {
  const P = pack.m.pets, pet = spec && spec.pet;
  if (!P || !pet || !pet.item || !P.parts[pet.item]) return null;
  const parts = P.parts[pet.item], anim = opts.anim || 'sit', dir = opts.dir || 'side';
  const L = parts[`${anim}|${dir}`] || parts[`${anim}|side`] || parts['idle|side'];
  if (!L) return null;
  const r = L.rects[(opts.frame || 0) % L.rects.length], [W, H] = P.size, out = new Uint8ClampedArray(W * H * 4);
  if (!r || !r[2]) return { w: W, h: H, data: out, ax: P.anchor[0], ay: P.anchor[1] };
  const [x, y, w, h, ox, oy] = r;
  let px = crop(pack.atlas(L.atlas), x, y, w, h);
  const it = pack.item(pet.item);
  if (L.mask && it && !it.lockedColors && it.channels) {
    const def = (pack.m.itemColors || {})[pet.item] || [];
    const cols = Array.from({ length: it.channels }, (_, i) => (pet.colors && pet.colors[i]) || def[i]).filter(Boolean);
    if (cols.length) px = new Uint8ClampedArray(recolour(px, crop(pack.mask(L.atlas), x, y, w, h), cols));
  }
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const si = (j * w + i) * 4, X = ox + i, Y = oy + j;
    if (!px[si + 3] || X >= W || Y >= H || X < 0 || Y < 0) continue;
    const di = (Y * W + X) * 4; out[di] = px[si]; out[di + 1] = px[si + 1]; out[di + 2] = px[si + 2]; out[di + 3] = 255;
  }
  return { w: W, h: H, data: out, ax: P.anchor[0], ay: P.anchor[1] };
}
