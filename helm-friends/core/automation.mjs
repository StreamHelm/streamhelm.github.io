// Event automation (v1.11, Sky): big events can start on their own. Per event, on the admin page:
//   mode 'off'     - never automatic, and chat can't open it either (Sky's "Start now" still works)
//   mode 'manual'  - only when someone opens it (chat command, a reward, "Start now")
//   mode 'auto'    - manual, PLUS a timer (every N minutes while live) and/or a chance (p % once per time window,
//                    e.g. 30 % once per hour, at a random minute of that hour) — both may be on ("combinations")
// Global rules: a minimum gap between any two big events, only while live (switchable), and the stage gate (a running
// show, an open lobby or another big event → wait and retry until the slot's window ends). Every start is logged.
// Deterministic: a chance window's roll and minute come from a seeded rng (the cloud's salt + event + window start), so a
// restart or a second pump makes the same decision, and the tests drive it with a fake clock.

import { createRng } from './rng.mjs';

export const AUTO_EVENTS = Object.freeze(['heist', 'royale', 'grandprix', 'blessing']);
export const AUTO_MODES = Object.freeze(['off', 'manual', 'auto']);
const ev = (mode, timerMin, pct, windowMin, chanceOn) => ({ mode, timer: { on: false, everyMin: timerMin }, chance: { on: !!chanceOn, pct, windowMin } });
export const DEFAULT_AUTOMATION = Object.freeze({
  minGapMin: 20, onlyLive: true,
  events: {
    heist: ev('manual', 60, 30, 60), royale: ev('manual', 60, 30, 60), grandprix: ev('manual', 60, 30, 60),
    blessing: ev('auto', 90, 20, 60, true),   // Glorp's Blessing: rare and random by default (≈ once every 5 hours live)
  },
});

const clampInt = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : d);

/** A clean automation config from whatever was stored or sent (unknown keys dropped, numbers clamped). */
export function normalizeAutomation(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}, D = DEFAULT_AUTOMATION;
  const out = { minGapMin: clampInt(r.minGapMin, 0, 240, D.minGapMin), onlyLive: r.onlyLive == null ? D.onlyLive : !!r.onlyLive, events: {} };
  for (const k of AUTO_EVENTS) {
    const e = (r.events && r.events[k]) || {}, d = D.events[k];
    out.events[k] = {
      mode: AUTO_MODES.includes(e.mode) ? e.mode : d.mode,
      timer: { on: e.timer && e.timer.on != null ? !!e.timer.on : d.timer.on, everyMin: clampInt(e.timer && e.timer.everyMin, 5, 1440, d.timer.everyMin) },
      chance: { on: e.chance && e.chance.on != null ? !!e.chance.on : d.chance.on, pct: clampInt(e.chance && e.chance.pct, 0, 100, d.chance.pct),
        windowMin: clampInt(e.chance && e.chance.windowMin, 5, 1440, d.chance.windowMin) },
    };
  }
  return out;
}

/** May chat / a reward open this event? ('off' = only Sky's Start now.) */
export const chatMayOpen = (auto, kind) => !AUTO_EVENTS.includes(kind) || normalizeAutomation(auto).events[kind].mode !== 'off';

/**
 * A chance window's decision: does it fire, and when (a seeded minute in the first 90 % of the window, so a busy stage
 * still leaves time to retry before the window ends).
 * @returns {{ fires:boolean, at:number, until:number, key:string }}
 */
export function chanceSlot(event, windowStart, pct, windowMs, salt = '') {
  const rng = createRng(`auto:${salt}:${event}:${windowStart}`);
  const fires = rng.next() < pct / 100;
  return { fires, at: windowStart + Math.floor(rng.next() * windowMs * 0.9), until: windowStart + windowMs, key: `chance:${event}:${windowStart}` };
}

/** @typedef {{ last:Object<string,number>, lastAny:number, done:Object<string,number> }} AutoState */
export const emptyAutoState = () => ({ last: {}, lastAny: 0, done: {} });

/**
 * The automatic starts due now, best first. The caller tries them in order against the stage gate and records the one it
 * starts (record()); anything it can't start stays due and is retried on the next pump (a chance slot until its window
 * ends; a timer until it fires).
 * @param {Object} auto   normalizeAutomation() output
 * @param {AutoState} state
 * @param {number} now
 * @param {{ live:boolean, liveSince?:number, salt?:string }} ctx   liveSince: the timers count from the stream start
 * @returns {{ event:string, reason:'timer'|'chance', key:string }[]}
 */
export function dueEvents(auto, state, now, ctx) {
  const a = normalizeAutomation(auto), st = { ...emptyAutoState(), ...(state || {}) }, out = [];
  if (a.onlyLive && !ctx.live) return out;
  if (st.lastAny && now - st.lastAny < a.minGapMin * 60000) return out;
  for (const k of AUTO_EVENTS) {
    const e = a.events[k];
    if (e.mode !== 'auto') continue;
    if (e.chance.on && e.chance.pct > 0) {
      const W = e.chance.windowMin * 60000, ws = Math.floor(now / W) * W, slot = chanceSlot(k, ws, e.chance.pct, W, ctx.salt || '');
      if (slot.fires && now >= slot.at && now < slot.until && !st.done[slot.key]) out.push({ event: k, reason: 'chance', key: slot.key });
    }
    if (e.timer.on) {
      const from = Math.max(st.last[k] || 0, ctx.liveSince || 0) || now;
      if (now - from >= e.timer.everyMin * 60000) out.push({ event: k, reason: 'timer', key: `timer:${k}:${now}` });
    }
  }
  return out;
}

/**
 * The state after a big event started (automatic OR manual: a manual start also resets that event's timer and the gap).
 * Old `done` keys (> 2 days) are dropped.
 * @param {AutoState} state @param {string} event @param {number} now @param {string} [key]
 */
export function recordStart(state, event, now, key) {
  const st = { ...emptyAutoState(), ...(state || {}) };
  const done = Object.fromEntries(Object.entries(st.done).filter(([, t]) => now - t < 2 * 86400000));
  if (key) done[key] = now;
  return { last: { ...st.last, [event]: now }, lastAny: now, done };
}

/** The expected automatic starts per live hour of an event (for the admin page). */
export function autoRate(e) {
  if (!e || e.mode !== 'auto') return 0;
  return (e.chance.on ? (e.chance.pct / 100) * (60 / e.chance.windowMin) : 0) + (e.timer.on ? 60 / e.timer.everyMin : 0);
}
