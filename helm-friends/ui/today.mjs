// "Today" (v1.11, round 3): the strip above every screen of the web app and the Twitch panel.
//   - the daily check-in button + the streak (POST /me/checkin; once a day, the server makes a double tap pay once)
//   - "We made you a Helm Friend - make it yours!" for a character the cloud made automatically (Me.characterAuto)
//   - the follow note for a viewer who doesn't follow yet (Me.follows === false)
//   - LIVE EVENTS: every open lobby (GET /lobbies) with a Join button; a heist shows every role (taken / open, by whom) and
//     takes a bet + a role (POST /games/:id/join) — the same lobby view the EVENT JOIN overlay panel shows
import { fmt, fmtWait, PSD, psd } from '../core/index.mjs';
import { h, mount } from './h.mjs';
import { renderKeepingFocus, announce } from './a11y.mjs';
import { toast } from './toast.mjs';

export function createToday({ store, api, actions, go, now = () => Date.now() }) {
  const el = h('section', { class: 'today', 'aria-label': 'Today' });
  let busy = false, timer = 0;
  const forms = new Map();   // lobby id → { amount, role }

  async function checkin() {
    if (busy) return; busy = true; render();
    try {
      const r = await api.checkin();
      store.set({ me: r.me });
      const msg = `Checked in: +${psd(r.checkin.amount)} (day ${r.checkin.streak} in a row)`;
      toast(msg, { kind: 'win' }); announce(msg);
    } catch (e) { toast(e.message || 'Check-in failed', { kind: 'error' }); }
    finally { busy = false; render(); }
  }

  async function join(l) {
    if (busy) return; busy = true; render();
    const f = forms.get(l.id) || {};
    try {
      const body = l.game === 'heist' ? { amount: Number(f.amount) || l.bet.min, role: f.role || null } : {};
      const r = await api.joinGame(l.id, body);
      store.set({ me: r.me, lobbies: (store.get().lobbies || []).map((x) => (x.id === l.id && r.lobby ? r.lobby : x)) });
      const msg = l.game === 'heist' ? `You're in the heist${r.role ? ' as ' + r.role : ''}!` : `You joined ${l.title.replace(/^(A|The) /, 'the ')}!`;
      toast(msg, { kind: 'info' }); announce(msg);
    } catch (e) { toast(e.message || "Couldn't join", { kind: 'error' }); }
    finally { busy = false; render(); }
  }

  function checkinBox(st) {
    const me = st.me, c = me && me.checkin;
    if (!st.loggedIn || !c || !c.enabled) return null;
    return h('div', { class: 'today-card checkin', 'data-testid': 'checkin' },
      h('div', null, h('b', null, c.done ? `Checked in today · ${c.streak}-day streak` : c.streak ? `Day ${c.next} of your streak` : 'Daily check-in'),
        h('p', { class: 'muted' }, c.done ? `Come back tomorrow for +${fmt(c.bonus)}.` : `Check in now for +${psd(c.bonus)}${c.streak ? ' - keep the streak going!' : '.'}`)),
      h('button', { type: 'button', class: 'btn small primary', 'data-fk': 'checkin', disabled: c.done || busy, onclick: checkin }, c.done ? 'Done ✓' : 'Check in'));
  }

  function lobbyBox(l, st) {
    const left = Math.max(0, l.closesAt - now());
    const f = forms.get(l.id) || { amount: l.bet ? String(Math.max(l.bet.min, 100)) : '', role: '' };
    forms.set(l.id, f);
    const iAmIn = st.me && (l.people || []).includes(st.me.displayName);
    const head = h('div', { class: 'lobby-head' }, h('b', null, l.title), h('span', { class: 'muted' }, ` · ${l.count}/${l.max} · closes in ${fmtWait(left)}${l.chance ? ` · ${l.chance}% chance` : ''}`));
    const how = (l.join || []).map((j) => h('p', { class: 'muted' }, 'In chat: ', h('code', null, j.cmd), ` - ${j.what}`));
    let roles = null, controls = null;
    if (l.roles) {
      roles = h('ul', { class: 'roles', 'aria-label': 'Heist roles' }, l.roles.map((r) => h('li', { class: r.open ? 'open' : 'taken', 'data-role': r.role },
        h('b', null, r.name), ' ', h('span', { class: 'muted' }, r.people.length ? r.people.join(', ') : r.single ? 'one seat, open' : 'open'),
        !r.open ? h('span', { class: 'tag' }, ' taken') : null)));
      if (st.loggedIn) {
        controls = h('div', { class: 'lobby-join' },
          h('label', null, 'Bet ', h('input', { type: 'number', inputmode: 'numeric', min: l.bet.min, max: l.bet.max, value: f.amount, 'aria-label': `Heist bet in ${PSD}`, 'data-fk': 'heist-amount-' + l.id, oninput: (e) => { f.amount = e.target.value; } })),
          h('label', null, 'Role ', h('select', { 'aria-label': 'Heist role', 'data-fk': 'heist-role-' + l.id, onchange: (e) => { f.role = e.target.value; } },
            h('option', { value: '' }, 'Any open role'), l.roles.filter((r) => r.open).map((r) => h('option', { value: r.role, selected: f.role === r.role }, r.name)))),
          h('button', { type: 'button', class: 'btn small primary', disabled: busy || iAmIn, 'data-fk': 'join-' + l.id, onclick: () => join(l) }, iAmIn ? "You're in" : 'Join the heist'));
      }
    } else if (st.loggedIn) {
      controls = h('div', { class: 'lobby-join' }, h('button', { type: 'button', class: 'btn small primary', disabled: busy || iAmIn, 'data-fk': 'join-' + l.id, onclick: () => join(l) },
        iAmIn ? "You're in" : l.fee ? `Join (${psd(l.fee)})` : 'Join - free'));
    }
    return h('div', { class: 'today-card lobby', 'data-lobby': l.id, 'data-game': l.game }, head, how, roles, controls);
  }

  function render() {
    const st = store.get(), me = st.me, items = [];
    if (me && me.follows === false) items.push(h('div', { class: 'note warn', 'data-note': 'follow' }, h('p', null, `Follow the channel on Twitch to get your Helm Friend on stream, play the games and earn ${PSD} by watching.`)));
    if (me && me.characterAuto && st.route !== 'character') items.push(h('div', { class: 'note', 'data-note': 'auto-char' }, h('p', null, 'We made you a Helm Friend - make it yours!'),
      h('button', { type: 'button', class: 'btn small primary', 'data-fk': 'auto-char', onclick: () => go('character') }, 'Change my character')));
    const ci = checkinBox(st); if (ci) items.push(ci);
    const lob = (st.lobbies || []).filter((l) => l.closesAt > now() - 2000);
    if (lob.length) items.push(h('div', { class: 'live-events', role: 'region', 'aria-label': 'Live events' }, h('h2', { class: 'today-title' }, 'Live events - join now'), lob.map((l) => lobbyBox(l, st))));
    else if (st.stageEvent) items.push(h('p', { class: 'note', 'data-note': 'event-on' }, `${st.stageEvent.name} is on right now - the other games wait until it's over.`));
    renderKeepingFocus(el, () => mount(el, items));
    clearTimeout(timer);
    if (lob.length) timer = setTimeout(render, 1000);
  }

  store.subscribe(render);
  render();
  return { el, render };
}
