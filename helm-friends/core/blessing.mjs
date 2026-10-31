// Glorp's Blessing (v1.11, Sky): a rare random event. Glorp descends over the stage, coins rain, and every viewer who is
// watching right now gets a few Dollahs. Started by the event automation (a chance per hour, see automation.mjs) or Sky's
// "Start now". It is a big event: it holds the stage for its ~12 s show (no gambling cooldown is charged).
//   each present viewer: int U[perViewerMin, perViewerMax] (default 10–30, ≈ 10 minutes of watching)
//   the total is capped at totalCap (default 3,000): with many viewers everyone's share is scaled down evenly (floored)
// Ledger: one 'blessing' line per viewer, key gb:<blessingId>:<twitchId> (sys:mint → viewer), so a retry pays nobody twice.

import { DEFAULT_ECONOMY } from './economy.mjs';
import { transfer, userAcct, SYS } from './ledger.mjs';
import { mulDiv } from './money.mjs';
import { scriptBuilder, EVERYONE, HOUSE } from './script.mjs';
import { fmt } from './format.mjs';

const cfgOf = (cfg) => (cfg && cfg.blessing) || DEFAULT_ECONOMY.blessing;
export const BLESSING_SHOW = Object.freeze({ descendMs: 2500, blessAt: 3000, ascendAt: 9000, durationMs: 12000 });

/**
 * Who gets what. Viewers are sorted by id first, so the same seed + the same people → the same amounts.
 * @param {string[]} viewers   twitchIds present (bots, banned and Sky already left out by the caller)
 * @param {import('./rng.mjs').Rng} rng
 * @returns {{ twitchId:string, amount:number }[]}
 */
export function blessingPayouts(viewers, rng, cfg = DEFAULT_ECONOMY) {
  const c = cfgOf(cfg), ids = [...new Set(viewers)].sort();
  const raw = ids.map((twitchId) => ({ twitchId, amount: rng.int(c.perViewerMin, c.perViewerMax) }));
  const total = raw.reduce((s, x) => s + x.amount, 0);
  if (total <= c.totalCap) return raw;
  // floor(amount × cap / total) each: the sum of floors never exceeds the cap (a crowd bigger than the cap gets nothing extra)
  return raw.map((x) => ({ twitchId: x.twitchId, amount: mulDiv(x.amount, c.totalCap, total) })).filter((x) => x.amount > 0);
}

/** The ledger lines of a blessing. */
export function blessingIntents(blessingId, payouts) {
  return payouts.filter((p) => p.amount > 0).map((p) => transfer(`gb:${blessingId}:${p.twitchId}`, 'blessing', SYS.mint, userAcct(p.twitchId), p.amount, "Glorp's Blessing", { eventId: blessingId }));
}

/** The expected total for n viewers (for help and the admin page). */
export function blessingTheory(n, cfg = DEFAULT_ECONOMY) {
  const c = cfgOf(cfg), mean = (c.perViewerMin + c.perViewerMax) / 2;
  return { perViewer: mean, total: Math.min(c.totalCap, mean * n), cap: c.totalCap };
}

/**
 * The show: Glorp floats down from the sky (prop glorpDescend), raises his joint, the coins rain over everyone, the crowd
 * cheers, he floats away. Every on-stage actor reacts (EVERYONE), so nobody needs to be in the cast.
 * @param {{ id:string, now:number, payouts:{ amount:number }[] }} a
 * @param {import('./rng.mjs').Rng} rng
 */
export function blessingScript({ id, now, payouts }, rng) {
  const S = BLESSING_SHOW, total = payouts.reduce((s, p) => s + p.amount, 0), n = payouts.length;
  const s = scriptBuilder({ id, kind: 'blessing', startsAt: now, crowd: 'others-free' })
    .cast(HOUSE, 'announcer')
    .prop('glorp', 'glorpDescend', 0.5, 2, 'hidden', { y: 0.18 });
  s.at(0, 'prop', null, { id: 'glorp', state: 'descend' });
  s.at(300, 'expr', EVERYONE, { name: 'startled', ms: 1500 });
  s.at(300, 'anim', EVERYONE, { name: 'startled' });
  s.say(600, HOUSE, rng.pick(['Is that... GLORP?!', 'The sky is glowing green!', 'Everyone look up!']), 2000);
  s.at(S.blessAt, 'prop', null, { id: 'glorp', state: 'bless' });
  s.at(S.blessAt, 'fx', null, { name: 'banner', x: 0.5, y: 0.12, text: n ? `GLORP'S BLESSING! ${fmt(total)} Pepe's Silvia Dollahs for ${n}` : "GLORP'S BLESSING!" });
  s.at(S.blessAt, 'fx', null, { name: 'stars', x: 0.5, y: 0.25 });
  if (total > 0) {
    s.coinRain(S.blessAt + 300, total, 0.3, 0.1);
    s.coinRain(S.blessAt + 900, total, 0.7, 0.1);
  }
  s.at(S.blessAt + 400, 'expr', EVERYONE, { name: 'excited', ms: 4000 });
  s.at(S.blessAt + 400, 'anim', EVERYONE, { name: 'cheer' });
  s.at(S.blessAt + 3200, 'anim', EVERYONE, { name: 'dance' });
  s.at(S.blessAt + 600, 'anim', HOUSE, { name: 'cheer' });
  s.at(S.ascendAt, 'prop', null, { id: 'glorp', state: 'ascend' });
  return s.build(S.durationMs);
}

/** The one chat line. */
export function blessingLine(payouts) {
  const total = payouts.reduce((s, p) => s + p.amount, 0);
  return payouts.length ? `GLORP'S BLESSING! Glorp rained ${fmt(total)} Pepe's Silvia Dollahs on ${payouts.length} viewer${payouts.length === 1 ? '' : 's'}. Glorp provides.`
    : "GLORP'S BLESSING! ...but nobody was here to catch the coins.";
}
