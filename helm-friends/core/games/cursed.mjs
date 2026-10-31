// Sayok's cursed slot `!cursed <amount> [spins]` (v1.11, Sky): the high-risk, high-reward machine. Three reels of Sayok's
// things, the same weights on every reel (out of 40): Bone 17, Hellfire 12, Skull 7, Sayok's Eye 3, Glorp 1.
//   Eye Eye Eye  - SAYOK'S DOOM   666×   1 in 2,370
//   Skull ×3                       30×
//   Hellfire ×3                     7×
//   Bone ×3                         2×
//   two Eyes                        4×
//   any Glorp (Glorp's mercy)       1× (stake back)
// RTP 91.94 % (house edge 8.1 %, vs 5.7 % on !slots), hit rate 19.8 % (vs 32.5 %), standard deviation ≈ 13.9 bets per spin
// (vs ≈ 3.6 on !slots): you lose more often and more over time, but the top prize is 6.7× the slots jackpot. cursedTheory()
// computes every number from the tables below; t-hf-core checks it by enumeration and by seeded Monte Carlo.
// Same lifecycle as slots (multi-run 1–3, one show, one stake, a line per run). The overlay draws a Sayok-red machine
// (cursedMini) and big reels (cursedReels); the overlay's placeholder art stands in until the art pack has them.

import { DEFAULT_ECONOMY } from '../economy.mjs';
import { applyMult } from '../money.mjs';
import { fail } from '../errors.mjs';
import { scriptBuilder, HOUSE, clip } from '../script.mjs';
import { isId, checkStake, at, resultWord, runsOf, checkRuns, runsStake, runsSettle, bestRun, netWord, crowdReact, moodOf } from './common.mjs';
import { fmt } from '../format.mjs';

export const CURSED_REEL = Object.freeze([
  { sym: 'bone', name: 'Bone', weight: 17 },
  { sym: 'flame', name: 'Hellfire', weight: 12 },
  { sym: 'skull', name: 'Skull', weight: 7 },
  { sym: 'eye', name: "Sayok's Eye", weight: 3 },
  { sym: 'glorp', name: 'Glorp', weight: 1 },
]);
const TOTAL = CURSED_REEL.reduce((s, r) => s + r.weight, 0);
const NAME = Object.fromEntries(CURSED_REEL.map((r) => [r.sym, r.name]));
const count = (r, s) => r.filter((x) => x === s).length;

/** Pay lines, first match wins; `mult` × bet back (stake included). */
export const CURSED_PAYTABLE = Object.freeze([
  { id: 'doom', label: "Sayok's Eye ×3: SAYOK'S DOOM", mult: 666, test: (r) => count(r, 'eye') === 3 },
  { id: 'skull3', label: 'Skull ×3', mult: 30, test: (r) => count(r, 'skull') === 3 },
  { id: 'flame3', label: 'Hellfire ×3', mult: 7, test: (r) => count(r, 'flame') === 3 },
  { id: 'bone3', label: 'Bone ×3', mult: 2, test: (r) => count(r, 'bone') === 3 },
  { id: 'eye2', label: "Two of Sayok's Eyes", mult: 4, test: (r) => count(r, 'eye') === 2 },
  { id: 'mercy', label: "Glorp's mercy (stake back)", mult: 1, test: (r) => count(r, 'glorp') >= 1 },
]);
export const CURSED_RAIN_MULT = 7;
const SHOW = Object.freeze({ firstAt: 1500, runMs: 4600, stops: [1600, 2300, 3000], resultAt: 3300, outroMs: 2800, doomOutroMs: 5200 });

export function cursedEvaluate(reels) {
  for (const l of CURSED_PAYTABLE) if (l.test(reels)) return { id: l.id, mult: l.mult };
  return { id: null, mult: 0 };
}
function spin(rng) {
  let r = rng.int(1, TOTAL);
  for (const s of CURSED_REEL) { r -= s.weight; if (r <= 0) return s.sym; }
  return CURSED_REEL[CURSED_REEL.length - 1].sym;
}

/** Exact odds by enumerating all 125 combinations: per line p and RTP share, total RTP, hit rate, standard deviation. */
export function cursedTheory() {
  const acc = Object.fromEntries(CURSED_PAYTABLE.map((l) => [l.id, 0]));
  let hit = 0, sq = 0;
  for (const a of CURSED_REEL) for (const b of CURSED_REEL) for (const c of CURSED_REEL) {
    const p = (a.weight * b.weight * c.weight) / TOTAL ** 3, { id, mult } = cursedEvaluate([a.sym, b.sym, c.sym]);
    if (id) { acc[id] += p; hit += p; sq += p * mult * mult; }
  }
  const lines = CURSED_PAYTABLE.map((l) => ({ id: l.id, label: l.label, mult: l.mult, p: acc[l.id], rtp: acc[l.id] * l.mult }));
  const rtp = lines.reduce((s, l) => s + l.rtp, 0);
  return { lines, rtp, houseEdge: 1 - rtp, hit, sd: Math.sqrt(sq - rtp * rtp) };
}

const limits = (cfg) => (cfg && cfg.cursed) || DEFAULT_ECONOMY.cursed;
const reelsWord = (reels) => reels.map((r) => NAME[r].toUpperCase()).join(' ');

/** @type {import('./index.mjs').GameEngine} */
export const GAME = Object.freeze({
  id: 'cursed',
  defaults: { minBet: DEFAULT_ECONOMY.cursed.minBet, maxBet: DEFAULT_ECONOMY.cursed.maxBet, maxRuns: DEFAULT_ECONOMY.cursed.maxRuns },
  validate(input, cfg) {
    if (!input || !isId(input.player)) return fail('BAD_INPUT');
    const lim = limits(cfg), r = checkRuns(input, lim.maxRuns);
    if (!r.ok) return r;
    return checkStake(input.bet, lim.minBet, lim.maxBet);
  },
  stakes: (input, gameId) => runsStake(gameId, input),
  resolve(input, rng) {
    const spins = [];
    for (let i = 0; i < runsOf(input); i++) {
      const reels = [spin(rng), spin(rng), spin(rng)], { id, mult } = cursedEvaluate(reels);
      spins.push({ reels, line: id, mult, payout: mult ? applyMult(input.bet, mult) : 0 });
    }
    const best = bestRun(spins);
    return { reels: best.reels, line: best.line, mult: best.mult, payout: spins.reduce((s, x) => s + x.payout, 0), spins };
  },
  choreograph(input, outcome, rng, ctx) {
    const p = input.player, n = outcome.spins.length;
    const s = scriptBuilder({ id: ctx.gameId || 'g_preview', kind: 'cursed', startsAt: ctx.now, crowd: 'others-watch' })
      .cast(p, 'player').cast(HOUSE, 'dealer')
      .prop('slots', 'cursedMini', 0.5, 1, 'idle')
      .prop('reels', 'cursedReels', 0.5, 2, 'idle', { y: 0.36, label: n > 1 ? `${fmt(input.bet)} × ${n}` : fmt(input.bet) });
    s.at(0, 'moveTo', HOUSE, { x: 0.58, lane: 2, speed: 'walk' });
    s.at(0, 'moveTo', p, { x: 0.455, lane: 1, speed: 'walk' });
    s.say(600, HOUSE, rng.pick(['Sayok is watching...', 'Are you SURE about this?', 'Cursed machine. No refunds.']), 1800);
    s.at(SHOW.firstAt - 100, 'face', p, { dir: 'right' });
    let doom = false, last = SHOW.firstAt;
    outcome.spins.forEach((sp, i) => {
      const t = SHOW.firstAt + i * SHOW.runMs, tag = n > 1 ? `@${i + 1}/${n}` : '';
      last = t;
      s.at(t, 'anim', p, { name: 'punch' });
      s.at(t + 100, 'prop', null, { id: 'slots', state: 'lever' });
      s.at(t + 300, 'prop', null, { id: 'slots', state: 'spin' }).at(t + 300, 'prop', null, { id: 'reels', state: 'spin' + tag });
      SHOW.stops.forEach((dt, k) => {
        const st = 'stop:' + sp.reels.slice(0, k + 1).join(',');
        s.at(t + dt, 'prop', null, { id: 'slots', state: st }).at(t + dt, 'prop', null, { id: 'reels', state: st + tag });
      });
      const T = t + SHOW.resultAt, mood = moodOf(input.bet, sp.payout, CURSED_RAIN_MULT), win = sp.payout > input.bet;
      if (win) s.at(T, 'prop', null, { id: 'slots', state: 'win' }).at(T, 'prop', null, { id: 'reels', state: 'win' + tag });
      crowdReact(s, T + 100, mood);
      if (sp.line === 'doom') {
        doom = true;
        s.at(T, 'fx', null, { name: 'flash', x: 0.5, y: 0.5 });
        s.at(T, 'fx', null, { name: 'banner', x: 0.5, y: 0.2, text: "SAYOK'S DOOM!" });
        s.at(T, 'expr', p, { name: 'excited', ms: 4500 }).at(T, 'anim', p, { name: 'victory' });
        s.say(T + 300, HOUSE, rng.pick(['SAYOK HAS CHOSEN YOU.', 'The curse... PAID OUT?!', 'Six six six, baby!']));
      } else if (win) {
        s.at(T, 'expr', p, { name: mood === 'big' ? 'excited' : 'happy', ms: 2500 }).at(T, 'anim', p, { name: 'cheer' });
      } else if (sp.payout > 0) {
        s.at(T, 'expr', p, { name: 'neutral', ms: 1500 });
        if (n === 1) s.say(T + 200, HOUSE, "Glorp's mercy. Stake back.", 1800);
      } else {
        s.at(T, 'expr', p, { name: 'fear', ms: 2000 }).at(T, 'anim', p, { name: 'sad' });
        if (n === 1 && rng.chance(0.5)) s.say(T + 300, HOUSE, rng.pick(['Sayok feasts.', 'Cursed indeed.', 'The eye blinks. You lose.']));
      }
      if (sp.mult >= CURSED_RAIN_MULT) s.coinRain(T + 200, sp.payout, 0.5, 0.42);
      if (i < n - 1) s.at(T + SHOW.runMs - SHOW.resultAt - 400, 'face', p, { dir: 'right' });
    });
    const end = last + SHOW.resultAt;
    if (n > 1) s.say(end + 900, HOUSE, clip(`${n} cursed spins: ${netWord(input.bet * n, outcome.payout)}`, 60), 2000);
    s.at(end + 2400, 'moveTo', p, { x: 0.36, lane: 1, speed: 'walk' });
    return s.build(end + (doom ? SHOW.doomOutroMs : SHOW.outroMs) + 1400);
  },
  settle(input, outcome, gameId) {
    return runsSettle(gameId, input, outcome.spins, (r) => (r.payout ? `Cursed slot ${r.mult}×` : 'Cursed slot'));
  },
  summary(input, outcome) {
    const n = outcome.spins.length;
    if (n === 1) {
      const pre = outcome.line === 'doom' ? "SAYOK'S DOOM! " : '';
      return `${pre}${at(input, input.player)} ${reelsWord(outcome.reels)} - ${resultWord(input.bet, outcome.payout)}`;
    }
    const doom = outcome.spins.some((x) => x.line === 'doom') ? "SAYOK'S DOOM! " : '';
    const each = outcome.spins.map((x) => `${reelsWord(x.reels)} ${resultWord(input.bet, x.payout)}`).join(' · ');
    return clip(`${doom}${at(input, input.player)} cursed ×${n}: ${each} = ${netWord(input.bet * n, outcome.payout)}`, 300);
  },
});
