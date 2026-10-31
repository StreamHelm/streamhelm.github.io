// Arm wrestle (DESIGN §4.5): the winner is a coin flip, drawn first; then a seeded Brownian bridge from 0 to ±1 over
// 40 samples (0.25 s each = 10 s) makes a dramatic back-and-forth that always ends on the right side.
// Path sign: +1 = A's side wins, -1 = B's side wins.

import { DEFAULT_ECONOMY } from '../economy.mjs';
import { scriptBuilder, HOUSE, EVERYONE } from '../script.mjs';
import { validatePvp, stakesPvp, settlePvp, pvpSummary } from './pvp.mjs';

export const ARMWRESTLE = Object.freeze({
  samples: 40, sampleMs: 250,
  sigma: 0.24,        // step size of the random walk (drama)
  edge: 0.92,         // before the last sample the arm never quite touches the table
  introMs: 2500, outroMs: 3000,
});

const round3 = (x) => Math.round(x * 1000) / 1000;

/**
 * A Brownian bridge from 0 to `target` (±1) in `n` samples, kept inside ±edge until the end.
 * @returns {number[]}
 */
export function bridgePath(target, rng, n = ARMWRESTLE.samples) {
  const w = [0];
  for (let k = 1; k <= n; k++) w.push(w[k - 1] + rng.normal() * ARMWRESTLE.sigma);
  const path = [];
  for (let k = 1; k <= n; k++) {
    const f = k / n;
    const v = k === n ? target : w[k] - f * w[n] + f * target;
    path.push(k === n ? target : round3(Math.max(-ARMWRESTLE.edge, Math.min(ARMWRESTLE.edge, v))));
  }
  return path;
}

const limits = (cfg) => (cfg && cfg.armwrestle) || DEFAULT_ECONOMY.armwrestle;

/** @type {import('./index.mjs').GameEngine} */
export const GAME = Object.freeze({
  id: 'armwrestle',
  defaults: { minBet: DEFAULT_ECONOMY.armwrestle.minBet, maxBet: DEFAULT_ECONOMY.armwrestle.maxBet, acceptMs: DEFAULT_ECONOMY.armwrestle.acceptSec * 1000 },

  validate: (input, cfg) => validatePvp(input, limits(cfg)),
  stakes: stakesPvp,

  resolve(input, rng) {
    const aWins = rng.chance(0.5);
    const path = bridgePath(aWins ? 1 : -1, rng);
    return { winner: aWins ? input.a : input.b, loser: aWins ? input.b : input.a, path, durationMs: ARMWRESTLE.samples * ARMWRESTLE.sampleMs };
  },

  choreograph(input, outcome, rng, ctx) {
    const { a, b } = input, { winner, loser } = outcome, A = ARMWRESTLE;
    const s = scriptBuilder({ id: ctx.gameId || 'g_preview', kind: 'armwrestle', startsAt: ctx.now, crowd: 'others-watch' })
      .cast(a, 'a').cast(b, 'b').cast(HOUSE, 'referee')
      .prop('table', 'armTable', 0.5, 1, 'idle');
    s.at(0, 'moveTo', a, { x: 0.46, lane: 1, speed: 'walk' }).at(0, 'moveTo', b, { x: 0.54, lane: 1, speed: 'walk' });
    s.at(0, 'moveTo', HOUSE, { x: 0.5, lane: 2, speed: 'walk' });
    s.at(1600, 'face', a, { dir: 'right' }).at(1600, 'face', b, { dir: 'left' });
    s.at(1800, 'anim', a, { name: 'armwrestle', loop: true }).at(1800, 'anim', b, { name: 'armwrestle', loop: true });
    s.at(1800, 'expr', a, { name: 'angry', ms: 10500 }).at(1800, 'expr', b, { name: 'angry', ms: 10500 });
    s.say(1900, HOUSE, 'Ready... GO!', 700);
    let lead = 0, cheers = 0;
    outcome.path.forEach((v, i) => {
      const t = A.introMs + (i + 1) * A.sampleMs;
      s.at(t, 'prop', null, { id: 'table', state: 'arm:' + v });
      const side = Math.abs(v) < 0.15 ? 0 : Math.sign(v);
      if (side && side !== lead && i < outcome.path.length - 1) {   // a lead swing: the crowd goes wild
        if (lead !== 0 && cheers < 4) { s.at(t, 'anim', EVERYONE, { name: 'cheer' }); cheers++; }
        lead = side;
      }
    });
    const end = A.introMs + outcome.durationMs;
    s.at(end, 'anim', loser, { name: 'startled' }).at(end, 'expr', loser, { name: 'startled', ms: 800 });
    s.at(end + 800, 'anim', loser, { name: 'sad' }).at(end + 800, 'expr', loser, { name: 'sad', ms: 2000 });
    s.at(end + 200, 'anim', winner, { name: 'cheer' }).at(end + 200, 'expr', winner, { name: 'excited', ms: 2500 });
    s.at(end + 300, 'anim', EVERYONE, { name: 'cheer' });
    if (input.stake > 0) s.coinRain(end + 400, input.stake * 2, winner === a ? 0.46 : 0.54, 0.5);
    return s.build(end + A.outroMs);
  },

  settle: (input, outcome, gameId) => settlePvp(gameId, input, outcome.winner, 'arm wrestle'),
  summary: (input, outcome) => pvpSummary(input, outcome.winner, outcome.loser, 'out-muscled'),
});
