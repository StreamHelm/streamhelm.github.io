// Coin flip (v1.9, DESIGN §4.4b): flip the Silvia Dollah. Heads = Sky, tails = the Cosmic Trinity. Call it right and you
// get 2× your bet back. The house edge is the coin itself: once in 40 flips the Dollah lands ON ITS EDGE (Klerb's doing),
// and then nobody's call wins.
//   P(heads) = P(tails) = 39/80 = 48.75 %, P(edge) = 2/80 = 2.5 %, pays 2× → RTP = 2 × 39/80 = 97.5 % (house edge 2.5 %,
//   between roulette's 2.7 % and fair). flipTheory() computes it from the table, so help, admin and tests agree.
// `!flip 100 tails 3` = 1–5 flips in one show (input.runs), each settled on its own ledger line like slots/roulette.
// Show: the player flicks a SMALL coin on the stage, a BIG spinning Dollah lands above it, the crowd watches and reacts.

import { DEFAULT_ECONOMY } from '../economy.mjs';
import { applyBp } from '../money.mjs';
import { fail } from '../errors.mjs';
import { scriptBuilder, HOUSE, EVERYONE, clip } from '../script.mjs';
import { isId, checkStake, at, resultWord, runsOf, checkRuns, runsStake, runsSettle, bestRun, netWord, crowdReact } from './common.mjs';
import { fmt } from '../format.mjs';

/** The coin's faces with their weight out of 80. */
export const FLIP_FACES = Object.freeze([
  { side: 'heads', name: 'Heads (Sky)', weight: 39 },
  { side: 'tails', name: 'Tails (Cosmic Trinity)', weight: 39 },
  { side: 'edge', name: 'On its edge', weight: 2 },
]);
const TOTAL = FLIP_FACES.reduce((s, f) => s + f.weight, 0);
/** What a correct call pays back, in basis points (stake included): 2×. */
export const FLIP_WIN_BP = 20000;
export const FLIP_CALLS = Object.freeze(['heads', 'tails']);
/** Show timing (ms) and the coin-rain threshold (a flip paying at least this many Dollahs rains coins). */
export const FLIP_SHOW = Object.freeze({ firstAt: 1300, runMs: 3300, landAt: 2100, rainMin: 500, outroMs: 2600 });

/**
 * Exact odds: the win probability for a call, the RTP and the house edge.
 * @returns {{ pWin:number, pEdge:number, mult:number, rtp:number, houseEdge:number }}
 */
export function flipTheory() {
  const pWin = FLIP_FACES[0].weight / TOTAL, pEdge = FLIP_FACES[2].weight / TOTAL, mult = FLIP_WIN_BP / 10000;
  return { pWin, pEdge, mult, rtp: pWin * mult, houseEdge: 1 - pWin * mult };
}

function toss(rng) {
  let r = rng.int(1, TOTAL);
  for (const f of FLIP_FACES) { r -= f.weight; if (r <= 0) return f.side; }
  return 'edge';
}

const limits = (cfg) => (cfg && cfg.flip) || DEFAULT_ECONOMY.flip;
const SIDE_WORD = { heads: 'HEADS', tails: 'TAILS', edge: 'EDGE' };

/** @type {import('./index.mjs').GameEngine} */
export const GAME = Object.freeze({
  id: 'flip',
  defaults: { minBet: DEFAULT_ECONOMY.flip.minBet, maxBet: DEFAULT_ECONOMY.flip.maxBet, maxRuns: DEFAULT_ECONOMY.flip.maxRuns },

  validate(input, cfg) {
    if (!input || !isId(input.player) || !FLIP_CALLS.includes(input.call)) return fail('BAD_INPUT');
    const lim = limits(cfg), r = checkRuns(input, lim.maxRuns);
    if (!r.ok) return r;
    return checkStake(input.bet, lim.minBet, lim.maxBet);
  },

  stakes: (input, gameId) => runsStake(gameId, input),

  /** outcome: top-level side/win/mult = the best flip, payout = every flip together, flips = each. */
  resolve(input, rng) {
    const flips = [];
    for (let i = 0; i < runsOf(input); i++) {
      const side = toss(rng), win = side === input.call;
      flips.push({ side, win, mult: win ? FLIP_WIN_BP / 10000 : 0, payout: win ? applyBp(input.bet, FLIP_WIN_BP) : 0 });
    }
    const best = bestRun(flips);
    return { side: best.side, win: best.win, mult: best.mult, payout: flips.reduce((s, x) => s + x.payout, 0), flips };
  },

  choreograph(input, outcome, rng, ctx) {
    const p = input.player, n = outcome.flips.length, F = FLIP_SHOW;
    const s = scriptBuilder({ id: ctx.gameId || 'g_preview', kind: 'flip', startsAt: ctx.now, crowd: 'others-watch' })
      .cast(p, 'player').cast(HOUSE, 'dealer')
      .prop('coin', 'coinToss', 0.5, 1, 'idle')                                          // the small coin they flick
      .prop('bigcoin', 'coinBig', 0.5, 2, 'idle', { y: 0.36, label: clip(`${SIDE_WORD[input.call]} · ${fmt(input.bet)}${n > 1 ? ' × ' + n : ''}`, 60) });
    s.at(0, 'moveTo', HOUSE, { x: 0.58, lane: 2, speed: 'walk' });
    s.at(0, 'moveTo', p, { x: 0.5, lane: 1, speed: 'walk' });
    s.at(F.firstAt - 100, 'face', p, { dir: 'front' });
    s.say(F.firstAt - 300, p, input.call === 'heads' ? 'Heads! Come on, Sky!' : 'Tails! Trinity, guide me!', 1200);
    let last = F.firstAt, rained = false;
    outcome.flips.forEach((f, i) => {
      const t = F.firstAt + i * F.runMs, tag = n > 1 ? `@${i + 1}/${n}` : '', T = t + F.landAt;
      last = t;
      s.at(t, 'anim', p, { name: 'wave' });                                              // the flick
      s.at(t + 100, 'prop', null, { id: 'coin', state: 'toss' });
      s.at(t + 250, 'prop', null, { id: 'bigcoin', state: 'spin' + tag });
      s.at(T, 'prop', null, { id: 'bigcoin', state: 'land:' + f.side + tag }).at(T, 'prop', null, { id: 'coin', state: 'land:' + f.side });
      if (f.side === 'edge') {
        s.at(T, 'fx', null, { name: 'flash', x: 0.5, y: 0.36 });
        s.say(T + 150, HOUSE, rng.pick(['ON ITS EDGE?! Klerb!!', 'The edge! House wins!', 'Klerb tipped it!']), 1800);
        s.at(T + 150, 'expr', EVERYONE, { name: 'startled', ms: 1400 }).at(T + 150, 'anim', EVERYONE, { name: 'startled' });   // the whole crowd jumps
      } else crowdReact(s, T + 200, f.win ? 'win' : 'lose');
      if (f.win) s.at(T + 200, 'expr', p, { name: 'happy', ms: 2200 }).at(T + 200, 'anim', p, { name: 'cheer' });
      else s.at(T + 200, 'expr', p, { name: 'sad', ms: 2000 }).at(T + 200, 'anim', p, { name: 'sad' });
      if (f.win && f.payout >= F.rainMin) { s.coinRain(T + 300, f.payout, 0.5, 0.42); rained = true; }
    });
    const end = last + F.landAt;
    const net = outcome.payout - input.bet * n;
    if (!rained && net >= F.rainMin) s.coinRain(end + 500, net, 0.5, 0.42);           // several small wins that add up
    if (n > 1) s.say(end + 900, HOUSE, clip(`${n} flips: ${netWord(input.bet * n, outcome.payout)}`, 60), 1800);
    s.at(end + 2400, 'moveTo', p, { x: 0.38, lane: 1, speed: 'walk' });
    return s.build(end + F.outroMs + 1400);
  },

  settle(input, outcome, gameId) {
    return runsSettle(gameId, input, outcome.flips, (f) => `Coin flip: ${f.side}`);
  },

  summary(input, outcome) {
    const n = outcome.flips.length;
    if (n === 1) {
      const f = outcome.flips[0];
      return `${at(input, input.player)} called ${input.call}: ${SIDE_WORD[f.side]}${f.side === 'edge' ? ' (on its edge!)' : ''} - ${resultWord(input.bet, f.payout)}`;
    }
    const each = outcome.flips.map((f) => `${SIDE_WORD[f.side]} ${resultWord(input.bet, f.payout)}`).join(' · ');
    return clip(`${at(input, input.player)} flip ${input.call} ×${n}: ${each} = ${netWord(input.bet * n, outcome.payout)}`, 300);
  },
});
