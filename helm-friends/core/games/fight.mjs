// Fight (DESIGN §4.5): a seeded boxing match until someone is knocked out, timed to last 15–20 s.
// The rules are symmetric and the first attacker is a coin flip, so it is a fair 50/50; looks never matter.

import { DEFAULT_ECONOMY } from '../economy.mjs';
import { scriptBuilder, HOUSE } from '../script.mjs';
import { nameOf } from './common.mjs';
import { validatePvp, stakesPvp, settlePvp, pvpSummary } from './pvp.mjs';
import { fitGaps, cumulative } from './timing.mjs';

export const FIGHT = Object.freeze({
  hp: 100,
  moves: [
    { move: 'punch', p: 0.6, lo: 6, hi: 12 },
    { move: 'kick', p: 0.3, lo: 9, hi: 16 },
    { move: 'uppercut', p: 0.1, lo: 12, hi: 20 },
  ],
  critChance: 0.12, critBp: 18000,  // ×1.8, floored
  dodgeChance: 0.1,
  counterChance: 0.35,              // the defender takes the initiative (a dodge always does)
  maxHits: 26,                      // after 26 hits the next one is a guaranteed knockout
  minMs: 15000, maxMs: 20000,       // whole show
  gapLo: 550, gapHi: 1600,          // between two hits
  introMinMs: 2000, outroMs: 3000,
});

const TAUNTS = ['Come here!', "You're going down!", 'Glorp guide my fists!', 'Let\'s dance.', 'No mercy!', 'Is that all?'];

function pickMove(rng) {
  let r = rng.next();
  for (const m of FIGHT.moves) { if (r < m.p) return m; r -= m.p; }
  return FIGHT.moves[FIGHT.moves.length - 1];
}

/**
 * Simulates hits until a knockout. Pure: same rng → same fight.
 * @returns {{ by:string, def:string, move:string, dmg:number, crit:boolean, dodge:boolean, counter:boolean }[]}
 */
export function simulateHits(a, b, rng) {
  const hp = { [a]: FIGHT.hp, [b]: FIGHT.hp };
  const hits = [];
  let att = rng.chance(0.5) ? a : b, counter = false;
  for (;;) {
    const def = att === a ? b : a;
    let move, dmg = 0, crit = false, dodge = false;
    if (hits.length >= FIGHT.maxHits) { move = 'uppercut'; dmg = hp[def]; crit = true; }
    else {
      const m = pickMove(rng);
      move = m.move;
      dodge = rng.chance(FIGHT.dodgeChance);
      if (!dodge) {
        dmg = rng.int(m.lo, m.hi);
        crit = rng.chance(FIGHT.critChance);
        if (crit) dmg = Math.floor((dmg * FIGHT.critBp) / 10000);
      }
    }
    dmg = Math.min(dmg, hp[def]);
    hp[def] -= dmg;
    hits.push({ by: att, def, move, dmg, crit, dodge, counter });
    if (hp[def] === 0) return hits;
    counter = dodge || rng.chance(FIGHT.counterChance);
    if (counter) att = def;
  }
}

const limits = (cfg) => (cfg && cfg.fight) || DEFAULT_ECONOMY.fight;

/** @type {import('./index.mjs').GameEngine} */
export const GAME = Object.freeze({
  id: 'fight',
  defaults: { minBet: DEFAULT_ECONOMY.fight.minBet, maxBet: DEFAULT_ECONOMY.fight.maxBet, acceptMs: DEFAULT_ECONOMY.fight.acceptSec * 1000 },

  validate: (input, cfg) => validatePvp(input, limits(cfg)),
  stakes: stakesPvp,

  resolve(input, rng) {
    const hits = simulateHits(input.a, input.b, rng);
    const n = hits.length;
    // the whole show lands in 15–20 s; with many hits the minimum gap decides the lower bound
    const lo = Math.max(FIGHT.minMs, n * FIGHT.gapLo + FIGHT.introMinMs + FIGHT.outroMs);
    const durationMs = rng.int(lo, FIGHT.maxMs);
    const budget = durationMs - FIGHT.introMinMs - FIGHT.outroMs;
    const weights = hits.map((h) => (h.counter ? 0.75 : 1) * rng.float(0.8, 1.25));
    const gaps = fitGaps(weights, budget, FIGHT.gapLo, FIGHT.gapHi);
    const intro = durationMs - FIGHT.outroMs - gaps.reduce((s, g) => s + g, 0);
    const times = cumulative(gaps).map((t) => intro + t);
    const rounds = hits.map((h, i) => ({ t: times[i], by: h.by, move: h.move, dmg: h.dmg, crit: h.crit, dodge: h.dodge, counter: h.counter }));
    const hpA = FIGHT.hp - hits.filter((h) => h.def === input.a).reduce((s, h) => s + h.dmg, 0);
    const hpB = FIGHT.hp - hits.filter((h) => h.def === input.b).reduce((s, h) => s + h.dmg, 0);
    const winner = hpA > 0 ? input.a : input.b;
    return { winner, loser: winner === input.a ? input.b : input.a, rounds, hpA, hpB, introMs: intro, durationMs };
  },

  choreograph(input, outcome, rng, ctx) {
    const { a, b } = input, { winner, loser } = outcome;
    const X = { [a]: 0.42, [b]: 0.58 };
    const s = scriptBuilder({ id: ctx.gameId || 'g_preview', kind: 'fight', startsAt: ctx.now, crowd: 'others-hide' })
      .cast(a, 'a').cast(b, 'b').cast(HOUSE, 'announcer')
      .prop('ring', 'ring', 0.5, 1, 'idle').prop('hpA', 'hpBar', 0.3, 0, 'hidden').prop('hpB', 'hpBar', 0.7, 0, 'hidden');
    s.at(0, 'moveTo', a, { x: X[a], lane: 1, speed: 'run' }).at(0, 'moveTo', b, { x: X[b], lane: 1, speed: 'run' });
    s.at(0, 'moveTo', HOUSE, { x: 0.5, lane: 2, speed: 'walk' });
    s.at(900, 'face', a, { dir: 'right' }).at(900, 'face', b, { dir: 'left' });
    s.at(1000, 'equip', a, { layer: 'gloves' }).at(1000, 'equip', b, { layer: 'gloves' });
    s.at(1000, 'fx', null, { name: 'dust', x: X[a], y: 0.8 }).at(1000, 'fx', null, { name: 'dust', x: X[b], y: 0.8 });
    s.at(1300, 'prop', null, { id: 'hpA', state: 'show' }).at(1300, 'prop', null, { id: 'hpB', state: 'show' });
    s.at(1300, 'hp', null, { actor: a, value: 100, max: 100 }).at(1300, 'hp', null, { actor: b, value: 100, max: 100 });
    s.at(1300, 'expr', a, { name: 'angry', ms: 2000 }).at(1300, 'expr', b, { name: 'angry', ms: 2000 });
    // longer intros get a taunt or two
    let tt = 1500;
    for (const who of rng.shuffle([a, b])) {
      if (tt + 1200 > outcome.introMs - 700) break;
      s.say(tt, who, rng.pick(TAUNTS), 1100);
      tt += 1300;
    }
    s.say(Math.max(1500, outcome.introMs - 700), HOUSE, 'FIGHT!', 900);
    const hp = { [a]: 100, [b]: 100 };
    for (const r of outcome.rounds) {
      const def = r.by === a ? b : a;
      s.at(r.t - 250, 'anim', r.by, { name: r.move });
      if (r.dodge) { s.at(r.t, 'anim', def, { name: 'jump' }); continue; }
      hp[def] -= r.dmg;
      s.at(r.t, 'hp', null, { actor: def, value: hp[def], max: 100, dmg: r.dmg, crit: r.crit });
      if (hp[def] > 0) s.at(r.t, 'anim', def, { name: 'hurt' });
      if (r.crit) s.at(r.t, 'fx', null, { name: 'stars', x: X[def], y: 0.6 });
    }
    const ko = outcome.durationMs - 3000;
    s.at(ko, 'anim', loser, { name: 'knockout', hold: true }).at(ko, 'expr', loser, { name: 'ko', ms: 3000 });
    s.at(ko + 600, 'anim', winner, { name: 'victory' }).at(ko + 600, 'expr', winner, { name: 'excited', ms: 2000 });
    s.say(ko + 700, HOUSE, `${nameOf(input, winner)} WINS!`, 1800);
    if (input.stake > 0) s.coinRain(ko + 800, input.stake * 2, X[winner], 0.45);
    s.at(ko + 2400, 'unequip', a, { layer: 'gloves' }).at(ko + 2400, 'unequip', b, { layer: 'gloves' });
    s.at(ko + 2400, 'prop', null, { id: 'hpA', state: 'hidden' }).at(ko + 2400, 'prop', null, { id: 'hpB', state: 'hidden' });
    return s.build(outcome.durationMs);
  },

  settle: (input, outcome, gameId) => settlePvp(gameId, input, outcome.winner, 'fight'),
  summary: (input, outcome) => pvpSummary(input, outcome.winner, outcome.loser, 'knocked out'),
});
