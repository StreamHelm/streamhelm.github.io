// Catalog helpers: build the catalog from items.mjs, look items up, decide what a viewer may wear and what it costs.

import { ITEM_ROWS, itemFromRow } from './items.mjs';
import { VEHICLE_ROWS } from './vehicles.mjs';
import { DEFAULT_ECONOMY, priceForRarity } from '../economy.mjs';

export const CATALOG_VERSION = 1;

/** @typedef {import('./items.mjs')} _ */
/** @typedef {{ version:number, items:Object[] }} Catalog */

/**
 * The full catalog (CONTRACTS §3.3), prices from the economy config.
 * @returns {Catalog}
 */
export function buildCatalog(cfg = DEFAULT_ECONOMY) {
  const items = [];
  for (const rows of [ITEM_ROWS, VEHICLE_ROWS]) for (const [slot, list] of Object.entries(rows)) for (const row of list) items.push(itemFromRow(slot, row, cfg.prices));
  return { version: CATALOG_VERSION, items };
}

const itemsOf = (catalog) => (Array.isArray(catalog) ? catalog : catalog.items);
const INDEX = new WeakMap();

/**
 * id → item, cached per catalog object.
 * @param {Catalog|Object[]} catalog
 * @returns {Map<string, Object>}
 */
export function indexCatalog(catalog) {
  const key = Array.isArray(catalog) ? catalog : catalog.items;
  let m = INDEX.get(key);
  if (!m) { m = new Map(itemsOf(catalog).map((it) => [it.id, it])); INDEX.set(key, m); }
  return m;
}

/** One item by id, or null. */
export function itemById(catalog, id) {
  return (id && indexCatalog(catalog).get(id)) || null;
}

/**
 * Items grouped by slot, in catalog order.
 * @returns {Object<string, Object[]>}
 */
export function itemsBySlot(catalog) {
  const out = {};
  for (const it of itemsOf(catalog)) (out[it.slot] ||= []).push(it);
  return out;
}

const has = (owned, id) => (owned instanceof Set ? owned.has(id) : Array.isArray(owned) ? owned.includes(id) : false);

/**
 * May this viewer use the item?
 *  - reserved items only for the matching unique avatar (Sky's or PepeBot's), even in "unlock everything" playtests;
 *  - starter items always; items tagged 'kit:<unique>' for that unique avatar (Sky's rings, septum, jeans, boots);
 *  - Sky's unique avatar: everything that is not reserved for someone else (v1.11);
 *  - everything else when owned or the season unlocks everything.
 * @param {Object} item
 * @param {Set<string>|string[]} owned
 * @param {{ unlockAll?:boolean, unique?:string|null }} flags
 */
export function isUnlocked(item, owned, flags = {}) {
  if (!item) return false;
  if (item.rarity === 'reserved' || item.reservedFor) return !!flags.unique && flags.unique === item.reservedFor;
  if (item.rarity === 'starter') return true;
  if (flags.unique === 'sky') return true;                       // v1.11: Sky can wear everything, locked items included, for free
  if (flags.unique && item.tags && item.tags.includes('kit:' + flags.unique)) return true;   // part of a unique avatar's look
  return !!flags.unlockAll || has(owned, item.id);
}

/**
 * The unlock price: a per-item override (Admin → catalogPrices) wins, else the rarity price. null = not for sale.
 * @param {Object} item
 * @param {Object} [cfg]  economy config, optionally with `itemPrices: { [id]: number }`
 */
export function priceOf(item, cfg = DEFAULT_ECONOMY) {
  if (!item || item.rarity === 'reserved' || item.reservedFor) return null;
  const o = cfg.itemPrices && cfg.itemPrices[item.id];
  if (Number.isSafeInteger(o) && o >= 0) return o;
  return priceForRarity(item.rarity, cfg);
}

/**
 * Can this species use this item? ([] = every species.)
 * @param {Object} item
 * @param {string} species
 */
export function fitsSpecies(item, species) {
  return !item.species.length || item.species.includes(species);
}
