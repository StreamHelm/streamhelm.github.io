// Small modal dialogs (native <dialog>: focus is trapped and Escape closes, for free).

import { h } from './h.mjs';
import { trapFocus } from './a11y.mjs';

let n = 0;

/**
 * Asks a yes/no question. With `typeToConfirm`, the confirm button stays disabled until that word is typed.
 * @param {{ title:string, body:(string|Node)[]|string, confirmLabel?:string, cancelLabel?:string, danger?:boolean, typeToConfirm?:string }} o
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, body, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false, typeToConfirm = null }) {
  return new Promise((resolve) => {
    const id = 'hf-dlg-' + ++n;
    let settled = false;
    const done = (v) => { if (settled) return; settled = true; dlg.close(); dlg.remove(); resolve(v); };
    const ok = h('button', { type: 'button', class: ['btn', danger ? 'danger' : 'primary'], onclick: () => done(true), disabled: !!typeToConfirm }, confirmLabel);
    const typed = typeToConfirm ? h('input', { type: 'text', autocomplete: 'off', 'aria-describedby': id + '-d',
      'aria-label': `Type ${typeToConfirm} to confirm`, oninput: (e) => { ok.disabled = e.target.value.trim() !== typeToConfirm; } }) : null;
    const dlg = h('dialog', { class: 'hf-dialog', 'aria-labelledby': id + '-t', 'aria-describedby': id + '-d' },
      h('h2', { id: id + '-t' }, title),
      h('div', { id: id + '-d' }, (Array.isArray(body) ? body : [body]).map((b) => (typeof b === 'string' ? h('p', null, b) : b))),
      typed && h('label', { class: 'field' }, h('span', null, `Type ${typeToConfirm} to confirm`), typed),
      h('div', { class: 'cw-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => done(false) }, cancelLabel), ok));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
    document.body.append(dlg);
    trapFocus(dlg);   // v1.14: Tab stays inside, focus returns to the opener
    dlg.showModal();
    (typed || ok.disabled ? typed : ok).focus();
  });
}
