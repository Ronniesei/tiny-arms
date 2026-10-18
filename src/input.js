// Keyboard input: WASD/arrows to move, Space for the ability, Shift to dodge-roll (press counters), Esc for settings.

const LEFT = new Set(['KeyA', 'ArrowLeft']);
const RIGHT = new Set(['KeyD', 'ArrowRight']);
const UP = new Set(['KeyW', 'ArrowUp']);
const DOWN = new Set(['KeyS', 'ArrowDown']);

export class Keyboard {
  constructor() {
    this.down = new Set();
    this.ab = 0;
    this.dr = 0;
    this.onEscape = null;
    addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      if (e.code === 'Escape') { this.onEscape?.(); return; }
      if (e.code === 'Space') { if (!e.repeat) this.ab++; e.preventDefault(); }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { if (!e.repeat) this.dr++; e.preventDefault(); }
      if (LEFT.has(e.code) || RIGHT.has(e.code) || UP.has(e.code) || DOWN.has(e.code)) e.preventDefault();
      this.down.add(e.code);
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
  }

  any(set) {
    for (const c of set) if (this.down.has(c)) return true;
    return false;
  }

  read() {
    let mx = (this.any(RIGHT) ? 1 : 0) - (this.any(LEFT) ? 1 : 0);
    let my = (this.any(DOWN) ? 1 : 0) - (this.any(UP) ? 1 : 0);
    if (mx && my) { mx *= Math.SQRT1_2; my *= Math.SQRT1_2; }
    return { mx, my, ab: this.ab, dr: this.dr };
  }
}

function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && e.code !== 'Escape';
}
