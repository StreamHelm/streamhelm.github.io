// "Play & challenges" (v1.14): challenge someone who is on stage to a fight, an arm wrestle or a Gleep Race, and answer
// the challenges people send you. The same rules and ledger as the chat commands (!fight @user 100, !accept, !decline):
// the cloud runs these buttons through its chat-command path, so errors read the same ("you only have 40 Pepe's Silvia
// Dollahs", "next game in 20s", "the heist is on right now"...).
//
//   page   - the inbox (incoming: Accept / Decline; outgoing: Call it off) + the "Challenge someone" form
//   inbox  - a banner of incoming challenges shown above every OTHER screen (the app shell's live strip)
//
// Heists, battle royales and the Grand Prix are joined from the Live events card (today.mjs); predictions from the
// prediction strip; check-in from the Today card; channel unlocks on their own screen. Slots, roulette, coin flip and
// Sayok's cursed slot stay chat-only (kept out of the panel for the extension review, and out of the web app for now).

import { fmt, fmtWait, psd, PSD } from '../core/index.mjs';
import { h, icon, mount } from './h.mjs';
import { renderKeepingFocus, announce } from './a11y.mjs';
import { toast } from './toast.mjs';
import { coinImg } from './shell.mjs';

export const CHALLENGE_GAMES = [
  ['fight', 'Fight', 'a fight'], ['armwrestle', 'Arm wrestle', 'an arm wrestle'], ['race', 'Gleep Race', 'a Gleep Race'],
];
const GAME_NAME = Object.fromEntries(CHALLENGE_GAMES.map(([k, , a]) => [k, a]));
const LIMIT_KEY = { fight: 'fight', armwrestle: 'armwrestle', race: 'race' };

/**
 * @param {{ store:Object, api:Object, actions:Object, go:(r:string)=>void, compact?:boolean, now?:()=>number }} o
 */
export function createPlay({ store, api, actions, go, compact = false, now = () => Date.now() }) {
  const form = { game: 'fight', target: '', typed: '', amount: '', filter: '' };
  let busy = false, error = '', timer = 0;
  const el = h('section', { 'aria-labelledby': 'play-title', class: 'play' });
  const inbox = h('div', { class: 'inbox-strip', role: 'region', 'aria-label': 'Challenges for you' });

  const limits = () => {
    const e = store.get().economy || {}, l = e[LIMIT_KEY[form.game]] || e.fight || {};
    return { min: l.minBet || 10, max: l.maxBet || 5000, acceptSec: l.acceptSec || 60 };
  };
  const balance = () => { const me = store.get().me; return me ? me.balance : 0; };
  const left = (c) => Math.max(0, (c.expiresAt || 0) - now());

  // ---------- actions
  async function answer(c, op) {
    if (busy) return;
    busy = true; renderAll();
    try {
      const r = await api.answer(c.id, op);
      actions.setData({ me: r.me || store.get().me, challenges: { incoming: r.incoming || [], outgoing: r.outgoing || [] } });
      const msg = op === 'accept' ? `${cap(GAME_NAME[c.game])} with ${c.from.name} is on - watch the stream!`
        : c.from.id === (store.get().me || {}).twitchId ? 'Challenge called off.' : `You said no to ${c.from.name}.`;
      toast(msg, { kind: op === 'accept' ? 'win' : 'info' }); announce(msg);
    } catch (e) {
      toast(e.message || 'That did not work.', { kind: 'error' });
      actions.reloadChallenges();
    } finally { busy = false; renderAll(); }
  }

  async function send(e) {
    if (e) e.preventDefault();
    if (busy) return;
    const st = store.get();
    if (!st.loggedIn) return actions.login();
    const target = (form.typed.trim() || form.target).replace(/^@/, '');
    const amount = form.amount === '' ? 0 : Number(form.amount);
    const lim = limits();
    error = '';
    if (!target) error = 'Pick someone to challenge first.';
    else if (!Number.isSafeInteger(amount) || amount < 0) error = `Type a whole number of ${PSD} (0 = just for glory).`;
    else if (amount && (amount < lim.min || amount > lim.max)) error = `Bets are ${fmt(lim.min)}–${fmt(lim.max)} ${PSD} (or 0 just for glory).`;
    else if (amount && balance() !== -1 && amount > balance()) error = `You only have ${psd(balance())}.`;
    if (error) { renderAll(); focusError(); return; }
    busy = true; renderAll();
    try {
      const r = await api.challenge(form.game, target, amount);
      actions.setData({ me: r.me || st.me, challenges: { incoming: r.incoming || [], outgoing: r.outgoing || [] } });
      const who = (st.people.find((p) => p.login === target.toLowerCase()) || {}).displayName || target;
      const msg = `Challenge sent! ${who} has ${lim.acceptSec} seconds to accept.`;
      form.typed = ''; form.target = ''; form.amount = '';
      toast(msg, { kind: 'win' }); announce(msg);
    } catch (err) {
      error = err.message || 'The challenge did not go through.';
      toast(error, { kind: 'error' });
    } finally { busy = false; renderAll(); if (error) focusError(); }
  }
  const focusError = () => { const x = el.querySelector('[data-testid=challenge-error]'); if (x) x.focus(); };

  // ---------- pieces
  function stakeText(c) { return c.stake ? psd(c.stake) : 'just for glory'; }

  function incomingCard(c, where) {
    return h('div', { class: 'challenge in', 'data-challenge': c.id, 'data-testid': `${where}-incoming` },
      h('p', null, h('b', null, c.from.name), ` challenges you to ${GAME_NAME[c.game]}`, c.stake ? [' for ', h('b', { class: 'gold' }, psd(c.stake))] : ' (just for glory)', '!'),
      c.bounty ? h('p', { class: 'small gold' }, `Bounty: +${psd(c.bounty)} if the WANTED one loses.`) : null,
      h('p', { class: 'small muted' }, `Answer in ${fmtWait(left(c))}.`),
      h('div', { class: 'row-btns' },
        h('button', { type: 'button', class: 'btn small primary', disabled: busy, 'data-fk': `${where}-accept-${c.id}`, onclick: () => answer(c, 'accept') },
          c.stake ? ['Accept · bet ', fmt(c.stake), coinImg('coin-sm')] : 'Accept'),
        h('button', { type: 'button', class: 'btn small', disabled: busy, 'data-fk': `${where}-decline-${c.id}`, onclick: () => answer(c, 'decline') }, 'Decline')));
  }

  function outgoingCard(c) {
    return h('div', { class: 'challenge out', 'data-challenge': c.id, 'data-testid': 'play-outgoing' },
      h('p', null, `You challenged `, h('b', null, c.to.name), ` to ${GAME_NAME[c.game]} (${stakeText(c)}).`),
      h('p', { class: 'small muted' }, `Waiting for their answer · ${fmtWait(left(c))} left.`),
      h('button', { type: 'button', class: 'btn small', disabled: busy, 'data-fk': `play-cancel-${c.id}`, onclick: () => answer(c, 'decline') }, 'Call it off'));
  }

  function inboxSection(st) {
    const { incoming, outgoing } = st.challenges || { incoming: [], outgoing: [] };
    return [
      h('h3', { class: 'section-title', id: 'inbox-title' }, 'Challenges for you'),
      h('div', { class: 'card inbox', 'aria-labelledby': 'inbox-title', role: 'region' },
        incoming.length || outgoing.length ? [incoming.map((c) => incomingCard(c, 'play')), outgoing.map(outgoingCard)]
          : h('p', { class: 'muted small', 'data-testid': 'inbox-empty' }, 'Nothing waiting. When someone challenges you, it shows up here and at the top of every screen.')),
    ];
  }

  function peoplePicker(st) {
    const q = form.filter.trim().toLowerCase();
    const list = (st.people || []).filter((p) => !q || p.displayName.toLowerCase().includes(q) || p.login.includes(q));
    return h('fieldset', { class: 'people' },
      h('legend', null, 'Who? (people on stage right now)'),
      (st.people || []).length > 6 ? h('input', { type: 'text', placeholder: 'Search names', 'aria-label': 'Search the people on stage', value: form.filter, 'data-fk': 'people-filter',
        oninput: (e) => { form.filter = e.target.value; renderPage(); } }) : null,
      list.length ? h('div', { class: 'people-list', role: 'group', 'aria-label': 'People on stage' }, list.slice(0, 40).map((p) => h('button', {
        type: 'button', class: 'chip person', 'aria-pressed': String(form.target === p.login && !form.typed), 'data-fk': 'person-' + p.login, 'data-person': p.login,
        onclick: () => { form.target = p.login; form.typed = ''; error = ''; renderPage(); },
      }, p.displayName, p.test ? h('span', { class: 'tag' }, ' TEST') : null)))
        : h('p', { class: 'small muted', 'data-testid': 'people-empty' }, (st.people || []).length ? 'Nobody matches that search.' : 'Nobody is on stage right now. People walk on when they chat on stream.'),
      h('div', { class: 'row-btns' },
        h('button', { type: 'button', class: 'btn small', 'data-fk': 'people-refresh', onclick: async () => { await actions.reloadPeople(); announce('List updated'); } }, icon('turnR'), 'Refresh list')),
      h('label', { class: 'field' }, h('span', null, 'Or type their Twitch name'),
        h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', maxlength: 26, value: form.typed, 'data-fk': 'challenge-name', placeholder: '@name',
          oninput: (e) => { form.typed = e.target.value; if (form.typed) form.target = ''; } })));
  }

  function challengeForm(st) {
    if (!st.loggedIn) {
      return h('div', { class: 'card' }, h('p', null, st.mode === 'ext' ? 'Connect your Twitch name to challenge people and answer challenges.' : 'Log in with Twitch to challenge people and answer challenges.'),
        h('button', { type: 'button', class: 'btn primary', 'data-fk': 'play-login', onclick: () => actions.login() }, st.mode === 'ext' ? 'Connect my Twitch name' : 'Log in with Twitch'));
    }
    const lim = limits();
    const mine = (st.challenges && st.challenges.outgoing) || [];
    return h('form', { class: 'card challenge-form', 'aria-labelledby': 'ch-title', onsubmit: send, novalidate: true },
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Which game' }, CHALLENGE_GAMES.map(([k, label]) => h('button', {
        type: 'button', class: 'chip', 'aria-pressed': String(form.game === k), 'data-fk': 'game-' + k, onclick: () => { form.game = k; error = ''; renderPage(); },
      }, label))),
      peoplePicker(st),
      h('label', { class: 'field' }, h('span', null, `Bet (${fmt(lim.min)}–${fmt(lim.max)} ${PSD}, or 0 just for glory)`),
        h('input', { type: 'number', inputmode: 'numeric', min: 0, max: lim.max, step: 1, value: form.amount, placeholder: '0', 'data-fk': 'challenge-amount', 'aria-describedby': 'ch-help',
          oninput: (e) => { form.amount = e.target.value; } })),
      h('p', { class: 'small muted', id: 'ch-help' }, `They have ${lim.acceptSec} seconds to accept, here or in chat with !accept. The winner takes the pot.`),
      error ? h('p', { class: 'form-error', role: 'alert', tabindex: '-1', 'data-testid': 'challenge-error' }, error) : null,
      st.live === false ? h('p', { class: 'small muted' }, 'Sky is offline - challenges only work while the stream is on.') : null,
      h('button', { type: 'submit', class: 'btn primary block', disabled: busy || mine.length > 0, 'data-fk': 'challenge-send', 'data-testid': 'challenge-send' },
        mine.length ? 'You already have a challenge waiting' : 'Send challenge'));
  }

  function moreGames(st) {
    return [
      h('h3', { class: 'section-title' }, 'More ways to play'),
      h('div', { class: 'card' },
        h('ul', { class: 'plain-list' },
          h('li', null, 'Heists, battle royales and the Gleep Grand Prix: when one opens, a "Live events" card shows at the top of every screen with a Join button (pick your heist role there).'),
          h('li', null, 'Predictions: bet ', PSD, ' on the live prediction bar at the top.'),
          h('li', null, 'Daily check-in: the Today card at the top, once a day.'),
          h('li', null, h('a', { href: '#/unlocks', 'data-fk': 'play-unlocks', onclick: (e) => { e.preventDefault(); go('unlocks'); } }, 'Channel unlocks'), ': spend ', PSD, ' on the stream.')),
        compact ? null : h('p', { class: 'small muted' }, 'Slots, roulette, the coin flip and Sayok\'s cursed slot are played in chat (see Help).')),
    ];
  }

  // ---------- render
  function renderPage() {
    const st = store.get();
    renderKeepingFocus(el, () => mount(el,
      h('h2', { class: 'page-title', id: 'play-title' }, 'Play & challenges'),
      st.loggedIn ? inboxSection(st) : null,
      h('h3', { class: 'section-title', id: 'ch-title' }, 'Challenge someone'),
      challengeForm(st),
      moreGames(st)));
  }

  function renderInbox() {
    const st = store.get(), list = (st.challenges && st.challenges.incoming) || [];
    renderKeepingFocus(inbox, () => mount(inbox, st.loggedIn && st.route !== 'play' && list.length
      ? h('div', { class: 'inbox-banner' }, h('h2', { class: 'today-title' }, list.length === 1 ? 'You were challenged!' : `${list.length} challenges for you`), list.map((c) => incomingCard(c, 'strip')))
      : null));
  }

  function renderAll() {
    renderPage(); renderInbox();
    clearTimeout(timer);
    const st = store.get(), any = st.challenges && (st.challenges.incoming.length || st.challenges.outgoing.length);
    if (any) timer = setTimeout(() => {
      // a challenge past its time is gone on the server too: ask once, then keep counting
      const c = store.get().challenges, expired = [...c.incoming, ...c.outgoing].some((x) => left(x) <= 0);
      if (expired) actions.reloadChallenges();
      renderAll();
    }, 1000);
  }

  /** A challenge that just arrived also pops a toast (the banner may be out of view, e.g. scrolled down on Play). */
  const seen = new Set();
  let quietUntil = now() + 4000;   // what is already waiting when the app opens shows in the banner, without a toast
  function noticeNew(s) {
    const list = (s.challenges && s.challenges.incoming) || [];
    for (const c of list) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      if (now() < quietUntil) continue;
      const text = `${c.from.name} challenges you to ${GAME_NAME[c.game]}${c.stake ? ` for ${psd(c.stake)}` : ''}!`;
      toast(text, { kind: 'info', action: { label: 'Answer', run: () => { go('play'); setTimeout(() => { const b = el.querySelector(`[data-fk="play-accept-${c.id}"]`); if (b) { b.scrollIntoView({ block: 'center' }); b.focus(); } }, 50); } } });
    }
  }

  store.subscribe((s, keys) => {
    if (keys.includes('route') && s.route === 'play') actions.reloadPeople();
    if (keys.includes('loggedIn') && s.loggedIn) quietUntil = now() + 4000;
    if (keys.includes('challenges')) noticeNew(s);
    if (keys.some((k) => ['challenges', 'people', 'loggedIn', 'me', 'economy', 'route', 'live'].includes(k))) renderAll();
  });
  renderAll();
  return { el, inbox, render: renderAll };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
