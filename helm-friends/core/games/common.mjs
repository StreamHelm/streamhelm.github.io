// Small helpers shared by the six game engines: stake checks, escrow settlement lines, names for chat lines.

import { fail } from '../errors.mjs';
import { isMoney } from '../money.mjs';
import { intent, escrowAcct, userAcct, gameIdem, SYS } from '../ledger.mjs';
import { fmt } from '../format.mjs';
import { EVERYONE } from '../script.mjs';

/** A non-empty id string (a twitchId). */
export const isId = (x) => typeof x === 'string' && x.length > 0 && x.length <= 64;

/**
 * Is `amount` a legal stake between min and max?
 * @returns {{ ok:true } | { ok:false, code:'BAD_AMOUNT', min:number, max:number }}
 */
export function checkStake(amount, min, max) {
  return isMoney(amount) && amount >= min && amount <= max ? { ok: true } : fail('BAD_AMOUNT', { min, max });
}

/** Display name for chat lines: input.names[id] (a login or display name) or the id itself. */
export function nameOf(input, id) {
  const n = input && input.names && input.names[id];
  return n ? String(n) : String(id);
}

/** "@name". */
export const at = (input, id) => '@' + nameOf(input, id);

/**
 * The stake going into the game's escrow when the game is created (u → escrow).
 * @param {string} gameId
 * @param {string} player
 * @param {number} amount
 */
export function stakeIntent(gameId, player, amount) {
  return intent(gameIdem(gameId, 'stake', player), 'stake', [[userAcct(player), -amount], [escrowAcct(gameId), amount]],
    'Bet', { gameId });
}

/**
 * Settles one player's stake: the escrow gives back `stake`, the player receives `payout`, and `bank` (the house for
 * casino games, the mint for faucets) covers the difference — or keeps the stake on a loss.
 * @param {string} gameId
 * @param {string} player
 * @param {number} stake
 * @param {number} payout
 * @param {string} bank   'sys:house' | 'sys:mint'
 * @param {string} memo
 */
export function settleLine(gameId, player, stake, payout, bank, memo, run = 0) {
  const kind = payout === stake && stake > 0 ? 'refund' : 'payout';
  return intent(gameIdem(gameId, kind, player) + (run ? ':r' + run : ''), kind,
    [[escrowAcct(gameId), -stake], [userAcct(player), payout], [bank, stake - payout]], memo, run ? { gameId, run } : { gameId });
}

// ───────────── multi-run games (v1.9: `!slots 100 3`, `!roulette 100 red 5`, `!flip 100 heads 2`)
// One stake of bet × runs goes into escrow when the game starts (so the whole show is covered or nothing is played), then
// every run settles on its own line: key g:<gameId>:<payout|refund>:<twitchId>:r<n> (n = 1..runs). A single run keeps the
// plain v1 key g:<gameId>:<kind>:<twitchId>. One show, one stage slot, one summary line for all of it.

/** Runs to play: input.runs (1..max), default 1. */
export const runsOf = (input) => (input && Number.isSafeInteger(input.runs) && input.runs > 0 ? input.runs : 1);

/** Checks input.runs against the game's cfg.maxRuns (absent = 1 run). */
export function checkRuns(input, maxRuns) {
  if (input.runs == null) return { ok: true };
  return Number.isSafeInteger(input.runs) && input.runs >= 1 && input.runs <= (maxRuns || 1) ? { ok: true } : fail('BAD_INPUT', { maxRuns: maxRuns || 1 });
}

/** The one stake of a multi-run game: bet × runs. */
export const runsStake = (gameId, input) => [stakeIntent(gameId, input.player, input.bet * runsOf(input))];

/**
 * Settlement lines: the v1 single line for one run, else one line per run (each takes `bet` out of the escrow).
 * @param {string} gameId
 * @param {{ player:string, bet:number, runs?:number }} input
 * @param {{ payout:number }[]} each   per-run results
 * @param {(r:Object, i:number)=>string} memo
 */
export function runsSettle(gameId, input, each, memo) {
  if (each.length === 1) return [settleLine(gameId, input.player, input.bet, each[0].payout, SYS.house, memo(each[0], 0))];
  return each.map((r, i) => settleLine(gameId, input.player, input.bet, r.payout, SYS.house, memo(r, i), i + 1));
}

/** The best run (highest payout, the first on a tie): its details go on the outcome's top level (alerts read them). */
export function bestRun(each) {
  let b = 0;
  each.forEach((r, i) => { if (r.payout > each[b].payout) b = i; });
  return each[b];
}

/**
 * What the watching crowd (actor '*') does when a run ends (v1.9, Sky: "sad when the player doesn't win, happy + jump
 * when they do"): 'big' = excited, jump, then cheer; 'win' = happy + jump; 'lose' = sad face + sad slump; 'meh' = nothing.
 * @param {ReturnType<import('../script.mjs').scriptBuilder>} s
 * @param {number} t
 * @param {'big'|'win'|'lose'|'meh'} mood
 */
export function crowdReact(s, t, mood) {
  if (mood === 'big' || mood === 'win') {
    s.at(t, 'expr', EVERYONE, { name: mood === 'big' ? 'excited' : 'happy', ms: 2600 });
    s.at(t, 'anim', EVERYONE, { name: 'jump' });
    if (mood === 'big') s.at(t + 700, 'anim', EVERYONE, { name: 'cheer' });
  } else if (mood === 'lose') {
    s.at(t, 'expr', EVERYONE, { name: 'sad', ms: 2200 });
    s.at(t, 'anim', EVERYONE, { name: 'sad' });
  }
  return s;
}

/** The mood of one run's result: 'big' (≥ bigMult × bet back), 'win' (profit), 'meh' (some back), 'lose' (nothing). */
export function moodOf(bet, payout, bigMult = 10) {
  return payout >= bet * bigMult ? 'big' : payout > bet ? 'win' : payout > 0 ? 'meh' : 'lose';
}

/** "net +350" / "net -200" / "even" for a multi-run summary. */
export function netWord(stake, payout) {
  return payout > stake ? 'net +' + fmt(payout - stake) : payout < stake ? 'net -' + fmt(stake - payout) : 'even';
}

/** "+1,234", "stake back", "50 back" or "lost 100" for result lines. */
export function resultWord(stake, payout) {
  if (payout > stake) return '+' + fmt(payout - stake);
  if (payout === stake) return 'stake back';
  if (payout > 0) return `${fmt(payout)} back`;
  return 'lost ' + fmt(stake - payout);
}

/** Simple x spread: n points evenly between lo and hi. */
export function spread(n, lo, hi) {
  if (n <= 1) return [(lo + hi) / 2];
  return Array.from({ length: n }, (_, i) => round3(lo + ((hi - lo) * i) / (n - 1)));
}

/** Rounds a stage coordinate to 3 decimals (keeps fixtures readable and stable). */
export const round3 = (x) => Math.round(x * 1000) / 1000;
