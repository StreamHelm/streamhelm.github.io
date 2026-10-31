// Seasonal cosmetics (v1.11 — the engine half; the items themselves are the art engineer's catalog work). A catalog item
// tagged `seasonal:<id>` is for sale only while that season's window is open (economy `seasonal`: [{ id, name, from:'MM-DD',
// to:'MM-DD' }], inclusive, UTC; a window may wrap the new year, e.g. 12-01 → 01-06). Owning it is forever: a bought
// seasonal item stays wearable after its window closes (it only leaves the shop). Sky edits the windows like any economy value.

import { DEFAULT_ECONOMY } from './economy.mjs';
import { isoDay } from './format.mjs';

const md = (now) => isoDay(now).slice(5, 10);   // 'MM-DD'

/** The seasons whose window contains `now`. */
export function openSeasons(now, cfg = DEFAULT_ECONOMY) {
  const d = md(now);
  return (cfg.seasonal || []).filter((w) => (w.from <= w.to ? d >= w.from && d <= w.to : d >= w.from || d <= w.to));
}

/** The season id an item belongs to, or null. */
export const seasonOfItem = (item) => ((item && item.tags) || []).map((t) => /^seasonal:([\w-]+)$/.exec(t)).filter(Boolean).map((m) => m[1])[0] || null;

/** Can this item be bought now? (non-seasonal items always; seasonal ones only inside their window) */
export function seasonalOnSale(item, now, cfg = DEFAULT_ECONOMY) {
  const s = seasonOfItem(item);
  return !s || openSeasons(now, cfg).some((w) => w.id === s);
}
