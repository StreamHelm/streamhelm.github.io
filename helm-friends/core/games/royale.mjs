// Battle royale (DESIGN §4.6): free to join, everyone brawls, last one standing wins Dollahs from the mint and the
// runner-up gets 15 %. The knockout order is a uniform shuffle (fair); each knockout names a random living attacker.

import { DEFAULT_ECONOMY } from '../economy.mjs';
import { applyBp, isMoney } from '../money.mjs';
import { SYS, transfer, userAcct, gameIdem } from '../ledger.mjs';
import { fail } from '../errors.mjs';
import { scriptBuilder, HOUSE } from '../script.mjs';
import { isId, at, nameOf, round3 } from './common.mjs';
import { fitGaps, cumulative } from './timing.mjs';
import { fmt } from '../format.mjs';

export const ROYALE = Object.freeze({
  minMs: 30000, maxMs: 60000,   // show length grows with the player count
  introMs: 5000, outroMs: 7000,
  maxVisibleScuffles: 6,
});

const conf = (cfg) => (cfg && cfg.royale) || DEFAULT_ECONOMY.royale;

/**
 * The prize: round(U[1-jitter, 1+jitter] × (base + per × n)), capped. Jitter drawn in whole basis points.
 * @param {number} n  players
 * @param {import('../rng.mjs').Rng} rng
 */
export function royalePrize(n, rng, cfg) {
  const r = conf(cfg), j = Math.round(r.jitter * 10000);
  const bp = rng.int(10000 - j, 10000 + j);
  const base = r.prizeBase + r.prizePer * n;
  return Math.min(r.prizeCap, Math.round((base * bp) / 10000));
}

/** Show length for n players: 30 s at the minimum crowd up to 60 s at the maximum. */
export function royaleDuration(n, cfg) {
  const r = conf(cfg), span = Math.max(1, r.maxPlayers - r.minPlayers);
  const f = Math.max(0, Math.min(1, (n - r.minPlayers) / span));
  return ROYALE.minMs + Math.round((ROYALE.maxMs - ROYALE.minMs) * f);
}

/** @type {import('./index.mjs').GameEngine} */
export const GAME = Object.freeze({
  id: 'royale',
  defaults: { minBet: 0, maxBet: 0, lobbyMs: DEFAULT_ECONOMY.royale.lobbySec * 1000, minPlayers: DEFAULT_ECONOMY.royale.minPlayers, maxPlayers: DEFAULT_ECONOMY.royale.maxPlayers },

  validate(input, cfg) {
    const r = conf(cfg);
    if (!input || !Array.isArray(input.players) || !input.players.every(isId)) return fail('BAD_INPUT');
    if (new Set(input.players).size !== input.players.length) return fail('BAD_INPUT');
    if (input.players.length < r.minPlayers) return fail('BAD_INPUT', { min: r.minPlayers });
    if (input.players.length > r.maxPlayers) return fail('FULL', { max: r.maxPlayers });
    if (input.prize != null && !(isMoney(input.prize) && input.prize > 0)) return fail('BAD_AMOUNT', { min: 1, max: r.prizeCap });
    return { ok: true };
  },

  stakes: () => [],   // free to join

  resolve(input, rng, cfg) {
    const r = conf(cfg), n = input.players.length;
    const prize = input.prize != null ? input.prize : royalePrize(n, rng, cfg);
    const order = rng.shuffle(input.players);
    const durationMs = royaleDuration(n, cfg);
    const fightMs = durationMs - ROYALE.introMs - ROYALE.outroMs;
    const gaps = fitGaps(order.slice(1).map(() => rng.float(0.6, 1.4)), fightMs, 300, fightMs);
    const times = cumulative(gaps).map((t) => ROYALE.introMs + t);
    const beats = [];
    for (let i = 0; i < n - 1; i++) {
      const ko = order[i], living = order.slice(i + 1);
      beats.push({ t: times[i], ko, by: rng.pick(living) });
    }
    return {
      order, beats, prize, durationMs,
      runnerUp: order[n - 2], runnerUpPrize: applyBp(prize, Math.round(r.runnerUpPct * 100)),
    };
  },

  choreograph(input, outcome, rng, ctx) {
    const players = input.players, n = players.length, winner = outcome.order[n - 1];
    const s = scriptBuilder({ id: ctx.gameId || 'g_preview', kind: 'royale', startsAt: ctx.now, crowd: 'others-watch' })
      .cast(HOUSE, 'announcer').prop('ring', 'ring', 0.5, 1, 'idle');
    const pos = {};
    rng.shuffle(players).forEach((p, i) => {
      s.cast(p, 'fighter');
      pos[p] = { x: round3(0.2 + 0.6 * ((i * 0.618034) % 1)), lane: i % 3 };
      const t = Math.round((i / n) * 2500);
      s.at(t, 'moveTo', p, { x: pos[p].x, lane: pos[p].lane, speed: 'run' });
      s.at(t + 900, 'anim', p, { name: 'jump' });
      s.at(3500, 'equip', p, { layer: 'gloves' });
      s.at(3500, 'expr', p, { name: 'angry', ms: 3000 });
    });
    s.say(500, HOUSE, `${n} fighters. One survivor.`, 2000);
    s.say(4000, HOUSE, 'BRAWL!', 900);
    s.at(4200, 'fx', null, { name: 'dust', x: 0.5, y: 0.8 });
    let prev = ROYALE.introMs;
    const alive = new Set(players);
    for (const bt of outcome.beats) {
      // a few living fighters throw punches between knockouts (at most 6 visible scuffles)
      const brawlers = rng.shuffle([...alive]).slice(0, Math.min(ROYALE.maxVisibleScuffles, alive.size));
      brawlers.forEach((p, i) => {
        const t = prev + Math.round(((i + 1) * (bt.t - prev)) / (brawlers.length + 1));
        if (t < bt.t - 400) s.at(t, 'anim', p, { name: rng.pick(['punch', 'kick', 'punch']) });
      });
      s.at(bt.t - 700, 'moveTo', bt.by, { x: round3(Math.max(0, Math.min(1, pos[bt.ko].x - 0.03))), lane: pos[bt.ko].lane, speed: 'run' });
      s.at(bt.t - 250, 'anim', bt.by, { name: rng.pick(['uppercut', 'kick']) });
      s.at(bt.t, 'anim', bt.ko, { name: 'knockout' }).at(bt.t, 'expr', bt.ko, { name: 'ko', ms: 1500 });
      s.at(bt.t, 'fx', null, { name: 'stars', x: pos[bt.ko].x, y: 0.6 });
      s.at(bt.t + 300, 'moveTo', bt.ko, { x: pos[bt.ko].x < 0.5 ? 0 : 1, lane: pos[bt.ko].lane, speed: 'flee', anim: 'hurt' });
      s.at(bt.t + 1200, 'hide', bt.ko);
      pos[bt.by] = { ...pos[bt.ko] };
      alive.delete(bt.ko);
      prev = bt.t;
    }
    const end = outcome.durationMs - ROYALE.outroMs;
    s.at(end + 300, 'unequip', winner, { layer: 'gloves' });
    s.at(end + 300, 'moveTo', winner, { x: 0.5, lane: 1, speed: 'walk' });
    s.at(end + 1500, 'anim', winner, { name: 'victory' }).at(end + 1500, 'expr', winner, { name: 'excited', ms: 3000 });
    s.at(end + 1500, 'fx', null, { name: 'confetti', x: 0.5, y: 0.1 });
    s.say(end + 1600, HOUSE, `${nameOf(input, winner)} is the last one standing!`, 2500);
    s.coinRain(end + 1700, outcome.prize, 0.5, 0.45);
    for (const p of players) if (p !== winner) s.at(end + 4000, 'show', p);
    return s.build(outcome.durationMs);
  },

  settle(input, outcome, gameId) {
    const winner = outcome.order[outcome.order.length - 1], out = [];
    out.push(transfer(gameIdem(gameId, 'payout', winner), 'payout', SYS.mint, userAcct(winner), outcome.prize, 'Battle royale winner', { gameId }));
    if (outcome.runnerUpPrize > 0) {
      out.push(transfer(gameIdem(gameId, 'payout', outcome.runnerUp), 'payout', SYS.mint, userAcct(outcome.runnerUp), outcome.runnerUpPrize, 'Battle royale runner-up', { gameId }));
    }
    return out;
  },

  summary(input, outcome) {
    const winner = outcome.order[outcome.order.length - 1];
    return `${at(input, winner)} is the last one standing out of ${input.players.length}! +${fmt(outcome.prize)} ` +
      `(runner-up ${at(input, outcome.runnerUp)} +${fmt(outcome.runnerUpPrize)})`;
  },
});
