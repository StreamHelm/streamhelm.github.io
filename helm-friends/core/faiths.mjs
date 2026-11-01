// SH Gods BRIDGE (Phase 3): the gods a viewer's Helm Friend can follow (spec.faith). The default list is Sky's three cosmic
// cat-gods; another streamer's gods come from the cloud's settings (`faiths`, same shape) when set - normalizeFaiths() cleans it.
// Colours follow Sky's rules: Glorp radioactive green with a gold halo, Klerb PURPLE (never yellow / gold), Sayok red / flame.

export const FAITHS = Object.freeze([
  Object.freeze({ id: 'glorp', name: 'Glorp', color: '#7dff3b', rim: '#ffcf3f', blurb: 'Peace, balance, snacks. The chill one.' }),
  Object.freeze({ id: 'klerb', name: 'Klerb', color: '#b23cff', rim: '#2a0b3d', blurb: 'Chaos, pranks, bets. Never boring.' }),
  Object.freeze({ id: 'sayok', name: 'Sayok', color: '#ff5a1f', rim: '#3a0a00', blurb: 'Cruel, vulgar, terrifying. Escaped his prison.' }),
]);
const ID_RE = /^[a-z][a-z0-9_]{0,15}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

/** A streamer's own list (cloud settings `faiths`) → a clean list; anything unusable → the defaults. */
export function normalizeFaiths(list) {
  if (!Array.isArray(list) || !list.length) return FAITHS;
  const out = [];
  for (const f of list.slice(0, 8)) {
    if (!f || !ID_RE.test(String(f.id || '')) || out.some((x) => x.id === f.id)) continue;
    out.push({ id: f.id, name: String(f.name || f.id).slice(0, 24), color: HEX.test(f.color) ? f.color : '#c0c0c0', rim: HEX.test(f.rim) ? f.rim : '#1b1426', blurb: String(f.blurb || '').slice(0, 80) });
  }
  return out.length ? out : FAITHS;
}
/** A spec's faith if it is one of the gods (else null). */
export function faithOf(spec, list = FAITHS) {
  const id = spec && typeof spec.faith === 'string' ? spec.faith : null;
  return id && list.some((f) => f.id === id) ? id : null;
}
