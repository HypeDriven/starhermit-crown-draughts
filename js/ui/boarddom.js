// The semantic HTML board: a fully playable mirror of the 3D scene. Screen
// readers get a concise navigable model (not decorative objects); keyboard
// users get roving-tabindex grid navigation. It is always available and can
// be pinned visible beside/over the canvas.

import { isPlayable, squareName } from '../rules/engine.js';

const PIECE_GLYPH = { ivory: '●', onyx: '○', jade: '◆', ember: '▲' };
const CROWN_MARK = '♛';

export class DomBoard {
  /**
   * callbacks: onCell(r, c) — the game controller decides what a cell press
   * means (select / move / explain), identical to canvas picks.
   */
  constructor(container, callbacks) {
    this.container = container;
    this.cb = callbacks;
    this.state = null;
    this.cursor = { r: 0, c: 1 };
    this.selection = null;
    this.targets = new Map(); // "r,c" -> action list
    this.lastMove = null;
    this.grid = null;
    this._build();
  }

  _build() {
    this.grid = document.createElement('div');
    this.grid.className = 'dom-board';
    this.grid.setAttribute('role', 'grid');
    this.grid.setAttribute('aria-label', 'Game board');
    this.container.replaceChildren(this.grid);
  }

  setInteraction(selection, targets, lastMove) {
    this.selection = selection;
    this.targets = targets;
    this.lastMove = lastMove;
    this.render();
  }

  setCursor(r, c) {
    this.cursor = { r, c };
    this._applyRoving();
  }

  setState(state) {
    this.state = state;
    if (this.grid.children.length !== state.size * state.size) this._buildCells(state.size);
    this.render();
  }

  _buildCells(size) {
    this.grid.replaceChildren();
    this.grid.style.setProperty('--board-size', size);
    this.cells = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `dom-cell ${isPlayable(size, r, c) ? 'playable' : 'void'}`;
        btn.dataset.r = r;
        btn.dataset.c = c;
        btn.setAttribute('role', 'gridcell');
        btn.tabIndex = -1;
        if (isPlayable(size, r, c)) {
          btn.addEventListener('click', () => this.cb.onCell(r, c));
        } else {
          btn.disabled = true;
          btn.setAttribute('aria-hidden', 'true');
        }
        this.grid.appendChild(btn);
        this.cells.push(btn);
      }
    }
    this._applyRoving();
  }

  _cellAt(r, c) {
    return this.cells?.[r * this.state.size + c] || null;
  }

  _applyRoving() {
    if (!this.cells || !this.state) return;
    for (const b of this.cells) b.tabIndex = -1;
    const cur = this._cellAt(this.cursor.r, this.cursor.c);
    if (cur && !cur.disabled) cur.tabIndex = 0;
  }

  focusCursor() {
    const cur = this._cellAt(this.cursor.r, this.cursor.c);
    cur?.focus();
  }

  moveCursor(dr, dc) {
    const size = this.state?.size || 8;
    let { r, c } = this.cursor;
    for (let i = 0; i < size; i++) {
      r = Math.min(size - 1, Math.max(0, r + dr));
      c = Math.min(size - 1, Math.max(0, c + dc));
      if (isPlayable(size, r, c)) break;
    }
    this.setCursor(r, c);
    this.focusCursor();
  }

  render() {
    const st = this.state;
    if (!st || !this.cells) return;
    const at = new Map();
    for (const p of st.pieces) {
      if (!p.captured) at.set(p.r * st.size + p.c, p);
    }
    for (let r = 0; r < st.size; r++) {
      for (let c = 0; c < st.size; c++) {
        const btn = this._cellAt(r, c);
        if (!btn || btn.disabled) continue;
        const p = at.get(r * st.size + c);
        const key = `${r},${c}`;
        const isTarget = this.targets.has(key);
        const isSelected = this.selection && this.selection[0] === r && this.selection[1] === c;
        const isLast = this.lastMove && (this.lastMove.from === key || this.lastMove.to === key);
        btn.classList.toggle('target', isTarget);
        btn.classList.toggle('capture-target', isTarget && this.targets.get(key).some((a) => a.captures.length));
        btn.classList.toggle('selected', !!isSelected);
        btn.classList.toggle('last-move', !!isLast);
        btn.classList.toggle('cursor', this.cursor.r === r && this.cursor.c === c);
        if (p) {
          const pl = st.players[p.owner];
          btn.dataset.piece = pl.color;
          btn.dataset.crowned = p.crowned ? '1' : '';
          btn.textContent = `${PIECE_GLYPH[pl.color] || '●'}${p.crowned ? CROWN_MARK : ''}`;
          btn.setAttribute('aria-label', `${squareName(r, c)}: ${pl.name} ${p.crowned ? 'crowned piece' : 'piece'}${isSelected ? ', selected' : ''}`);
        } else {
          btn.dataset.piece = '';
          btn.dataset.crowned = '';
          btn.textContent = '';
          btn.setAttribute('aria-label', `${squareName(r, c)}: empty${isTarget ? ' — legal destination' : ''}`);
        }
      }
    }
  }

  /** Concise textual model of the whole position for live announcements. */
  summary() {
    const st = this.state;
    if (!st) return '';
    const parts = st.players.map((pl) => {
      const mine = st.pieces.filter((p) => !p.captured && p.owner === pl.id);
      const crowns = mine.filter((p) => p.crowned).length;
      return `${pl.name}: ${mine.length} pieces${crowns ? ` (${crowns} crowned)` : ''}${pl.eliminated ? ', eliminated' : ''}`;
    });
    return parts.join('. ');
  }
}
