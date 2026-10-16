// Ported from the frozen predecessor's pointer-tap.ts (owner decision
// 2026-10-16), types stripped.
/** Distinguish a tap from an orbit, pinch, pan, or canceled touch sequence. */
export class PointerTap {
  active = new Map();
  blocked = false;
  down(id, x, y, threshold) {
    if (this.active.size === 0) this.blocked = false;
    this.active.set(id, { x, y, threshold });
    if (this.active.size > 1) this.blocked = true;
  }
  move(id, x, y) {
    const start = this.active.get(id);
    if (start && Math.hypot(x - start.x, y - start.y) > start.threshold) this.blocked = true;
  }
  up(id, x, y) {
    this.move(id, x, y);
    const tap = this.active.has(id) && this.active.size === 1 && !this.blocked;
    this.active.delete(id);
    return tap;
  }
  cancel(id) { this.active.delete(id); this.blocked = true; }
}
