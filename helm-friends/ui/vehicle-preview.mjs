// The editor's live preview of a viewer's getaway car / Gleep Race UFO (v1.14; CONTRACTS v1.8 spec.vehicles, art.json
// `vehicles`). Every part of core vehicleOf(spec, kind) is drawn in the manifest's order and recoloured through its mask
// with core recolour, exactly like the overlay (overlay/hf/vehicles.mjs) and devkit/hf-art composeVehicle. The rider is
// not drawn. Without vehicle art (the placeholder pack) a simple shape in the chosen colours stands in.

import { recolour, vehicleOf, itemById, hsvToRgb } from '../core/index.mjs';
import { h } from './h.mjs';
import { reducedMotion } from './a11y.mjs';

export const VEHICLE_STATES = { car: [['idle', 'Parked'], ['drive', 'Driving']], ufo: [['hover', 'Hovering'], ['fly', 'Flying']] };

/**
 * One composed vehicle frame (no rider) in art pixels, or null when the pack has no art for it.
 * @param {import('./avatar-render.mjs').ArtPack} pack
 * @returns {Promise<{ data:Uint8ClampedArray, w:number, h:number, animated:boolean }|null>}
 */
export async function composeVehicle(pack, spec, kind, catalog, state, t = 0) {
  const V = pack && pack.m && !pack.m.placeholder && pack.m.vehicles && pack.m.vehicles[kind];
  if (!V) return null;
  const vo = vehicleOf(spec, kind), fps = 12, f = Math.floor(t / (1000 / fps));
  const bobs = (V.bob && V.bob[state]) || [0], bob = Math.round(bobs[f % bobs.length] || 0);
  const W = V.size[0], H = V.size[1], out = new Uint8ClampedArray(W * H * 4);
  const body = kind === 'car' && vo.body ? V.parts[vo.body.item] : null;
  let animated = bobs.length > 1;

  async function draw(st, fi, X, Y, worn) {
    const r = st.rects[fi % st.rects.length];
    if (!r || !r[2]) return;
    const [x, y, w, hh, ox, oy] = r;
    const A = await pack.canvasFor('a', st.atlas);
    let px = A.getImageData(x, y, w, hh).data;
    if (st.mask && worn && worn.colors && worn.colors.length) {
      const it = itemById(catalog, worn.item);
      if (!(it && it.lockedColors)) {
        const fx = it && it.anim && it.anim.kind === 'fx' ? it.anim.fx : null;
        if (fx) animated = true;
        const M = await pack.canvasFor('m', st.atlas);
        px = recolour(px, M.getImageData(x, y, w, hh).data, worn.colors.map((hsv) => ({ hsv, fx })), t);
      }
    }
    for (let j = 0; j < hh; j++) {
      for (let i = 0; i < w; i++) {
        const si = (j * w + i) * 4;
        if (!px[si + 3]) continue;
        const tx = X + ox + i, ty = Y + oy + j + bob;
        if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
        out.set(px.subarray(si, si + 4), (ty * W + tx) * 4);
      }
    }
  }

  for (const slot of V.order) {
    if (slot === 'rider') continue;
    if (slot === 'cabin') { if (body && body.cabin) await draw(body.cabin, 0, 0, 0, null); continue; }
    const worn = vo[slot];
    if (!worn) continue;
    const P = V.parts[worn.item];
    if (!P) continue;
    const st = P.states[state] || P.states.idle;
    if (st.rects.length > 1) animated = true;
    const fi = st.rects.length > 1 ? Math.floor(t / (1000 / (st.fps || 8))) : 0;
    if (slot === 'wheels') { if (body) for (const [wx, wy] of body.meta.wheels) await draw(st, fi, Math.round(wx - P.meta.centre[0]), Math.round(wy - P.meta.centre[1]), worn); }
    else if (slot === 'decal') { if (body) await draw(st, fi, Math.round(body.meta.panel[0]), Math.round(body.meta.panel[1]), worn); }
    else await draw(st, fi, 0, 0, worn);
  }
  return { data: out, w: W, h: H, animated };
}

/**
 * @param {{ art:Promise<import('./avatar-render.mjs').ArtPack|null>, catalog:()=>Object }} o
 */
export function createVehiclePreview({ art, catalog }) {
  const canvas = h('canvas', { class: 'veh-canvas', width: 224, height: 112, role: 'img', 'aria-label': 'Vehicle preview', 'data-testid': 'vehicle-preview' });
  const ctx = canvas.getContext('2d');
  const scratch = document.createElement('canvas');
  let pack = null, spec = null, kind = 'car', state = 'idle', raf = 0, token = 0, t0 = 0;
  const stateBtns = h('div', { class: 'ed-anims', role: 'group', 'aria-label': 'Vehicle preview motion' });
  const el = h('div', { class: 'ed-stage veh-stage' }, canvas, stateBtns);

  art.then((p) => { pack = p; rebuild(); }, () => rebuild());

  function renderStates() {
    stateBtns.replaceChildren(...VEHICLE_STATES[kind].map(([id, label]) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(id === state), 'data-fk': 'vstate-' + id,
      onclick: () => { state = id; renderStates(); rebuild(); },
    }, label)));
  }

  function describe() {
    const vo = vehicleOf(spec, kind), names = Object.values(vo).filter(Boolean).map((w) => (itemById(catalog(), w.item) || {}).name).filter(Boolean);
    return `${kind === 'car' ? 'Getaway car' : 'UFO'} preview: ${names.join(', ')}`;
  }

  async function frame(t) {
    const fr = pack ? await composeVehicle(pack, spec, kind, catalog(), state, t).catch(() => null) : null;
    return fr;
  }

  async function rebuild() {
    const my = ++token;
    cancelAnimationFrame(raf);
    if (!spec) return;
    canvas.setAttribute('aria-label', describe());
    const fr = await frame(0);
    if (my !== token) return;
    if (!fr) { drawFallback(); return; }
    canvas.width = fr.w; canvas.height = fr.h;
    paint(fr);
    canvas.dataset.parts = String(Object.values(vehicleOf(spec, kind)).filter(Boolean).length);
    canvas.dataset.drawn = String(my);
    if (!fr.animated || reducedMotion()) return;
    t0 = performance.now();
    let busy = false;
    const tick = async (now) => {
      if (my !== token || !canvas.isConnected) return;
      if (!busy) { busy = true; const f2 = await frame(now - t0); busy = false; if (my !== token) return; if (f2) paint(f2); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  function paint(fr) {
    scratch.width = fr.w; scratch.height = fr.h;
    scratch.getContext('2d').putImageData(new ImageData(fr.data, fr.w, fr.h), 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(scratch, 0, 0);
  }

  function drawFallback() {
    canvas.width = 224; canvas.height = 112;
    canvas.dataset.parts = '0'; canvas.dataset.drawn = String(token);
    const vo = vehicleOf(spec, kind), rgb = (w, i = 0, d = '#888') => (w && w.colors && w.colors[i] ? `rgb(${hsvToRgb(w.colors[i]).join(',')})` : d);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, 224, 112);
    if (kind === 'car') {
      ctx.fillStyle = rgb(vo.body, 0, '#c33'); ctx.fillRect(30, 58, 164, 30);
      ctx.fillStyle = rgb(vo.body, 1, '#ddd'); ctx.fillRect(70, 40, 80, 20);
      ctx.fillStyle = rgb(vo.wheels, 0, '#bbb'); for (const x of [60, 164]) { ctx.beginPath(); ctx.arc(x, 92, 12, 0, 7); ctx.fill(); }
    } else {
      ctx.fillStyle = rgb(vo.hull, 0, '#aac'); ctx.beginPath(); ctx.ellipse(112, 64, 70, 16, 0, 0, 7); ctx.fill();
      ctx.fillStyle = rgb(vo.dome, 0, '#9ef'); ctx.beginPath(); ctx.ellipse(112, 50, 28, 20, 0, Math.PI, 0); ctx.fill();
    }
  }

  return {
    el,
    /** Shows `which` vehicle of a spec (call on every change). */
    show(next, which) {
      spec = next;
      if (which && which !== kind) { kind = which; state = VEHICLE_STATES[kind][0][0]; }
      renderStates(); rebuild();
    },
    stop() { token++; cancelAnimationFrame(raf); },
    state: () => ({ kind, state }),
  };
}
