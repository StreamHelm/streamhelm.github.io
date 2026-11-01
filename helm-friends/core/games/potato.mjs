// SAYOK'S HOT POTATO (v1.18, Sky approved): the party game. `!potato [entry]` opens a short lobby (3–12 players, `!join`
// pays the entry). Sayok's cursed bomb then goes round the circle: every so often (faster and faster) whoever holds it
// tosses it to a random player — unless they type `!pass @user` first (choose who gets it; you must hold it a moment and
// can't spam-pass). Each round the bomb explodes at a HIDDEN random moment on whoever holds it: they're blasted out and
// lose their entry. Rounds repeat until one player is left or `blasts` bombs have gone off (default 3). The survivors
// split the whole pot (every entry) plus a small bank bonus.
//
// Money: pot = entry × n; bonus = min(bonusCap, bonusMin + floor(pot × bonusPct / 100)) from the bank (sys:mint), fixed at
// resolve time. Each survivor gets floor((pot + bonus) / survivors) (the first survivors in join order get the leftover
// Dollahs, 1 each, so the escrow empties exactly). With random passing every player is equally likely to be blasted, so
//   expected return per player = (pot + bonus) / n = entry + bonus / n   →   EV = +bonus / n (the game itself is fair).
//   e.g. 6 players × 100: pot 600, bonus 160, blasts 3 → 3 survivors get 253 each; EV per player +26.7 (+26.7 %).
//   12 × 100: pot 1,200, bonus 220, 3 blasts → 9 survivors get 157 (+57); EV +18.3. 3 × 100 → 2 blasts, 1 survivor gets 430.
//   Free game (entry 0): only the bonus (100 + 0) is shared, EV +100 / n.
// potatoTheory() gives these numbers; t-hf-core checks them and the fairness by seeded Monte Carlo.
//
// Provably fair with live input: a round's fuse length and every random toss come from the seed (rng.fork('round<r>')),
// so they never depend on what people type. Manual passes are logged on the game record (`input.passes`
// [{ t, from, to }], t = ms after the show started) and resolve() replays them: same seed + same passes → same result.
// The cloud checks a pass with potatoPass() (holder? held long enough? off cooldown? target still in?) before logging it,
// re-runs resolve + choreograph and re-sends the script (same `group`, a new id: the overlay replaces the show and lands
// in the same pose). The show's length is fixed at the start (fuses don't depend on passes), so endsAt never moves.

import { DEFAULT_ECONOMY } from '../economy.mjs';
import { isMoney } from '../money.mjs';
import { SYS } from '../ledger.mjs';
import { fail } from '../errors.mjs';
import { scriptBuilder, HOUSE, EVERYONE, clip } from '../script.mjs';
import { isId, settleLine, stakeIntent, at, nameOf, spread, round3 } from './common.mjs';
import { fmt } from '../format.mjs';

/** Timing (ms). Fuses are hidden (uniform fuseLo..fuseHi); tosses come every gapBase × gapDecay^k (≥ gapMin) ± 25 %. */
export const POTATO = Object.freeze({
  introMs: 6500, roundBannerMs: 1200, fuseLo: 9000, fuseHi: 18000,
  gapBase: 2600, gapDecay: 0.88, gapMin: 650, jitterLo: 0.75, jitterHi: 1.25,
  graceMs: 900,          // nobody can pass in the first 0.9 s of a round (everyone sees who has it)
  minHoldMs: 600,        // you must hold the bomb this long before you can !pass it
  passCooldownMs: 2500,  // and you can !pass at most once every 2.5 s
  lockMs: 200,           // passes in the last 0.2 s before a blast are too late
  blastPauseMs: 5000, outroMs: 7000, maxPassesPerRound: 60,
});

const conf = (cfg) => (cfg && cfg.potato) || DEFAULT_ECONOMY.potato;

/** Blasts in a game of n players: min(n − 1, cfg.blasts). */
export const potatoBlasts = (n, cfg) => Math.max(1, Math.min(n - 1, conf(cfg).blasts));
/** The bank's bonus for a pot: min(cap, min + floor(pot × pct / 100)). */
export function potatoBonus(pot, cfg) {
  const c = conf(cfg);
  return Math.min(c.bonusCap, c.bonusMin + Math.floor((pot * c.bonusPct) / 100));
}
/** Show length (fixed at the start): intro + every round's fuse and blast pause + outro. */
const showLength = (rounds) => (rounds.length ? rounds[rounds.length - 1].boom + POTATO.blastPauseMs : POTATO.introMs) + POTATO.outroMs;

/**
 * Exact money facts for n players paying `entry` (random passing → everyone equally likely to be blasted).
 * @returns {{ n:number, entry:number, blasts:number, survivors:number, pot:number, bonus:number, share:number, pLose:number, expectedReturn:number, ev:number, evPct:number }}
 */
export function potatoTheory(n, entry, cfg) {
  const blasts = potatoBlasts(n, cfg), survivors = n - blasts, pot = entry * n, bonus = potatoBonus(pot, cfg);
  const expectedReturn = (pot + bonus) / n;
  return { n, entry, blasts, survivors, pot, bonus, share: Math.floor((pot + bonus) / survivors), pLose: blasts / n, expectedReturn, ev: expectedReturn - entry, evPct: entry ? (expectedReturn - entry) / entry : null };
}

/** The seats (stage x, lane) the players stand at, in join order. ≤ 6 in one row, more in two staggered rows. */
export function potatoSeats(n) {
  if (n <= 6) return spread(n, 0.22, 0.78).map((x) => ({ x, lane: 1 }));
  return spread(n, 0.14, 0.86).map((x, i) => ({ x: round3(x), lane: i % 2 ? 2 : 0 }));
}

/**
 * The whole game as a timeline (pure): fuse per round, every toss (random or a logged manual pass), who was blasted.
 * Invalid logged passes (not the holder at that moment, too soon, target out…) are ignored, so the record can't be
 * bent by a bad entry. `upTo` stops the simulation at that time (the cloud's "who holds it right now").
 * @param {{ players:string[], passes?:{ t:number, from:string, to:string }[] }} input
 * @param {import('../rng.mjs').Rng} rng   the game's resolve stream (playGame: createRng(seed).fork('resolve'))
 * @param {Object} [cfg]
 * @param {number} [upTo]
 */
export function potatoTimeline(input, rng, cfg, upTo = Infinity) {
  const P = POTATO, players = input.players, blasts = potatoBlasts(players.length, cfg);
  const manual = (input.passes || []).filter((p) => p && Number.isSafeInteger(p.t)).slice().sort((a, b) => a.t - b.t);
  let alive = players.slice(), t = P.introMs;
  const rounds = [], lastManual = {};
  for (let r = 0; r < blasts; r++) {
    const rr = rng.fork('round' + r);
    const fuse = rr.int(P.fuseLo, P.fuseHi), start = t + P.roundBannerMs, boom = start + fuse;
    let holder = rr.pick(alive), since = start, k = 0;
    const events = [{ t: start, from: null, to: holder, how: 'start' }];
    const gap = () => Math.round(Math.max(P.gapMin, P.gapBase * P.gapDecay ** k) * rr.float(P.jitterLo, P.jitterHi));
    let nextAuto = start + P.graceMs + gap();
    const queue = manual.filter((p) => p.t >= start && p.t < boom);
    let qi = 0, used = 0;
    const end = Math.min(boom, upTo);
    for (;;) {
      // events in time order: a logged manual pass is checked against the state at ITS moment (after earlier tosses)
      const m = qi < queue.length && used < P.maxPassesPerRound ? queue[qi] : null;
      const autoT = nextAuto < boom - P.lockMs ? nextAuto : Infinity;
      if (m && m.t < end && m.t <= autoT) {
        qi++;
        if (!passOk(m, holder, since, lastManual, alive, start, boom)) continue;
        events.push({ t: m.t, from: holder, to: m.to, how: 'pass' });
        lastManual[holder] = m.t; holder = m.to; since = m.t; k++; used++;
        nextAuto = m.t + gap();
        continue;
      }
      if (autoT < end) {
        const to = rr.pick(alive.filter((id) => id !== holder));
        events.push({ t: nextAuto, from: holder, to, how: 'toss' });
        holder = to; since = nextAuto; k++;
        nextAuto += gap();
        continue;
      }
      break;
    }
    if (upTo < boom) return { rounds, current: { round: r, start, holder, since, alive: alive.slice(), events, lastManual: { ...lastManual } }, blasts };
    rounds.push({ n: r + 1, start, fuse, boom, loser: holder, events });
    alive = alive.filter((id) => id !== holder);
    t = boom + P.blastPauseMs;
    if (upTo < t) return { rounds, current: { round: r + 1, start: t + P.roundBannerMs, holder: null, since: null, alive: alive.slice(), events: [], lastManual: { ...lastManual }, pause: true }, blasts };
  }
  return { rounds, current: null, blasts, alive };
}

function passOk(p, holder, since, lastManual, alive, start, boom) {
  const P = POTATO;
  return p.from === holder && p.to !== holder && alive.includes(p.to) && p.t >= start + P.graceMs && p.t >= since + P.minHoldMs &&
    p.t < boom - P.lockMs && (lastManual[holder] == null || p.t - lastManual[holder] >= P.passCooldownMs);
}

/**
 * May `from` pass the bomb to `to` at `t` (ms after the show started)? `to` null = a random player (seeded by the pass
 * number, so it is replayable). Returns the pass to log, or a quiet failure reason (the cloud answers most of them silently).
 * @param {{ players:string[], passes?:Object[] }} input
 * @param {import('../rng.mjs').Rng} rng   the resolve stream (same as resolve gets)
 * @returns {{ ok:true, pass:{ t:number, from:string, to:string } } | { ok:false, code:string, why:'pause'|'holder'|'early'|'cooldown'|'late'|'target'|'done' }}
 */
export function potatoPass(input, rng, t, from, to, cfg) {
  const P = POTATO, tl = potatoTimeline(input, rng, cfg, t), cur = tl.current;
  if (!cur) return fail('CLOSED', { why: 'done' });
  if (cur.pause || t < cur.start + P.graceMs) return fail('CLOSED', { why: 'pause' });
  if (cur.holder !== from) return fail('FORBIDDEN', { why: 'holder' });
  const others = cur.alive.filter((id) => id !== from);
  if (to != null && !others.includes(to)) return fail('NO_TARGET', { why: 'target' });
  if (t < cur.since + P.minHoldMs) return fail('COOLDOWN', { why: 'early', waitMs: cur.since + P.minHoldMs - t });
  if (cur.lastManual[from] != null && t - cur.lastManual[from] < P.passCooldownMs) return fail('COOLDOWN', { why: 'cooldown', waitMs: P.passCooldownMs - (t - cur.lastManual[from]) });
  let target = to;
  if (target == null) target = rng.fork('mp' + (input.passes || []).length).pick(others);
  if (!others.includes(target)) return fail('NO_TARGET', { why: 'target' });
  const boom = cur.start + rng.fork('round' + cur.round).int(P.fuseLo, P.fuseHi);
  if (t >= boom - P.lockMs) return fail('CLOSED', { why: 'late' });
  return { ok: true, pass: { t, from, to: target } };
}

/** Who holds the bomb at `t` (for the overlay-less web view / tests): { round, holder, alive } or null between rounds. */
export function potatoHolder(input, rng, t, cfg) {
  const c = potatoTimeline(input, rng, cfg, t).current;
  return c && !c.pause ? { round: c.round + 1, holder: c.holder, alive: c.alive } : null;
}

/** @type {import('./index.mjs').GameEngine} */
export const GAME = Object.freeze({
  id: 'potato',
  defaults: { minBet: 0, maxBet: DEFAULT_ECONOMY.potato.maxEntry, lobbyMs: DEFAULT_ECONOMY.potato.lobbySec * 1000, minPlayers: DEFAULT_ECONOMY.potato.minPlayers, maxPlayers: DEFAULT_ECONOMY.potato.maxPlayers },

  validate(input, cfg) {
    const c = conf(cfg);
    if (!input || !Array.isArray(input.players) || !input.players.every(isId) || new Set(input.players).size !== input.players.length) return fail('BAD_INPUT');
    if (input.players.length < c.minPlayers) return fail('BAD_INPUT', { min: c.minPlayers });
    if (input.players.length > c.maxPlayers) return fail('FULL', { max: c.maxPlayers });
    const entry = input.entry || 0;
    if (!isMoney(entry) || entry > c.maxEntry) return fail('BAD_AMOUNT', { min: 0, max: c.maxEntry });
    if (input.passes != null && (!Array.isArray(input.passes) || input.passes.length > 400)) return fail('BAD_INPUT');
    return { ok: true };
  },

  stakes: (input, gameId) => ((input.entry || 0) > 0 ? input.players.map((p) => stakeIntent(gameId, p, input.entry)) : []),

  resolve(input, rng, cfg) {
    const tl = potatoTimeline(input, rng, cfg);
    const blasted = tl.rounds.map((r) => r.loser), survivors = input.players.filter((id) => !blasted.includes(id));
    const entry = input.entry || 0, pot = entry * input.players.length, bonus = potatoBonus(pot, cfg);
    const total = pot + bonus, share = Math.floor(total / survivors.length), rem = total - share * survivors.length;
    const payouts = Object.fromEntries(input.players.map((id) => [id, 0]));
    survivors.forEach((id, i) => { payouts[id] = share + (i < rem ? 1 : 0); });
    return { rounds: tl.rounds, blasted, survivors, entry, pot, bonus, share, payouts, passes: tl.rounds.reduce((s, r) => s + r.events.filter((e) => e.how === 'pass').length, 0), durationMs: showLength(tl.rounds) };
  },

  choreograph(input, outcome, rng, ctx) {
    const players = input.players, n = players.length, seats = potatoSeats(n), seatOf = Object.fromEntries(players.map((id, i) => [id, i]));
    const s = scriptBuilder({ id: ctx.gameId || 'g_preview', kind: 'potato', startsAt: ctx.now, crowd: 'others-watch' })
      .cast(HOUSE, 'host')
      .prop('bomb', 'potatoBomb', 0.5, 1, 'hidden', { potato: { seats } });
    players.forEach((id, i) => {
      s.cast(id, 'player');
      s.at(Math.round((i / n) * 1800), 'moveTo', id, { x: seats[i].x, lane: seats[i].lane, speed: 'run' });
      s.at(2600, 'face', id, { dir: 'front' });
    });
    s.at(0, 'moveTo', HOUSE, { x: 0.5, lane: 2, speed: 'walk' });
    s.at(1200, 'fx', null, { name: 'banner', x: 0.5, y: 0.16, text: "SAYOK'S HOT POTATO" });
    s.say(1400, HOUSE, rng.pick(["Sayok's cursed potato! Don't hold it!", 'Pass it or get BLASTED.', 'Sayok wants a snack...']), 2400);
    s.say(4200, HOUSE, '!pass @name to toss it!', 2000);
    let alive = players.slice();
    for (const r of outcome.rounds) {
      const R0 = r.start - POTATO.roundBannerMs;
      s.at(R0, 'fx', null, { name: 'banner', x: 0.5, y: 0.16, text: r.n === 1 ? 'ROUND 1 - FUSE LIT!' : `ROUND ${r.n}!` });
      r.events.forEach((e, k) => {
        const seat = seatOf[e.to], er = rng.fork(`r${r.n}e${k}`);   // per toss: a later !pass never changes earlier lines
        s.at(e.t, 'prop', null, { id: 'bomb', state: `hold:${seat}` });
        if (e.from) {
          s.at(Math.max(0, e.t - 120), 'anim', e.from, { name: 'punch' });
          s.at(e.t, 'expr', e.from, { name: 'happy', ms: 900 });
          if (e.how === 'pass' && er.chance(0.6)) s.say(e.t, e.from, er.pick(['Catch!', 'Yours!', 'Nope!', 'Byeee', `Here ${clip(nameOf(input, e.to), 14)}!`]), 900);
        }
        s.at(e.t + 30, 'expr', e.to, { name: e.how === 'start' ? 'fear' : er.pick(['startled', 'fear']), ms: 1100 });
        if (e.how !== 'start' && er.chance(0.25)) s.at(e.t + 60, 'anim', e.to, { name: 'startled' });
      });
      // the blast
      const B = r.boom, ls = seats[seatOf[r.loser]];
      s.at(B, 'prop', null, { id: 'bomb', state: `boom:${seatOf[r.loser]}` });
      s.at(B, 'fx', null, { name: 'flash', x: ls.x, y: 0.55 }).at(B + 50, 'fx', null, { name: 'stars', x: ls.x, y: 0.6 });
      s.at(B + 80, 'fx', null, { name: 'dust', x: ls.x, y: 0.8 });
      s.at(B, 'anim', r.loser, { name: 'knockout' }).at(B, 'expr', r.loser, { name: 'ko', ms: 2500 });
      s.at(B + 700, 'moveTo', r.loser, { x: ls.x < 0.5 ? 0 : 1, lane: ls.lane, speed: 'flee', anim: 'hurt' });
      s.at(B + 2200, 'hide', r.loser);
      alive = alive.filter((id) => id !== r.loser);
      alive.forEach((id, i) => { s.at(B + 250 + i * 40, 'expr', id, { name: 'happy', ms: 1800 }); if (i % 2 === 0) s.at(B + 300, 'anim', id, { name: 'jump' }); });
      s.at(B + 200, 'expr', EVERYONE, { name: 'startled', ms: 1200 });
      s.say(B + 600, HOUSE, clip(rng.fork('boom' + r.n).pick([`BOOM! Sayok claims ${nameOf(input, r.loser)}!`, `${nameOf(input, r.loser)} got COOKED!`, `Crispy ${nameOf(input, r.loser)}!`]), 60), 2200);
      s.at(B + 1200, 'prop', null, { id: 'bomb', state: 'hidden' });
    }
    const end = outcome.durationMs - POTATO.outroMs;
    const paid = outcome.survivors.reduce((sum, id) => sum + outcome.payouts[id], 0);
    s.at(end + 200, 'fx', null, { name: 'banner', x: 0.5, y: 0.16, text: outcome.survivors.length === 1 ? 'LAST ONE STANDING!' : 'SURVIVORS!' });
    outcome.survivors.forEach((id, i) => s.at(end + 300 + i * 60, 'anim', id, { name: 'victory' }).at(end + 300, 'expr', id, { name: 'excited', ms: 3000 }));
    s.at(end + 400, 'fx', null, { name: 'confetti', x: 0.5, y: 0.1 });
    if (paid > 0) s.coinRain(end + 600, paid, 0.5, 0.45);
    s.say(end + 800, HOUSE, clip(paid ? `Survivors split ${fmt(paid)}!` : 'Survivors live to tell the tale!', 60), 2400);
    for (const id of outcome.blasted) s.at(end + POTATO.outroMs - 2200, 'show', id);
    const out = s.build(outcome.durationMs);
    out.group = 'potato:' + (ctx.gameId || 'g_preview');   // a !pass re-sends the show (new id, same group): the overlay swaps it in
    return out;
  },

  /** Survivors' shares (entry back + winnings) and the blasted players' entries; the bank (mint) covers the bonus. */
  settle(input, outcome, gameId) {
    const entry = input.entry || 0, out = [];
    for (const id of input.players) {
      const pay = outcome.payouts[id] || 0;
      if (!entry && !pay) continue;
      out.push(settleLine(gameId, id, entry, pay, SYS.mint, pay ? "Sayok's Hot Potato: survived" : "Sayok's Hot Potato: blasted"));
    }
    return out;
  },

  summary(input, outcome) {
    const list = (ids) => ids.slice(0, 6).map((id) => at(input, id)).join(', ') + (ids.length > 6 ? ` and ${ids.length - 6} more` : '');
    const sv = outcome.survivors, share = sv.length ? outcome.payouts[sv[0]] : 0;
    return clip(`SAYOK'S HOT POTATO: blasted ${list(outcome.blasted)}! ${sv.length === 1 ? 'Last one standing' : 'Survivors'}: ${list(sv)} ` +
      `(+${fmt(Math.max(0, share - outcome.entry))} each${outcome.bonus ? `, bank bonus ${fmt(outcome.bonus)}` : ''})`, 300);
  },
});
