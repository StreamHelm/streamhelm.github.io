// Toasts: short messages at the bottom, read out politely by screen readers. One optional action button.

import { h, icon } from './h.mjs';

let box = null;

function container() {
  if (!box || !box.isConnected) {
    box = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(box);
  }
  return box;
}

/**
 * @param {string} text
 * @param {{ kind?:'info'|'win'|'error', action?:{ label:string, run:()=>void }, ms?:number }} [o]
 */
export function toast(text, { kind = 'info', action = null, ms } = {}) {
  const close = () => el.remove();
  const el = h('div', { class: ['toast', kind] },
    h('p', null, text),
    action && h('button', { class: 'btn small solid', onclick: () => { close(); action.run(); } }, action.label),
    h('button', { class: 'hf-iconbtn', 'aria-label': 'Dismiss message', onclick: close }, icon('x')));
  container().append(el);
  const life = ms ?? (action ? 12000 : kind === 'error' ? 7000 : 4000);
  if (life > 0) setTimeout(close, life);
  return el;
}
