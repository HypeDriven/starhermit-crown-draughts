// Small DOM helpers shared across screens.

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function button(label, onClick, { kind = 'secondary', ...attrs } = {}) {
  return el('button', { type: 'button', class: `btn btn-${kind}`, text: label, onclick: onClick, ...attrs });
}

/** Simple focus trap + restore for modals. */
export class Modal {
  constructor(root, { title, onClose, wide = false }) {
    this.onClose = onClose;
    this.prevFocus = document.activeElement;
    this.backdrop = el('div', { class: 'modal-backdrop', role: 'presentation' });
    this.box = el('div', {
      class: `modal${wide ? ' modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true',
      'aria-label': title,
    });
    this.backdrop.appendChild(this.box);
    root.appendChild(this.backdrop);
    this.backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === this.backdrop) this.close();
    });
    this._keyHandler = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); this.close(); return; }
      if (e.key !== 'Tab') return;
      const focusables = this.box.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', this._keyHandler, true);
  }

  close() {
    if (!this.backdrop.isConnected) return;
    document.removeEventListener('keydown', this._keyHandler, true);
    this.backdrop.remove();
    this.onClose?.();
    if (this.prevFocus?.focus) this.prevFocus.focus();
  }
}

export function confirmDialog(root, { title, body, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const modal = new Modal(root, { title, onClose: () => resolve(false) });
    modal.box.appendChild(el('h2', { text: title }));
    if (body) modal.box.appendChild(el('p', { text: body, class: 'modal-body' }));
    const row = el('div', { class: 'modal-actions' });
    row.appendChild(button('Cancel', () => { modal.close(); resolve(false); }));
    row.appendChild(button(confirmLabel, () => { modal.close(); resolve(true); }, { kind: danger ? 'danger' : 'primary' }));
    modal.box.appendChild(row);
    row.querySelector('.btn-danger, .btn-primary')?.focus();
  });
}
