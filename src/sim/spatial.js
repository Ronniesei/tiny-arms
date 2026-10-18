// Uniform-grid spatial hash for circle entities ({x, y, r}). Rebuilt every tick.

export class SpatialHash {
  constructor(cell = 80) {
    this.cell = cell;
    /** @type {Map<number, any[]>} */
    this.cells = new Map();
    this.used = [];
    this.maxR = 0;
  }

  clear() {
    for (const a of this.used) a.length = 0;
    this.used.length = 0;
    this.maxR = 0;
  }

  key(cx, cy) {
    return (cx + 512) * 4096 + (cy + 512);
  }

  insert(e) {
    if (e.r > this.maxR) this.maxR = e.r;
    const k = this.key(Math.floor(e.x / this.cell), Math.floor(e.y / this.cell));
    let a = this.cells.get(k);
    if (!a) { a = []; this.cells.set(k, a); }
    if (a.length === 0) this.used.push(a);
    a.push(e);
  }

  /**
   * Entities whose circle overlaps the query circle.
   * @param {number} x @param {number} y @param {number} r
   * @param {any[]} [out]
   */
  query(x, y, r, out = []) {
    const c = this.cell;
    const pad = this.maxR;
    const x0 = Math.floor((x - r - pad) / c), x1 = Math.floor((x + r + pad) / c);
    const y0 = Math.floor((y - r - pad) / c), y1 = Math.floor((y + r + pad) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const a = this.cells.get(this.key(cx, cy));
        if (!a || a.length === 0) continue;
        for (const e of a) {
          const dx = e.x - x, dy = e.y - y, rr = r + (e.r || 0);
          if (dx * dx + dy * dy <= rr * rr) out.push(e);
        }
      }
    }
    return out;
  }
}
