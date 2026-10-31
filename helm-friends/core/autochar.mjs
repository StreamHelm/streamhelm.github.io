// The automatic first character (v1.11, Sky): the first time a follower (or above) shows up, the cloud makes them a Helm
// Friend so they're on stage right away; they can change everything in the web app / panel later. Seeded by their Twitch
// id, so it is the same character every time it is made. Only FREE starter items (core randomStarterSpec picks rarity
// 'starter' only), and the colours come from small curated palettes instead of random hues — readable, never clashing:
//   one main hue for the top (+ a darker shade of it on the second channel), calm neutrals for trousers and shoes, an
//   accent (complementary or a near hue) for the hat; natural hair colours (a fun dye 1 time in 6).

import { createRng } from './rng.mjs';
import { randomStarterSpec, skinTone, WEAR_SLOTS } from './avatar/spec.mjs';
import { itemById } from './avatar/catalog.mjs';

const MAIN_HUES = [0, 18, 35, 48, 95, 140, 168, 195, 215, 235, 262, 285, 320, 340];
const NEUTRALS = [{ h: 220, s: 35, v: 32 }, { h: 215, s: 45, v: 45 }, { h: 30, s: 25, v: 30 }, { h: 38, s: 30, v: 62 }, { h: 0, s: 0, v: 22 }, { h: 0, s: 0, v: 55 }, { h: 100, s: 20, v: 35 }];
const SHOE_NEUTRALS = [{ h: 0, s: 0, v: 15 }, { h: 25, s: 40, v: 30 }, { h: 0, s: 0, v: 92 }, { h: 30, s: 20, v: 60 }];
const HAIR = [{ h: 25, s: 60, v: 18 }, { h: 28, s: 55, v: 35 }, { h: 35, s: 50, v: 55 }, { h: 45, s: 45, v: 85 }, { h: 15, s: 70, v: 50 }, { h: 0, s: 0, v: 70 }, { h: 0, s: 0, v: 10 }];
const DYES = [{ h: 300, s: 60, v: 80 }, { h: 190, s: 70, v: 85 }, { h: 110, s: 70, v: 75 }, { h: 340, s: 55, v: 85 }];

/**
 * The automatic character for a Twitch id. Pure and stable. The cloud still runs normalizeSpec() on it.
 * @param {string} twitchId
 * @param {Object} catalog  buildCatalog() output
 */
export function autoCharacter(twitchId, catalog) {
  const rng = createRng('autochar:' + twitchId);
  const s = randomStarterSpec(rng.fork('shape'), catalog);   // species, model, body, height, starter items
  const c = rng.fork('colours');
  const main = c.pick(MAIN_HUES), accent = c.chance(0.5) ? (main + 180) % 360 : (main + 30) % 360;
  const top = { h: main, s: c.int(50, 75), v: c.int(62, 85) };
  const shade = (x) => ({ h: x.h, s: Math.min(100, x.s + 10), v: Math.max(15, x.v - 30) });
  const colourFor = {
    shirt: [top, shade(top), { h: accent, s: 60, v: 80 }],
    pants: [c.pick(NEUTRALS), { h: 0, s: 0, v: 20 }, { h: accent, s: 40, v: 70 }],
    shoes: [c.pick(SHOE_NEUTRALS), { h: 0, s: 0, v: 90 }, { h: main, s: 50, v: 60 }],
    hat: [{ h: accent, s: c.int(45, 70), v: c.int(55, 80) }, { h: 0, s: 0, v: 95 }, top],
    eyewear: [{ h: 0, s: 0, v: 12 }, { h: accent, s: 50, v: 70 }, top],
    ear: [{ h: 45, s: 15, v: 85 }, { h: 45, s: 70, v: 85 }, top],
    nose: [{ h: 45, s: 15, v: 85 }, { h: 45, s: 70, v: 85 }, top],
  };
  for (const slot of WEAR_SLOTS) {
    const w = s.wear[slot]; if (!w) continue;
    const it = itemById(catalog, w.item), n = it ? Math.max(0, it.channels || 0) : w.colors.length;
    w.colors = colourFor[slot].slice(0, n).map((x) => ({ ...x }));
  }
  const hair = c.chance(1 / 6) ? c.pick(DYES) : c.pick(HAIR);
  if (s.hair) s.hair = { ...s.hair, color: { ...hair }, fx: null };
  if (s.facialHair) s.facialHair = { ...s.facialHair, color: { ...hair } };
  if (s.species === 'human') s.skin = skinTone(c.int(0, 100));
  if (s.wings) s.wings = { ...s.wings, color: { h: accent, s: 55, v: 65 } };
  return s;
}
