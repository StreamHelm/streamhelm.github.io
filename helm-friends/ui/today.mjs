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

  // ───── launch audit (Sky): a role lobby (bank heist and any future role-based event) is a big sheet at the top of EVERY
  // screen, pushed live (SSE / panel PubSub → GET /lobbies): the countdown, a bet box and ONE BIG BUTTON PER ROLE (what it
  // does, open / taken / by whom, single seats marked). One tap joins with that role through the same cloud path as the chat
  // command; once in: "You're in as <role>", tap another role to switch, or leave (stake back) while the lobby is open.
  // Driven only by the lobby view's `roles` list from core, so new role-based games show up here without UI changes.
  const minimized = new Set(), seen = new Set();
  async function roleAct(l, kind, role) {
    if (busy) return; busy = true; render();
    const f = forms.get(l.id) || {};
    try {
      let r, msg;
      if (kind === 'join') {
        r = await api.joinGame(l.id, { amount: Number(f.amount) || (l.bet && l.bet.min) || 0, role: role || null });
        msg = `You're in as ${roleName(l, r.role) || 'crew'}!`;
      } else if (kind === 'switch') {
        r = await api.lobbyRole(l.id, role);
        msg = r.contested ? `You asked for ${roleName(l, role)} - one seat, drawn fairly when it starts. For now you're ${roleName(l, r.role)}.` : `Switched: you're now ${roleName(l, r.role)}.`;
      } else {
        r = await api.lobbyLeave(l.id);
        msg = `You left ${l.title.replace(/^(A|The) /, 'the ')}${r.refunded ? ` - ${psd(r.refunded)} back` : ''}.`;
      }
      store.set({ me: r.me || store.get().me, lobbies: (store.get().lobbies || []).map((x) => (x.id === l.id && r.lobby ? r.lobby : x)) });
      // the sheet itself shows "You're in as …" (join / switch): a toast only when the sheet's status goes away (leave) or a
      // contested seat needs explaining; screen readers always hear it
      if (kind === 'leave' || (r && r.contested)) toast(msg, { kind: 'info' });
      announce(msg);
    } catch (e) { toast(e.message || "That didn't work - try again", { kind: 'error' }); if (actions.reloadLobbies) actions.reloadLobbies(); }
    finally { busy = false; render(); }
  }
  const roleName = (l, key) => { const r = (l.roles || []).find((x) => x.role === key); return r ? r.name : key; };
  /** My place in a lobby (matched by display name, like the overlay's join panel): { role, wants } or null. */
  function mine(l, st) {
    const me = st.me && st.me.displayName;
    if (!me) return null;
    const i = (l.people || []).indexOf(me);
    if (i < 0) return null;
    const wants = (l.roles || []).find((r) => (r.wanting || []).includes(me));
    return { role: (l.crewRoles || [])[i] || null, wants: wants ? wants.role : null };
  }
  function roleSheet(l, st) {
    const left = Math.max(0, l.closesAt - now()), you = mine(l, st), f = forms.get(l.id) || { amount: l.bet ? String(Math.max(l.bet.min, 100)) : '' };
    forms.set(l.id, f);
    const id = 'rs-' + l.id;
    const head = h('div', { class: 'rs-head' },
      h('span', { class: 'rs-live', 'aria-hidden': 'true' }, 'LIVE'),
      h('h2', { class: 'rs-title', id: id + '-t' }, l.title),
      h('span', { class: 'rs-timer', 'data-closes': l.closesAt, 'aria-label': `closes in ${fmtWait(left)}` }, fmtWait(left)),
      h('button', { type: 'button', class: 'rs-min', 'aria-expanded': String(!minimized.has(l.id)), 'aria-controls': id + '-b', 'data-fk': 'rs-min-' + l.id,
        onclick: () => { if (minimized.has(l.id)) minimized.delete(l.id); else minimized.add(l.id); render(); } }, minimized.has(l.id) ? 'Show' : 'Hide'));
    const sub = h('p', { class: 'rs-sub' }, `${l.count}/${l.max} in${l.chance ? ` · ${l.chance}% chance right now` : ''}${l.bet ? ` · bet ${fmt(l.bet.min)}–${fmt(l.bet.max)}` : ''}`);
    if (minimized.has(l.id)) return h('section', { class: 'role-sheet min', 'data-lobby': l.id, 'data-game': l.game, 'aria-labelledby': id + '-t' }, head, you ? h('p', { class: 'rs-in' }, `You're in as ${roleName(l, you.role)}.`) : sub);
    const status = you
      ? h('div', { class: 'rs-in', role: 'status', 'data-testid': 'rs-in' },
        h('p', null, "You're in as ", h('b', null, roleName(l, you.role)), you.wants ? ` - and in the draw for ${roleName(l, you.wants)}` : '', '. Tap another role to switch.'),
        h('button', { type: 'button', class: 'btn small ghost', disabled: busy, 'data-fk': 'rs-leave-' + l.id, onclick: () => roleAct(l, 'leave') }, 'Leave (bet back)'))
      : st.loggedIn && l.bet
        ? h('label', { class: 'rs-bet' }, 'Your bet ', h('input', { type: 'number', inputmode: 'numeric', min: l.bet.min, max: l.bet.max, value: f.amount, 'aria-label': `Your bet in ${PSD}`, 'data-fk': 'rs-amount-' + l.id, oninput: (e) => { f.amount = e.target.value; } }),
          h('span', { class: 'muted' }, ' then tap a role'))
        : null;
    const btns = h('div', { class: 'rs-roles', role: 'group', 'aria-label': 'Roles' }, (l.roles || []).map((r) => {
      const isMine = you && you.role === r.role, others = r.people.filter((p) => !(st.me && p === st.me.displayName));
      const who = isMine ? 'You' + (others.length ? ' + ' + others.join(', ') : '') : r.single && others.length ? `Held by ${others[0]}${r.wanting && r.wanting.length ? ` · ${r.wanting.length} in the draw` : ''} - tap to enter the draw` : others.length ? others.join(', ') : 'Open';
      return h('button', { type: 'button', class: ['rs-role', isMine && 'mine', r.single && 'single', r.open ? 'open' : 'taken', r.people.length && 'has-people'], 'aria-pressed': String(!!isMine), 'data-role': r.role, 'data-fk': `rs-role-${l.id}-${r.role}`,
        disabled: busy || !st.loggedIn || isMine, onclick: () => roleAct(l, you ? 'switch' : 'join', r.role) },
        h('span', { class: 'rs-name' }, r.name, r.single ? h('span', { class: 'rs-one' }, 'ONE SEAT') : null),
        h('span', { class: 'rs-what' }, r.what),
        h('span', { class: 'rs-who' }, who));
    }));
    const extra = !st.loggedIn
      ? h('div', { class: 'rs-login' }, h('p', null, 'Log in to join from here - or use chat:'), h('button', { type: 'button', class: 'btn small primary', 'data-fk': 'rs-login-' + l.id, onclick: () => actions.login() }, 'Log in'))
      : !you ? h('button', { type: 'button', class: 'btn small', disabled: busy, 'data-fk': 'rs-any-' + l.id, onclick: () => roleAct(l, 'join', null) }, 'Any open role') : null;
    const chat = (l.join || []).slice(0, 1).map((j) => h('p', { class: 'muted rs-chat' }, 'In chat: ', h('code', null, j.cmd)));
    const fresh = !seen.has(l.id); seen.add(l.id);   // the slide-in plays once, not on every 1-s countdown re-render
    return h('section', { class: ['role-sheet', fresh && 'rs-new'], 'data-lobby': l.id, 'data-game': l.game, 'aria-labelledby': id + '-t' },
      head, h('div', { id: id + '-b', class: 'rs-body' }, sub, status, btns, extra, chat));
  }

  function lobbyBox(l, st) {
    if (Array.isArray(l.roles) && l.roles.length) return roleSheet(l, st);
    const left = Math.max(0, l.closesAt - now());
    const f = forms.get(l.id) || { amount: l.bet ? String(Math.max(l.bet.min, 100)) : '', role: '' };
    forms.set(l.id, f);
    const iAmIn = st.me && (l.people || []).includes(st.me.displayName);
    const head = h('div', { class: 'lobby-head' }, h('b', null, l.title), h('span', { class: 'muted' }, ` · ${l.count}/${l.max} · closes in `, h('span', { 'data-closes': l.closesAt }, fmtWait(left)), l.chance ? ` · ${l.chance}% chance` : ''));
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
    const lob = (st.lobbies || []).filter((l) => l.closesAt > now() - 2000);
    // role lobbies first, above everything else on the screen (launch audit, Sky)
    const roleLob = lob.filter((l) => Array.isArray(l.roles) && l.roles.length), otherLob = lob.filter((l) => !roleLob.includes(l));
    for (const l of roleLob) items.unshift(roleSheet(l, st));
    const ci = checkinBox(st); if (ci) items.push(ci);
    if (otherLob.length) items.push(h('div', { class: 'live-events', role: 'region', 'aria-label': 'Live events' }, h('h2', { class: 'today-title' }, 'Live events - join now'), otherLob.map((l) => lobbyBox(l, st))));
    else if (st.stageEvent && !roleLob.length) items.push(h('p', { class: 'note', 'data-note': 'event-on' }, `${st.stageEvent.name} is on right now - the other games wait until it's over.`));
    // a scrolled-down viewer still sees a role event: a floating "join" bar while the sheet is off screen (tap → the sheet)
    const l0 = roleLob[0];
    if (l0) {
      const you = mine(l0, st);
      items.push(h('button', { type: 'button', class: 'rs-float', hidden: true, 'data-testid': 'rs-float', 'data-fk': 'rs-float',
        onclick: () => { const s = el.querySelector('.role-sheet'); if (!s) return; minimized.delete(l0.id); render(); const s2 = el.querySelector('.role-sheet'); s2.scrollIntoView({ block: 'start', behavior: 'smooth' }); const t = s2.querySelector('.rs-title'); if (t) { t.tabIndex = -1; t.focus({ preventScroll: true }); } } },
        h('span', { class: 'rs-live', 'aria-hidden': 'true' }, 'LIVE'), ' ',
        h('b', null, l0.title), ' · ', h('span', { 'data-closes': l0.closesAt }, fmtWait(Math.max(0, l0.closesAt - now()))), ' · ', you ? `you're in as ${roleName(l0, you.role)}` : 'tap to pick a role'));
    }
    renderKeepingFocus(el, () => mount(el, items));
    updateFloat();
    clearTimeout(timer);
    if (lob.length) timer = setTimeout(tick, 1000);
  }
  /** The countdowns tick in place (re-rendering every second would swap the buttons under a viewer's finger). */
  function tick() {
    const t = now(), lob = store.get().lobbies || [];
    if (lob.some((l) => l.closesAt <= t - 2000 && l.closesAt > t - 3100)) return render();   // one just closed: drop it
    for (const e of el.querySelectorAll('[data-closes]')) { const w = fmtWait(Math.max(0, Number(e.dataset.closes) - t)); if (e.textContent !== w) e.textContent = w; if (e.hasAttribute('aria-label')) e.setAttribute('aria-label', 'closes in ' + w); }
    timer = setTimeout(tick, 1000);
  }
  function updateFloat() {
    const f = el.querySelector('.rs-float'), s = el.querySelector('.role-sheet');
    if (!f) return;
    const hdr = document.querySelector('.hf-header'), top = hdr ? hdr.getBoundingClientRect().bottom : 0;
    const r = s && s.getBoundingClientRect(), visible = r && r.height && r.bottom > top + 40 && r.top < innerHeight - 40;
    f.hidden = !s || !!visible || !el.isConnected || !el.offsetParent;
  }
  addEventListener('scroll', updateFloat, { passive: true });
  addEventListener('resize', updateFloat);

  store.subscribe(render);
  render();
  return { el, render };
}
