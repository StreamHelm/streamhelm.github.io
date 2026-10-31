// The live character preview: a pixel canvas (3× on the web app, 2× in the panel) playing idle / walk / dance, with
// ‹ › buttons to turn the character. Respects prefers-reduced-motion (shows a still frame). If the art isn't available
// it draws a simple silhouette in the character's colours so the editor still works.

import { hsvToRgb, describeSpec } from '../core/index.mjs';
import { h, icon } from './h.mjs';
import { reducedMotion } from './a11y.mjs';

export const VIEW_DIRS = ['front', 'right', 'back', 'left'];
const DIR_NAMES = { front: 'facing you', right: 'facing right', back: 'facing away', left: 'facing left' };
export const PREVIEW_ANIMS = [['idle', 'Idle'], ['walk', 'Walk'], ['dance', 'Dance']];

/**
 * @param {{ art:Promise<import('./avatar-render.mjs').ArtPack|null>, catalog:()=>Object }} o
 */
export function createPreview({ art, catalog }) {
  const canvas = h('canvas', { class: 'ed-canvas', width: 64, height: 64, role: 'img', 'aria-label': 'Character preview', 'data-testid': 'preview' });
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const scratch = document.createElement('canvas');
  let spec = null, dir = 'front', anim = 'idle', frames = [], token = 0, raf = 0, pack = null, status = 'loading';
  const animated = { any: false };

  art.then((p) => { pack = p; status = p ? 'ready' : 'missing'; if (p && p.frame) { canvas.width = p.frame.w; canvas.height = p.frame.h; ctx.imageSmoothingEnabled = false; } rebuild(); }, () => { status = 'missing'; rebuild(); });

  const turn = (k) => { dir = VIEW_DIRS[(VIEW_DIRS.indexOf(dir) + k + 4) % 4]; rebuild(); announceDir(); };
  const dirLabel = h('span', { class: 'sr-only', 'aria-live': 'polite' });
  const announceDir = () => { dirLabel.textContent = 'Turned: ' + DIR_NAMES[dir]; };
  const animBtns = PREVIEW_ANIMS.map(([id, label]) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(id === anim), 'data-fk': 'anim-' + id,
    onclick: () => { anim = id; for (const b of animBtns) b.setAttribute('aria-pressed', String(b.dataset.fk === 'anim-' + id)); rebuild(); },
  }, label));

  const el = h('div', { class: 'ed-stage' },
    h('div', { class: 'ed-preview-wrap' },
      h('button', { type: 'button', class: 'hf-iconbtn', 'aria-label': 'Turn character left', 'data-fk': 'turn-l', onclick: () => turn(-1) }, icon('left')),
      canvas,
      h('button', { type: 'button', class: 'hf-iconbtn', 'aria-label': 'Turn character right', 'data-fk': 'turn-r', onclick: () => turn(1) }, icon('right'))),
    h('div', { class: 'ed-anims', role: 'group', 'aria-label': 'Preview animation' }, animBtns),
    dirLabel);

  async function rebuild() {
    const my = ++token;
    if (!spec) return;
    canvas.setAttribute('aria-label', 'Character preview: ' + describeSpec(spec, catalog()) + ', ' + DIR_NAMES[dir]);
    if (!pack) { frames = []; drawFallback(); return; }
    const a = pack.anim(anim) || pack.anim('idle') || { frames: 1, fps: 6 };
    const n = reducedMotion() ? 1 : a.frames || 1;
    const out = [];
    animated.any = false;
    try {
      for (let f = 0; f < n; f++) {
        const fr = await pack.compose(spec, catalog(), { anim, dir, frame: f, expr: 'neutral' }, 0);
        if (my !== token) return;
        out.push(fr);
        if (fr.animated) animated.any = true;
      }
    } catch { out.length = 0; }
    if (my !== token) return;
    frames = out;
    canvas.dataset.layers = String(out[0] ? out[0].layers : 0);
    canvas.dataset.built = String(my);   // data-drawn catches up once this build's first frame is on the canvas (tests wait for it)
    if (!out.length || !out[0].layers) { drawFallback(); return; }
    start(a.fps || 8);
  }

  function start(fps) {
    cancelAnimationFrame(raf);
    const t0 = performance.now();
    let last = -1;
    const tick = (now) => {
      const t = now - t0, f = frames.length > 1 ? Math.floor((t / 1000) * fps) % frames.length : 0;
      if (f !== last || animated.any) { last = f; draw(frames[f], t); }
      if ((frames.length > 1 || animated.any) && !reducedMotion() && canvas.isConnected) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  async function draw(fr, t) {
    if (!fr) return;
    let img = fr;
    if (fr.animated && pack && t) img = await pack.compose(spec, catalog(), { anim, dir, frame: frames.indexOf(fr), expr: 'neutral' }, t);
    scratch.width = img.w; scratch.height = img.h;
    scratch.getContext('2d').putImageData(new ImageData(img.data, img.w, img.h), 0, 0);
    const W = canvas.width, H = canvas.height;   // the pack's frame (v1.10: 128×128)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (dir === 'left') ctx.setTransform(-1, 0, 0, 1, W, 0);
    ctx.drawImage(scratch, 0, -img.lift);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    canvas.dataset.drawn = String(token);
  }

  function drawFallback() {
    cancelAnimationFrame(raf);
    canvas.dataset.layers = '0';
    const rgb = (c) => `rgb(${hsvToRgb(c).join(',')})`;
    const s = spec, shirt = s.wear && s.wear.shirt && s.wear.shirt.colors && s.wear.shirt.colors[0];
    const pants = s.wear && s.wear.pants && s.wear.pants.colors && s.wear.pants.colors[0];
    const tall = { short: 0, medium: 3, tall: 6 }[s.height] || 3;
    const k = canvas.width / 64;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(22, 59, 20, 2);
    ctx.fillStyle = pants ? rgb(pants) : '#3a4a6a'; ctx.fillRect(25, 46 - tall / 2, 14, 13 + tall / 2);
    ctx.fillStyle = shirt ? rgb(shirt) : '#5a6a9a'; ctx.fillRect(23, 34 - tall, 18, 13);
    ctx.fillStyle = rgb(s.skin); ctx.fillRect(24, 18 - tall, 16, 16);
    if (s.hair && s.hair.style !== 'hair.bald') { ctx.fillStyle = rgb(s.hair.color); ctx.fillRect(24, 16 - tall, 16, 5); }
    if (dir !== 'back') { ctx.fillStyle = rgb(s.eyes.color); ctx.fillRect(28, 25 - tall, 2, 2); ctx.fillRect(34, 25 - tall, 2, 2); }
  }

  return {
    el,
    /** Shows a spec (call on every change). */
    show(next) { spec = next; rebuild(); },
    state: () => ({ dir, anim, status }),
  };
}
