// Daily login streak (v1.11, Sky): a check-in button in the web app / Twitch panel pays a small bonus once a day. Days in a
// row grow the bonus up to a cap; missing a day starts the streak over. One check-in per viewer per day is enforced by the
// ledger key ci:<season>:<day>:<twitchId>, so a double tap (two tabs, a retry) never pays twice.
//   bonus(day n of the streak) = base + step × (min(n, maxDays) − 1)    default 20, 30, … 80 from day 7 on
//   a perfect week = 20+30+40+50+60+70+80 = 350 Dollahs (≈ 2 active hours of watching) — a nudge, not a faucet.

import { DEFAULT_ECONOMY } from './economy.mjs';
import { fail } from './errors.mjs';
import { transfer, userAcct, SYS } from './ledger.mjs';
import { isoDay, dayNumber } from './format.mjs';

const cfgOf = (cfg) => (cfg && cfg.checkin) || DEFAULT_ECONOMY.checkin;

/** The check-in day for `now` ('YYYY-MM-DD' in the channel's time zone, cfg.checkin.tzOffsetMin minutes from UTC). */
export function dayOf(now, cfg = DEFAULT_ECONOMY) {
  return isoDay(now + cfgOf(cfg).tzOffsetMin * 60000);
}

/** Whole days from `a` to `b` (both 'YYYY-MM-DD'). */
export function daysBetween(a, b) {
  return dayNumber(b) - dayNumber(a);
}

/** The bonus for day `streak` of a streak (1-based). */
export function checkinBonus(streak, cfg = DEFAULT_ECONOMY) {
  const c = cfgOf(cfg);
  return c.base + c.step * (Math.min(Math.max(1, streak), c.maxDays) - 1);
}

/**
 * Where a viewer's streak stands today.
 * @param {{ day:string, streak:number }|null} last   their latest check-in
 * @param {string} today
 * @returns {{ done:boolean, streak:number, next:number, bonus:number, broken:boolean }}
 *   done = already checked in today; streak = the streak as it stands (today's if done, else what it was, 0 if broken);
 *   next = the streak a check-in now makes; bonus = what that check-in pays
 */
export function streakState(last, today, cfg = DEFAULT_ECONOMY) {
  if (!last) return { done: false, streak: 0, next: 1, bonus: checkinBonus(1, cfg), broken: false };
  const gap = daysBetween(last.day, today);
  if (gap <= 0) return { done: true, streak: last.streak, next: last.streak + 1, bonus: checkinBonus(last.streak + 1, cfg), broken: false };
  if (gap === 1) return { done: false, streak: last.streak, next: last.streak + 1, bonus: checkinBonus(last.streak + 1, cfg), broken: false };
  return { done: false, streak: 0, next: 1, bonus: checkinBonus(1, cfg), broken: true };
}

/**
 * Today's check-in: { ok, day, streak, amount, intent } or CLOSED (already done today) / FORBIDDEN (switched off).
 * @param {{ seasonId:string, twitchId:string, now:number, last:{ day:string, streak:number }|null }} a
 */
export function checkin({ seasonId, twitchId, now, last }, cfg = DEFAULT_ECONOMY) {
  if (!cfgOf(cfg).enabled) return fail('FORBIDDEN', { message: 'Daily check-ins are switched off.' });
  const day = dayOf(now, cfg), st = streakState(last, day, cfg);
  if (st.done) return fail('CLOSED', { message: 'You already checked in today - come back tomorrow!', streak: st.streak });
  const amount = st.bonus;
  return { ok: true, day, streak: st.next, amount, intent: transfer(`ci:${seasonId}:${day}:${twitchId}`, 'checkin', SYS.mint, userAcct(twitchId), amount, `Daily check-in (day ${st.next})`) };
}

/** A perfect week's total and the cap (for help and the admin page). */
export function checkinTheory(cfg = DEFAULT_ECONOMY) {
  const c = cfgOf(cfg);
  let week = 0; for (let d = 1; d <= 7; d++) week += checkinBonus(d, cfg);
  return { first: checkinBonus(1, cfg), max: checkinBonus(c.maxDays, cfg), maxDays: c.maxDays, week };
}
