// MonkeyCraft ape village: a tiny software framebuffer and lit materials.
// No anti-aliasing; painter's order; every pixel can carry a pick id.

export const W = 320, H = 180, WORLD = 960, GROUND = 110;
// The world is three stories tall: the ground village (world y 0..180), Canopy 1 (−180..0) and Canopy 2 (−360..−180).
export const TOP = -2 * H;
export const STORIES = [{ name: 'Ground', camY: 0 }, { name: 'Canopy 1', camY: -H }, { name: 'Canopy 2', camY: -2 * H }];
export const FOG = [126, 146, 140], SUN = [255, 214, 158];
export const lerp = (a, b, t) => a + (b - a) * t;
export const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const hash = (x, y, z = 0) => { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1440662683); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
export const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
export const bayer = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];

/** A lit material: shadow, base, light, and a sunlit rim. */
export function mat(base, { rim = 0.55, cool = 0.12 } = {}) {
  const s = [base[0] * 0.5, base[1] * 0.52, base[2] * 0.58 + 10 * cool];
  const l = [Math.min(255, base[0] * 1.28 + 8), Math.min(255, base[1] * 1.25 + 8), Math.min(255, base[2] * 1.18 + 6)];
  return { s, b: base, l, r: mixc(base, SUN, rim) };
}
export const K = (() => { const v = [-0.25, -0.55, 0.8], n = Math.hypot(...v); return v.map(x => x / n); })();
export const R = (() => { const v = [-0.75, -0.5, -0.42], n = Math.hypot(...v); return v.map(x => x / n); })();
export function shade(m, nx, ny, nz) {
  if (nx * R[0] + ny * R[1] + nz * R[2] > 0.22) return m.r;
  const k = nx * K[0] + ny * K[1] + nz * K[2];
  return k > 0.74 ? m.l : k > 0.28 ? m.b : m.s;
}

// ---------- a tiny software framebuffer (no anti-aliasing, painter's order) ----------
export class FB {
  constructor(w, h, oy = 0) { this.w = w; this.h = h; this.oy = oy;   // oy: the world y of row 0 (the camera height, for the screen)
    this.d = new Uint8ClampedArray(w * h * 4); this.id = new Int16Array(w * h).fill(-1); this.fog = 0; this.fogc = FOG; this.ox = 0; this.pid = -1; }
  put(x, y, c) {
    x |= 0; y = Math.floor(y - this.oy); if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x), o = i * 4, f = this.fog;
    this.d[o] = f ? lerp(c[0], this.fogc[0], f) : c[0]; this.d[o + 1] = f ? lerp(c[1], this.fogc[1], f) : c[1]; this.d[o + 2] = f ? lerp(c[2], this.fogc[2], f) : c[2]; this.d[o + 3] = 255;
    this.id[i] = this.pid;
  }
  add(x, y, c, a) {
    x |= 0; y = Math.floor(y - this.oy); if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 4; this.d[o] += c[0] * a; this.d[o + 1] += c[1] * a; this.d[o + 2] += c[2] * a;
  }
  rect(x0, y0, x1, y1, c) { for (let y = Math.max(this.oy, Math.floor(y0)); y < Math.min(this.oy + this.h, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0 - this.ox)); x < Math.min(this.w, Math.ceil(x1 - this.ox)); x++) this.put(x, y, c); }
  /** filled polygon (flat colour) */
  poly(pts, c) {
    let y0 = Infinity, y1 = -Infinity; for (const p of pts) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    for (let y = Math.max(this.oy, Math.floor(y0)); y <= Math.min(this.oy + this.h - 1, Math.ceil(y1)); y++) {
      const yc = y + 0.5, xs = [];
      for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; if ((a[1] <= yc) !== (b[1] <= yc)) xs.push(a[0] + (yc - a[1]) / (b[1] - a[1]) * (b[0] - a[0])); }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.ceil(xs[k] - 0.5 - this.ox); x <= Math.floor(xs[k + 1] - 0.5 - this.ox); x++) this.put(x, y, c);
    }
  }
  /** lit ellipse; rot in radians */
  ell(cx, cy, rx, ry, m, rot = 0) {
    cx -= this.ox; const c = Math.cos(rot), s = Math.sin(rot), e = Math.max(rx, ry) + 1;
    for (let y = Math.floor(cy - e); y <= Math.ceil(cy + e); y++) for (let x = Math.floor(cx - e); x <= Math.ceil(cx + e); x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, u = (dx * c + dy * s) / rx, v = (-dx * s + dy * c) / ry, d = u * u + v * v;
      if (d > 1) continue;
      this.put(x, y, m.s ? shade(m, u * c - v * s, u * s + v * c, Math.sqrt(1 - d)) : m);
    }
  }
  /** lit capsule from A to B with radii r0 → r1 */
  cap(ax, ay, bx, by, r0, r1, m) {
    ax -= this.ox; bx -= this.ox;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-6, e = Math.max(r0, r1) + 1;
    for (let y = Math.floor(Math.min(ay, by) - e); y <= Math.ceil(Math.max(ay, by) + e); y++) for (let x = Math.floor(Math.min(ax, bx) - e); x <= Math.ceil(Math.max(ax, bx) + e); x++) {
      const px = x + 0.5 - ax, py = y + 0.5 - ay, t = Math.max(0, Math.min(1, (px * dx + py * dy) / l2)), r = r0 + (r1 - r0) * t;
      const ox = px - t * dx, oy = py - t * dy, dd = Math.hypot(ox, oy);
      if (dd > r) continue;
      const q = dd / r; this.put(x, y, m.s ? shade(m, ox / (dd || 1) * q, oy / (dd || 1) * q, Math.sqrt(Math.max(0, 1 - q * q))) : m);
    }
  }
}
