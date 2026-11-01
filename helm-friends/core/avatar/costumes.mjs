// Event costumes (CONTRACTS v1.18, art batch 2): outfits the SHOWS put on a character for a moment — PepeBot's referee
// stripes in a fight, Sky's announcer suit at the announcer table, police uniforms for the heist's jail result, the
// orange jumpsuit for jailed players. They are NOT catalog items: nobody owns or buys them, they are never saved in a
// spec, and normalizeSpec would remove them. The overlay applies one at draw time with applyCostume(); the art pack
// draws every costume part for all 6 body proportions in every animation, so it fits every species, body type and
// height (tails, wings, horns and ears stay the character's own: they are separate layers).

/**
 * key → { name, wear: { slot: partId|null } } — slots not listed keep the character's own item.
 * Part ids are art.json `parts` names (attach 'body' like a worn item, `colors: 'fixed'`, no catalog item); a hat part is
 * a head part (by '*'). `null` empties the slot for the costume's duration.
 */
export const COSTUMES = Object.freeze({
  referee: {
    name: 'Referee',
    wear: { shirt: 'costume.referee.shirt', pants: 'costume.referee.pants', shoes: 'costume.referee.shoes', hat: null },
  },
  announcer: {
    name: 'Announcer suit',
    wear: { shirt: 'costume.announcer.shirt', pants: 'costume.announcer.pants', shoes: 'costume.announcer.shoes', hat: null },
  },
  police: {
    name: 'Police uniform',
    wear: { shirt: 'costume.police.shirt', pants: 'costume.police.pants', shoes: 'costume.police.shoes', hat: 'costume.police.hat' },
  },
  jumpsuit: {
    name: 'Orange jumpsuit',
    wear: { shirt: 'costume.jumpsuit.shirt', pants: 'costume.jumpsuit.pants', shoes: 'costume.jumpsuit.shoes' },
  },
});
export const COSTUME_KEYS = Object.freeze(Object.keys(COSTUMES));
/** Every costume part id (shirt / sleeves are drawn from the same id: `<id>`, `<id>.far`, `<id>.near`, like a shirt). */
export const COSTUME_PARTS = Object.freeze([...new Set(Object.values(COSTUMES).flatMap((c) => Object.values(c.wear).filter(Boolean)))]);

/**
 * A copy of `spec` wearing the costume (the input is not changed). Unknown key → a plain copy.
 * The result carries `costume: key` and worn entries `{ item: partId, colors: [] }` (fixed colours), so any
 * compositor that draws `spec.wear` (overlay art.mjs, web avatar-render, devkit compose.js) draws the costume as is.
 * @param {Object} spec
 * @param {string} key  'referee' | 'announcer' | 'police' | 'jumpsuit'
 * @returns {Object}
 */
export function applyCostume(spec, key) {
  const out = JSON.parse(JSON.stringify(spec || {}));
  const c = COSTUMES[key];
  if (!c) return out;
  out.wear = { ...(out.wear || {}) };
  for (const [slot, id] of Object.entries(c.wear)) out.wear[slot] = id ? { item: id, colors: [] } : null;
  out.costume = key;
  return out;
}

/** Is this worn item id a costume part (not a catalog item)? */
export function isCostumePart(id) {
  return typeof id === 'string' && id.startsWith('costume.');
}
