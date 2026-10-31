// Roulette (DESIGN §4.4): European single-zero wheel, 37 pockets.
// One payout rule for every pick: covering k numbers pays floor(3600 / k) / 100 × the bet (stake included).
//   red/black/odd/even/low/high (18) → 2×, dozens (12) → 3×, one number or green (1) → 36×, a 6-number range → 6×,
//   5 → 7.2×. So every bet returns at most 36/37 (house edge 2.7 %); zero loses every outside bet.
// v1.9: `!roulette 100 red 5` = 1–5 spins with the same pick in one show; the crowd watches and reacts; the player plays
// at a SMALL table on the stage while a BIG wheel spins above the walking area.

import { DEFAULT_ECONOMY } from '../economy.mjs';
import { applyBp } from '../money.mjs';
import { fail } from '../errors.mjs';
import { scriptBuilder, HOUSE, clip } from '../script.mjs';
import { isId, checkStake, at, resultWord, runsOf, checkRuns, runsStake, runsSettle, bestRun, netWord, crowdReact } from './common.mjs';
import { fmt } from '../format.mjs';

export const POCKETS = 37;
export const RED = Object.freeze([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const RED_SET = new Set(RED);
/** Range bets: contiguous a-b inside 1..36, covering 2 to 18 numbers. */
export const RANGE_MIN = 2, RANGE_MAX = 18;

/** 'green' | 'red' | 'black' */
export function colorOf(pocket) {
  return pocket === 0 ? 'green' : RED_SET.has(pocket) ? 'red' : 'black';
}

/**
 * The numbers a pick covers, or null when the pick is malformed.
 * @param {{ kind:string, a?:number, b?:number }} pick
 * @returns {number[]|null}
 */
export function pickNumbers(pick) {
  const all = Array.from({ length: 36 }, (_, i) => i + 1);
  if (!pick || typeof pick !== 'object') return null;
  switch (pick.kind) {
    case 'red': return RED.slice();
    case 'black': return all.filter((n) => !RED_SET.has(n));
    case 'green': return [0];
    case 'odd': return all.filter((n) => n % 2 === 1);
    case 'even': return all.filter((n) => n % 2 === 0);
    case 'low': return all.filter((n) => n <= 18);
    case 'high': return all.filter((n) => n >= 19);
    case 'dozen': return Number.isInteger(pick.a) && pick.a >= 1 && pick.a <= 3 ? all.slice((pick.a - 1) * 12, pick.a * 12) : null;
    case 'number': return Number.isInteger(pick.a) && pick.a >= 0 && pick.a <= 36 ? [pick.a] : null;
    case 'range': {
      const { a, b } = pick;
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b > 36 || b <= a) return null;
      const k = b - a + 1;
      return k >= RANGE_MIN && k <= RANGE_MAX ? all.slice(a - 1, b) : null;
    }
    default: return null;
  }
}

/**
 * The payout multiplier of a pick in basis points (×10,000): floor(3600 / k) × 100.
 * @param {{ kind:string, a?:number, b?:number }} pick
 */
export function multBp(pick) {
  const nums = pickNumbers(pick);
  return nums ? Math.floor(3600 / nums.length) * 100 : 0;
}

/** Human label: "red", "1st 12", "17", "7-12". */
export function pickLabel(pick) {
  if (pick.kind === 'dozen') return ['1st', '2nd', '3rd'][pick.a - 1] + ' 12';
  if (pick.kind === 'number') return String(pick.a);
  if (pick.kind === 'range') return `${pick.a}-${pick.b}`;
  return pick.kind;
}

/**
 * Exact expected return (per 1 staked) of a pick: Σ over pockets of payout / 37.
 * @returns {number}
 */
export function pickRtp(pick, bet = 10000) {
  const nums = new Set(pickNumbers(pick) || []);
  let total = 0;
  for (let p = 0; p < POCKETS; p++) if (nums.has(p)) total += applyBp(bet, multBp(pick));
  return total / POCKETS / bet;
}

const limits = (cfg) => (cfg && cfg.roulette) || DEFAULT_ECONOMY.roulette;

/** Show timing (ms). The first spin is the full ≈ 6 s; later spins of a multi-run are quicker (prop state `spin:<pocket>:<ms>`). */
export const ROULETTE_SHOW = Object.freeze({ firstAt: 1500, firstSpinMs: 6000, spinMs: 3600, afterMs: 1700, outroMs: 2900 });

/** @type {import('./index.mjs').GameEngine} */
export const GAME = Object.freeze({
  id: 'roulette',
  defaults: { minBet: DEFAULT_ECONOMY.roulette.minBet, maxBet: DEFAULT_ECONOMY.roulette.maxBet, maxRuns: DEFAULT_ECONOMY.roulette.maxRuns },

  validate(input, cfg) {
    if (!input || !isId(input.player) || !pickNumbers(input.pick)) return fail('BAD_INPUT');
    const lim = limits(cfg), r = checkRuns(input, lim.maxRuns);
    if (!r.ok) return r;
    return checkStake(input.bet, lim.minBet, lim.maxBet);
  },

  stakes: (input, gameId) => runsStake(gameId, input),

  /** outcome: top-level pocket/color/win/mult = the best spin, payout = every spin together, spins = each (same pick every time). */
  resolve(input, rng) {
    const nums = pickNumbers(input.pick), bp = multBp(input.pick), spins = [];
    for (let i = 0; i < runsOf(input); i++) {
      const pocket = rng.int(0, POCKETS - 1), win = nums.includes(pocket);
      spins.push({ pocket, color: colorOf(pocket), win, mult: win ? bp / 10000 : 0, payout: win ? applyBp(input.bet, bp) : 0 });
    }
    const best = bestRun(spins);
    return { pocket: best.pocket, color: best.color, win: best.win, mult: best.mult, payout: spins.reduce((s, x) => s + x.payout, 0), spins };
  },

  choreograph(input, outcome, rng, ctx) {
    const p = input.player, n = outcome.spins.length, R = ROULETTE_SHOW;
    const s = scriptBuilder({ id: ctx.gameId || 'g_preview', kind: 'roulette', startsAt: ctx.now, crowd: 'others-watch' })
      .cast(p, 'player').cast(HOUSE, 'dealer')
      .prop('table', 'rouletteMini', 0.5, 1, 'idle')                                    // the small table they play at
      .prop('wheel', 'rouletteBig', 0.5, 2, 'idle', { y: 0.36, label: clip(`${pickLabel(input.pick)} · ${fmt(input.bet)}${n > 1 ? ' × ' + n : ''}`, 60) });   // the big wheel above
    s.at(0, 'moveTo', HOUSE, { x: 0.565, lane: 2, speed: 'walk' });
    s.at(0, 'moveTo', p, { x: 0.45, lane: 1, speed: 'walk' });
    s.at(R.firstAt - 200, 'face', p, { dir: 'right' });
    s.say(R.firstAt - 100, HOUSE, 'No more bets!', 1500);
    let t = R.firstAt;
    outcome.spins.forEach((sp, i) => {
      const spin = i === 0 ? R.firstSpinMs : R.spinMs, tag = n > 1 ? `@${i + 1}/${n}` : '';
      s.at(t, 'anim', p, { name: 'punch' });                                            // flicks the ball in
      s.at(t, 'prop', null, { id: 'table', state: 'spin' });
      s.at(t + 100, 'prop', null, { id: 'wheel', state: 'spin:' + sp.pocket + (i === 0 ? '' : ':' + spin) + tag });
      const T = t + 100 + spin + 100;
      s.at(T, 'prop', null, { id: 'wheel', state: 'result:' + sp.pocket + tag }).at(T, 'prop', null, { id: 'table', state: 'result:' + sp.pocket });
      s.say(T, HOUSE, `${sp.pocket} ${sp.color}!`, 1600);
      crowdReact(s, T + 150, sp.win ? (sp.mult >= 6 ? 'big' : 'win') : 'lose');
      if (sp.win) {
        s.at(T + 200, 'expr', p, { name: sp.mult >= 6 ? 'excited' : 'happy', ms: 2500 }).at(T + 200, 'anim', p, { name: 'cheer' });
        s.coinRain(T + 300, sp.payout, 0.5, 0.42);
      } else {
        s.at(T + 200, 'expr', p, { name: 'sad', ms: 2000 }).at(T + 200, 'anim', p, { name: 'sad' });
      }
      if (i < n - 1) s.at(T + R.afterMs - 200, 'face', p, { dir: 'right' });
      t = T + R.afterMs;
    });
    const end = t - R.afterMs;
    if (n > 1) s.say(end + 1000, HOUSE, clip(`${n} spins: ${netWord(input.bet * n, outcome.payout)}`, 60), 1800);
    s.at(end + 2600, 'moveTo', p, { x: 0.36, lane: 1, speed: 'walk' });
    return s.build(end + R.outroMs + 1450);
  },

  settle(input, outcome, gameId) {
    return runsSettle(gameId, input, outcome.spins, () => `Roulette ${pickLabel(input.pick)}`);
  },

  summary(input, outcome) {
    if (outcome.spins.length === 1) return `${at(input, input.player)} ${outcome.pocket} ${outcome.color} — ${resultWord(input.bet, outcome.payout)}`;
    const n = outcome.spins.length, each = outcome.spins.map((x) => `${x.pocket} ${x.color} ${resultWord(input.bet, x.payout)}`).join(' · ');
    return clip(`${at(input, input.player)} roulette ${pickLabel(input.pick)} ×${n}: ${each} = ${netWord(input.bet * n, outcome.payout)}`, 300);
  },
});
