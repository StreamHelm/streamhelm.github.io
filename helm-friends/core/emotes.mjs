// Emotes (v1.21, games round 6): `!dance [style]` and `!emote <name>`. Silent in chat, shown on stage; one per viewer per
// cooldown.emoteSec (10 s) like the old !jump / !wave, plus a channel-wide limit so a spam wave stays readable.
// Each emote names a body animation every pack has (`anim`, the fallback), an optional particle preset (`fx`, overlay
// particles.mjs), a face (`expr`) and how long it lasts. When the art pack ships a dedicated animation `emote<Name>`
// (emoteLaugh, emoteFlex …) or `dance<Style>` (danceRobot …), the overlay plays that instead (CONTRACTS v1.21).

import { DANCE_STYLES } from './script.mjs';

/** name → { anim (base animation), loop?, fx?, expr?, ms (how long the overlay keeps it up), word (help list) } */
export const EMOTE_LIST = Object.freeze({
  wave: { anim: 'wave', ms: 1800, word: 'wave hello' },
  jump: { anim: 'jump', ms: 1200, word: 'jump' },
  cheer: { anim: 'cheer', loop: true, ms: 3000, word: 'cheer' },
  sit: { anim: 'sit', loop: true, ms: 30000, word: 'sit down' },
  dance: { anim: 'dance', loop: true, fx: 'notes', expr: 'happy', ms: 4000, word: 'dance (try !dance robot)' },
  love: { anim: 'wave', fx: 'hearts', expr: 'happy', ms: 3000, word: 'hearts' },
  laugh: { anim: 'cheer', loop: true, fx: 'sparkle', expr: 'happy', ms: 2600, word: 'laugh' },
  cry: { anim: 'sad', loop: true, fx: 'sweat', expr: 'sad', ms: 3200, word: 'cry' },
  rage: { anim: 'hurt', fx: 'smoke', expr: 'angry', ms: 2400, word: 'rage' },
  sleep: { anim: 'sit', loop: true, fx: 'zzz', expr: 'neutral', ms: 8000, word: 'nap' },
  flex: { anim: 'victory', fx: 'sparkle', expr: 'excited', ms: 2400, word: 'flex' },
  scared: { anim: 'startled', fx: 'sweat', expr: 'fear', ms: 2200, word: 'get scared' },
  party: { anim: 'dance', loop: true, fx: 'confetti', expr: 'excited', ms: 3500, word: 'party' },
  glorp: { anim: 'cheer', loop: true, fx: 'leaves', expr: 'happy', ms: 3000, word: "Glorp's leaves" },
  klerb: { anim: 'jump', fx: 'chaosSparks', expr: 'excited', ms: 2200, word: "Klerb's chaos" },
  sayok: { anim: 'victory', fx: 'embers', expr: 'angry', ms: 2600, word: "Sayok's embers" },
  rich: { anim: 'victory', fx: 'glint', expr: 'excited', ms: 2400, word: 'show off your Pepe\'s Silvia Dollahs' },
});
/** Words people type for an emote → its name. */
export const EMOTE_WORDS = Object.freeze({
  hi: 'wave', hello: 'wave', wave: 'wave', jump: 'jump', hop: 'jump', cheer: 'cheer', yay: 'cheer', sit: 'sit',
  dance: 'dance', love: 'love', heart: 'love', hearts: 'love', '<3': 'love', laugh: 'laugh', lol: 'laugh', lmao: 'laugh', kek: 'laugh',
  cry: 'cry', sad: 'cry', rage: 'rage', angry: 'rage', mad: 'rage', sleep: 'sleep', nap: 'sleep', zzz: 'sleep', flex: 'flex', strong: 'flex',
  scared: 'scared', scary: 'scared', spooky: 'scared', party: 'party', glorp: 'glorp', klerb: 'klerb', sayok: 'sayok', rich: 'rich', money: 'rich',
});
/** Words for a dance style → DANCE_STYLES (core script.mjs). */
export const DANCE_WORDS = Object.freeze({
  ...Object.fromEntries(DANCE_STYLES.map((s) => [s, s])), groovy: 'groove', disco: 'disco', robo: 'robot', bot: 'robot',
  floss: 'floss', shuffle: 'shuffle', worm: 'worm', moon: 'moonwalk', moonwalk: 'moonwalk', break: 'breakdance', breakdance: 'breakdance',
  bboy: 'breakdance', twist: 'twist', sprinkler: 'sprinkler',
});
/** Emote names for help / the command list. */
export const EMOTE_NAMES = Object.freeze(Object.keys(EMOTE_LIST));

/** "laugh" / "LOL" → 'laugh'; anything else → null. */
export function emoteOf(word) {
  const w = String(word || '').toLowerCase().replace(/^!/, '');
  return EMOTE_WORDS[w] || null;
}
/** "robot" / "ROBO" → 'robot'; anything else → null. */
export function danceStyleOf(word) {
  return DANCE_WORDS[String(word || '').toLowerCase()] || null;
}
/**
 * The emote feed message's extra fields for an emote intent: { anim, emote?, style? } (anim = the base animation every pack has).
 * @param {{ name:string, emote?:string, style?:string }} intent
 */
export function emoteFeed(intent) {
  const e = intent.emote && EMOTE_LIST[intent.emote];
  const out = { anim: e ? e.anim : intent.name };
  if (e) out.emote = intent.emote;
  if (intent.style && DANCE_STYLES.includes(intent.style)) out.style = intent.style;
  return out;
}
