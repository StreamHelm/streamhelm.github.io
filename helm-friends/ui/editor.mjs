// "Make your character" (DESIGN §10): live preview, categories, ‹ item › rows with lock state, colour wheel, and the
// sticky "Update / save changes" button. Every rule (what fits which species, what's reserved, what's owned, how a spec
// is repaired) is core's normalizeSpec / isUnlocked; this file only arranges the controls.
//
// v1.14 (Sky's bug report: "it kept jumping back to Bearded Dragon"): the draft is the viewer's until they save or
// discard it. A refreshed catalog or a fresh copy of the saved character (every poll sends new objects) no longer
// reloads the draft; the draft is also kept in this browser (per viewer, per saved revision) so a reload doesn't lose
// unsaved picks. Vehicles (getaway car + UFO) got their own tabs with a live preview.

import {
  normalizeSpec, defaultSpec, itemById, itemsBySlot, isUnlocked, fitsSpecies, itemsInSpec, describeSpec, skinTone,
  EYE_PRESETS, fmt, psd, PSD, VEHICLE_PARTS, VEHICLE_OPTIONAL, VEHICLE_COLORS,
} from '../core/index.mjs';
import { h, icon, mount } from './h.mjs';
import { renderKeepingFocus, announce } from './a11y.mjs';
import { openColorDialog, cssColor, describeHsv } from './colorwheel.mjs';
import { createPreview } from './avatar-preview.mjs';
import { createVehiclePreview } from './vehicle-preview.mjs';
import { confirmDialog } from './dialog.mjs';
import { toast } from './toast.mjs';
import { ApiError } from './api.mjs';
import { coinImg } from './shell.mjs';
import { safeStorage } from './store.mjs';

const RARITY = { starter: 'Starter', common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary', reserved: 'Reserved' };
const CHANNEL_NAMES = ['Main colour', 'Second colour', 'Third colour'];
const HAIR_FX_KEYS = { 'hairfx.neon': 'neon', 'hairfx.stardust': 'stardust', 'hairfx.prism': 'prism' };
const SPECIES_NAMES_FIRST = ['human', 'dragon', 'ape', 'cat', 'dog', 'frog', 'capybara', 'panda', 'alien', 'rat', 'axolotl', 'beardie', 'bat', 'orc', 'minotaur', 'clown', 'mecha'];
const PART_NAMES = { 'car.body': 'Body', 'car.wheels': 'Wheels', 'car.decal': 'Decal', 'ufo.hull': 'Hull', 'ufo.dome': 'Dome', 'ufo.lights': 'Lights', 'ufo.trail': 'Trail' };
const PART_ORDER = { car: ['body', 'wheels', 'decal'], ufo: ['hull', 'dome', 'lights', 'trail'] };
const DRAFT_KEY = 'hf.draft.';
/** v1.16 row labels: cats / dogs have breeds, everyone else coats; the 'ears' slot is each species' own feature. */
const coatWord = (sp) => (sp === 'cat' || sp === 'dog' ? 'Breed' : 'Coat');
const FEATURE_WORDS = { human: 'Face shape', capybara: 'Extras', frog: 'Extras', ape: 'Extras', clown: 'Face paint', orc: 'Tusks', minotaur: 'Horns', alien: 'Antennae', axolotl: 'Gills', beardie: 'Frill' };
const featureWord = (sp) => FEATURE_WORDS[sp] || 'Ears';

/** The categories (DESIGN §10): Body · Species · Face · Hair · Hat · Glasses · Ears · Nose · Shirt · Pants · Shoes, + Pet, Car, UFO. */
export const CATEGORIES = [
  ['body', 'Body'], ['species', 'Species'], ['face', 'Face'], ['hair', 'Hair'], ['hat', 'Hat'], ['eyewear', 'Glasses'],
  ['ear', 'Ears'], ['nose', 'Nose'], ['shirt', 'Shirt'], ['pants', 'Pants'], ['shoes', 'Shoes'], ['pet', 'Pet'],
  ['car', 'Getaway car'], ['ufo', 'UFO'],
];
const VEHICLE_CATS = ['car', 'ufo'];
/** v1.14: the top switch of the editor: you, your pet, your getaway car, your UFO. */
const GROUPS = [['me', 'Me'], ['pet', 'Pet'], ['car', 'Getaway car'], ['ufo', 'UFO']];

/**
 * @param {{ store:Object, api:Object, actions:Object, art:Promise }} o
 *   store state used: me, catalog, owned (string[]), character { spec, rev }, loggedIn
 */
export function createEditor({ store, api, actions, art }) {
  let draft = null, savedJson = null, baseRev = null, cat = 'body', lastMe = 'body', busy = false, touched = false, restored = false;
  const catalog = () => store.get().catalog;
  const preview = createPreview({ art, catalog });
  const vpreview = createVehiclePreview({ art, catalog });
  const rowsBox = h('div', { class: 'ed-rows', id: 'ed-rows' });
  const groupBox = h('div', { class: 'seg ed-groups', role: 'group', 'aria-label': 'What to edit' });
  const catsBox = h('div', { class: 'chips ed-cats', role: 'group', 'aria-label': 'Which part' });
  const noteBox = h('div', { class: 'ed-note' });
  const saveBox = h('div', { class: 'savebar' });
  const previewBox = h('div', { class: 'ed-previews' }, preview.el, vpreview.el);
  const el = h('section', { 'aria-labelledby': 'ed-title' },
    h('h2', { class: 'page-title', id: 'ed-title' }, 'Make your character'),
    previewBox, groupBox, catsBox, noteBox, rowsBox, saveBox);

  // ---------- state
  const flags = () => {
    const me = store.get().me;
    return { unlockAll: !!(me && me.flags && me.flags.unlockAll), unique: (me && me.unique) || null };
  };
  const owned = () => new Set(store.get().owned || []);
  const locked = (it) => !!it && !isUnlocked(it, owned(), flags());
  /** Repairs cross-dependencies (species ⇄ breed/ears/wings…) while allowing try-on of anything not reserved. */
  const repair = (s) => normalizeSpec(s, catalog(), [], { unlockAll: true, unique: flags().unique }).spec;
  const draftKey = () => { const me = store.get().me; return me && me.twitchId ? DRAFT_KEY + me.twitchId : null; };

  /** Keeps the unsaved draft in this browser (a reload or a closed tab doesn't lose it); cleared on save / discard. */
  function remember() {
    const k = draftKey();
    if (!k) return;
    if (dirty() && touched) safeStorage.setJson(k, { rev: baseRev, spec: draft, cat, at: Date.now() });
    else safeStorage.del(k);
  }

  function load() {
    const st = store.get();
    if (!st.catalog) return;
    const base = st.character && st.character.spec ? st.character.spec : defaultSpec('human');
    savedJson = st.character && st.character.spec ? JSON.stringify(repair(st.character.spec)) : null;
    baseRev = st.character ? st.character.rev : null;
    draft = repair(base); touched = false; restored = false;
    // an unsaved draft from before a reload comes back when it was made on top of the same saved revision
    const k = draftKey(), kept = k ? safeStorage.getJson(k) : null;
    if (kept && kept.spec && st.character && kept.rev === st.character.rev) {
      const again = repair(kept.spec);
      if (JSON.stringify(again) !== savedJson) { draft = again; touched = true; restored = true; if (kept.cat && CATEGORIES.some((c) => c[0] === kept.cat)) cat = kept.cat; }
      else safeStorage.del(k);
    } else if (kept && k) safeStorage.del(k);
    render();
  }
  const dirty = () => !!draft && JSON.stringify(draft) !== savedJson;

  function change(mut, say) {
    const next = structuredClone(draft);
    mut(next);
    draft = repair(next); touched = true;
    remember();
    render();
    if (say) announce(say);
  }
  /** A live change from a slider / colour wheel: only the preview and the save button update. */
  function liveChange(mut) {
    const next = structuredClone(draft);
    mut(next);
    draft = repair(next); touched = true;
    remember();
    showPreview(); renderSave();
  }

  // ---------- options per slot
  function options(slot) {
    const unique = flags().unique;
    return (itemsBySlot(catalog())[slot] || [])
      .filter((it) => fitsSpecies(it, draft.species) && (!it.reservedFor || it.reservedFor === unique))
      .sort((a, b) => slot === 'species' ? SPECIES_NAMES_FIRST.indexOf(a.id.slice(8)) - SPECIES_NAMES_FIRST.indexOf(b.id.slice(8)) : 0);
  }

  const lockText = (it) => `Trying on · ${RARITY[it.rarity] || it.rarity} · ${fmt(it.price)}`;

  // ---------- row builders
  /** ‹ item › with lock state. get() → id|null; set(next, id) mutates the draft clone. */
  function cycleRow({ key, label, slot, get, set, optional = false, noneLabel = 'None' }) {
    const list = options(slot).map((it) => it.id);
    if (optional) list.unshift(null);
    const cur = get(draft);
    const idx = Math.max(0, list.indexOf(cur));
    const it = cur ? itemById(catalog(), cur) : null;
    const name = it ? it.name : noneLabel;
    const isLocked = locked(it);
    const step = (k) => {
      if (list.length < 2) return;
      const id = list[(idx + k + list.length) % list.length];
      const nit = id ? itemById(catalog(), id) : null;
      change((d) => set(d, id), `${label}: ${nit ? nit.name : noneLabel}${locked(nit) ? `, locked, ${psd(nit.price)}, trying on` : ''}`);
    };
    return h('div', { class: 'ed-row', 'data-row': key },
      h('div', { class: 'ed-row-head' }, h('span', { id: `lbl-${key}` }, label), h('span', { class: 'small' }, `${idx + 1} of ${list.length}`)),
      h('div', { class: 'cycler' },
        h('button', { type: 'button', class: 'arrow', 'aria-label': `Previous ${label.toLowerCase()}`, 'data-fk': `${key}-prev`, onclick: () => step(-1), disabled: list.length < 2 }, icon('left')),
        h('div', { class: 'value', 'aria-labelledby': `lbl-${key}`, 'data-testid': `value-${key}`, 'aria-live': 'polite' },
          h('span', { class: 'name' }, name),
          isLocked ? h('span', { class: 'lock', 'data-locked': '1' }, icon('lock'), lockText(it), coinImg('coin-sm')) :
            it && it.rarity !== 'starter' ? h('span', { class: 'badge owned small' }, 'Owned') : null),
        h('button', { type: 'button', class: 'arrow', 'aria-label': `Next ${label.toLowerCase()}`, 'data-fk': `${key}-next`, onclick: () => step(1), disabled: list.length < 2 }, icon('right'))));
  }

  function segRow({ key, label, choices, get, set }) {
    const cur = get(draft);
    return h('div', { class: 'ed-row', 'data-row': key },
      h('div', { class: 'ed-row-head', id: `lbl-${key}` }, label),
      h('div', { class: 'seg', role: 'group', 'aria-labelledby': `lbl-${key}` },
        choices.map(([v, text]) => h('button', {
          type: 'button', class: 'chip', 'aria-pressed': String(v === cur), 'data-fk': `${key}-${v}`,
          onclick: () => change((d) => set(d, v), `${label}: ${text}`),
        }, text))));
  }

  function colorButton({ key, label, get, set, presets = [] }) {
    const c = get(draft);
    if (!c) return null;
    const chip = h('span', { class: 'chip-color' });
    chip.style.background = cssColor(c);
    return h('button', {
      type: 'button', class: 'swatch-btn', 'data-fk': `color-${key}`, 'aria-label': `${label}: ${describeHsv(c)}. Change colour`,
      onclick: () => openColorDialog({
        title: label, value: c, presets,
        onInput: (hsv) => liveChange((next) => set(next, hsv)),
        onClose: () => { render(); const b = rowsBox.querySelector(`[data-fk="color-${key}"]`); if (b) b.focus(); },
      }),
    }, chip, h('span', null, label));
  }

  const colorRow = (key, label, buttons) => {
    const list = buttons.filter(Boolean);
    return list.length ? h('div', { class: 'ed-row', 'data-row': key }, h('div', { class: 'ed-row-head' }, label), h('div', { class: 'swatches' }, list)) : null;
  };

  function wearRows(slot, label) {
    const w = draft.wear[slot];
    const it = w ? itemById(catalog(), w.item) : null;
    const optional = !['shirt', 'pants', 'shoes'].includes(slot);
    const rows = [cycleRow({
      key: slot, label, slot, optional, noneLabel: `No ${label.toLowerCase()}`,
      get: (d) => (d.wear[slot] ? d.wear[slot].item : null),
      set: (d, id) => { const prev = d.wear[slot]; d.wear[slot] = id ? { item: id, colors: prev ? prev.colors : [] } : null; },
    })];
    if (it && it.channels > 0 && !it.lockedColors) {
      rows.push(colorRow(`${slot}-colors`, 'Colours', Array.from({ length: it.channels }, (_, i) => colorButton({
        key: `${slot}-${i}`, label: CHANNEL_NAMES[i],
        get: (d) => d.wear[slot] && d.wear[slot].colors[i],
        set: (d, hsv) => { d.wear[slot].colors[i] = hsv; },
      }))));
    } else if (it && it.lockedColors) {
      rows.push(h('p', { class: 'small muted' }, 'This one has its own colours.'));
    }
    if (it && it.tags.includes('number')) rows.push(numberField('jersey-number', 'Jersey number (0–99)', (w.extra && w.extra.number) || '0', (d, v) => { d.wear.shirt.extra = { number: v }; }));
    return rows;
  }

  function numberField(fk, label, value, set) {
    return h('label', { class: 'ed-row field' }, h('span', null, label),
      h('input', { type: 'text', inputmode: 'numeric', maxlength: 2, pattern: '[0-9]*', value, 'data-fk': fk,
        onchange: (e) => { const v = String(Number(e.target.value.replace(/\D/g, '').slice(0, 2) || '0')); change((d) => set(d, v), `${label.split(' (')[0]} ${v}`); } }));
  }

  /** v1.14: the getaway car / UFO parts: ‹ part › (free + locked try-on, bought on save like clothes), colours, race number. */
  function vehicleRows(kind) {
    const rows = [h('p', { class: 'small muted' }, kind === 'car'
      ? 'Your getaway car: when you are picked as the heist driver, this is the car that pulls up (you show in the window).'
      : 'Your UFO for the Gleep Race and the Grand Prix.')];
    for (const part of PART_ORDER[kind]) {
      const slot = `${kind}.${part}`, label = PART_NAMES[slot], optional = VEHICLE_OPTIONAL[kind].includes(part);
      rows.push(cycleRow({
        key: `${kind}-${part}`, label, slot, optional, noneLabel: `No ${label.toLowerCase()}`,
        get: (d) => (d.vehicles[kind][part] ? d.vehicles[kind][part].item : null),
        set: (d, id) => {
          const prev = d.vehicles[kind][part], nit = id ? itemById(catalog(), id) : null;
          const colors = prev && prev.colors && prev.colors.length ? prev.colors : (VEHICLE_COLORS[slot] || []).map((c) => ({ ...c }));
          d.vehicles[kind][part] = id ? { item: id, colors: nit ? colors.slice(0, nit.channels) : [] } : null;
        },
      }));
      const w = draft.vehicles[kind][part], it = w ? itemById(catalog(), w.item) : null;
      if (it && it.channels > 0 && !it.lockedColors) {
        rows.push(colorRow(`${kind}-${part}-colors`, `${label} colours`, Array.from({ length: it.channels }, (_, i) => colorButton({
          key: `${kind}-${part}-${i}`, label: `${label}: ${CHANNEL_NAMES[i].toLowerCase()}`,
          get: (d) => d.vehicles[kind][part] && d.vehicles[kind][part].colors[i],
          set: (d, hsv) => { d.vehicles[kind][part].colors[i] = hsv; },
        }))));
      } else if (it && it.lockedColors) rows.push(h('p', { class: 'small muted' }, `The ${it.name} has its own colours.`));
      if (it && it.tags.includes('number')) rows.push(numberField(`${kind}-${part}-number`, 'Race number (0–99)', (w.extra && w.extra.number) || '0', (d, v) => { d.vehicles[kind][part].extra = { number: v }; }));
    }
    return rows;
  }

  function rowsFor(id) {
    const d = draft;
    switch (id) {
      case 'body': {
        const rows = [
          segRow({ key: 'model', label: 'Model', choices: [[1, 'Model 1'], [2, 'Model 2']], get: (s) => s.model, set: (s, v) => { s.model = v; } }),
          segRow({ key: 'build', label: 'Body type', choices: [['slim', 'Slim'], ['average', 'Average'], ['broad', 'Broad']], get: (s) => s.body, set: (s, v) => { s.body = v; } }),
          segRow({ key: 'height', label: 'Height', choices: [['short', 'Short'], ['medium', 'Medium'], ['tall', 'Tall']], get: (s) => s.height, set: (s, v) => { s.height = v; } }),
        ];
        if (d.species === 'human') rows.push(skinRow());
        else if (d.species !== 'mecha') {
          // v1.16: a coat with 0 channels is a fixed colour morph (cat / dog breeds, the albino rat…): no body colour to pick
          const coat = d.breed ? itemById(catalog(), d.breed) : null;
          if (coat && !coat.channels) rows.push(h('p', { class: 'small muted', 'data-note': 'coat-colours' }, `The ${coat.name} ${coatWord(d.species).toLowerCase()} has its own colours (Species tab).`));
          else rows.push(colorRow('skin', 'Body colour', [colorButton({ key: 'skin', label: 'Body colour', get: (s) => s.skin, set: (s, v) => { s.skin = v; } })]));
        }
        return rows;
      }
      case 'species': return [
        cycleRow({ key: 'species', label: 'Species', slot: 'species', get: (s) => 'species.' + s.species,
          set: (s, id) => { const sp = id.slice(8); if (sp !== s.species) { const base = defaultSpec(sp); Object.assign(s, { species: sp, skin: base.skin, breed: base.breed, ears: base.ears, wings: base.wings }); } } }),
        d.breed !== null && cycleRow({ key: 'breed', label: coatWord(d.species), slot: 'breed', get: (s) => s.breed, set: (s, id) => { s.breed = id; } }),
        d.ears !== null && d.species !== 'human' && cycleRow({ key: 'ears', label: featureWord(d.species), slot: 'ears', get: (s) => s.ears, set: (s, id) => { s.ears = id; } }),
        d.wings && cycleRow({ key: 'wings', label: 'Wings', slot: 'wings', get: (s) => s.wings.style, set: (s, id) => { s.wings.style = id; } }),
        d.wings && colorRow('wings-color', 'Wing colour', [colorButton({ key: 'wings', label: 'Wing colour', get: (s) => s.wings && s.wings.color, set: (s, v) => { s.wings.color = v; } })]),
      ];
      case 'face': return [
        d.species === 'human' && d.ears !== null && cycleRow({ key: 'ears', label: featureWord(d.species), slot: 'ears', get: (s) => s.ears, set: (s, id) => { s.ears = id; } }),   // v1.16 face shapes
        cycleRow({ key: 'eyes', label: 'Eye shape', slot: 'eyes', get: (s) => s.eyes.shape, set: (s, id) => { s.eyes.shape = id; } }),
        colorRow('eye-color', 'Eye colour', [colorButton({ key: 'eyes', label: 'Eye colour', presets: EYE_PRESETS, get: (s) => s.eyes.color, set: (s, v) => { s.eyes.color = v; } })]),
        cycleRow({ key: 'brows', label: 'Eyebrows', slot: 'brows', get: (s) => s.brows, set: (s, id) => { s.brows = id; } }),
        cycleRow({ key: 'facialHair', label: 'Facial hair', slot: 'facialHair', optional: true, noneLabel: 'No facial hair', get: (s) => s.facialHair.style, set: (s, id) => { s.facialHair.style = id; } }),
        d.facialHair.style && colorRow('fh-color', 'Facial hair colour', [colorButton({ key: 'facialHair', label: 'Facial hair colour', get: (s) => s.facialHair.color, set: (s, v) => { s.facialHair.color = v; } })]),
      ];
      case 'hair': return [
        cycleRow({ key: 'hair', label: 'Hair style', slot: 'hair', get: (s) => s.hair.style, set: (s, id) => { s.hair.style = id; } }),
        colorRow('hair-color', 'Hair colour', [colorButton({ key: 'hair', label: 'Hair colour', get: (s) => s.hair.color, set: (s, v) => { s.hair.color = v; } })]),
        cycleRow({ key: 'hairfx', label: 'Hair effect', slot: 'hairfx', optional: true, noneLabel: 'No effect',
          get: (s) => (s.hair.fx ? Object.keys(HAIR_FX_KEYS).find((k) => HAIR_FX_KEYS[k] === s.hair.fx) : null),
          set: (s, id) => { s.hair.fx = id ? HAIR_FX_KEYS[id] : null; } }),
      ];
      case 'pet': {   // v1.11/v1.12: a pet that follows you on stream (shop / unlock like items: saving buys a locked one)
        const pit = d.pet ? itemById(catalog(), d.pet.item) : null;
        const rows = [cycleRow({ key: 'pet', label: 'Pet', slot: 'pet', optional: true, noneLabel: 'No pet',
          get: (s) => (s.pet ? s.pet.item : null),
          set: (s, id) => { const prev = s.pet; s.pet = id ? { item: id, colors: prev && prev.item === id ? prev.colors : [], ...(prev && prev.name ? { name: prev.name } : {}) } : null; } })];
        if (pit && pit.channels > 0 && !pit.lockedColors) {
          rows.push(colorRow('pet-colors', 'Pet colours', Array.from({ length: pit.channels }, (_, i) => colorButton({
            key: `pet-${i}`, label: i === 0 ? 'Fur / body' : CHANNEL_NAMES[i], get: (s) => s.pet && s.pet.colors[i], set: (s, hsv) => { s.pet.colors[i] = hsv; } }))));
        } else if (pit && pit.lockedColors) rows.push(h('p', { class: 'small muted' }, 'This one has its own colours.'));
        if (pit) rows.push(h('label', { class: 'ed-row field' }, h('span', null, 'Pet name (optional)'),
          h('input', { type: 'text', maxlength: 20, value: d.pet.name || '', 'data-fk': 'pet-name', 'aria-label': 'Pet name',
            onchange: (e) => { const v = e.target.value.trim().slice(0, 20); change((s) => { if (v) s.pet.name = v; else delete s.pet.name; }, v ? `Pet name ${v}` : 'Pet name cleared'); } })));
        return rows;
      }
      case 'car': case 'ufo': return vehicleRows(id);
      default: return wearRows(id, (CATEGORIES.find((c) => c[0] === id) || [id, id])[1]);
    }
  }

  function skinRow() {
    // the slider is a 1-D path of skin tones (core skinTone); start where the current colour is closest
    let best = 0, bestD = Infinity;
    for (let t = 0; t <= 100; t++) { const c = skinTone(t), dd = Math.abs(c.h - draft.skin.h) + Math.abs(c.s - draft.skin.s) + Math.abs(c.v - draft.skin.v); if (dd < bestD) { bestD = dd; best = t; } }
    const input = h('input', { type: 'range', min: 0, max: 100, step: 1, value: best, class: 'skin-range', 'aria-label': 'Skin tone, light to deep', 'data-fk': 'skin-range',
      oninput: (e) => liveChange((next) => { next.skin = skinTone(Number(e.target.value)); }) });
    const stops = [0, 25, 50, 75, 100].map((t) => `${cssColor(skinTone(t))} ${t}%`).join(', ');
    input.style.background = `linear-gradient(90deg, ${stops})`;
    return h('div', { class: 'ed-row', 'data-row': 'skin' }, h('div', { class: 'ed-row-head' }, 'Skin tone'), input);
  }

  // ---------- render
  function showPreview() {
    const veh = VEHICLE_CATS.includes(cat);
    preview.el.hidden = veh; vpreview.el.hidden = !veh;
    if (veh) vpreview.show(draft, cat); else { vpreview.stop(); preview.show(draft); }
  }

  function render() {
    if (!draft) { mount(rowsBox, h('p', { class: 'empty' }, 'Loading the wardrobe…')); return; }
    showPreview();
    // v1.14: what you're editing first (you · your pet · your getaway car · your UFO), then the parts of "you" as chips,
    // so the rides can't hide at the far end of a sideways-scrolling chip row on a phone
    const group = GROUPS.some((g) => g[0] === cat) ? cat : 'me';
    if (group === 'me') lastMe = cat;
    renderKeepingFocus(groupBox, () => mount(groupBox, GROUPS.map(([id, label]) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(id === group), 'data-fk': id === 'me' ? 'grp-me' : 'cat-' + id,
      onclick: () => { cat = id === 'me' ? lastMe : id; remember(); render(); },
    }, label))));
    catsBox.hidden = group !== 'me';
    renderKeepingFocus(catsBox, () => mount(catsBox, CATEGORIES.filter(([id]) => !GROUPS.some((g) => g[0] === id)).map(([id, label]) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(id === cat), 'data-fk': 'cat-' + id,
      onclick: () => { cat = id; remember(); render(); },
    }, label))));
    mount(noteBox, restored && dirty() ? h('div', { class: 'note', 'data-note': 'draft-restored' },
      h('p', null, 'We kept the changes you hadn\'t saved yet.'),
      h('button', { type: 'button', class: 'btn small', 'data-fk': 'draft-discard', onclick: discard }, 'Discard them')) : null);
    renderKeepingFocus(rowsBox, () => mount(rowsBox, rowsFor(cat).filter(Boolean)));
    renderSave();
  }

  function discard() {
    const k = draftKey(); if (k) safeStorage.del(k);
    load(); announce('Unsaved changes discarded');
  }

  /** What saving needs: locked items in the draft and their total price. */
  function pending() {
    const items = itemsInSpec(draft).map((id) => itemById(catalog(), id)).filter((it) => it && locked(it));
    const uniq = [...new Map(items.map((it) => [it.id, it])).values()];
    return { items: uniq, cost: uniq.reduce((s, it) => s + (it.price || 0), 0) };
  }

  function renderSave() {
    const st = store.get(), me = st.me;
    const { items, cost } = pending();
    const balance = me ? me.balance : 0;
    const short = me && balance !== -1 && cost > balance ? cost - balance : 0;
    let label = 'Update / save changes', note = null, disabled = busy || !dirty();
    if (!st.loggedIn) { label = st.mode === 'ext' ? 'Connect your Twitch name to save' : 'Log in with Twitch to save'; disabled = false; }
    else if (items.length) {
      label = `Unlock ${items.length} item${items.length === 1 ? '' : 's'} (${fmt(cost)}) & save`;
      if (short) { disabled = true; note = `You need ${psd(short)} more. Remove the locked items to save the rest.`; }
    }
    if (st.loggedIn && !dirty()) note = 'All changes saved.';
    else if (st.loggedIn && !items.length && dirty()) note = 'You have unsaved changes.';
    const btn = h('button', { type: 'button', class: 'btn primary block', 'data-fk': 'save', 'data-testid': 'save', disabled, onclick: save },
      items.length && st.loggedIn ? coinImg('coin-sm') : null, busy ? 'Saving…' : label);
    saveBox.classList.toggle('floating', dirty() || !st.loggedIn);   // only stick to the bottom when there's something to save
    renderKeepingFocus(saveBox, () => mount(saveBox, btn, note && h('p', { class: short ? '' : 'muted', role: short ? 'alert' : 'status', 'data-testid': 'save-note' }, note)));
  }

  async function save() {
    const st = store.get();
    if (!st.loggedIn) return actions.login();
    const { items, cost } = pending();
    if (items.length) {
      const ok = await confirmDialog({
        title: 'Unlock and save?',
        body: [`This spends ${psd(cost)} to unlock: ${items.map((it) => it.name).join(', ')}.`, 'Unlocked items stay yours for this season.'],
        confirmLabel: `Unlock (${fmt(cost)}) & save`,
      });
      if (!ok) return;
    }
    busy = true; renderSave();
    try {
      for (const it of items) {
        const r = await api.unlock(it.id);
        actions.setData({ me: r.me || store.get().me, owned: r.owned || [...(store.get().owned || []), it.id] });
      }
      const rev = baseRev != null ? baseRev : (st.character ? st.character.rev : 0);
      const r = await api.saveCharacter(draft, rev);
      draft = repair(r.spec); savedJson = JSON.stringify(draft); baseRev = r.rev; touched = false; restored = false;
      remember();
      actions.setData({ character: { spec: r.spec, rev: r.rev } });
      const tidied = (r.changes || []).filter((c) => c.reason !== 'CLAMP');
      toast(tidied.length ? 'Saved — the server tidied a few pieces that didn\'t fit.' : 'Saved! Your Helm Friend looks like this on stream now.', { kind: 'win' });
      announce('Character saved');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'STALE') {
        toast('Your character changed somewhere else (another tab or device).', { kind: 'error', action: { label: 'Reload', run: async () => { await actions.reloadCharacter(); const k = draftKey(); if (k) safeStorage.del(k); load(); } } });
      } else if (e instanceof ApiError && e.code === 'NOT_OWNED') {
        await actions.reloadUnlocks();
        toast(e.message, { kind: 'error' });
      } else toast(e.message || 'Saving failed.', { kind: 'error' });
    } finally { busy = false; render(); }
  }

  store.subscribe((s, keys) => {
    if (keys.includes('catalog')) {
      // a new catalog (prices, items): keep the viewer's draft, just re-check it against the new list
      if (!draft || !touched) load();
      else { draft = repair(draft); if (s.character && s.character.spec) savedJson = JSON.stringify(repair(s.character.spec)); render(); }
    } else if (keys.includes('character')) {
      // the saved copy changed (this save, another tab, a season repair): untouched → show it; touched → keep the draft
      // (saving answers STALE with "Load that one" when the revision moved on)
      if (!draft || !touched) load();
      else savedJson = s.character && s.character.spec ? JSON.stringify(repair(s.character.spec)) : savedJson;
      if (draft && touched) renderSave();
    } else if (keys.includes('me') && draft && !touched && !restored && draftKey() && safeStorage.getJson(draftKey())) {
      load();   // first time we know who this is: bring back their unsaved draft
    } else if (keys.some((k) => ['me', 'owned', 'loggedIn'].includes(k)) && draft) render();
  });
  load();

  return { el, dirty, draft: () => draft, describe: () => (draft ? describeSpec(draft, catalog()) : ''), preview, vpreview, category: () => cat };
}
