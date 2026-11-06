// ---------- the foreground frame: boughs, broad leaves and swaying vines round the screen edge ----------
// Fixed to the screen like a window onto the village. Close to the eye, so darker, with a sunlit rim,
// and kept to the edges so the middle of the scene stays clear.

import { FB, H, W, hash, lerp, mat } from './fb.js';
import { flower, foliage } from './scenery.js';
export const FRAME = { pal: [[12, 24, 16], [26, 50, 30], [46, 82, 44], [118, 158, 78]], bark: [50, 36, 28], vine: [26, 46, 28] };
export const BOUGH_L = [-10, 46, 84, -2, 10], BOUGH_R = [W + 10, 56, W - 96, -3, 12];
export const boughAt = ([x0, y0, x1, y1, bend], f) => [lerp(x0, x1, f), lerp(y0, y1, f) - Math.sin(Math.PI * f) * bend];
export const boughY = (b, x) => boughAt(b, (x - b[0]) / (b[2] - b[0]))[1];
/** A broad leaf: tapering blade with a midrib, a lit and a shaded half, a sunlit edge and monstera-like slits. */
export function leafBlade(fb, x, y, ang, len, wid, pal, seed, slits = true) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  for (let s = 0; s <= len; s += 0.5) {
    const f = s / len, w = wid * Math.sin(Math.PI * Math.pow(f, 0.75)), cx = x + ca * s, cy = y + sa * s + f * f * len * 0.22;  // the tip arches down
    for (let k = -w; k <= w; k += 0.5) {
      if (slits && f > 0.25 && Math.abs(k) > w * 0.45 && Math.floor(s * 2 + (k < 0 ? 0 : 3)) % 7 === 0) continue;
      const px = cx - sa * k, py = cy + ca * k, up = k < 0, edge = Math.abs(k) > w - 0.8;
      let c = Math.abs(k) < 0.5 ? pal[0] : up ? pal[2] : pal[1];
      if (edge && up) c = pal[3]; else if (hash(px | 0, py | 0, seed) < 0.1) c = pal[0];
      fb.put(px, py, c);
    }
  }
}
export function buildFrame() {
  const fr = new FB(W, H); fr.d.fill(0);
  const pal = FRAME.pal, bark = mat(FRAME.bark, { rim: 0.7 });
  const bough = (b, r0, r1) => { for (let i = 0; i < 14; i++) { const p0 = boughAt(b, i / 14), p1 = boughAt(b, (i + 1) / 14); fr.cap(p0[0], p0[1], p1[0], p1[1], lerp(r0, r1, i / 14), lerp(r0, r1, (i + 1) / 14), bark); } };
  for (const [b, side] of [[BOUGH_L, 1], [BOUGH_R, -1]]) {
    for (let i = 0; i < 5; i++) { const [x, y] = boughAt(b, 0.2 + i * 0.16); foliage(fr, x, y - 2, 7 + hash(i, side, 8) * 4, 4 + hash(i, side, 9) * 2, pal, 90 + i + side * 7); }   // leaf clumps along the bough
    bough(b, 7, 2);
    for (let i = 0; i < 16; i++) { const [x, y] = boughAt(b, 0.1 + i * 0.05); if (hash(i, side, 3) < 0.7) fr.put(x, y - 4 - hash(i, side, 4) * 2, pal[2]); }   // moss on the top of the bough
    const tw = boughAt(b, 0.45);                                                                     // a drooping side twig
    fr.cap(tw[0], tw[1], tw[0] + side * 26, tw[1] + 4, 1.4, 0.6, bark);
    for (let i = 0; i < 6; i++) { const f = 0.15 + i * 0.13, [x, y] = boughAt(b, f); leafBlade(fr, x, y + 1, Math.PI / 2 - side * (0.6 + hash(i, side, 5) * 0.5), 9 + hash(i, side, 6) * 7, 2.6 + hash(i, side, 7), pal, 30 + i, false); }
    const X = x => side > 0 ? x : W - x;
    foliage(fr, X(-2), 6, 22, 13, pal, 11 + side); foliage(fr, X(24), -2, 16, 8, pal, 21 + side); foliage(fr, X(50), -4, 13, 6, pal, 31 + side); foliage(fr, X(-5), 32, 9, 15, pal, 41 + side);
    for (const [y, a, len] of [[58, 0.25, 20], [84, 0.05, 15]]) leafBlade(fr, X(-3), y, side > 0 ? a : Math.PI - a, len, 5, pal, 51 + side + y);   // big leaves reaching in from the side
    for (const [a, len, w] of [[-1.3, 44, 7], [-1.0, 40, 7.5], [-0.7, 34, 6.5], [-0.42, 28, 5.5], [-0.15, 20, 4.5]])   // broad leaves rising from the bottom corners
      leafBlade(fr, X(-4), H + 4, side > 0 ? a : Math.PI - a, len, w, pal, 61 + side + len);
  }
  for (let x = 86; x < W - 96; x += 9) if (hash(x, 70) < 0.6) foliage(fr, x + hash(x, 71) * 5, -3, 4 + hash(x, 72) * 3, 3 + hash(x, 73) * 1.5, pal, 80 + x);  // a fringe of leaf tips along the top
  for (const [x, y, k] of [[8, 12, 'hibiscus'], [30, 4, 'plumeria'], [W - 12, 14, 'hibiscus'], [W - 34, 5, 'orchid'], [14, H - 18, 'bird'], [W - 16, H - 20, 'heliconia']]) flower(fr, x, y, k, true);
  return fr;
}
// vines hang from the boughs and sway in the breeze, the tip moving most
export const FRAME_VINES = [[BOUGH_L, 12, 52], [BOUGH_L, 30, 66], [BOUGH_L, 58, 34], [BOUGH_R, W - 14, 46], [BOUGH_R, W - 40, 72], [BOUGH_R, W - 70, 30]];
export function drawVines(fb, t) {
  FRAME_VINES.forEach(([b, ax, len], i) => {
    let x = ax, y = boughY(b, ax) + 2; const ph = i * 1.9, A = 0.08 + (i % 3) * 0.03;
    for (let s = 0; s < len; s++) {
      const f = s / len, a = A * Math.sin(t * 0.8 + ph - f * 1.8) * (0.25 + f) + 0.03 * f * Math.sin(t * 2.1 + ph + f * 5);
      x += Math.sin(a); y += Math.cos(a);
      fb.put(x, y, FRAME.vine);
      if (s % 4 === 2 && s > 3) { const d = (s >> 2) & 1 ? 1 : -1; fb.put(x + d, y, FRAME.pal[2]); fb.put(x + d * 2, y + 1, FRAME.pal[2]); fb.put(x + d, y + 1, FRAME.pal[1]); if (d < 0) fb.put(x + d * 2, y, FRAME.pal[3]); }
    }
    if (i % 3 === 1) flower(fb, x, y + 1, 'orchid');
  });
}
