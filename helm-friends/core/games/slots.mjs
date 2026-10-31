// Slots (DESIGN §4.3): 3 reels, 5 stream symbols, same weights on every reel. Three Glorps = JACKPOT (100×).
// Theoretical RTP 94.28 % (house edge 5.7 %); slotsTheory() computes it from the tables below, so the help page, the
// admin page and the tests all read the same numbers.
// v1.9: `!slots 100 3` plays 1–5 spins in one show (input.runs; every spin is an independent draw, so the RTP per Dollah
// is the same); the crowd gathers round to watch and reacts to every spin; the player pulls a SMALL machine on the stage
// while a BIG view of the reels spins above the walking area.

import { DEFAULT_ECONOMY } from '../economy.mjs';
import { applyMult } from '../money.mjs';
import { fail } from '../errors.mjs';
import { scriptBuilder, HOUSE, clip } from '../script.mjs';
import { isId, checkStake, at, resultWord, runsOf, checkRuns, runsStake, runsSettle, bestRun, netWord, crowdReact, moodOf } from './common.mjs';
import { fmt } from '../format.mjs';

/** Reel symbols with their weight out of 20 (p = .30 / .25 / .20 / .15 / .10). */
export const REEL = Object.freeze([
  { sym: 'pepebot', name: 'PepeBot', weight: 6 },
  { sym: 'sky', name: 'Sky', weight: 5 },
  { sym: 'sayok', name: 'Sayok', weight: 4 },
  { sym: 'klerb', name: 'Klerb', weight: 3 },
  { sym: 'glorp', name: 'Glorp', weight: 2 },
]);
const REEL_TOTAL = REEL.reduce((s, r) => s + r.weight, 0);
const NAME = Object.fromEntries(REEL.map((r) => [r.sym, r.name]));

/** Pay lines, first match wins. `mult` × bet is paid back (stake included). */
export const PAYTABLE = Object.freeze([
  { id: 'jackpot', label: 'Glorp Glorp Glorp: JACKPOT', mult: 100, test: (r, g) => g === 3 },
  { id: 'klerb3', label: 'Klerb ×3', mult: 40, test: (r) => same(r, 'klerb') },
  { id: 'sayok3', label: 'Sayok ×3', mult: 20, test: (r) => same(r, 'sayok') },
  { id: 'sky3', label: 'Sky ×3', mult: 10, test: (r) => same(r, 'sky') },
  { id: 'pepebot3', label: 'PepeBot ×3', mult: 5, test: (r) => same(r, 'pepebot') },
  { id: 'glorp2', label: 'Two Glorps', mult: 5, test: (r, g) => g === 2 },
  { id: 'glorp1', label: 'One Glorp (half back)', mult: 0.5, test: (r, g) => g === 1 },
]);
const same = (r, s) => r[0] === s && r[1] === s && r[2] === s;

/** Wins of at least this multiplier get a coin rain. */
export const COIN_RAIN_MULT = 10;

/** Show timing (ms): walk up, then one spin every RUN_MS (lever, three reel stops 600 ms apart, the reaction). */
export const SLOTS_SHOW = Object.freeze({ firstAt: 1400, runMs: 4200, stops: [1500, 2100, 2700], resultAt: 3000, outroMs: 2600, jackpotOutroMs: 4600 });

/**
 * The pay line for three reels.
 * @param {string[]} reels
 * @returns {{ id:string|null, mult:number }}
 */
export function evaluate(reels) {
  const glorps = reels.filter((s) => s === 'glorp').length;
  for (const line of PAYTABLE) if (line.test(reels, glorps)) return { id: line.id, mult: line.mult };
  return { id: null, mult: 0 };
}

/** One reel stop. */
function spinReel(rng) {
  let r = rng.int(1, REEL_TOTAL);
  for (const s of REEL) { r -= s.weight; if (r <= 0) return s.sym; }
  return REEL[REEL.length - 1].sym;
}

/**
 * Exact odds by enumerating all 125 reel combinations: every pay line's probability and RTP share, plus the total.
 * @returns {{ lines:{ id:string, label:string, mult:number, p:number, rtp:number }[], rtp:number, houseEdge:number }}
 */
export function slotsTheory() {
  const acc = Object.fromEntries(PAYTABLE.map((l) => [l.id, 0]));
  for (const a of REEL) for (const b of REEL) for (const c of REEL) {
    const p = (a.weight * b.weight * c.weight) / REEL_TOTAL ** 3;
    const { id } = evaluate([a.sym, b.sym, c.sym]);
    if (id) acc[id] += p;
  }
  const lines = PAYTABLE.map((l) => ({ id: l.id, label: l.label, mult: l.mult, p: acc[l.id], rtp: acc[l.id] * l.mult }));
  const rtp = lines.reduce((s, l) => s + l.rtp, 0);
  return { lines, rtp, houseEdge: 1 - rtp };
}

const limits = (cfg) => (cfg && cfg.slots) || DEFAULT_ECONOMY.slots;
const reelsWord = (reels) => reels.map((r) => NAME[r].toUpperCase()).join(' ');

/** @type {import('./index.mjs').GameEngine} */
export const GAME = Object.freeze({
  id: 'slots',
  defaults: { minBet: DEFAULT_ECONOMY.slots.minBet, maxBet: DEFAULT_ECONOMY.slots.maxBet, maxRuns: DEFAULT_ECONOMY.slots.maxRuns },

  validate(input, cfg) {
    if (!input || !isId(input.player)) return fail('BAD_INPUT');
    const lim = limits(cfg), r = checkRuns(input, lim.maxRuns);
    if (!r.ok) return r;
    return checkStake(input.bet, lim.minBet, lim.maxBet);
  },

  stakes: (input, gameId) => runsStake(gameId, input),

  /** outcome: top-level reels/line/mult = the best spin (alerts read them), payout = all spins together, spins = each. */
  resolve(input, rng) {
    const spins = [];
    for (let i = 0; i < runsOf(input); i++) {
      const reels = [spinReel(rng), spinReel(rng), spinReel(rng)];
      const { id, mult } = evaluate(reels);
      spins.push({ reels, line: id, mult, payout: mult ? applyMult(input.bet, mult) : 0 });
    }
    const best = bestRun(spins);
    return { reels: best.reels, line: best.line, mult: best.mult, payout: spins.reduce((s, x) => s + x.payout, 0), spins };
  },

  choreograph(input, outcome, rng, ctx) {
    const p = input.player, n = outcome.spins.length, S = SLOTS_SHOW;
    const s = scriptBuilder({ id: ctx.gameId || 'g_preview', kind: 'slots', startsAt: ctx.now, crowd: 'others-watch' })
      .cast(p, 'player').cast(HOUSE, 'dealer')
      .prop('slots', 'slotMini', 0.5, 1, 'idle')                                       // the small machine they pull
      .prop('reels', 'slotReels', 0.5, 2, 'idle', { y: 0.36, label: n > 1 ? `${fmt(input.bet)} × ${n}` : fmt(input.bet) });   // the big view above
    s.at(0, 'moveTo', HOUSE, { x: 0.57, lane: 2, speed: 'walk' });
    s.at(0, 'moveTo', p, { x: 0.455, lane: 1, speed: 'walk' });
    s.at(S.firstAt - 100, 'face', p, { dir: 'right' });
    let jackpot = false, last = S.firstAt;
    outcome.spins.forEach((sp, i) => {
      const t = S.firstAt + i * S.runMs, tag = n > 1 ? `@${i + 1}/${n}` : '';
      last = t;
      s.at(t, 'anim', p, { name: 'punch' });                                            // pulls the lever
      s.at(t + 100, 'prop', null, { id: 'slots', state: 'lever' });
      s.at(t + 300, 'prop', null, { id: 'slots', state: 'spin' }).at(t + 300, 'prop', null, { id: 'reels', state: 'spin' + tag });
      S.stops.forEach((dt, k) => {
        const st = 'stop:' + sp.reels.slice(0, k + 1).join(',');
        s.at(t + dt, 'prop', null, { id: 'slots', state: st }).at(t + dt, 'prop', null, { id: 'reels', state: st + tag });
      });
      const T = t + S.resultAt, mood = moodOf(input.bet, sp.payout, COIN_RAIN_MULT), win = sp.payout > input.bet;
      if (win) s.at(T, 'prop', null, { id: 'slots', state: 'win' }).at(T, 'prop', null, { id: 'reels', state: 'win' + tag });
      crowdReact(s, T + 100, mood);
      if (sp.line === 'jackpot') {
        jackpot = true;
        s.at(T, 'fx', null, { name: 'banner', x: 0.5, y: 0.2, text: 'JACKPOT!' });
        s.at(T, 'fx', null, { name: 'confetti', x: 0.5, y: 0.1 });
        s.at(T, 'expr', p, { name: 'excited', ms: 4000 }).at(T, 'anim', p, { name: 'victory' });
        s.say(T + 300, HOUSE, rng.pick(['GLORP GLORP GLORP!!', 'JACKPOT, BABY!', 'The gods have spoken!']));
      } else if (win) {
        s.at(T, 'expr', p, { name: mood === 'big' ? 'excited' : 'happy', ms: 2500 }).at(T, 'anim', p, { name: 'cheer' });
        if (mood === 'big') s.say(T + 300, HOUSE, rng.pick(['Big win!', 'Look at that!', 'Cha-ching!']));
      } else if (sp.payout > 0) {
        s.at(T, 'expr', p, { name: 'neutral', ms: 1500 });
        if (n === 1) s.say(T + 200, HOUSE, 'Half back. Glorp is merciful.');
      } else {
        s.at(T, 'expr', p, { name: 'sad', ms: 2000 }).at(T, 'anim', p, { name: 'sad' });
        if (n === 1 && rng.chance(0.4)) s.say(T + 300, HOUSE, rng.pick(['So close!', 'Next one, surely.', 'The house thanks you.']));
      }
      if (sp.mult >= COIN_RAIN_MULT) s.coinRain(T + 200, sp.payout, 0.5, 0.42);
      if (i < n - 1) s.at(T + S.runMs - S.resultAt - 400, 'face', p, { dir: 'right' });   // back to the machine for the next spin
    });
    const end = last + S.resultAt;
    if (n > 1) s.say(end + 900, HOUSE, clip(`${n} spins: ${netWord(input.bet * n, outcome.payout)}`, 60), 2000);
    s.at(end + 2400, 'moveTo', p, { x: 0.36, lane: 1, speed: 'walk' });
    return s.build(end + (jackpot ? S.jackpotOutroMs : S.outroMs) + 1400);
  },

  settle(input, outcome, gameId) {
    return runsSettle(gameId, input, outcome.spins, (r) => (r.payout ? `Slots ${r.mult}×` : 'Slots'));
  },

  summary(input, outcome) {
    const n = outcome.spins.length;
    if (n === 1) {
      const reels = reelsWord(outcome.reels);
      if (outcome.line === 'jackpot') return `${at(input, input.player)} ${reels} - JACKPOT! +${fmt(outcome.payout - input.bet)}`;
      return `${at(input, input.player)} ${reels} - ${resultWord(input.bet, outcome.payout)}`;
    }
    const jp = outcome.spins.some((x) => x.line === 'jackpot') ? 'JACKPOT! ' : '';
    const each = outcome.spins.map((x) => `${reelsWord(x.reels)} ${resultWord(input.bet, x.payout)}`).join(' · ');
    return clip(`${jp}${at(input, input.player)} slots ×${n}: ${each} = ${netWord(input.bet * n, outcome.payout)}`, 300);
  },
});
