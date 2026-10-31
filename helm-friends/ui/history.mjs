// "My history": the viewer's ledger rows (CONTRACTS §6.1 GET /me/ledger), newest first, 50 at a time.

import { fmt, PSD } from '../core/index.mjs';
import { h, mount } from './h.mjs';
import { toast } from './toast.mjs';

const when = (ms) => {
  try { return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return new Date(ms).toISOString(); }
};

export function createHistory({ store, api, actions }) {
  const list = h('ul', { class: 'ledger', 'aria-label': 'Transactions' });
  const more = h('button', { type: 'button', class: 'btn block', hidden: true, onclick: () => load(true) }, 'Show older');
  const status = h('p', { class: 'small muted', role: 'status' });
  const el = h('section', { 'aria-labelledby': 'hi-title' }, h('h2', { class: 'page-title', id: 'hi-title' }, `My ${PSD} history`), status, list, more);
  let rows = [], loading = false;

  async function load(older = false) {
    if (loading) return;
    if (!store.get().loggedIn) { mount(list); status.textContent = ''; mount(status, 'Log in to see your history. ', h('button', { type: 'button', class: 'btn small solid', onclick: () => actions.login() }, 'Log in')); return; }
    loading = true; status.textContent = 'Loading…';
    try {
      const before = older && rows.length ? rows[rows.length - 1].id : undefined;
      const r = await api.ledger(before, 50);
      rows = older ? rows.concat(r.rows) : r.rows;
      more.hidden = r.rows.length < 50;
      status.textContent = rows.length ? `${rows.length} transaction${rows.length === 1 ? '' : 's'}` : `Nothing yet — you earn ${PSD} by watching and chatting.`;
      mount(list, rows.map((x) => h('li', null,
        h('span', { class: 'memo' }, x.memo || x.kind),
        h('span', { class: 'when' }, when(x.at)),
        h('span', { class: ['delta', x.delta >= 0 ? 'plus' : 'minus'], 'aria-label': `${x.delta >= 0 ? 'plus' : 'minus'} ${fmt(Math.abs(x.delta))} ${PSD}` },
          (x.delta >= 0 ? '+' : '−') + fmt(Math.abs(x.delta))))));
    } catch (e) { status.textContent = ''; toast(e.message, { kind: 'error' }); } finally { loading = false; }
  }

  store.subscribe((s, keys) => { if (s.route === 'history' && (keys.includes('route') || keys.includes('me') || keys.includes('loggedIn'))) load(); });
  return { el, load };
}
