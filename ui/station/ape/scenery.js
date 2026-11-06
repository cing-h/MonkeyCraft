// MonkeyCraft ape village: scenery painters (leaf clumps, canopies, bark, palms, bananas, flowers, bushes, ferns).

import { hash, lerp, mat } from './fb.js';
import { C } from './cast.js';

// ---------- scenery painters ----------
export const GREENS = {
  canopy: [[24, 52, 34], [40, 82, 44], [66, 116, 52], [110, 156, 70]],
  jungle: [[22, 60, 44], [34, 90, 56], [58, 126, 64], [104, 168, 84]],
  palm: [[28, 66, 36], [50, 104, 46], [86, 142, 58], [140, 186, 84]],
  banana: [[44, 90, 40], [76, 132, 52], [118, 172, 70], [170, 210, 104]]
};
export const noise1 = (x, s) => { const i = Math.floor(x), f = x - i, a = hash(i, s), b = hash(i + 1, s); return a + (b - a) * f * f * (3 - 2 * f); };
/** A clump of leaves: jagged edge, lit from the upper left, speckled with leaf texture. pal = [dark, mid, light, highlight]. */
export function foliage(fb, cx, cy, rx, ry, pal, seed = 0, rough = 1) {
  const e = Math.max(rx, ry) * 1.25 + 1, ox = fb.ox;
  for (let y = Math.floor(cy - e); y <= Math.ceil(cy + e); y++) for (let x = Math.floor(cx - e); x <= Math.ceil(cx + e); x++) {
    const u = (x + 0.5 - cx) / rx, v = (y + 0.5 - cy) / ry, d = Math.hypot(u, v), ang = Math.atan2(v, u);
    const edge = 1 + rough * (0.16 * (noise1((ang + Math.PI) * 4.2, seed) - 0.5) * 2 + 0.09 * (noise1((ang + Math.PI) * 11, seed + 1) - 0.5) * 2);
    if (d > edge) continue;
    const lit = -u * 0.45 - v * 0.75 + 0.25 + (1 - d) * 0.25, cell = hash(x >> 1, y >> 1, seed + 7), px = hash(x, y, seed + 9);
    let val = lit + (cell - 0.5) * 0.55 * rough + (px - 0.5) * 0.18;
    if (d > edge - 0.12) val -= 0.25;                       // darker rim of the clump
    const i = val > 0.55 ? 3 : val > 0.18 ? 2 : val > -0.25 ? 1 : 0;
    fb.put(x - ox, y, (i === 3 && px > 0.55) ? pal[2] : pal[i]);
  }
}
/** A canopy: clusters of clumps, dark ones behind, lit ones in front. */
export function canopy(fb, cx, cy, w, h, pal, seed, n = 12) {
  const dark = pal.map(c => c.map(v => v * 0.72));
  for (let i = 0; i < n; i++) { const a = hash(i, seed, 1), b = hash(i, seed, 2); foliage(fb, cx + (a - 0.5) * w, cy + (b - 0.3) * h * 0.6, w * (0.16 + hash(i, seed, 3) * 0.1), h * (0.2 + hash(i, seed, 4) * 0.12), dark, seed + i, 1); }
  for (let i = 0; i < n; i++) { const a = hash(i, seed, 5), b = hash(i, seed, 6); foliage(fb, cx + (a - 0.5) * w * 0.85, cy + (b - 0.5) * h * 0.6, w * (0.13 + hash(i, seed, 7) * 0.09), h * (0.17 + hash(i, seed, 8) * 0.1), pal, seed + 40 + i, 1); }
}
/** Bark: a trunk with vertical streaks. */
export function trunk(fb, x, y0, y1, r0, r1, tone = C.bark, seed = 0) {
  const m = mat(tone, { rim: 0.4 });
  fb.cap(x, y0, x, y1, r1, r0, m);
  for (let k = 0; k < r0 * 1.6; k++) { const sx = x + (hash(k, seed, 1) - 0.5) * r0 * 1.4; for (let y = y0; y < y1; y++) if (hash(Math.floor(sx), y >> 2, seed) < 0.55 && Math.abs(sx - x) < lerp(r1, r0, (y - y0) / (y1 - y0)) - 0.6) fb.put(sx - fb.ox, y, m.s); }
}
export function palm(fb, x, base, h, bend, seed, pal = GREENS.palm, scale = 1) {
  let px = x, py = base, ang = -Math.PI / 2 + bend * 0.25;
  const segs = Math.round(h / 3), ring = mat([128, 100, 70], { rim: 0.5 }), ring2 = mat([96, 74, 52], { rim: 0.4 });
  for (let i = 0; i < segs; i++) {
    ang += bend * 0.04; const nx = px + Math.cos(ang) * 3, ny = py + Math.sin(ang) * 3, r = lerp(2.2, 1.3, i / segs) * scale;
    fb.cap(px, py, nx, ny, r, r, i & 1 ? ring : ring2); px = nx; py = ny;
  }
  const fronds = 8;
  for (let f = 0; f < fronds; f++) {
    let a = -Math.PI + (f / (fronds - 1)) * Math.PI + (hash(f, seed) - 0.5) * 0.3, fx = px, fy = py;
    const len = (14 + hash(f, seed, 2) * 6) * scale, droop = 0.07 + hash(f, seed, 3) * 0.05;
    for (let s = 0; s < len; s++) {
      a += droop * Math.cos(a) * (a < -Math.PI / 2 ? -1 : 1) * 0.0 + droop * (Math.cos(a) > 0 ? 1 : -1) * 0.35;
      const nx = fx + Math.cos(a), ny = fy + Math.sin(a) + s * droop * 0.08;
      fb.put(nx - fb.ox, ny, pal[1]);
      const ll = (1 - s / len) * 4.5 * scale + 1;          // leaflets, swept toward the tip
      for (const side of [-1, 1]) for (let k = 1; k < ll; k++) {
        const lx = nx + Math.cos(a + side * 1.9) * k * 0.8, ly = ny + Math.sin(a + side * 1.9) * k * 0.8 + k * 0.35;
        fb.put(lx - fb.ox, ly, side < 0 ? pal[2] : (k > ll - 1.5 ? pal[0] : pal[1]));
      }
      fx = nx; fy = ny;
    }
  }
  for (let k = 0; k < 3; k++) fb.ell(px + (k - 1) * 1.6, py + 1.5, 1.2, 1.2, mat([110, 80, 40]));  // coconuts
}
export function banana(fb, x, base, seed, s = 1) {
  fb.cap(x, base, x, base - 12 * s, 1.6 * s, 1.2 * s, mat([96, 122, 56]));
  for (let i = 0; i < 5; i++) {
    const side = i % 2 ? 1 : -1, a = -Math.PI / 2 + side * (0.5 + hash(i, seed) * 0.7), len = (11 + hash(i, seed, 2) * 5) * s;
    const cx = x + Math.cos(a) * len * 0.5, cy = base - 12 * s + Math.sin(a) * len * 0.5 + 2;
    fb.ell(cx, cy, len * 0.55, 2.6 * s, mat(GREENS.banana[1], { rim: 0.6 }), a + side * 0.25);
    for (let k = 2; k < len; k++) fb.put(x + Math.cos(a) * k * 0.95 - fb.ox, base - 12 * s + Math.sin(a) * k * 0.95 + 2 + k * 0.06 * side, GREENS.banana[0]);   // midrib
  }
}
export const FLOWER = { hibiscus: [[214, 40, 60], [255, 120, 120]], plumeria: [[250, 240, 220], [252, 206, 90]], orchid: [[200, 90, 200], [250, 170, 240]], heliconia: [[230, 60, 40], [250, 200, 60]], bird: [[255, 140, 30], [70, 110, 220]] };
export function flower(fb, x, y, kind, big = false) {
  const [c, k] = FLOWER[kind]; x -= fb.ox;
  if (kind === 'heliconia') { for (let i = 0; i < 4; i++) { fb.put(x + (i & 1 ? 1 : -1), y + i * 2, c); fb.put(x + (i & 1 ? 2 : -2), y + i * 2, k); fb.put(x, y + i * 2 + 1, [60, 110, 50]); } return; }
  if (kind === 'bird') { fb.put(x, y, c); fb.put(x + 1, y - 1, c); fb.put(x + 2, y - 1, k); fb.put(x - 1, y + 1, [60, 110, 50]); return; }
  fb.put(x, y, k); fb.put(x - 1, y, c); fb.put(x + 1, y, c); fb.put(x, y - 1, c); fb.put(x, y + 1, c);
  if (big) { fb.put(x - 1, y - 1, c); fb.put(x + 1, y + 1, c); fb.put(x + 1, y - 1, c); fb.put(x - 1, y + 1, c); }
}
export function bush(fb, x, y, w, seed, flowers = true) {
  for (let i = 0; i < 4; i++) foliage(fb, x + (hash(i, seed) - 0.5) * w, y - hash(i, seed, 2) * 4, w * 0.32, w * 0.22, GREENS.jungle, seed + i);
  if (flowers) { const kinds = ['hibiscus', 'plumeria', 'orchid', 'hibiscus', 'bird']; for (let i = 0; i < Math.round(w / 3); i++) flower(fb, x + (hash(i, seed, 5) - 0.5) * w * 1.1, y - 2 - hash(i, seed, 6) * w * 0.35, kinds[(seed + i) % kinds.length], hash(i, seed, 7) < 0.4); }
}
export function fern(fb, x, y, seed, s = 1) {
  for (let f = 0; f < 6; f++) {
    let a = -Math.PI / 2 + (f - 2.5) * 0.38, fx = x, fy = y; const len = (9 + hash(f, seed) * 6) * s;
    for (let k = 0; k < len; k++) { a += (f < 3 ? -1 : 1) * 0.05; fx += Math.cos(a); fy += Math.sin(a); fb.put(fx - fb.ox, fy, GREENS.jungle[1]); if (k % 2) { fb.put(fx - fb.ox - 1, fy + 1, GREENS.jungle[2]); fb.put(fx - fb.ox + 1, fy + 1, GREENS.jungle[0]); } }
  }
}
