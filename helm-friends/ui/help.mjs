// "Help & how-to": plain-English cards from core help (the same source as the chat's !hfhelp), plus a list of every
// chat command. The cloud's /config sends help built from Sky's tuned economy; without it, core's defaults are used.

import { HELP, COMMANDS, helpFor, PSD } from '../core/index.mjs';
import { h, icon, mount } from './h.mjs';

const WHO = { everyone: 'Everyone', mod: 'Mods and Sky', broadcaster: 'Sky' };

/** Every command as one row: triggers, who may use it, the usage example and what it's about (from help). */
export function commandRows(help = HELP) {
  return Object.entries(COMMANDS).map(([key, c]) => {
    const entry = helpFor(key, help);
    return { key, triggers: c.triggers, who: WHO[c.who] || c.who, usage: c.usage, about: entry ? entry.title : '' };
  });
}

/**
 * @param {{ store:Object, mode:'web'|'ext'|'local', links:{ privacy:string, terms:string } }} o
 */
export function createHelp({ store, mode, links }) {
  const el = h('section', { 'aria-labelledby': 'help-title' });

  function render() {
    const help = (store.get().help && store.get().help.length ? store.get().help : HELP);
    mount(el,
      h('h2', { class: 'page-title', id: 'help-title' }, 'Help & how-to'),
      h('p', null, "Pepe's Helm Friends is the channel's little world of pixel characters. Make your own Helm Friend here; it walks around on Sky's stream when you chat."),
      mode === 'ext' ? h('p', { class: 'small muted' }, `The chat games happen in chat and on the stream, just for fun with free ${PSD}. This panel is for your character, challenges, unlocks and help.`) : null,
      help.map(card),
      h('h3', { class: 'section-title', id: 'cmd-title' }, 'Every chat command'),
      h('div', { class: 'card' }, h('table', { class: 'hf-table cmd-table', 'aria-labelledby': 'cmd-title' },
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Type'), h('th', { scope: 'col' }, 'Who'), h('th', { scope: 'col' }, 'What it is'))),
        h('tbody', null, commandRows(help).map((r) => h('tr', { 'data-cmd': r.key },
          h('td', null, r.triggers.map((t, i) => [i ? ' ' : '', h('code', null, t)]), h('div', { class: 'small muted' }, 'e.g. ', r.usage)),
          h('td', null, r.who), h('td', null, r.about)))))),
      h('h3', { class: 'section-title' }, 'Your data'),
      h('div', { class: 'card' },
        h('p', null, `We keep your Twitch name and id, your character, your unlocks and your ${PSD} history — never your messages, email or password. You can hide your character or delete your data any time in Settings.`),
        h('p', null, h('a', { href: links.privacy, target: mode === 'ext' ? '_blank' : null, rel: 'noopener' }, 'Privacy policy'), ' · ',
          h('a', { href: links.terms, target: mode === 'ext' ? '_blank' : null, rel: 'noopener' }, 'Terms of use'))));
  }

  function card(e, i) {
    const id = 'help-' + e.id;
    return h('details', { class: 'card help-card', id, 'data-help': e.id, open: i < 2 ? true : null },
      h('summary', null, h('h3', null, e.title), icon('right')),
      e.who && e.commands.length ? h('p', { class: 'who muted' }, 'Who: ' + e.who) : null,
      e.text.map((t) => h('p', null, t)),
      e.syntax ? h('p', null, 'Type: ', h('code', null, e.syntax), e.example ? [' — for example ', h('code', null, e.example)] : null) : null,
      e.table ? h('table', { class: 'hf-table' },
        h('thead', null, h('tr', null, e.table.cols.map((c) => h('th', { scope: 'col' }, c)))),
        h('tbody', null, e.table.rows.map((r) => h('tr', null, r.map((c) => h('td', null, c)))))) : null);
  }

  store.subscribe((s, keys) => { if (keys.includes('help')) render(); });
  render();
  return { el };
}
