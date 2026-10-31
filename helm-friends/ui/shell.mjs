// The app shell (DESIGN §10): header ("Pepe's Helm Friends" + balance with the coin's heads side), the menu, the
// status notes (offline, Sky not live, log in / connect), the PLAYTEST ribbon and the main area.
// The balance chip shows only the number + the coin (no currency word: Sky, v1.14); screen readers hear the full name.

import { fmt, PSD } from '../core/index.mjs';
import { h, icon, mount } from './h.mjs';
import { renderKeepingFocus } from './a11y.mjs';

const COIN = {
  64: new URL('./img/coin-heads-64.png', import.meta.url).href,
  128: new URL('./img/coin-heads-128.png', import.meta.url).href,
};

/** The coin's heads side (decorative, the number next to it carries the meaning). */
export function coinImg(cls = 'coin') {
  return h('img', { class: cls, src: COIN[64], srcset: `${COIN[64]} 1x, ${COIN[128]} 2x`, alt: '', width: 34, height: 34, decoding: 'async' });
}

export const MENU = [
  { id: 'character', label: 'Make your character', short: 'Character', icon: 'user' },
  { id: 'play', label: 'Play & challenges', short: 'Play', icon: 'swords' },   // v1.14
  { id: 'unlocks', label: 'Channel unlocks', short: 'Unlocks', icon: 'gift' },
  { id: 'help', label: 'Help & how-to', short: 'Help', icon: 'help' },
];

/**
 * @param {{ mode:'web'|'ext'|'local', go:(route:string)=>void, actions:Object, links:{ privacy:string, terms:string, app?:string } }} o
 */
export function createShell({ mode, go, actions, links }) {
  const compact = mode === 'ext';
  const balanceBox = h('div', { class: 'hf-balance-box' });
  const header = h('header', { class: 'hf-header' },
    h('h1', { class: 'hf-title' }, "Pepe's ", h('b', null, 'Helm'), ' Friends'),
    balanceBox,
    h('button', { type: 'button', class: 'hf-iconbtn', 'aria-label': 'Settings', 'data-fk': 'nav-settings', onclick: () => go('settings') }, icon('gear')));
  const menuBtns = MENU.map((m) => h('button', { type: 'button', 'data-route': m.id, 'data-fk': 'nav-' + m.id, onclick: () => go(m.id) },
    // ("how-to" never splits at its hyphen)
    icon(m.icon), h('span', { class: 'menu-label' }, (compact ? m.short : m.label).split(' ').map((w, i) => [i ? ' ' : '', /-/.test(w) ? h('span', { class: 'nw' }, w) : w])),
    h('span', { class: 'menu-badge', hidden: true, 'aria-hidden': 'true', 'data-badge': m.id })));
  const menu = h('nav', { class: 'hf-menu', 'aria-label': 'Main menu' }, menuBtns);
  const notes = h('div', { class: 'hf-notes' });
  const live = h('div', { class: 'hf-live', 'aria-label': 'Live now', role: 'region' });
  const main = h('main', { class: 'hf-main', id: 'hf-main', tabindex: '-1' });
  const ribbon = h('div', { class: 'ribbon', hidden: true, role: 'note' }, h('b', null, 'PLAYTEST'), compact ? ' · resets before launch' : ' · everything resets before the real launch');
  const footer = h('footer', { class: 'footer' },
    h('p', null, `${PSD} are free play money with no cash value.`),
    h('p', null,
      links.app && h('a', { href: links.app, target: '_blank', rel: 'noopener' }, 'Open the full web app'),
      h('a', { href: links.privacy, target: compact ? '_blank' : null, rel: 'noopener' }, 'Privacy'),
      h('a', { href: links.terms, target: compact ? '_blank' : null, rel: 'noopener' }, 'Terms')));
  const el = h('div', { class: ['hf-app', compact && 'compact'], 'data-mode': mode },
    h('a', { class: 'skip-link', href: '#hf-main' }, 'Skip to content'),
    ribbon, header, menu, notes, live, main, footer);

  function update(st) {
    ribbon.hidden = !(st.season && st.season.playtest);
    for (const b of menuBtns) { if (b.dataset.route === st.route) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
    // v1.14: the Play tab shows how many challenges wait for an answer
    const n = (st.loggedIn && st.challenges && st.challenges.incoming.length) || 0;
    const badge = menu.querySelector('[data-badge=play]'), playBtn = menu.querySelector('[data-route=play]');
    badge.hidden = !n; badge.textContent = String(n);
    if (n) playBtn.setAttribute('aria-label', `Play & challenges, ${n} challenge${n === 1 ? '' : 's'} waiting`); else playBtn.removeAttribute('aria-label');
    renderKeepingFocus(balanceBox, () => mount(balanceBox, balanceButton(st)));
    renderKeepingFocus(notes, () => mount(notes, noteList(st)));
  }

  function balanceButton(st) {
    if (!st.loggedIn) {
      const label = mode === 'ext' ? 'Connect' : 'Log in';
      return h('button', { type: 'button', class: 'btn small solid', 'data-fk': 'login', onclick: () => actions.login() }, label);
    }
    const n = st.me ? st.me.balance : null, text = n == null ? '…' : fmt(n);
    return h('button', {
      type: 'button', class: 'hf-balance', 'data-fk': 'balance', 'data-testid': 'balance',
      'aria-label': n === -1 ? `Balance: unlimited ${PSD} (playtest). Show history` : `Balance: ${text} ${PSD}. Show history`,
      onclick: () => go('history'),
    }, h('span', { 'aria-hidden': 'true' }, text), coinImg());
  }

  function noteList(st) {
    const out = [];
    const note = (kind, text, btn, id) => out.push(h('div', { class: ['note', kind], 'data-note': id }, h('p', null, text), btn));
    if (st.online === false) {
      note('error', `Can't reach the Helm Friends server right now. Your character and ${PSD} are safe; try again in a moment.`,
        h('button', { type: 'button', class: 'btn small', 'data-fk': 'retry', onclick: () => actions.refresh() }, 'Try again'), 'offline');
    } else if (st.live === false) {
      note('', 'Sky is offline right now. Everything here still works; chat games and live-only unlocks wait for the stream.', null, 'not-live');
    }
    if (!st.loggedIn && st.online !== false) {
      if (mode === 'ext') {
        note('warn', st.extAuthed ? `Connect your Twitch name to save your character and spend your ${PSD}.` : 'Log in to Twitch to make your own character.',
          st.extAuthed ? h('button', { type: 'button', class: 'btn small primary', 'data-fk': 'link', onclick: () => actions.login() }, 'Connect my Twitch name') : null, 'link');
      } else if (mode === 'web') {
        note('warn', `Log in with Twitch to save your character and use your ${PSD}. You can look around first.`,
          h('button', { type: 'button', class: 'btn small primary', 'data-fk': 'login-note', onclick: () => actions.login() }, 'Log in with Twitch'), 'login');
      }
    }
    return out;
  }

  return { el, main, live, update };
}
