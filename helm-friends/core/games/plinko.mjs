// PEPE'S PLINKO `!plinko <amount> [low|mid|high] [drops 1-5]` (v1.18, Sky approved): the easy solo gamble. A silver
// Pepe's Silvia Dollah drops through 12 rows of pegs; at every peg it bounces left or right (50/50), so it lands in one of
// 13 slots with binomial odds (C(12,k) / 4096). Each slot pays a multiplier of the bet (stake included). Three boards:
//
//   slot (from the left)   0     1    2    3    4    5    6    7    8    9   10   11   12
//   chance 1 in          4096  341   62   19  8.3  5.2  4.4  5.2  8.3   19   62  341 4096
//   LOW  (safe)            10    3  1.5  1.3  1.1    1  0.5    1  1.1  1.3  1.5    3   10   RTP 97.58 %  sd 0.37 bets
//   MID  (default)         30   10    4  1.8  1.1  0.6  0.3  0.6  1.1  1.8    4   10   30   RTP 96.11 %  sd 1.19 bets
//   HIGH (risky)          150   24    8    2  0.6  0.2  0.2  0.2  0.6    2    8   24  150   RTP 95.40 %  sd 4.01 bets
//
// Compared with the other house games: flip 97.5 %, roulette 97.3 %, slots ≈ 94.3 %, cursed 91.9 %. So Plinko is a gentle
// game: LOW almost never loses much (the worst slot gives half back), HIGH is the lottery ticket (150× on the edge slot,
// 1 in 2,048 for either edge). plinkoTheory() computes every number from the tables; t-hf-core checks it exactly and with
// seeded Monte Carlo. Multipliers are applied with core applyMult (exact basis points, floored).
// Lifecycle like slots: one stake of bet × drops, one show, one ledger line per drop (g:<id>:<payout|refund>:<id>[:r<n>]).
// Show: the player walks to the small Plinko machine (plinkoMini) on the stage and presses the button; the BIG board
// (plinkoBoard, in the sky) shows the coin bouncing peg by peg (prop state `drop:<bits>` = the path, 1 = right) and
// landing (`land:<slot>`); the crowd watches and reacts; big wins rain coins.

import { DEFAULT_ECONOMY } from '../economy.mjs';
import { applyMult } from '../money.mjs';
import { fail } from '../errors.mjs';
import { scriptBuilder, HOUSE, clip } from '../script.mjs';
import { isId, checkStake, at, resultWord, runsOf, checkRuns, runsStake, runsSettle, bestRun, netWord, crowdReact, moodOf } from './common.mjs';
import { fmt } from '../format.mjs';

export const PLINKO_ROWS = 12;
/** The left half of each board (slots 0..6); the right half mirrors it. */
const HALF = Object.freeze({
  low: [10, 3, 1.5, 1.3, 1.1, 1, 0.5],
  mid: [30, 10, 4, 1.8, 1.1, 0.6, 0.3],
  high: [150, 24, 8, 2, 0.6, 0.2, 0.2],
});
/** risk → the 13 slot multipliers (left to right). */
export const PLINKO_BOARDS = Object.freeze(Object.fromEntries(Object.entries(HALF).map(([k, h]) => [k, Object.freeze([...h, ...h.slice(0, 6).reverse()])])));
export const PLINKO_RISKS = Object.freeze(['low', 'mid', 'high']);
export const PLINKO_RISK_NAMES = Object.freeze({ low: 'Low risk', mid: 'Medium risk', high: 'High risk' });
/** Words people type for a board. */
export const PLINKO_WORDS = Object.freeze({ low: 'low', safe: 'low', easy: 'low', l: 'low', mid: 'mid', medium: 'mid', med: 'mid', normal: 'mid', m: 'mid',
  high: 'high', risky: 'high', hard: 'high', max: 'high', h: 'high' });
/** A drop paying at least this × the bet rains coins; at least BIG_MULT is a big win (excited crowd). */
export const PLINKO_RAIN_MULT = 5;
const BIG_MULT = 10;
/** Show timing (ms): the coin falls ROW_MS per row. */
export const PLINKO_SHOW = Object.freeze({ firstAt: 1500, rowMs: 200, settleMs: 300, runMs: 4300, outroMs: 2800, bigOutroMs: 4200 });

const binom = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };

/**
 * Exact odds of one board: per slot chance and payout, the RTP, house edge, chance to get more than the bet back,
 * standard deviation (in bets) and the top prize.
 * @param {'low'|'mid'|'high'} risk
 */
export function plinkoTheory(risk = 'mid') {
  const mults = PLINKO_BOARDS[risk] || PLINKO_BOARDS.mid, total = 2 ** PLINKO_ROWS;
  const slots = mults.map((mult, k) => ({ slot: k, mult, p: binom(PLINKO_ROWS, k) / total }));
  const rtp = slots.reduce((s, x) => s + x.p * x.mult, 0);
  const sq = slots.reduce((s, x) => s + x.p * x.mult * x.mult, 0);
  const win = slots.filter((x) => x.mult > 1).reduce((s, x) => s + x.p, 0);
  const back = slots.filter((x) => x.mult >= 1).reduce((s, x) => s + x.p, 0);
  return { risk, rows: PLINKO_ROWS, slots, rtp, houseEdge: 1 - rtp, win, back, sd: Math.sqrt(sq - rtp * rtp), top: Math.max(...mults), topP: slots[0].p * 2 };
}

const limits = (cfg) => (cfg && cfg.plinko) || DEFAULT_ECONOMY.plinko;
const riskOf = (input, cfg) => (PLINKO_RISKS.includes(input.risk) ? input.risk : (limits(cfg).risk || 'mid'));
const multWord = (m) => `${m}×`;

/** One drop: 12 bounces → the path ('0' = left, '1' = right), the slot (number of rights), its multiplier and payout. */
function drop(rng, bet, mults) {
  let path = '';
  for (let r = 0; r < PLINKO_ROWS; r++) path += rng.int(0, 1) ? '1' : '0';
  const slot = [...path].filter((c) => c === '1').length, mult = mults[slot];
  return { path, slot, mult, payout: applyMult(bet, mult) };
}

/** @type {import('./index.mjs').GameEngine} */
export const GAME = Object.freeze({
  id: 'plinko',
  defaults: { minBet: DEFAULT_ECONOMY.plinko.minBet, maxBet: DEFAULT_ECONOMY.plinko.maxBet, maxRuns: DEFAULT_ECONOMY.plinko.maxRuns },
  validate(input, cfg) {
    if (!input || !isId(input.player)) return fail('BAD_INPUT');
    if (input.risk != null && !PLINKO_RISKS.includes(input.risk)) return fail('BAD_INPUT');
    const lim = limits(cfg), r = checkRuns(input, lim.maxRuns);
    if (!r.ok) return r;
    return checkStake(input.bet, lim.minBet, lim.maxBet);
  },
  stakes: (input, gameId) => runsStake(gameId, input),
  /** outcome.risk is fixed here (input.risk or the economy default), so settle/summary/choreograph never need cfg. */
  resolve(input, rng, cfg) {
    const risk = riskOf(input, cfg), mults = PLINKO_BOARDS[risk], drops = [];
    for (let i = 0; i < runsOf(input); i++) drops.push(drop(rng, input.bet, mults));
    const best = bestRun(drops);
    return { risk, path: best.path, slot: best.slot, mult: best.mult, payout: drops.reduce((s, x) => s + x.payout, 0), drops };
  },
  choreograph(input, outcome, rng, ctx) {
    const p = input.player, n = outcome.drops.length, S = PLINKO_SHOW, fall = PLINKO_ROWS * S.rowMs;
    const label = clip(`${fmt(input.bet)} · ${outcome.risk.toUpperCase()}${n > 1 ? ' × ' + n : ''}`, 60);
    const s = scriptBuilder({ id: ctx.gameId || 'g_preview', kind: 'plinko', startsAt: ctx.now, crowd: 'others-watch' })
      .cast(p, 'player').cast(HOUSE, 'dealer')
      .prop('machine', 'plinkoMini', 0.5, 1, 'idle')
      .prop('board', 'plinkoBoard', 0.5, 2, 'idle', { y: 0.34, label, plinko: { rows: PLINKO_ROWS, risk: outcome.risk, mults: [...PLINKO_BOARDS[outcome.risk]] } });
    s.at(0, 'moveTo', HOUSE, { x: 0.6, lane: 2, speed: 'walk' });
    s.at(0, 'moveTo', p, { x: 0.45, lane: 1, speed: 'walk' });
    s.say(500, HOUSE, rng.pick(outcome.risk === 'high' ? ['High risk board. Respect.', 'Edge slot pays 150×!', 'Brave little coin...'] : ['Drop it like it\'s hot!', 'Plinko time!', 'Peg, peg, peg... PAYDAY?']), 1800);
    s.at(S.firstAt - 150, 'face', p, { dir: 'right' });
    let big = false, last = S.firstAt;
    outcome.drops.forEach((d, i) => {
      const t = S.firstAt + i * S.runMs, tag = n > 1 ? `@${i + 1}/${n}` : '';
      last = t;
      s.at(t, 'anim', p, { name: 'punch' });                                                // presses the big button
      s.at(t + 100, 'prop', null, { id: 'machine', state: 'drop' });
      s.at(t + 150, 'prop', null, { id: 'board', state: `drop:${d.path}${tag}` });
      const T = t + 150 + fall + S.settleMs, mood = moodOf(input.bet, d.payout, BIG_MULT);
      s.at(T, 'prop', null, { id: 'board', state: `land:${d.slot}${tag}` });
      s.at(T, 'prop', null, { id: 'machine', state: d.payout > input.bet ? 'win' : d.payout < input.bet ? 'lose' : 'idle' });
      crowdReact(s, T + 100, mood);
      if (mood === 'big') {
        big = true;
        s.at(T, 'fx', null, { name: 'flash', x: 0.5, y: 0.4 });
        s.at(T, 'fx', null, { name: 'banner', x: 0.5, y: 0.18, text: `PLINKO ${multWord(d.mult)}!` });
        s.at(T, 'expr', p, { name: 'excited', ms: 3500 }).at(T, 'anim', p, { name: 'victory' });
        s.say(T + 300, HOUSE, rng.pick(['THE EDGE! THE EDGE!', 'Peg gods smiled on you!', 'Absolute plinko legend.']));
      } else if (d.payout > input.bet) {
        s.at(T, 'expr', p, { name: 'happy', ms: 2200 }).at(T, 'anim', p, { name: 'cheer' });
      } else if (d.payout === input.bet) {
        s.at(T, 'expr', p, { name: 'neutral', ms: 1500 });
      } else {
        s.at(T, 'expr', p, { name: 'sad', ms: 1800 });
        if (d.payout === 0 || d.mult <= 0.3) s.at(T, 'anim', p, { name: 'sad' });
      }
      if (d.mult >= PLINKO_RAIN_MULT) s.coinRain(T + 200, d.payout, 0.5, 0.42);
      if (i < n - 1) s.at(T + 600, 'prop', null, { id: 'machine', state: 'idle' });
    });
    const end = last + 150 + fall + S.settleMs;
    if (n > 1) s.say(end + 900, HOUSE, clip(`${n} drops: ${netWord(input.bet * n, outcome.payout)}`, 60), 2000);
    s.at(end + 2300, 'moveTo', p, { x: 0.36, lane: 1, speed: 'walk' });
    return s.build(end + (big ? S.bigOutroMs : S.outroMs) + 1200);
  },
  settle(input, outcome, gameId) {
    return runsSettle(gameId, input, outcome.drops, (r) => `Plinko ${outcome.risk} ${r.mult}×`);
  },
  summary(input, outcome) {
    const n = outcome.drops.length, risk = outcome.risk.toUpperCase();
    if (n === 1) {
      const pre = outcome.mult >= BIG_MULT ? 'PLINKO! ' : '';
      return `${pre}${at(input, input.player)} ${risk} board: ${multWord(outcome.mult)} - ${resultWord(input.bet, outcome.payout)}`;
    }
    const pre = outcome.drops.some((d) => d.mult >= BIG_MULT) ? 'PLINKO! ' : '';
    const each = outcome.drops.map((d) => multWord(d.mult)).join(' · ');
    return clip(`${pre}${at(input, input.player)} ${risk} ×${n}: ${each} = ${netWord(input.bet * n, outcome.payout)}`, 300);
  },
});
