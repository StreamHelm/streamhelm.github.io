// KLERB'S CHAOS WHEEL `!wheel <amount> [spins 1-3]` (v1.21, games round 6; Sky: "whatever fits the theme and is fun and
// easy"). The solo gamble with a twist: Klerb's wheel has 16 equal slices; each one pays a multiplier of the bet (stake
// included) AND sets off one of Klerb's chaos effects on the stream - everyone shrinks, outfits get swapped round the
// stage for a minute, low gravity, a disco, a confetti storm... Losing still makes something silly happen.
//
//   slice  0      1      2       3     4       5      6       7      8      9       10     11      12     13      14     15
//   mult   4×     0      2×      .5×   1.5×    0      1.2×    0      2×     .2×     1×     0       1.5×   0       1×     .5×
//   chaos  party  shrink sparkle swap  gravity spin   shrink  giant  disco  chaos   swap   chaos   party  gravity giant  disco
//
// Every slice is 1 in 16 (the wheel is drawn with equal slices, so what you see is the real odds).
// RTP = Σ mult / 16 = 15.4 / 16 = 96.25 % (house edge 3.75 %), sd ≈ 1.05 bets; a win (more than the bet back) 6 in 16 =
// 37.5 %, the bet back 2 in 16, the 4× jackpot 1 in 16. Compared with the other house games: flip 97.5 %, roulette 97.3 %,
// Plinko 95.4–97.6 %, slots ≈ 94.3 %, cursed 91.9 %. wheelTheory() computes every number from the table; t-hf-core checks it
// exactly + with seeded Monte Carlo. Multipliers go through core applyMult (exact basis points, floored).
// Lifecycle like slots / Plinko: one stake of bet × spins, one show, one ledger line per spin (g:<id>:<payout|refund>:<id>[:r<n>]).
// Show: the player walks up to the small wheel (wheelMini) and gives it a shove; the BIG wheel (chaosWheel, in the sky)
// spins for ~4 s and stops on the slice (prop states spin:<slice>[@i/n] → stop:<slice>[@i/n]); Klerb's chaos goes off
// (fx 'chaos' { effect, ms }: the overlay applies it to everyone on stage for ms); the crowd reacts; wins rain coins.

import { DEFAULT_ECONOMY } from '../economy.mjs';
import { applyMult } from '../money.mjs';
import { fail } from '../errors.mjs';
import { scriptBuilder, HOUSE, clip, EVERYONE } from '../script.mjs';
import { isId, checkStake, at, runsOf, checkRuns, runsStake, runsSettle, bestRun, netWord, crowdReact, moodOf } from './common.mjs';
import { fmt } from '../format.mjs';

/** Klerb's chaos effects: how long each lasts on stage (ms) and how chat lines / the overlay name it. */
export const CHAOS = Object.freeze({
  confetti: { ms: 5000, name: 'CONFETTI STORM', line: 'confetti everywhere' },
  shrink: { ms: 30000, name: 'SHRINK RAY', line: 'everyone got shrunk' },
  giant: { ms: 30000, name: 'MEGA CHONK', line: 'became a giant' },
  swap: { ms: 60000, name: 'OUTFIT SWAP', line: 'everyone swapped outfits' },
  gravity: { ms: 30000, name: 'LOW GRAVITY', line: 'gravity switched off' },
  spin: { ms: 8000, name: 'DIZZY SPIN', line: 'everyone is spinning' },
  disco: { ms: 15000, name: 'DISCO TIME', line: 'disco time' },
  sparkle: { ms: 6000, name: 'SPARKLE', line: 'sparkly' },
  chaos: { ms: 6000, name: "KLERB'D", line: "got Klerb'd" },
});
/** The 16 slices in wheel order (clockwise from the top). `word` is the small text on the slice. */
export const WHEEL_SEGS = Object.freeze([
  { mult: 4, effect: 'confetti', word: 'JACKPOT' },
  { mult: 0, effect: 'shrink', word: 'SHRUNK' },
  { mult: 2, effect: 'sparkle', word: 'DOUBLE' },
  { mult: 0.5, effect: 'swap', word: 'SWAP' },
  { mult: 1.5, effect: 'gravity', word: 'FLOATY' },
  { mult: 0, effect: 'spin', word: 'DIZZY' },
  { mult: 1.2, effect: 'shrink', word: 'SHRINK' },
  { mult: 0, effect: 'giant', word: 'CHONK' },
  { mult: 2, effect: 'disco', word: 'DISCO' },
  { mult: 0.2, effect: 'chaos', word: "KLERB'D" },
  { mult: 1, effect: 'swap', word: 'SWAP' },
  { mult: 0, effect: 'chaos', word: "KLERB'D" },
  { mult: 1.5, effect: 'confetti', word: 'PARTY' },
  { mult: 0, effect: 'gravity', word: 'FLOATY' },
  { mult: 1, effect: 'giant', word: 'CHONK' },
  { mult: 0.5, effect: 'disco', word: 'DISCO' },
].map((s) => Object.freeze(s)));
/** A spin paying at least this × the bet rains coins; at least BIG_MULT is a big win (banner + excited crowd). */
export const WHEEL_RAIN_MULT = 2;
const BIG_MULT = 4;
/** Show timing (ms): the wheel spins SPIN_MS, the next spin starts RUN_MS after the last. */
export const WHEEL_SHOW = Object.freeze({ firstAt: 1700, spinMs: 4200, runMs: 6400, outroMs: 3000, bigOutroMs: 4200 });

/**
 * Exact odds: per-slice chance, the RTP, house edge, chance to win / get the bet back, sd (in bets), the top prize.
 */
export function wheelTheory() {
  const n = WHEEL_SEGS.length, p = 1 / n;
  const rtp = WHEEL_SEGS.reduce((s, x) => s + x.mult * p, 0), sq = WHEEL_SEGS.reduce((s, x) => s + x.mult * x.mult * p, 0);
  const win = WHEEL_SEGS.filter((x) => x.mult > 1).length * p, back = WHEEL_SEGS.filter((x) => x.mult >= 1).length * p;
  const zero = WHEEL_SEGS.filter((x) => x.mult === 0).length * p, top = Math.max(...WHEEL_SEGS.map((x) => x.mult));
  return { slices: n, p, rtp, houseEdge: 1 - rtp, win, back, zero, sd: Math.sqrt(sq - rtp * rtp), top, topP: WHEEL_SEGS.filter((x) => x.mult === top).length * p };
}

const limits = (cfg) => (cfg && cfg.wheel) || DEFAULT_ECONOMY.wheel;
const multWord = (m) => `${m}×`;

/** One spin: a slice (uniform), its multiplier, payout and chaos effect. */
function spin(rng, bet) {
  const seg = rng.int(0, WHEEL_SEGS.length - 1), s = WHEEL_SEGS[seg];
  return { seg, mult: s.mult, effect: s.effect, payout: applyMult(bet, s.mult) };
}

/** @type {import('./index.mjs').GameEngine} */
export const GAME = Object.freeze({
  id: 'wheel',
  defaults: { minBet: DEFAULT_ECONOMY.wheel.minBet, maxBet: DEFAULT_ECONOMY.wheel.maxBet, maxRuns: DEFAULT_ECONOMY.wheel.maxRuns },
  validate(input, cfg) {
    if (!input || !isId(input.player)) return fail('BAD_INPUT');
    const lim = limits(cfg), r = checkRuns(input, lim.maxRuns);
    if (!r.ok) return r;
    return checkStake(input.bet, lim.minBet, lim.maxBet);
  },
  stakes: (input, gameId) => runsStake(gameId, input),
  resolve(input, rng) {
    const spins = [];
    for (let i = 0; i < runsOf(input); i++) spins.push(spin(rng, input.bet));
    const best = bestRun(spins);
    return { seg: best.seg, mult: best.mult, effect: best.effect, payout: spins.reduce((s, x) => s + x.payout, 0), spins };
  },
  choreograph(input, outcome, rng, ctx) {
    const p = input.player, n = outcome.spins.length, S = WHEEL_SHOW;
    const label = clip(`${fmt(input.bet)}${n > 1 ? ' × ' + n : ''}`, 60);
    const s = scriptBuilder({ id: ctx.gameId || 'g_preview', kind: 'wheel', startsAt: ctx.now, crowd: 'others-watch' })
      .cast(p, 'player').cast(HOUSE, 'dealer')
      .prop('mini', 'wheelMini', 0.5, 1, 'idle')
      .prop('wheel', 'chaosWheel', 0.5, 2, 'idle', { y: 0.44, label, wheel: { segs: WHEEL_SEGS.map((x) => ({ mult: x.mult, effect: x.effect, word: x.word })) } });
    s.at(0, 'moveTo', HOUSE, { x: 0.61, lane: 2, speed: 'walk' });
    s.at(0, 'moveTo', p, { x: 0.44, lane: 1, speed: 'walk' });
    s.say(500, HOUSE, rng.pick(['Klerb says: SPIN IT!', 'Chaos is a ladder. Spin!', 'Round and round she goes...', 'What could possibly go wrong?']), 1800);
    s.at(S.firstAt - 150, 'face', p, { dir: 'right' });
    let big = false, last = S.firstAt;
    outcome.spins.forEach((r, i) => {
      const t = S.firstAt + i * S.runMs, tag = n > 1 ? `@${i + 1}/${n}` : '', c = CHAOS[r.effect];
      last = t;
      s.at(t, 'anim', p, { name: 'punch' });                                           // shoves the wheel
      s.at(t + 120, 'prop', null, { id: 'mini', state: 'spin' });
      s.at(t + 150, 'prop', null, { id: 'wheel', state: `spin:${r.seg}${tag}` });
      s.at(t + 450, 'fx', null, { name: 'chaosSparks', x: 0.5, y: 0.25, ms: S.spinMs - 600 });
      const T = t + 150 + S.spinMs, mood = moodOf(input.bet, r.payout, BIG_MULT);
      s.at(T, 'prop', null, { id: 'wheel', state: `stop:${r.seg}${tag}` });
      s.at(T, 'prop', null, { id: 'mini', state: r.payout > input.bet ? 'win' : r.payout < input.bet ? 'lose' : 'idle' });
      s.at(T + 250, 'fx', null, { name: 'chaos', x: 0.5, y: 0.5, effect: r.effect, ms: c.ms });
      crowdReact(s, T + 160, mood);
      if (mood === 'big') {
        big = true;
        s.at(T, 'fx', null, { name: 'flash', x: 0.5, y: 0.4 });
        s.at(T, 'fx', null, { name: 'banner', x: 0.5, y: 0.56, text: `KLERB JACKPOT ${multWord(r.mult)}!` });
        s.at(T, 'expr', p, { name: 'excited', ms: 3500 }).at(T, 'anim', p, { name: 'victory' });
        s.say(T + 300, HOUSE, rng.pick(['KLERB SMILES UPON YOU!', 'Total chaos. Total profit.', 'The wheel has chosen!']));
      } else if (r.payout > input.bet) {
        s.at(T, 'expr', p, { name: 'happy', ms: 2200 }).at(T, 'anim', p, { name: 'cheer' });
      } else if (r.payout === input.bet) {
        s.at(T, 'expr', p, { name: 'neutral', ms: 1500 });
      } else {
        s.at(T, 'expr', p, { name: r.mult === 0 ? 'startled' : 'sad', ms: 1800 });
        if (r.mult === 0) s.at(T + 300, 'anim', p, { name: 'sad' });
      }
      // the chaos word over the stage when it isn't the jackpot banner
      if (mood !== 'big') s.say(T + 400, HOUSE, clip(`${c.name}!`, 60), 1800);
      if (r.effect === 'disco') s.at(T + 400, 'anim', EVERYONE, { name: 'dance', loop: true, style: 'disco' });
      if (r.mult >= WHEEL_RAIN_MULT) s.coinRain(T + 200, r.payout, 0.5, 0.42);
      if (i < n - 1) s.at(T + 700, 'prop', null, { id: 'mini', state: 'idle' });
    });
    const end = last + 150 + S.spinMs;
    if (n > 1) s.say(end + 2300, HOUSE, clip(`${n} spins: ${netWord(input.bet * n, outcome.payout)}`, 60), 2000);
    s.at(end + 2300, 'moveTo', p, { x: 0.36, lane: 1, speed: 'walk' });
    return s.build(end + (big ? S.bigOutroMs : S.outroMs) + 1200);
  },
  settle(input, outcome, gameId) {
    return runsSettle(gameId, input, outcome.spins, (r) => `Chaos Wheel ${r.mult}× (${CHAOS[r.effect].name.toLowerCase()})`);
  },
  summary(input, outcome) {
    const n = outcome.spins.length;
    if (n === 1) {
      const r = outcome.spins[0], c = CHAOS[r.effect], pre = r.mult >= BIG_MULT ? 'KLERB JACKPOT! ' : '';
      const res = r.payout > input.bet ? '+' + fmt(r.payout - input.bet) : r.payout === input.bet ? 'stake back' : r.payout > 0 ? `${fmt(r.payout)} back` : 'lost ' + fmt(input.bet);
      return `${pre}${at(input, input.player)} spun Klerb's Chaos Wheel: ${multWord(r.mult)} - ${res} (${c.name.toLowerCase()}!)`;
    }
    const pre = outcome.spins.some((r) => r.mult >= BIG_MULT) ? 'KLERB JACKPOT! ' : '';
    const each = outcome.spins.map((r) => multWord(r.mult)).join(' · ');
    return clip(`${pre}${at(input, input.player)} Chaos Wheel ×${n}: ${each} = ${netWord(input.bet * n, outcome.payout)}`, 300);
  },
});
