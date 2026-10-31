// Composes a Helm Friend from the art pack (assets/hf/art.json + atlases, CONTRACTS §11) for the editor preview.
// All pixel rules come from core (layer order, mask recolour, ramps, effects, height rows); this file only finds the
// right sprites and copies pixels.
//
// The manifest is read the way the art pipeline writes it (self-describing):
//   layers  { key: { atlas, rects:[[x,y,w,h,ox,oy] per frame], mask?: true | { atlas, rects } } }
//   parts   { name: { slot, attach:'body'|'head', by:'variant'|'prop'|'species'|'*', colors, item?, expr?, equip? } }
//   order   { side|front|back: slot[] }             (else core layerOrder)
//   anchors { '<model>.<body>': { '<anim>|<dir>': { head:[[x,y,pose]…] } } }   head parts sit on these
//   stretch { '<anim>|<dir>': [[waistY, kneeY]…] }  (or per layer `stretch`)
//   atlases[], maskAtlases[] (a mask:true layer reads the same rect from maskAtlases[atlas])
// Body keys: `${part}|${variant or prop}|${anim}|${dir}`; head keys: `${part}|${species or *}|h${pose}|${dir}`.
// A manifest without `parts` (the plain CONTRACTS §11 form) is read as `${catalogId}|${variant}|${anim}|${dir}`.

import { layerOrder, recolour, stretchRows, heightRows, itemById, itemsInSpec, bodyColors } from '../core/index.mjs';

const HAIR_FX = { neon: 'glow', stardust: 'glitter', prism: 'prism' };
const BREED_SPECIES = ['cat', 'dog'];

/** Loads art.json from `base` (a folder URL). Atlases load lazily, only the ones a preview needs. */
export async function loadArt(base, { fetchFn = (...a) => fetch(...a) } = {}) {
  const url = String(base).replace(/\/?$/, '/');
  const res = await fetchFn(url + 'art.json', { credentials: 'omit' });
  if (!res.ok) throw new Error('art.json ' + res.status);
  return new ArtPack(url, await res.json());
}

export class ArtPack {
  constructor(base, manifest) {
    this.base = base; this.m = manifest;
    this.frame = manifest.frame || { w: 64, h: 64, anchor: [32, 60] };
    this.canvases = new Map();   // 'a:3' / 'm:3' → Promise<CanvasRenderingContext2D>
    this.pixels = new Map();     // key#frame → { w, h, ox, oy, rgba, mask }
  }

  anim(name) { return (this.m.anims || {})[name] || null; }

  /** The direction an animation is actually drawn in ('right'/'left' → 'side'; falls back to the anim's first dir). */
  dirFor(anim, viewDir) {
    const want = viewDir === 'left' || viewDir === 'right' ? 'side' : viewDir;
    const a = this.anim(anim);
    return !a || !a.dirs || a.dirs.includes(want) ? want : a.dirs[0];
  }

  /**
   * Which sprites make up one frame, back to front. Sync; no pixels yet.
   * @returns {{ key:string, f:number, dx:number, dy:number, atlas:number, rect:number[], mask:any, channels:Array }[]}
   */
  layersFor(spec, catalog, { anim = 'idle', dir = 'front', frame = 0, expr = 'neutral' } = {}) {
    const m = this.m, d = this.dirFor(anim, dir);
    const prop = `${spec.model}.${spec.body}`, variant = spec.species === 'mecha' ? 'mecha.1.average' : `${spec.species}.${prop}`;
    const out = [];
    const push = (key, f, dx, dy, channels, slot) => {
      const L = m.layers && m.layers[key];
      if (!L || !L.rects || !L.rects.length) return;
      const rect = L.rects[f % L.rects.length];
      if (!rect || !rect[2] || !rect[3]) return;
      out.push({ key, f: f % L.rects.length, dx: dx + rect[4], dy: dy + rect[5], atlas: L.atlas, rect, mask: L.mask || null, channels, slot });
    };

    if (m.parts) {
      const worn = new Set(itemsInSpec(spec));
      const hat = spec.wear && spec.wear.hat ? itemById(catalog, spec.wear.hat.item) : null;
      const hides = (hat && hat.hides) || [];
      const anc = m.anchors && m.anchors[prop] && m.anchors[prop][`${anim}|${d}`];
      const head = anc && anc.head ? anc.head[frame % anc.head.length] : null;
      for (const [name, p] of Object.entries(m.parts)) {
        if (p.equip) continue;                                   // gloves / cuffs: shows only
        if (p.expr && p.expr !== expr) continue;
        if (p.item) {
          if (!worn.has(p.item)) continue;
          const underHat = name.endsWith('~hat');
          if (p.slot === 'hair' && underHat !== hides.includes('hair.top')) continue;
          if (p.slot === 'hairBack' && hides.includes('hair.back')) continue;
        }
        const channels = channelsFor(p.colors, p.item, spec, catalog, m.palettes);
        if (p.attach === 'head') {
          if (!head) continue;
          const seg = p.by === '*' ? '*' : spec.species;
          push(`${name}|${seg}|h${head[2] || 0}|${d}`, 0, head[0], head[1], channels, p.slot);
        } else {
          const seg = p.by === 'prop' ? prop : variant;
          push(`${name}|${seg}|${anim}|${d}`, frame, 0, 0, channels, p.slot);
        }
      }
      const order = (m.order && m.order[d]) || layerOrder(d);
      const rank = (s) => { const i = order.indexOf(s); return i < 0 ? order.length : i; };
      out.sort((a, b) => rank(a.slot) - rank(b.slot));
    } else {
      // plain CONTRACTS §11 form: catalog ids (and 'body') as the first key segment, core layer order
      const ids = ['body', ...itemsInSpec(spec)];
      for (const id of ids) {
        const it = itemById(catalog, id);
        const kind = id === 'body' || (it && (it.slot === 'species' || it.slot === 'breed')) ? 'body' : it && it.slot === 'hair' ? 'hair' : 'item';
        push(`${id}|${variant}|${anim}|${d}`, frame, 0, 0, channelsFor(kind, id, spec, catalog, m.palettes), slotOfId(id, it));
      }
      const order = layerOrder(d);
      const rank = (s) => { const i = order.indexOf(s); return i < 0 ? order.indexOf('body') : i; };
      out.sort((a, b) => rank(a.slot) - rank(b.slot));
    }
    return out;
  }

  /** Loads every atlas (and mask atlas) the given layers use. */
  async ensure(layers) {
    const jobs = [];
    for (const L of layers) {
      jobs.push(this.canvasFor('a', L.atlas));
      if (L.mask === true) jobs.push(this.canvasFor('m', L.atlas));
      else if (L.mask && typeof L.mask === 'object') jobs.push(this.canvasFor('a', L.mask.atlas));
    }
    await Promise.all(jobs);
  }

  canvasFor(kind, index) {
    const id = kind + ':' + index;
    if (!this.canvases.has(id)) {
      const file = kind === 'm' ? (this.m.maskAtlases || [])[index] : (this.m.atlases || [])[index];
      this.canvases.set(id, loadImage(this.base + file).then((img) => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(img, 0, 0);
        return x;
      }));
    }
    return this.canvases.get(id);
  }

  /** Pixels of one layer frame (after ensure()). */
  async sprite(L) {
    const id = L.key + '#' + L.f;
    if (this.pixels.has(id)) return this.pixels.get(id);
    const [x, y, w, hh] = L.rect;
    const ctx = await this.canvasFor('a', L.atlas);
    const rgba = ctx.getImageData(x, y, w, hh).data;
    let mask = null;
    if (L.mask === true) mask = (await this.canvasFor('m', L.atlas)).getImageData(x, y, w, hh).data;
    else if (L.mask && L.mask.rects) {
      const r = L.mask.rects[L.f % L.mask.rects.length];
      mask = (await this.canvasFor('a', L.mask.atlas)).getImageData(r[0], r[1], r[2], r[3]).data;
    }
    const s = { w, h: hh, rgba, mask };
    this.pixels.set(id, s);
    return s;
  }

  /** The stretch rows of a frame (for heights). */
  stretchFor(anim, dir, frame, layers) {
    const d = this.dirFor(anim, dir), s = this.m.stretch && this.m.stretch[`${anim}|${d}`];
    if (s && s.length) return s[frame % s.length];
    for (const L of layers) { const ml = this.m.layers[L.key]; if (ml && ml.stretch) return ml.stretch[L.f % ml.stretch.length]; }
    return null;
  }

  /**
   * One finished frame: layers recoloured through their masks, composited, then stretched for the height.
   * `lift` = rows added (draw the frame that many rows higher to keep the feet on the ground).
   * @returns {Promise<{ data:Uint8ClampedArray, w:number, h:number, lift:number, layers:number, animated:boolean }>}
   */
  async compose(spec, catalog, opts = {}, t = 0) {
    const frame = opts.frame || 0;
    const layers = this.layersFor(spec, catalog, opts);
    await this.ensure(layers);
    const W = this.frame.w, H = this.frame.h, out = new Uint8ClampedArray(W * H * 4);
    let animated = false;
    for (const L of layers) {
      const s = await this.sprite(L);
      let px = s.rgba;
      if (s.mask && L.channels.some(Boolean)) {
        px = recolour(s.rgba, s.mask, L.channels, t);
        if (L.channels.some((c) => c && c.fx)) animated = true;
      }
      blit(out, W, H, px, s.w, s.h, L.dx, L.dy);
    }
    const st = this.stretchFor(opts.anim || 'idle', opts.dir || 'front', frame, layers);
    if (st && spec.height) {
      const rows = heightRows(st, spec.height, this.frame.unit || 1).filter((r) => r.y >= 0 && r.y < H);
      if (rows.length) {
        const r = stretchRows(out, W, H, rows);
        return { data: r.data, w: r.w, h: r.h, lift: r.h - H, layers: layers.length, animated };
      }
    }
    return { data: out, w: W, h: H, lift: 0, layers: layers.length, animated };
  }
}

/** The colour channels a part is recoloured with (null = keep the art's own colours). */
export function channelsFor(kind, itemId, spec, catalog, palettes = null) {
  const it = itemId ? itemById(catalog, itemId) : null;
  const fx = it && it.anim && it.anim.kind === 'fx' ? it.anim.fx : null;
  switch (kind) {
    case 'body': {
      if (spec.species === 'mecha') return [];
      // v1.16 RULE: core bodyColors for EVERY coat species (a channels-0 coat = a fixed morph like the albino rat; channels-1 =
      // a pattern on your own colour). Without palettes (the placeholder pack) only cats / dogs keep their baked colours.
      if (palettes && (palettes.breeds || palettes.species)) return bodyColors(spec, palettes, spec.breed ? itemById(catalog, spec.breed) : null).map((c) => c || null);
      return BREED_SPECIES.includes(spec.species) ? [] : [spec.skin];
    }
    case 'hair': return spec.hair ? [{ hsv: spec.hair.color, fx: HAIR_FX[spec.hair.fx] || null }] : [];
    case 'facialHair': return spec.facialHair ? [spec.facialHair.color] : [];
    case 'eyes': return spec.eyes ? [spec.eyes.color] : [];
    case 'wings': return spec.wings ? [{ hsv: spec.wings.color, fx }] : [];
    case 'item': {
      const w = Object.values(spec.wear || {}).find((x) => x && x.item === itemId);
      return w ? (w.colors || []).map((c) => ({ hsv: c, fx })) : [];
    }
    default: return [];
  }
}

function slotOfId(id, it) {
  if (id === 'body' || !it) return 'body';
  if (it.slot === 'species' || it.slot === 'breed') return 'body';
  if (it.slot === 'ears') return 'ear';
  if (it.slot === 'wings') return 'wings.back';
  if (it.slot === 'hairfx') return 'hair';
  return it.slot;
}

/** Alpha-over copy of a sprite into the frame buffer. */
function blit(dst, W, H, src, w, h, dx, dy) {
  for (let y = 0; y < h; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= H) continue;
    for (let x = 0; x < w; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= W) continue;
      const si = (y * w + x) * 4, a = src[si + 3];
      if (!a) continue;
      const di = (ty * W + tx) * 4;
      if (a === 255) { dst[di] = src[si]; dst[di + 1] = src[si + 1]; dst[di + 2] = src[si + 2]; dst[di + 3] = 255; continue; }
      const fa = a / 255, da = dst[di + 3] / 255, oa = fa + da * (1 - fa);
      for (let k = 0; k < 3; k++) dst[di + k] = Math.round((src[si + k] * fa + dst[di + k] * da * (1 - fa)) / oa);
      dst[di + 3] = Math.round(oa * 255);
    }
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';   // the panel loads atlases from GitHub Pages (CORS *), and we read pixels back
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image ' + src));
    img.src = src;
  });
}
