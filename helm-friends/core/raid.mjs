// Raids (v1.11, Sky): when a raid arrives every avatar on stage dances, and the raiders get a welcome stipend.
// Twitch's raid event names only the raiding channel and a viewer count, never the raiders themselves, so a "raider" is
// someone who shows up for the first time this stream (chat or the chatters list) within raid.windowMin minutes after the
// raid. The stipend is paid once per raid per viewer (key rs:<raidEventId>:<twitchId>), to at most viewers + extra people
// (hard max hardMax) per raid, so a small raid can't be milked. The raid leader keeps the separate event bonus (events.raidLeader).

import { DEFAULT_ECONOMY } from './economy.mjs';
import { transfer, userAcct, SYS } from './ledger.mjs';
import { scriptBuilder, EVERYONE, HOUSE, clip } from './script.mjs';

const cfgOf = (cfg) => (cfg && cfg.raid) || DEFAULT_ECONOMY.raid;
export const RAID_SHOW = Object.freeze({ durationMs: 11000, danceEveryMs: 2600 });

/** How many stipends one raid may pay. */
export const raidStipendCap = (viewers, cfg = DEFAULT_ECONOMY) => Math.min(cfgOf(cfg).hardMax, Math.max(0, Math.floor(viewers || 0)) + cfgOf(cfg).extra);

/**
 * Is this viewer a raider of `raid`? They show up inside the window and were not here this stream before the raid
 * (raid.before = everyone seen this stream when the raid arrived, snapshotted then); never the raid leader themself.
 * @param {{ id:string, at:number, fromId?:string|null, before:string[] }} raid
 * @param {string} twitchId
 * @param {number} now
 */
export function isRaider(raid, twitchId, now, cfg = DEFAULT_ECONOMY) {
  if (!raid || !twitchId || twitchId === raid.fromId) return false;
  if (now < raid.at || now - raid.at > cfgOf(cfg).windowMin * 60000) return false;
  return !(raid.before || []).includes(twitchId);
}

/** The welcome stipend (sys:mint → raider). */
export function raidStipendIntent(raidId, twitchId, cfg = DEFAULT_ECONOMY) {
  const amt = cfgOf(cfg).stipend;
  return amt > 0 ? transfer(`rs:${raidId}:${twitchId}`, 'raid_stipend', SYS.mint, userAcct(twitchId), amt, 'Raid welcome', { eventId: raidId }) : null;
}

/**
 * The raid party: a welcome banner, then everyone on stage dances (a fresh dance every 2.6 s so loops never stall),
 * PepeBot greets the raiders.
 * @param {{ id:string, now:number, from?:string|null, viewers?:number }} a
 */
export function raidScript({ id, now, from, viewers }) {
  const S = RAID_SHOW;
  const s = scriptBuilder({ id, kind: 'raid', startsAt: now, crowd: 'others-free' })
    .cast(HOUSE, 'host')
    .prop('banner', 'raidBanner', 0.5, 2, 'show', { y: 0.14, label: clip(from ? `RAID! Welcome, ${from}'s crew!` : 'RAID! Welcome, raiders!', 60) });
  s.at(0, 'fx', null, { name: 'banner', x: 0.5, y: 0.12, text: clip(from ? `${from} is raiding with ${viewers || 0}!` : 'RAID!', 60) });
  s.at(0, 'fx', null, { name: 'confetti', x: 0.5, y: 0.08 });
  s.at(200, 'expr', EVERYONE, { name: 'excited', ms: 8000 });
  for (let t = 300; t < S.durationMs - 1500; t += S.danceEveryMs) s.at(t, 'anim', EVERYONE, { name: 'dance' });
  s.at(300, 'anim', HOUSE, { name: 'dance', loop: true });
  s.say(800, HOUSE, clip(from ? `Welcome, ${from} raiders!` : 'Welcome, raiders!', 60), 2600);
  s.at(S.durationMs - 1200, 'prop', null, { id: 'banner', state: 'hide' });
  s.at(S.durationMs - 1000, 'anim', HOUSE, { name: 'idle', loop: true });
  return s.build(S.durationMs);
}
