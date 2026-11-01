// The desktop side column (launch audit, Sky approved the two-column layout): shown only at ≥ 1100 px (CSS
// `.side-only`), under the live things (role sheet, challenges, check-in, prediction), so the left column is never empty:
//   - "My Helm Friend": your character (the editor's compositor), balance (number + silver coin), streak, title / bounty
//   - "What's on": Sky live or not, the big event on stage, which events start by themselves (/config `auto`),
//     the last results (settled games from the live feed)
//   - quick links to the four pages
// Below 1100 px it isn't shown at all (phones, tablets portrait, the panel): everything here is on the pages already.

import { fmt, PSD, psd, EVENT_NAMES } from '../core/index.mjs';
import { h, icon, mount } from './h.mjs';
import { renderKeepingFocus } from './a11y.mjs';
import { coinImg, MENU } from './shell.mjs';

export function createSide({ store, art, go, actions }) {
  const el = h('aside', { class: 'side-only side', 'aria-label': 'You and what is on' });
  const canvas = h('canvas', { class: 'side-avatar', width: 128, height: 128, role: 'img', 'aria-label': 'Your Helm Friend' });
  let pack = null, drawnKey = '';
  art.then((p) => { pack = p; draw(); }, () => { });

  async function draw() {
    const st = store.get(), spec = st.character && st.character.spec;
    if (!pack || !spec || !st.catalog) return;
    const k = JSON.stringify(spec);
    if (k === drawnKey) return;
    drawnKey = k;
    try {
      const r = await pack.compose(spec, st.catalog, { anim: 'idle', dir: 'front', frame: 0 });
      canvas.width = r.w; canvas.height = r.h;
      const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
      ctx.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.w, r.h), 0, 0);
    } catch { drawnKey = ''; }
  }

  function meCard(st) {
    const me = st.me;
    if (!st.loggedIn || !me) {
      return h('section', { class: 'card side-me' }, h('h2', { class: 'side-title' }, 'Your Helm Friend'),
        h('p', { class: 'small muted' }, `Log in to make your own character, earn ${PSD} by watching and play on stream.`),
        actions.login ? h('button', { type: 'button', class: 'btn small primary', 'data-fk': 'side-login', onclick: () => actions.login() }, 'Log in with Twitch') : null);
    }
    const c = me.checkin || {};
    return h('section', { class: 'card side-me', 'data-testid': 'side-me' },
      h('h2', { class: 'side-title' }, 'Your Helm Friend'),
      h('div', { class: 'side-me-row' },
        h('button', { type: 'button', class: 'side-avatar-btn', 'aria-label': 'Change my character', onclick: () => go('character') }, canvas),
        h('div', { class: 'side-facts' },
          h('b', { class: 'side-name' }, me.displayName || ''),
          me.title ? h('span', { class: 'side-badge' }, me.title) : null,
          me.bounty ? h('span', { class: 'side-badge wanted' }, `WANTED · ${fmt(me.bounty)}`) : null,
          h('span', { class: 'side-bal', 'aria-label': me.balance === -1 ? `unlimited ${PSD}` : psd(me.balance) }, me.balance === -1 ? '∞' : fmt(me.balance), coinImg('coin-sm')),
          c.enabled ? h('span', { class: 'small muted' }, c.streak ? `${c.streak}-day check-in streak` : 'No check-in streak yet') : null)));
  }

  function whatsOn(st) {
    const items = [];
    items.push(h('li', null, h('span', { class: ['dot', st.live ? 'on' : 'off'], 'aria-hidden': 'true' }), st.live ? 'Sky is live - chat games are on' : 'Sky is offline - chat games wait for the stream'));
    if (st.stageEvent) items.push(h('li', null, icon('clock'), `${st.stageEvent.name} is on right now`));
    for (const a of st.auto || []) {
      const how = [a.everyMin ? `about every ${a.everyMin} min` : null, a.chance ? `a ${a.chance.pct}% chance each ${a.chance.windowMin} min` : null].filter(Boolean).join(' or ');
      items.push(h('li', null, icon('clock'), `${EVENT_NAMES[a.kind] || a.kind} can start by itself while Sky is live${how ? ` (${how})` : ''}`));
    }
    const recent = (st.recentGames || []).slice(0, 5);
    return h('section', { class: 'card side-on', 'data-testid': 'side-on' },
      h('h2', { class: 'side-title' }, "What's on"),
      h('ul', { class: 'side-list' }, items),
      h('h3', { class: 'side-sub' }, 'Latest results'),
      recent.length ? h('ul', { class: 'side-list results' }, recent.map((g) => h('li', null, g.summary)))
        : h('p', { class: 'small muted' }, 'No games yet this session - results show up here as they happen.'));
  }

  function links() {
    return h('nav', { class: 'card side-links', 'aria-label': 'Quick links' },
      MENU.map((m) => h('button', { type: 'button', class: 'btn small ghost', 'data-fk': 'side-' + m.id, onclick: () => go(m.id) }, icon(m.icon), m.short)));
  }

  function render() {
    const st = store.get();
    renderKeepingFocus(el, () => mount(el, [meCard(st), whatsOn(st), links()]));
    draw();
  }
  store.subscribe(render);
  render();
  return { el, render };
}
