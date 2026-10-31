// Gleep Race (v1.9, DESIGN §4.6b): racers get beamed up into their UFOs (spec.vehicles.ufo) and race across the screen.
//   duel  `!race @user [amount]` → !accept / !decline, exactly like a fight: a fair 50/50, the winner takes the pot
//         (stake 0 = just for glory). Zero-sum; the rake is cfg.race.rakePct (default 0).
//   gp    the GLEEP GRAND PRIX: opened by Sky or a mod (`!gp [fee]`) or by a points / Dollah redemption; `!join` for
//         lobbySec; 3–24 racers. Prize pool = every entry fee + a prize from the mint (royale-style:
//         round(U[0.8,1.2] × (300 + 40 × n)), capped at 3,000). Podium split 60 / 25 / 15 %.
//         Expected value per racer = E[mint prize] / n — the fee only moves money between racers (no rake), so it raises
//         the stakes, never the house's take. raceTheory() gives the exact numbers.
// FAIRNESS: the finishing order is ONE uniform shuffle (resolve). Everything that makes it exciting — lead changes, boosts,
// wobbles, the Klerb chaos moment — is drawn afterwards in choreograph() from the 'show' stream and is pinned so that
// every racer crosses the line exactly at its finishing time. Looks never change the odds.

import { DEFAULT_ECONOMY } from '../economy.mjs';
import { isMoney } from '../money.mjs';
import { fail } from '../errors.mjs';
import { SYS, intent, escrowAcct, userAcct, gameIdem } from '../ledger.mjs';
import { scriptBuilder, HOUSE, EVERYONE, clip } from '../script.mjs';
import { isId, stakeIntent, at, nameOf, round3, spread } from './common.mjs';
import { validatePvp, stakesPvp, settlePvp, pvpSummary, rakeOf } from './pvp.mjs';
import { fmt } from '../format.mjs';

export const RACE = Object.freeze({
  sampleMs: 250,
  duelMs: 15000,                                  // the first racer crosses the line after this long (duel)
  gpBaseMs: 18000, gpPerRacerMs: 400, gpMaxMs: 30000,
  gapLo: 1, gapHi: 3,                             // samples between finishers (250–750 ms)
  sigma: 0.022,                                   // random-walk step (the jitter)
  startAt: 6500,                                  // ms from the show start to "GLEEP!"
  startX: 0.07, finishX: 0.9,                     // the course on screen (x 0..1)
  rowTop: 0.13, rowBottom: 0.62,                  // racing rows (y 0..1), spread over the racers
  landGapMs: 900, outroMs: 7000,
  podiumLift: [22, 14, 8],                        // art pixels each podium step stands up
});

const conf = (cfg) => (cfg && cfg.race) || DEFAULT_ECONOMY.race;
const gpConf = (cfg) => conf(cfg).gp || DEFAULT_ECONOMY.race.gp;

/** The racers of a race input. */
export const racersOf = (input) => (input.mode === 'gp' ? input.racers : [input.a, input.b]);

/**
 * The mint part of a Grand Prix prize: round(U[1-jitter, 1+jitter] × (base + per × n)), capped. Jitter in whole bp.
 * @param {number} n
 * @param {import('../rng.mjs').Rng} rng
 */
export function raceGpPrize(n, rng, cfg) {
  const g = gpConf(cfg), j = Math.round(g.jitter * 10000);
  const bp = rng.int(10000 - j, 10000 + j);
  return Math.min(g.prizeCap, Math.round(((g.prizeBase + g.prizePer * n) * bp) / 10000));
}

/**
 * The podium payouts of a pool: places 2.. are floored, 1st gets the rest (so the pool is paid out exactly).
 * Fewer racers than places: the split is cut to the racers and renormalised.
 * @param {number} pool
 * @param {number} n  racers
 * @returns {number[]}
 */
export function podiumSplit(pool, n, cfg) {
  const split = gpConf(cfg).split.slice(0, Math.max(1, Math.min(n, gpConf(cfg).split.length)));
  const total = split.reduce((s, x) => s + x, 0);
  const pays = split.map((pct) => Math.floor((pool * pct) / total));
  pays[0] = pool - pays.slice(1).reduce((s, x) => s + x, 0);
  return pays;
}

/**
 * Exact Grand Prix maths for n racers paying `fee` each: the mean mint prize (over every jitter step, with the cap), the
 * mean pool, the mean payout per podium place and the expected value per racer (= E[mint] / n).
 * @returns {{ n:number, fee:number, mintMean:number, poolMean:number, places:number[], evPerRacer:number }}
 */
export function raceTheory(n, fee = 0, cfg) {
  const g = gpConf(cfg), j = Math.round(g.jitter * 10000);
  let mint = 0; const places = new Array(Math.min(n, g.split.length)).fill(0);
  for (let bp = 10000 - j; bp <= 10000 + j; bp++) {
    const m = Math.min(g.prizeCap, Math.round(((g.prizeBase + g.prizePer * n) * bp) / 10000));
    mint += m;
    podiumSplit(m + fee * n, n, cfg).forEach((p, i) => { places[i] += p; });
  }
  const steps = 2 * j + 1;
  const mintMean = mint / steps;
  return { n, fee, mintMean, poolMean: mintMean + fee * n, places: places.map((p) => p / steps), evPerRacer: mintMean / n };
}

/** Race length (ms until the winner crosses the line). */
export function raceDuration(input) {
  if (input.mode !== 'gp') return RACE.duelMs;
  return Math.min(RACE.gpMaxMs, RACE.gpBaseMs + RACE.gpPerRacerMs * input.racers.length);
}

/** @type {import('./index.mjs').GameEngine} */
export const GAME = Object.freeze({
  id: 'race',
  defaults: { minBet: DEFAULT_ECONOMY.race.minBet, maxBet: DEFAULT_ECONOMY.race.maxBet, acceptMs: DEFAULT_ECONOMY.race.acceptSec * 1000,
    lobbyMs: DEFAULT_ECONOMY.race.gp.lobbySec * 1000, minPlayers: DEFAULT_ECONOMY.race.gp.minRacers, maxPlayers: DEFAULT_ECONOMY.race.gp.maxRacers },

  validate(input, cfg) {
    if (!input || typeof input !== 'object') return fail('BAD_INPUT');
    if (input.mode === 'duel' || input.mode == null) return validatePvp(input, conf(cfg));
    if (input.mode !== 'gp') return fail('BAD_INPUT');
    const g = gpConf(cfg);
    if (!Array.isArray(input.racers) || !input.racers.every(isId) || new Set(input.racers).size !== input.racers.length) return fail('BAD_INPUT');
    if (input.racers.length < g.minRacers) return fail('BAD_INPUT', { min: g.minRacers });
    if (input.racers.length > g.maxRacers) return fail('FULL', { max: g.maxRacers });
    if (!isMoney(input.fee || 0) || (input.fee || 0) > g.maxFee) return fail('BAD_AMOUNT', { min: 0, max: g.maxFee });
    if (input.prize != null && !(isMoney(input.prize) && input.prize >= 0)) return fail('BAD_AMOUNT', { min: 0, max: g.prizeCap });
    return { ok: true };
  },

  stakes(input, gameId) {
    if (input.mode !== 'gp') return stakesPvp(input, gameId);
    return input.fee > 0 ? input.racers.map((p) => stakeIntent(gameId, p, input.fee)) : [];
  },

  /** outcome: order (1st first), finishMs per racer (ms after "GLEEP!"), winner; gp: pool, mintPrize, fees, places. */
  resolve(input, rng, cfg) {
    const racers = racersOf(input), order = rng.shuffle(racers);
    const first = raceDuration(input), finishMs = {};
    let t = first;
    order.forEach((p, i) => { if (i) t += rng.int(RACE.gapLo, RACE.gapHi) * RACE.sampleMs; finishMs[p] = t; });
    const out = { mode: input.mode === 'gp' ? 'gp' : 'duel', order, winner: order[0], finishMs };
    if (out.mode === 'duel') return { ...out, loser: order[1] };
    const n = racers.length, fees = (input.fee || 0) * n;
    const mintPrize = input.prize != null ? input.prize : raceGpPrize(n, rng, cfg);
    const pays = podiumSplit(fees + mintPrize, n, cfg);
    return { ...out, pool: fees + mintPrize, mintPrize, fees, places: pays.map((payout, i) => ({ player: order[i], place: i + 1, payout })) };
  },

  choreograph(input, outcome, rng, ctx) {
    const R = RACE, racers = racersOf(input), n = racers.length, gp = outcome.mode === 'gp';
    const s = scriptBuilder({ id: ctx.gameId || 'g_preview', kind: 'race', startsAt: ctx.now, crowd: 'others-watch' })
      .cast(HOUSE, 'announcer');
    racers.forEach((p) => s.cast(p, 'racer'));
    const paths = racePaths(racers, outcome, rng.fork('paths'));
    const rows = n === 1 ? [0.4] : spread(n, R.rowTop, R.rowBottom);
    const board = spread(n, n > 6 ? 0.08 : 0.3, n > 6 ? 0.92 : 0.7);
    const rowOf = {}, boardOf = {};
    rng.shuffle(racers).forEach((p, i) => { rowOf[p] = rows[i]; });
    racers.forEach((p, i) => { boardOf[p] = board[i]; });
    s.prop('course', 'raceCourse', 0.5, 2, 'idle', { y: R.rowBottom + 0.06, label: gp ? 'GLEEP GRAND PRIX' : 'GLEEP RACE' });
    if (gp) s.prop('podium', 'podium', 0.5, 1, 'hidden');
    racers.forEach((p, i) => s.prop('ufo' + (i + 1), 'ufo', boardOf[p], 2, 'hidden',
      { owner: p, y: rowOf[p], path: paths.path[p], sampleMs: R.sampleMs, label: clip(nameOf(input, p), 24) }));
    const ufo = Object.fromEntries(racers.map((p, i) => [p, 'ufo' + (i + 1)]));
    // 1. boarding: walk to the pads, UFOs come down, tractor beams, up they go
    s.at(0, 'moveTo', HOUSE, { x: 0.5, lane: 2, speed: 'walk' });
    s.say(300, HOUSE, gp ? `${n} racers! The Gleep Grand Prix!` : 'Gleep Race! Pilots, to your saucers!', 2000);
    racers.forEach((p, i) => {
      s.at(Math.round((i * 900) / n), 'moveTo', p, { x: boardOf[p], lane: i % 2 ? 0 : 1, speed: 'walk' });
      const t = 1800 + Math.round((i * 1200) / n);
      s.at(t, 'prop', null, { id: ufo[p], state: 'arrive' });
      s.at(t + 1100, 'prop', null, { id: ufo[p], state: 'beam' });
      s.at(t + 1150, 'face', p, { dir: 'front' }).at(t + 1150, 'expr', p, { name: 'excited', ms: 1500 });
      s.at(t + 1300, 'anim', p, { name: 'jump' });
      s.at(t + 1700, 'hide', p);
      s.at(t + 1900, 'prop', null, { id: ufo[p], state: 'rise' });
    });
    s.say(R.startAt - 1600, HOUSE, '3... 2... 1...', 1300);
    s.at(R.startAt - 600, 'prop', null, { id: 'course', state: 'ready' });
    s.at(R.startAt, 'prop', null, { id: 'course', state: 'go' });
    s.say(R.startAt, HOUSE, 'GLEEP!', 900);
    for (const p of racers) s.at(R.startAt, 'prop', null, { id: ufo[p], state: 'race' });
    // 2. the race: boosts, wobbles, the chaos moment, lead changes (cosmetic: the order is already decided)
    const where = (p, k) => ({ x: round3(R.startX + (R.finishX - R.startX) * Math.min(1, paths.path[p][Math.min(k, paths.path[p].length - 1)])), y: rowOf[p] });
    for (const e of paths.events) {
      const t = R.startAt + e.k * R.sampleMs, w = where(e.racer, e.k);
      if (e.kind === 'boost') s.at(t, 'fx', null, { name: 'stars', x: w.x, y: w.y });
      if (e.kind === 'chaos') {
        s.at(t, 'prop', null, { id: 'course', state: 'chaos' });
        s.at(t, 'fx', null, { name: 'banner', x: 0.5, y: 0.08, text: 'KLERB CHAOS!' });
        s.at(t, 'fx', null, { name: 'flash', x: w.x, y: w.y });
        s.say(t + 100, HOUSE, rng.pick([`Klerb zapped ${nameOf(input, e.racer)}!`, 'CHAOS on the course!', 'Klerb is messing with the saucers!']), 1800);
        s.at(t + 1600, 'prop', null, { id: 'course', state: 'go' });
        if (e.lucky) s.at(t + 200, 'fx', null, { name: 'stars', x: where(e.lucky, e.k).x, y: rowOf[e.lucky] });
      }
    }
    let said = 0, cheers = 0;
    for (const lc of paths.leads) {
      const t = R.startAt + lc.k * R.sampleMs;
      if (cheers < 5) { s.at(t, 'anim', EVERYONE, { name: 'cheer' }); cheers++; }
      if (said < 3 && lc.k > 8) { s.say(t, HOUSE, clip(`${nameOf(input, lc.racer)} takes the lead!`, 60), 1400); said++; }
    }
    const won = outcome.finishMs[outcome.winner];
    s.at(R.startAt + won, 'prop', null, { id: 'course', state: 'finish' });
    s.at(R.startAt + won, 'fx', null, { name: 'banner', x: 0.5, y: 0.08, text: clip(`${nameOf(input, outcome.winner)} WINS!`, 60) });
    s.at(R.startAt + won, 'fx', null, { name: 'confetti', x: R.finishX, y: 0.1 });
    s.at(R.startAt + won + 100, 'anim', EVERYONE, { name: 'cheer' });
    // 3. landing: the podium rises, the saucers set everyone down, prizes, then the saucers zoom off
    const lastFinish = Math.max(...Object.values(outcome.finishMs));
    const LAND = R.startAt + lastFinish + R.landGapMs;
    const spots = landingSpots(outcome, gp);
    if (gp) s.at(LAND - 700, 'prop', null, { id: 'podium', state: 'rise' });
    outcome.order.forEach((p, i) => {
      const sp = spots[p], tl = LAND + Math.round((i * 600) / n);
      s.at(tl - 300, 'moveTo', p, { x: sp.x, lane: sp.lane, speed: 'run' });          // still hidden: under the saucer
      s.at(tl, 'prop', null, { id: ufo[p], state: 'land:' + sp.x });
      s.at(tl + 1100, 'show', p);
      if (sp.lift) s.at(tl + 1150, 'moveTo', p, { x: sp.x, lane: sp.lane, speed: 'walk', lift: sp.lift });
      s.at(tl + 1200, 'face', p, { dir: 'front' });
      s.at(tl + 1700, 'prop', null, { id: ufo[p], state: 'leave' });
    });
    const P = LAND + 600 + 1500;
    s.at(P, 'anim', outcome.winner, { name: 'victory' }).at(P, 'expr', outcome.winner, { name: 'excited', ms: 3500 });
    if (gp) {
      outcome.places.slice(1).forEach((pl) => s.at(P + 100, 'anim', pl.player, { name: 'cheer' }).at(P + 100, 'expr', pl.player, { name: 'happy', ms: 3000 }));
      for (const p of outcome.order.slice(outcome.places.length)) s.at(P + 100, 'expr', p, { name: 'sad', ms: 2500 });
      s.say(P + 200, HOUSE, clip(`Grand Prix champion: ${nameOf(input, outcome.winner)}!`, 60), 2500);
      s.coinRain(P + 300, outcome.pool, 0.5, 0.62);
    } else {
      s.at(P + 100, 'anim', outcome.loser, { name: 'sad' }).at(P + 100, 'expr', outcome.loser, { name: 'sad', ms: 2500 });
      if (input.stake > 0) s.coinRain(P + 300, input.stake * 2, spots[outcome.winner].x, 0.6);
    }
    const end = P + R.outroMs;
    if (gp) for (const pl of outcome.places) s.at(end - 1600, 'moveTo', pl.player, { x: spots[pl.player].x, lane: spots[pl.player].lane, speed: 'walk', lift: 0 });
    if (gp) s.at(end - 1200, 'prop', null, { id: 'podium', state: 'hidden' });
    return s.build(end);
  },

  settle(input, outcome, gameId) {
    if (outcome.mode !== 'gp') return settlePvp(gameId, input, outcome.winner, 'Gleep Race');
    // each podium payout comes out of the escrow (the fees) first, then the mint; the escrow ends at exactly 0
    let left = outcome.fees;
    return outcome.places.filter((pl) => pl.payout > 0).map((pl) => {
      const fromEscrow = Math.min(left, pl.payout); left -= fromEscrow;
      return intent(gameIdem(gameId, 'payout', pl.player), 'payout',
        [[escrowAcct(gameId), -fromEscrow], [SYS.mint, -(pl.payout - fromEscrow)], [userAcct(pl.player), pl.payout]], `Gleep Grand Prix: place ${pl.place}`, { gameId });
    });
  },

  summary(input, outcome) {
    if (outcome.mode !== 'gp') return pvpSummary(input, outcome.winner, outcome.loser, 'out-flew');
    const ord = ['1st', '2nd', '3rd'];
    const pod = outcome.places.map((pl) => `${ord[pl.place - 1]} ${at(input, pl.player)} +${fmt(pl.payout - (input.fee || 0))}`).join(' · ');
    return clip(`GLEEP GRAND PRIX (${input.racers.length} racers): ${pod}`, 300);
  },
});

/** Where everyone lands: the podium (1st centre, 2nd left, 3rd right, standing up `lift` pixels), the rest either side. */
function landingSpots(outcome, gp) {
  const out = {};
  if (!gp) { out[outcome.winner] = { x: 0.46, lane: 1, lift: 0 }; out[outcome.loser] = { x: 0.54, lane: 1, lift: 0 }; return out; }
  const pod = [0.5, 0.455, 0.545];
  outcome.places.forEach((pl, i) => { out[pl.player] = { x: pod[i], lane: 1, lift: RACE.podiumLift[i] }; });
  const rest = outcome.order.slice(outcome.places.length);
  const left = spread(Math.ceil(rest.length / 2), 0.1, 0.38), right = spread(Math.floor(rest.length / 2), 0.62, 0.9);
  rest.forEach((p, i) => { out[p] = { x: i % 2 ? right[i >> 1] : left[i >> 1], lane: i % 3 === 1 ? 2 : 0, lift: 0 }; });
  return out;
}

/**
 * The progress of every racer, one sample per RACE.sampleMs from "GLEEP!": 0 at the start, exactly 1 from its finishing
 * sample on, and below 0.98 before it (so nobody crosses the line early and the order is the outcome's order).
 * Drama on top of a gently easing base: a pinned random walk, boosts and wobbles (smooth bumps), a comeback for the
 * winner, an early lead for someone else, and one Klerb chaos zap of whoever leads at that moment.
 * @returns {{ path:Object<string, number[]>, events:{ k:number, kind:'boost'|'wobble'|'chaos', racer:string, lucky?:string }[], leads:{ k:number, racer:string }[] }}
 */
export function racePaths(racers, outcome, rng) {
  const R = RACE, fin = {}, bumps = {}, events = [];
  for (const p of racers) { fin[p] = Math.round(outcome.finishMs[p] / R.sampleMs); bumps[p] = []; }
  const len = Math.max(...Object.values(fin)) + 4;
  const bump = (p, c, w, a, kind) => { bumps[p].push({ c, w, a }); if (kind) events.push({ k: Math.round(c - w * 0.5), kind, racer: p }); };
  for (const p of racers) {
    const F = fin[p];
    for (let i = rng.int(1, 2); i > 0; i--) bump(p, F * rng.float(0.2, 0.8), F * rng.float(0.07, 0.13), rng.float(0.04, 0.09), 'boost');
    if (rng.chance(0.6)) bump(p, F * rng.float(0.25, 0.75), F * rng.float(0.06, 0.1), -rng.float(0.03, 0.07), 'wobble');
  }
  // suspense: the winner stumbles mid-race and comes back late; someone else grabs an early lead
  const w = outcome.order[0], Fw = fin[w];
  bump(w, Fw * 0.42, Fw * 0.1, -0.08, 'wobble');
  bump(w, Fw * 0.84, Fw * 0.09, 0.06, 'boost');
  if (outcome.order.length > 1) { const e = outcome.order[1 + rng.int(0, Math.min(2, outcome.order.length - 2))]; bump(e, fin[e] * 0.3, fin[e] * 0.12, 0.09, 'boost'); }
  // the walk, pinned at both ends (a Brownian bridge), per racer
  const walk = {};
  for (const p of racers) {
    const F = fin[p], wv = [0];
    for (let k = 1; k <= F; k++) wv.push(wv[k - 1] + rng.normal() * R.sigma);
    walk[p] = wv.map((v, k) => v - (k / F) * wv[F]);
  }
  const value = (p, k) => {
    const F = fin[p]; if (k >= F) return 1; if (k <= 0) return 0;
    const f = k / F; let v = f * (0.85 + 0.15 * f) + walk[p][k];
    for (const b of bumps[p]) v += b.a * Math.exp(-(((k - b.c) / b.w) ** 2));
    // a soft ceiling: above 0.9 the progress eases towards (never reaches) 0.98, so nobody sits pressed against the line
    return v <= 0.9 ? Math.max(0, v) : 0.9 + 0.08 * Math.tanh((v - 0.9) / 0.08);
  };
  // Klerb's chaos: whoever leads at that moment gets zapped back, a random other racer gets a lucky push
  const chaosK = Math.round(Math.min(...Object.values(fin)) * rng.float(0.55, 0.68));
  if (racers.length > 1 && (racers.length > 2 || rng.chance(0.5))) {
    const leader = racers.reduce((b, p) => (value(p, chaosK) > value(b, chaosK) ? p : b), racers[0]);
    const others = racers.filter((p) => p !== leader), lucky = rng.pick(others);
    bumps[leader].push({ c: chaosK + 3, w: fin[leader] * 0.09, a: -rng.float(0.1, 0.15) });
    bumps[lucky].push({ c: chaosK + 3, w: fin[lucky] * 0.08, a: rng.float(0.05, 0.09) });
    events.push({ k: chaosK, kind: 'chaos', racer: leader, lucky });
  }
  const path = {};
  for (const p of racers) path[p] = Array.from({ length: len }, (_, k) => round3(value(p, k)));
  // lead changes (who is furthest along) until the winner crosses the line
  const leads = []; let cur = null;
  for (let k = 4; k <= fin[outcome.order[0]]; k++) {
    const top = racers.reduce((b, p) => (path[p][k] > path[b][k] ? p : b), racers[0]);
    if (top !== cur) { if (cur !== null) leads.push({ k, racer: top }); cur = top; }
  }
  return { path, events: events.filter((e) => e.k > 0).sort((a, b) => a.k - b.k), leads };
}

/** Admin / help helper: a Grand Prix lobby input. */
export function gpInput(racers, fee = 0, names = {}) {
  return { mode: 'gp', racers: [...racers], fee, names };
}

export { rakeOf };
