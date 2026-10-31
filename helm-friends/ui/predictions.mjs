// The live prediction strip (DESIGN §6.1): one bar per option. A bar's length is its share of points + Dollahs
// (core bars()); inside it the outcome colour is the channel-point part and silver the Dollah part. Under each bar:
// "12,400 pts (31 people) · 3,250 Dollahs (9 people)" (core barCaption()). Viewers can bet Dollahs here.

import { bars as barsOf, barCaption, fmt, fmtWait, PSD, psd } from '../core/index.mjs';
import { h, mount } from './h.mjs';
import { renderKeepingFocus, announce } from './a11y.mjs';
import { toast } from './toast.mjs';
/** v1.9: the winning option ids (several = a tie; older records only have `winner`). */
const winIds = (p) => (Array.isArray(p.winners) && p.winners.length ? p.winners : p.winner ? [p.winner] : []);

const COLORS = { blue: '#387aff', pink: '#f5009b' };
const PALETTE = ['#387aff', '#f5009b', '#1fbf6b', '#ffb020', '#9b5cff', '#00bcd4', '#ff6b3d', '#c0ca33', '#ec407a', '#8d6e63'];
const colorOf = (o, i) => COLORS[o.color] || (/^#[0-9a-f]{6}$/i.test(o.color || '') ? o.color : PALETTE[i % PALETTE.length]);

/**
 * @param {{ store:Object, api:Object, actions:Object, now:()=>number }} o
 */
export function createPredictions({ store, api, actions, compact = false, now = () => Date.now() }) {
  const el = h('div', { class: 'pred-wrap' });
  // compact (the 318-px panel): the strip starts folded to one line so the rest of the panel stays reachable
  let pick = null, amount = '', busy = false, timer = 0, expanded = !compact;

  function render() {
    const st = store.get(), cur = st.prediction;
    const p = cur && cur.prediction;
    if (!p || p.status === 'canceled' || (p.status === 'resolved' && now() - (p.resolvedAt || p.locksAt) > 120000)) { mount(el); return; }
    const view = cur.bars && cur.bars.length ? cur.bars : barsOf(p);
    const mine = st.myBet && st.myBet.prediction === p.id ? st.myBet : null;
    const open = p.status === 'open' && now() < p.locksAt;
    const statusText = p.status === 'resolved' ? `${winIds(p).length > 1 ? 'Tie' : 'Result'}: ${p.outcomes.filter((o) => winIds(p).includes(o.id)).map((o) => o.title).join(' & ') || '—'}`
      : open ? `Betting closes in ${fmtWait(p.locksAt - now())}` : 'Betting is closed — waiting for the result';
    const pointsName = st.pointsName || 'pts';
    const body = [
      h('p', { class: 'pred-status' }, statusText),
      p.twitchStatus === 'canceled' && p.status !== 'canceled' ? h('p', { class: 'note warn' }, `Channel points were refunded by Twitch — the ${PSD} side is still running.`) : null,
      h('div', { class: 'legend', 'aria-hidden': 'true' }, h('span', null, h('i', { class: 'l-cp' }), 'channel points'), h('span', null, h('i', { class: 'l-d' }), PSD)),
      p.outcomes.map((o, i) => bar(o, i, view.find((b) => b.outcome === o.id) || { pct: 0, cpPct: 100, dPct: 0, points: 0, dollahs: 0, pointUsers: 0, bettors: 0 }, p, pointsName)),
      open ? betForm(p, st, mine) : null,
    ];
    const title = h('h2', { id: 'pred-title' }, p.title);
    renderKeepingFocus(el, () => mount(el, compact
      ? h('details', { class: 'pred', 'data-pred': p.id, open: expanded, ontoggle: (e) => { expanded = e.target.open; } },
        h('summary', { 'data-fk': 'pred-toggle' }, h('span', { class: 'small muted' }, 'Live prediction · tap to ', expanded ? 'hide' : 'bet'), title), body)
      : h('section', { class: 'pred', 'aria-labelledby': 'pred-title', 'data-pred': p.id }, title, body)));
  }

  function bar(o, i, b, p, pointsName) {
    const fill = h('div', { class: 'bar-fill' });
    fill.style.width = b.pct + '%';
    const cp = h('div', { class: 'bar-cp' }), d = h('div', { class: 'bar-d' });
    cp.style.width = b.cpPct + '%'; cp.style.background = colorOf(o, i); d.style.width = b.dPct + '%';
    fill.append(cp, d);
    const winner = p.status === 'resolved' && winIds(p).includes(o.id);
    return h('div', { class: 'bar-row', 'data-outcome': o.id },
      h('div', { class: 'bar-label' }, h('span', null, `${o.n}. ${o.title}${winner ? ' — winner' : ''}`), h('span', null, b.pct + '%')),
      h('div', { class: 'bar-track', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': b.pct, 'aria-label': `Option ${o.n}, ${o.title}: ${b.pct} percent` }, fill),
      h('div', { class: 'bar-caption' }, barCaption(b, pointsName)));
  }

  function betForm(p, st, mine) {
    if (!st.loggedIn) {
      return h('button', { type: 'button', class: 'btn block', 'data-fk': 'bet-login', onclick: () => actions.login() },
        st.mode === 'ext' ? `Connect your Twitch name to bet ${PSD}` : `Log in to bet ${PSD}`);
    }
    const locked = mine ? mine.outcome : null;
    if (locked) pick = locked;
    if (!pick) pick = p.outcomes[0].id;
    return h('form', { class: 'bet-form', onsubmit: (e) => { e.preventDefault(); bet(p); } },
      h('label', { class: 'field' }, h('span', null, locked ? 'Your option (you can top up)' : 'Option'),
        h('select', { 'data-fk': 'bet-pick', disabled: !!locked, onchange: (e) => { pick = e.target.value; } },
          p.outcomes.map((o) => h('option', { value: o.id, selected: o.id === pick }, `${o.n}. ${o.title}`)))),
      h('label', { class: 'field' }, h('span', null, `Bet (${PSD})`),
        h('input', { type: 'number', min: p.minBet || 10, max: p.maxBet || 10000, step: 1, inputmode: 'numeric', value: amount, 'data-fk': 'bet-amount', required: true,
          oninput: (e) => { amount = e.target.value; } })),
      h('button', { type: 'submit', class: 'btn primary', 'data-fk': 'bet-go', disabled: busy }, mine ? `Add to my bet (${fmt(mine.amount)} so far)` : `Bet ${PSD}`));
  }

  async function bet(p) {
    const n = Number(amount);
    if (!Number.isSafeInteger(n) || n < 1) { toast(`Type a whole number of ${PSD}.`, { kind: 'error' }); return; }
    busy = true; render();
    try {
      const r = await api.bet(p.id, pick, n);
      if (r.me) store.set({ me: r.me });
      store.set({ myBet: { prediction: p.id, outcome: pick, amount: (r.bet && r.bet.amount) || n } });
      amount = '';
      toast(`Bet placed: ${psd(n)}.`, { kind: 'win' });
      announce('Bet placed');
      actions.refreshPrediction();
    } catch (e) { toast(e.message, { kind: 'error' }); } finally { busy = false; render(); }
  }

  store.subscribe((s, keys) => { if (keys.some((k) => ['prediction', 'loggedIn', 'myBet'].includes(k))) render(); });
  render();
  timer = setInterval(() => { const p = store.get().prediction; if (p && p.prediction && p.prediction.status === 'open') render(); }, 1000);
  return { el, stop: () => clearInterval(timer) };
}
