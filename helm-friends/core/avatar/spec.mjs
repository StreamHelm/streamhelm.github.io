// Character specs (CONTRACTS §3.2): what a viewer's Helm Friend looks like. normalizeSpec() turns anything a client
// sends into a valid spec for that viewer and lists every change it made; the server runs the same function, so the
// web editor can show exactly what the server will do.

import { check, CHARACTER_SPEC } from '../schema.mjs';
import { itemById, isUnlocked, fitsSpecies, itemsBySlot } from './catalog.mjs';
import { VEHICLE_KINDS, VEHICLE_PARTS, VEHICLE_OPTIONAL, VEHICLE_DEFAULTS, VEHICLE_COLORS, defaultVehicles, skyVehicles, pepebotVehicles, vehicleItems } from './vehicles.mjs';

export const SPECIES = Object.freeze(['human', 'dragon', 'ape', 'cat', 'dog', 'frog', 'capybara', 'panda', 'alien', 'rat', 'axolotl', 'beardie', 'bat', 'orc', 'minotaur', 'clown']);
export const RESERVED_SPECIES = Object.freeze(['mecha']);
export const MODELS = Object.freeze([1, 2]);
export const BODIES = Object.freeze(['slim', 'average', 'broad']);
export const HEIGHTS = Object.freeze(['short', 'medium', 'tall']);
export const WEAR_SLOTS = Object.freeze(['hat', 'eyewear', 'ear', 'nose', 'shirt', 'pants', 'shoes']);
/** Species that pick a breed (and ears) instead of a skin colour. */
export const BREED_SPECIES = Object.freeze(['cat', 'dog']);
/** v1.16: species with coats (spec.breed). Cats and dogs: breeds; the rest: `breed.<sp>.natural` + patterns / colour morphs. */
export const COAT_SPECIES = Object.freeze(['cat', 'dog', 'dragon', 'ape', 'frog', 'capybara', 'panda', 'alien', 'rat', 'axolotl', 'beardie', 'bat', 'orc', 'minotaur']);
/** Species with an ears option (cat/dog ears, alien antennae, axolotl gills; v1.16: human face shapes, rat/panda ears, extras). v1.10 */
export const EAR_SPECIES = Object.freeze(['cat', 'dog', 'alien', 'axolotl', 'beardie', 'bat', 'orc', 'minotaur', 'clown', 'human', 'rat', 'panda', 'capybara', 'frog', 'ape']);
export const WING_SPECIES = Object.freeze(['dragon', 'bat']);
/** The ear species before v1.16 (randomStarterSpec keeps its old random sequence). */
const PRE_V116_EARS = ['cat', 'dog', 'alien', 'axolotl', 'beardie', 'bat', 'orc', 'minotaur', 'clown'];
export const MAX_SPEC_BYTES = 4096;

/** Shown as quick picks next to the eye colour wheel (any HSV is allowed). */
export const EYE_PRESETS = Object.freeze([
  { name: 'Brown', hsv: { h: 28, s: 70, v: 45 } }, { name: 'Blue', hsv: { h: 210, s: 70, v: 85 } },
  { name: 'Green', hsv: { h: 120, s: 60, v: 65 } }, { name: 'Hazel', hsv: { h: 45, s: 60, v: 60 } },
  { name: 'Grey', hsv: { h: 210, s: 10, v: 65 } }, { name: 'Amber', hsv: { h: 38, s: 90, v: 90 } },
  { name: 'Violet', hsv: { h: 275, s: 60, v: 80 } }, { name: 'Glorp green', hsv: { h: 110, s: 95, v: 90 } },
]);

/** Starting body colour per species (the skin slider starts here; cats and dogs use breeds). */
export const SPECIES_SKIN = Object.freeze({
  human: { h: 28, s: 35, v: 88 }, dragon: { h: 140, s: 55, v: 60 }, ape: { h: 25, s: 45, v: 35 }, cat: { h: 30, s: 50, v: 80 },
  dog: { h: 30, s: 50, v: 70 }, frog: { h: 105, s: 65, v: 70 }, capybara: { h: 25, s: 55, v: 55 }, panda: { h: 0, s: 0, v: 95 },
  alien: { h: 150, s: 45, v: 80 }, rat: { h: 25, s: 18, v: 62 }, axolotl: { h: 335, s: 32, v: 98 },
  beardie: { h: 36, s: 55, v: 80 }, bat: { h: 265, s: 22, v: 38 }, orc: { h: 95, s: 42, v: 58 }, minotaur: { h: 22, s: 55, v: 45 }, clown: { h: 28, s: 30, v: 92 },
  mecha: { h: 40, s: 85, v: 95 },
});

/** Wear given to a slot that is missing or invalid (null = deliberately empty is always kept). */
export const WEAR_DEFAULTS = Object.freeze({ hat: null, eyewear: null, ear: null, nose: null, shirt: 'shirt.tee', pants: 'pants.jeans', shoes: 'shoes.sneakers' });
const DEFAULT_COLORS = [{ h: 220, s: 60, v: 70 }, { h: 0, s: 0, v: 95 }, { h: 0, s: 0, v: 20 }];
const DEFAULT_BREED = Object.fromEntries(COAT_SPECIES.map((sp) => [sp, `breed.${sp}.natural`]));
DEFAULT_BREED.cat = 'breed.cat.tabby'; DEFAULT_BREED.dog = 'breed.dog.lab';
const DEFAULT_EARS = { cat: 'ears.cat.pointy', dog: 'ears.dog.floppy', alien: 'ears.alien.twin', axolotl: 'ears.axolotl.frills',
  beardie: 'ears.beardie.frill', bat: 'ears.bat.tall', orc: 'ears.orc.tusks', minotaur: 'ears.minotaur.curved', clown: 'ears.clown.classic',
  human: 'ears.human.oval', rat: 'ears.rat.round', panda: 'ears.panda.round', capybara: 'ears.capybara.plain', frog: 'ears.frog.plain', ape: 'ears.ape.plain' };
/** Species that start bald (their look is the head itself). Any hair can still be picked. */
const BALD_SPECIES = ['alien', 'rat', 'axolotl', 'beardie', 'bat', 'minotaur'];
/** Default colours of a recolourable pet (cosmic kitten: fur + antenna glow). */
const PET_COLORS = [{ h: 195, s: 45, v: 75 }, { h: 110, s: 90, v: 95 }];
const HAIR_FX = { prism: 'hairfx.prism', neon: 'hairfx.neon', stardust: 'hairfx.stardust' };

/**
 * A point on the skin-tone slider (0 = lightest … 100 = deepest). A gentle HSV path, not a wheel.
 * @param {number} t  0..100
 */
export function skinTone(t) {
  const f = Math.max(0, Math.min(100, t)) / 100;
  const lerp = (a, b) => Math.round(a + (b - a) * f);
  return { h: lerp(32, 18), s: lerp(18, 62), v: lerp(98, 26) };
}

/** Clamps anything to a valid HSV (whole numbers, hue wraps). */
export function clampHsv(c, fallback = { h: 0, s: 0, v: 50 }) {
  if (!c || typeof c !== 'object') return { ...fallback };
  const n = (x, d) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : d);
  const h = ((n(c.h, fallback.h) % 360) + 360) % 360;
  return { h, s: Math.max(0, Math.min(100, n(c.s, fallback.s))), v: Math.max(0, Math.min(100, n(c.v, fallback.v))) };
}

const sameHsv = (a, b) => !!a && !!b && a.h === b.h && a.s === b.s && a.v === b.v;

/**
 * A plain starter character for a species.
 * @param {string} [species]
 */
export function defaultSpec(species = 'human') {
  return {
    v: 1, species, model: 1, body: 'average', height: 'medium',
    skin: { ...(SPECIES_SKIN[species] || SPECIES_SKIN.human) },
    breed: DEFAULT_BREED[species] || null,
    ears: DEFAULT_EARS[species] || null,
    wings: WING_SPECIES.includes(species) ? { style: 'wings.bat', color: { h: 150, s: 50, v: 45 } } : null,
    eyes: { shape: 'eyes.round', color: { ...EYE_PRESETS[0].hsv } },
    brows: 'brows.1',
    hair: { style: BALD_SPECIES.includes(species) ? 'hair.bald' : species === 'clown' ? 'hair.clown_tufts' : 'hair.short', color: species === 'clown' ? { h: 15, s: 85, v: 85 } : { h: 25, s: 60, v: 30 }, fx: null },
    facialHair: { style: null, color: { h: 25, s: 60, v: 30 } },
    wear: Object.fromEntries(WEAR_SLOTS.map((s) => [s, WEAR_DEFAULTS[s] ? { item: WEAR_DEFAULTS[s], colors: DEFAULT_COLORS.slice(0, 2) } : null])),
    vehicles: defaultVehicles(),
    pet: null,
    unique: null,
  };
}

/**
 * Structure check (types, enums, sizes) — no ownership. Used on raw input before normalizeSpec.
 * @returns {{ ok:true } | { ok:false, code:'BAD_INPUT', path:string, msg:string }}
 */
export function validateSpec(spec) {
  let bytes;
  try { bytes = JSON.stringify(spec).length; } catch { return { ok: false, code: 'BAD_INPUT', path: '$', msg: 'not JSON' }; }
  if (bytes > MAX_SPEC_BYTES) return { ok: false, code: 'BAD_INPUT', path: '$', msg: `bigger than ${MAX_SPEC_BYTES} bytes` };
  return check(spec, CHARACTER_SPEC);
}

/**
 * @typedef {{ path:string, from:unknown, to:unknown, reason:'UNKNOWN'|'NOT_OWNED'|'RESERVED'|'SPECIES'|'CLAMP'|'LOCKED_COLORS' }} SpecChange
 */

/**
 * Makes any input a valid spec for this viewer. Never throws; every substitution is listed in `changes`.
 *  - unknown ids → the slot's default (UNKNOWN)
 *  - items the viewer can't use → default (NOT_OWNED, or RESERVED for Sky/PepeBot items)
 *  - species-only parts on another species → removed or defaulted (SPECIES)
 *  - colours clamped to the item's channels; locked-colour items drop colours (LOCKED_COLORS)
 *  - `unique` is always the server's flag, whatever the client sent.
 * The server REJECTS a save whose changes include NOT_OWNED or RESERVED (see saveRejection); a new season's
 * repair-on-load just applies the result.
 * @param {Object} input        what the client sent (any shape)
 * @param {Object} catalog
 * @param {Set<string>|string[]} owned
 * @param {{ unlockAll?:boolean, unique?:string|null }} flags
 * @returns {{ spec:Object, changes:SpecChange[] }}
 */
export function normalizeSpec(input, catalog, owned, flags = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const changes = [];
  const note = (path, from, to, reason) => { changes.push({ path, from: from === undefined ? null : from, to, reason }); return to; };
  const usable = (it) => isUnlocked(it, owned, flags);
  const deny = (it) => (it && (it.rarity === 'reserved' || it.reservedFor) ? 'RESERVED' : 'NOT_OWNED');

  // species first: every other part depends on it
  let species = src.species;
  const spItem = itemById(catalog, 'species.' + species);
  if (!spItem) species = note('species', src.species, 'human', 'UNKNOWN');
  else if (!usable(spItem)) species = note('species', src.species, 'human', deny(spItem));
  const base = defaultSpec(species);

  const pick = (path, val, list, fallback) => (list.includes(val) ? val : note(path, val, fallback, val == null ? 'UNKNOWN' : 'CLAMP'));
  const hsv = (path, val, fallback) => {
    const c = clampHsv(val, fallback);
    if (!sameHsv(c, val)) note(path, val ?? null, c, 'CLAMP');
    return c;
  };
  /** A catalog id for `slot`, usable by this viewer and species; else `fallback`. */
  const part = (path, id, slot, fallback) => {
    if (id == null) return fallback == null ? null : note(path, id, fallback, 'UNKNOWN');
    const it = itemById(catalog, id);
    if (!it || it.slot !== slot) return note(path, id, fallback, 'UNKNOWN');
    if (!fitsSpecies(it, species)) return note(path, id, fallback, 'SPECIES');
    if (!usable(it)) return note(path, id, fallback, deny(it));
    return id;
  };

  const out = {
    v: 1, species,
    model: MODELS.includes(src.model) ? src.model : note('model', src.model, 1, 'CLAMP'),
    body: pick('body', src.body, BODIES, 'average'),
    height: pick('height', src.height, HEIGHTS, 'medium'),
  };
  out.skin = hsv('skin', src.skin, base.skin);

  if (COAT_SPECIES.includes(species)) out.breed = part('breed', src.breed, 'breed', base.breed);
  else out.breed = src.breed == null ? null : note('breed', src.breed, null, 'SPECIES');
  if (EAR_SPECIES.includes(species)) out.ears = part('ears', src.ears, 'ears', base.ears);
  else out.ears = src.ears == null ? null : note('ears', src.ears, null, 'SPECIES');
  if (WING_SPECIES.includes(species)) {
    const w = src.wings && typeof src.wings === 'object' ? src.wings : {};
    out.wings = { style: part('wings.style', w.style ?? base.wings.style, 'wings', base.wings.style), color: hsv('wings.color', w.color, base.wings.color) };
  } else out.wings = src.wings == null ? null : note('wings', src.wings, null, 'SPECIES');

  const eyes = src.eyes && typeof src.eyes === 'object' ? src.eyes : {};
  out.eyes = { shape: part('eyes.shape', eyes.shape ?? null, 'eyes', base.eyes.shape), color: hsv('eyes.color', eyes.color, base.eyes.color) };
  out.brows = part('brows', src.brows ?? null, 'brows', base.brows);

  const hair = src.hair && typeof src.hair === 'object' ? src.hair : {};
  let fx = hair.fx ?? null;
  if (fx != null) {
    const it = itemById(catalog, HAIR_FX[fx]);
    if (!it) fx = note('hair.fx', hair.fx, null, 'UNKNOWN');
    else if (!usable(it)) fx = note('hair.fx', hair.fx, null, deny(it));
  }
  out.hair = { style: part('hair.style', hair.style ?? null, 'hair', base.hair.style), color: hsv('hair.color', hair.color, base.hair.color), fx };

  const fh = src.facialHair && typeof src.facialHair === 'object' ? src.facialHair : {};
  const fhStyle = part('facialHair.style', fh.style ?? null, 'facialHair', null);
  const fhItem = itemById(catalog, fhStyle);
  out.facialHair = { style: fhStyle, color: fhItem && fhItem.lockedColors ? clampHsv(fh.color, base.facialHair.color) : hsv('facialHair.color', fh.color, base.facialHair.color) };

  const wear = src.wear && typeof src.wear === 'object' ? src.wear : {};
  out.wear = {};
  for (const slot of WEAR_SLOTS) out.wear[slot] = worn(slot, wear[slot]);
  out.vehicles = vehicles(src.vehicles);
  out.pet = pet(src.pet);
  out.unique = flags.unique || null;
  if (src.unique != null && src.unique !== out.unique) note('unique', src.unique, out.unique, 'RESERVED');
  return { spec: out, changes };

  /** spec.vehicles (CONTRACTS v1.8). Missing entirely = an older client: defaults, silently. */
  function vehicles(v) {
    if (v == null || typeof v !== 'object' || Array.isArray(v)) {
      if (v != null) note('vehicles', v, null, 'CLAMP');
      return defaultVehicles((id) => itemById(catalog, id)?.channels ?? 0);
    }
    const res = {};
    for (const kind of VEHICLE_KINDS) {
      const k = v[kind] && typeof v[kind] === 'object' ? v[kind] : {};
      res[kind] = {};
      for (const p of VEHICLE_PARTS[kind]) {
        const slot = kind + '.' + p, dflt = VEHICLE_DEFAULTS[kind][p];
        const optional = VEHICLE_OPTIONAL[kind].includes(p);
        const w = k[p];
        if (w === undefined) { res[kind][p] = vfresh(slot, dflt); continue; }
        if (w === null && optional) { res[kind][p] = null; continue; }
        res[kind][p] = worn(slot, w, 'vehicles.' + kind + '.' + p, dflt);
      }
    }
    return res;
  }
  /** spec.pet (v1.11): null = no pet (also when missing); { item, colors, name? } */
  function pet(w) {
    if (w == null) return null;
    if (typeof w !== 'object' || Array.isArray(w)) return note('pet', w, null, 'CLAMP');
    const id = part('pet', w.item ?? null, 'pet', null);
    if (!id) return null;
    const it = itemById(catalog, id), given = Array.isArray(w.colors) ? w.colors : [];
    let colors = [];
    if (!it.lockedColors) { colors = Array.from({ length: it.channels }, (_, i) => clampHsv(given[i], PET_COLORS[i] || DEFAULT_COLORS[i])); if (id === w.item && !(given.length === colors.length && colors.every((c, i) => sameHsv(c, given[i])))) note('pet.colors', given, colors, 'CLAMP'); }
    else if (given.length) note('pet.colors', given, [], 'LOCKED_COLORS');
    const o = { item: id, colors };
    const name = typeof w.name === 'string' ? w.name.replace(/[^\p{L}\p{N} '_-]/gu, '').trim().slice(0, 20) : '';
    if (name) o.name = name; else if (w.name != null && w.name !== '') note('pet.name', w.name, null, 'CLAMP');
    return o;
  }
  function vfresh(slot, id) {
    return id ? { item: id, colors: VEHICLE_COLORS[slot].slice(0, itemById(catalog, id)?.channels ?? 0).map((c) => ({ ...c })) } : null;
  }

  function worn(slot, w, vpath, vdflt) {
    const veh = !!vpath, path = vpath || 'wear.' + slot, dflt = veh ? vdflt : WEAR_DEFAULTS[slot];
    const palette = veh ? VEHICLE_COLORS[slot] : DEFAULT_COLORS;
    const fresh = (id) => (id ? { item: id, colors: palette.slice(0, itemById(catalog, id)?.channels ?? 0).map((c) => ({ ...c })) } : null);
    if (w === null) return veh ? note(path, null, dflt, 'UNKNOWN') && fresh(dflt) : null;                                 // explicitly wearing nothing in this slot
    if (w === undefined) return dflt ? (note(path, null, dflt, 'UNKNOWN'), fresh(dflt)) : null;
    const id = part(path, typeof w === 'object' ? w.item ?? null : null, slot, dflt);
    if (id !== (w && w.item)) return fresh(id);
    const it = itemById(catalog, id);
    const given = Array.isArray(w.colors) ? w.colors : [];
    let colors;
    if (it.lockedColors) {
      colors = [];
      if (given.length) note(path + '.colors', given, [], 'LOCKED_COLORS');
    } else {
      colors = Array.from({ length: it.channels }, (_, i) => clampHsv(given[i], palette[i] || DEFAULT_COLORS[i]));
      const same = given.length === colors.length && colors.every((c, i) => sameHsv(c, given[i]));
      if (!same) note(path + '.colors', given, colors, 'CLAMP');
    }
    const out = { item: id, colors };
    if (it.tags.includes('number')) {
      const num = w.extra && /^\d{1,2}$/.test(String(w.extra.number ?? '')) ? String(Number(w.extra.number)) : null;
      out.extra = { number: num ?? note(path + '.extra.number', w.extra ? w.extra.number : null, '0', 'CLAMP') };
    }
    return out;
  }
}

/**
 * Why a save must be refused (CONTRACTS §3.2): 'NOT_OWNED' if it uses something the viewer can't use, else null.
 * @param {SpecChange[]} changes
 */
export function saveRejection(changes) {
  return changes.some((c) => c.reason === 'NOT_OWNED' || c.reason === 'RESERVED') ? 'NOT_OWNED' : null;
}

/**
 * Every catalog id a spec uses (species, breed, parts, hair fx, worn items). The editor uses it to price
 * "Unlock N items & save".
 * @returns {string[]}
 */
export function itemsInSpec(spec) {
  const ids = ['species.' + spec.species, spec.breed, spec.ears, spec.wings && spec.wings.style, spec.eyes && spec.eyes.shape,
    spec.brows, spec.hair && spec.hair.style, spec.hair && spec.hair.fx && HAIR_FX[spec.hair.fx], spec.facialHair && spec.facialHair.style];
  for (const s of WEAR_SLOTS) if (spec.wear && spec.wear[s]) ids.push(spec.wear[s].item);
  ids.push(...vehicleItems(spec));
  if (spec.pet && spec.pet.item) ids.push(spec.pet.item);
  return ids.filter(Boolean);
}

/**
 * The reserved unique avatars only Sky can assign (Admin → setUnique). Sky can still edit his own afterwards.
 * @param {'sky'|'pepebot'} which
 */
export function uniqueSpec(which) {
  if (which === 'sky') {
    const s = defaultSpec('human');
    Object.assign(s, { model: 1, body: 'broad', height: 'medium', skin: { h: 28, s: 30, v: 90 }, unique: 'sky' });
    s.eyes = { shape: 'eyes.round', color: { h: 28, s: 70, v: 40 } };
    s.brows = 'brows.2';
    s.hair = { style: 'hair.bald', color: { h: 28, s: 30, v: 90 }, fx: null };
    s.facialHair = { style: 'facialHair.sky_beard', color: { h: 25, s: 65, v: 35 } };
    s.wear = {
      hat: null, eyewear: { item: 'eyewear.sky_frames', colors: [] }, ear: { item: 'ear.black_rings', colors: [] },
      nose: { item: 'nose.septum_silver', colors: [] }, shirt: { item: 'shirt.sky_outfit', colors: [] },
      pants: { item: 'pants.black_jeans', colors: [] }, shoes: { item: 'shoes.black_boots', colors: [] },
    };
    s.vehicles = skyVehicles();
    return s;
  }
  if (which === 'pepebot') {
    const s = defaultSpec('mecha');
    Object.assign(s, { model: 1, body: 'broad', height: 'tall', unique: 'pepebot' });
    s.eyes = { shape: 'eyes.round', color: { h: 110, s: 95, v: 90 } };
    s.hair = { style: 'hair.bald', color: { h: 280, s: 70, v: 70 }, fx: null };   // the purple spikes are part of the mecha body art
    s.wear = Object.fromEntries(WEAR_SLOTS.map((k) => [k, null]));
    s.vehicles = pepebotVehicles();
    return s;
  }
  throw new Error('unknown unique ' + which);
}

/**
 * A random starter-only character (new accounts, "wipe characters" at a season reset).
 * @param {import('../rng.mjs').Rng} rng
 * @param {Object} catalog
 */
export function randomStarterSpec(rng, catalog) {
  const by = itemsBySlot(catalog);
  const starters = (slot, species) => (by[slot] || []).filter((it) => it.rarity === 'starter' && fitsSpecies(it, species)).map((it) => it.id);
  const species = rng.pick(SPECIES);
  const s = defaultSpec(species);
  s.model = rng.pick(MODELS); s.body = rng.pick(BODIES); s.height = rng.pick(HEIGHTS);
  s.skin = species === 'human' ? skinTone(rng.int(0, 100)) : s.skin;
  // v1.16 coats / features stay at their defaults here, so the random sequence (and every seeded starter) is unchanged
  if (BREED_SPECIES.includes(species)) s.breed = rng.pick(starters('breed', species));
  if (s.ears && PRE_V116_EARS.includes(species)) s.ears = rng.pick(starters('ears', species));
  if (species === 'alien' || species === 'axolotl' || species === 'rat') s.skin = { h: rng.int(0, 359), s: rng.int(20, 70), v: rng.int(55, 95) };
  if (s.wings) s.wings = { style: rng.pick(starters('wings', species)), color: { h: rng.int(0, 359), s: rng.int(30, 80), v: rng.int(35, 80) } };
  s.eyes = { shape: rng.pick(starters('eyes', species)), color: { ...rng.pick(EYE_PRESETS).hsv } };
  s.brows = rng.pick(starters('brows', species));
  s.hair = { style: rng.pick(starters('hair', species)), color: { h: rng.int(0, 359), s: rng.int(20, 90), v: rng.int(15, 90) }, fx: null };
  s.facialHair = { style: rng.chance(0.25) ? rng.pick(starters('facialHair', species)) : null, color: { ...s.hair.color } };
  for (const slot of WEAR_SLOTS) {
    const optional = !WEAR_DEFAULTS[slot];
    if (optional && !rng.chance(slot === 'hat' ? 0.4 : 0.2)) { s.wear[slot] = null; continue; }
    const id = rng.pick(starters(slot, species));
    const ch = itemById(catalog, id).channels;
    s.wear[slot] = { item: id, colors: Array.from({ length: ch }, () => ({ h: rng.int(0, 359), s: rng.int(20, 90), v: rng.int(25, 95) })) };
  }
  // a random starter ride: body / hull style and paint (the rest stays default)
  const car = rng.pick(starters('car.body', species)), hull = rng.pick(starters('ufo.hull', species));
  s.vehicles.car.body = { item: car, colors: [{ h: rng.int(0, 359), s: rng.int(30, 90), v: rng.int(35, 95) }, { ...VEHICLE_COLORS['car.body'][1] }] };
  s.vehicles.ufo.hull = { item: hull, colors: [{ h: rng.int(0, 359), s: rng.int(0, 40), v: rng.int(55, 90) }, { h: rng.int(0, 359), s: rng.int(40, 90), v: rng.int(50, 90) }] };
  return s;
}

/**
 * The screen-reader summary of a character: "Cat, Tabby, tall, Cap, Glorp tee, Jeans, Sneakers".
 * @param {Object} spec
 * @param {Object} catalog
 */
export function describeSpec(spec, catalog) {
  const name = (id) => (itemById(catalog, id) || {}).name;
  const parts = [name('species.' + spec.species), spec.breed && name(spec.breed), spec.height];
  for (const s of WEAR_SLOTS) if (spec.wear && spec.wear[s]) parts.push(name(spec.wear[s].item));
  return parts.filter(Boolean).join(', ');
}
