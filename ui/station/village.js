// The village: grass ground with cobbled roads and dirt lanes, one medieval
// building per crew member, the Voidwyrm's magic tower, trees and props, and
// the road graph creatures walk along.
//
// Each building has a separate LIGHTS layer (windows, beacons, runes) drawn
// every frame, lit only while its creature is working inside. The rest of the
// village is static and baked once per camera angle.

import { MAT, Vox, hash3 } from './engine.js';

export const FX = 150, FZ = 92;

// ---------- ground ----------
const COBBLE = [[0, -56, 0, 92, 7], [-150, 12, 150, 12, 6]];               // [x0, z0, x1, z1, half width]
const SQUARE = { x: 0, z: 14, r: 22 };
const DIRT = [
  [-101, -50, -101, 12, 3.5], [-78, 0, -78, 12, 3.5], [128, -56, 128, 12, 3.5], [92, 0, 92, 12, 3.5], [46, -16, 46, 12, 3],
  [-62, 75, -36, 75, 3.5], [-36, 75, -36, 12, 3.5], [56, 64, 30, 64, 3.5], [30, 64, 30, 12, 3.5],
  [70, 60, 84, 62, 2.5], [-140, 12, -146, 40, 2.5], [100, 30, 140, 50, 2]
];
function segDist(x, z, [x0, z0, x1, z1]) {
  const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz;
  const u = l2 ? Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / l2)) : 0;
  return Math.hypot(x - (x0 + u * dx), z - (z0 + u * dz));
}
const tone = (m, k) => MAT[m].rgb[Math.max(0, Math.min(4, k))];
const FLOWERS = [[242, 197, 49], [232, 230, 240], [255, 154, 208], [143, 180, 255]];

/** Ground colour at a world point on the floor (y = 0). */
export function groundRGB(x, z) {
  const vx = Math.floor(x), vz = Math.floor(z), h = hash3(vx, 0, vz), ragged = (hash3(vx, 31, vz) - 0.5) * 1.6;
  let dc = Math.hypot(x - SQUARE.x, z - SQUARE.z) - SQUARE.r;
  for (const s of COBBLE) dc = Math.min(dc, segDist(x, z, s) - s[4]);
  if (dc + ragged * 0.4 < 0) {                                  // cobbles: offset rows of 3×3 stones
    const row = Math.floor(vz / 3), gx = (((vx + (row & 1) * 2) % 3) + 3) % 3, gz = ((vz % 3) + 3) % 3;
    if (gx === 0 || gz === 0) return tone('cobble', 0 + (h > 0.6 ? 1 : 0));
    const sh = hash3(Math.floor((vx + (row & 1) * 2) / 3), 5, row);
    return tone('cobble', 2 + (sh > 0.55 ? 1 : 0) + (sh > 0.9 ? 1 : 0) - (h < 0.08 ? 1 : 0));
  }
  let dd = Infinity; for (const s of DIRT) dd = Math.min(dd, segDist(x, z, s) - s[4]);
  if (dd + ragged < 0) return h < 0.03 ? tone('cobble', 3) : tone('dirt', 2 + (h > 0.7 ? 1 : 0) - (h < 0.18 ? 1 : 0));
  if (Math.min(dc, dd) + ragged < 1.8 && h < 0.5) return tone('dirt', 1 + (h > 0.25 ? 1 : 0)); // worn edge
  const clump = hash3(Math.floor(vx / 6), 7, Math.floor(vz / 6));
  const fl = hash3(vx, 13, vz);
  if (fl < 0.0024) return FLOWERS[Math.floor(fl / 0.0006)];
  return tone('grass', 2 + (h > 0.86 ? 1 : 0) - (h < 0.16 ? 1 : 0) - (clump < 0.22 ? 1 : 0));
}

// ---------- builders ----------
function shell(v, x0, y0, z0, x1, y1, z1, mat) {
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++)
    if (x === x0 || x === x1 || y === y1 || z === z0 || z === z1) v.set(x, y, z, mat);
}
/** Stepped gable roof over a footprint; ridge runs along `along` ('x' or 'z'). Gable ends are filled with `gableMat`. */
function roof(v, { x0, x1, z0, z1, y, mat, gableMat, along = 'x', over = 1 }) {
  for (let k = 0; ; k++) {
    if (along === 'x') {
      const a = z0 - over + k, b = z1 + over - k; if (a > b) break;
      for (let x = x0 - over; x <= x1 + over; x++) { v.set(x, y + k, a, mat); v.set(x, y + k, b, mat); if (b - a <= 1) for (let z = a; z <= b; z++) v.set(x, y + k, z, mat); }
      for (let z = a + 1; z < b; z++) { v.set(x0, y + k, z, gableMat); v.set(x1, y + k, z, gableMat); }
    } else {
      const a = x0 - over + k, b = x1 + over - k; if (a > b) break;
      for (let z = z0 - over; z <= z1 + over; z++) { v.set(a, y + k, z, mat); v.set(b, y + k, z, mat); if (b - a <= 1) for (let x = a; x <= b; x++) v.set(x, y + k, z, mat); }
      for (let x = a + 1; x < b; x++) { v.set(x, y + k, z0, gableMat); v.set(x, y + k, z1, gableMat); }
    }
  }
}
/** Timber framing on a plaster box: beams at corners, every `step`, and at the base, middle and top. */
function timber(v, x0, y0, z0, x1, y1, z1, step = 7) {
  const mid = Math.round((y0 + y1) / 2);
  v.recolor((x, y, z, m) => {
    if (m !== 'plaster' || x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1) return null;
    const onX = z === z0 || z === z1, onZ = x === x0 || x === x1;
    const vert = (onX && (x - x0) % step === 0) || (onZ && (z - z0) % step === 0) || (onX && onZ);
    return (vert || y === y0 || y === y1 || y === mid) ? 'wood' : null;
  });
}
/** A window (or any light) rectangle laid into a wall: dark in the building, lit in `L`. face: 's' | 'n' | 'e' | 'w'. */
function win(v, L, face, a0, a1, y0, y1, plane, mat) {
  for (let a = a0; a <= a1; a++) for (let y = y0; y <= y1; y++) {
    const [x, z] = face === 's' || face === 'n' ? [a, plane] : [plane, a];
    v.set(x, y, z, 'hood'); L.set(x, y, z, mat);
  }
}
function door(v, x0, x1, y1, z, mat = 'wood') {
  for (let x = x0; x <= x1; x++) for (let y = 2; y <= y1; y++) v.set(x, y, z, (x === x0 || x === x1 || y === y1) ? 'char' : mat);
}
function tree(v, x, z, s = 1) {
  const h = Math.round(9 * s);
  v.box(x - 1, 0, z - 1, x, h, z, 'wood');
  v.ell(x, h + 4 * s, z, 6 * s, 4.5 * s, 6 * s, 'leaf').ell(x - 3 * s, h + 2 * s, z + 2 * s, 4 * s, 3.5 * s, 4 * s, 'leaf').ell(x + 3 * s, h + 3 * s, z - 2 * s, 4 * s, 3.5 * s, 4 * s, 'leaf');
}
function lampPost(v, x, z) { v.box(x, 0, z, x, 9, z, 'metal').box(x - 1, 10, z - 1, x + 1, 11, z + 1, 'lamp').box(x - 1, 12, z - 1, x + 1, 12, z + 1, 'metal'); }

// ---------- the buildings ----------
function smithy(v, L) {                     // Cinder Smith: stone smithy, slate roof, a chimney that throws embers
  shell(v, -96, 0, -26, -60, 22, -4, 'stone');
  roof(v, { x0: -96, x1: -60, z0: -26, z1: -4, y: 23, mat: 'slate', gableMat: 'stone' });
  shell(v, -70, 0, -22, -65, 46, -17, 'stone');
  for (let x = -69; x <= -66; x++) for (let z = -21; z <= -18; z++) { v.set(x, 46, z, 'hood'); L.set(x, 46, z, 'lava'); }
  door(v, -81, -75, 16, -4);
  win(v, L, 's', -92, -87, 8, 13, -4, 'lava'); win(v, L, 's', -69, -64, 8, 13, -4, 'lava');
  win(v, L, 'w', -20, -15, 8, 12, -96, 'lava'); win(v, L, 'e', -20, -15, 8, 12, -60, 'lava');
  v.box(-67, 0, 1, -62, 1, 3, 'metal').box(-66, 2, 1, -63, 3, 3, 'metal').box(-68, 4, 0, -61, 5, 4, 'metal');  // anvil
  v.ell(-92, 3, 0, 2.5, 3.5, 2.5, 'wood').box(-93, 6, -1, -91, 6, 1, 'water');                                    // water barrel
  return { key: 'smith', door: [-78, 0], ember: [-67.5, 47, -19.5] };
}
function archive(v, L) {                    // Bone Scribe: tall timber-framed archive with a tiled roof
  v.box(-120, 0, -78, -82, 1, -54, 'stone');
  shell(v, -120, 2, -78, -82, 30, -54, 'plaster'); timber(v, -120, 2, -78, -82, 30, -54, 6);
  roof(v, { x0: -120, x1: -82, z0: -78, z1: -54, y: 31, mat: 'tile', gableMat: 'plaster' });
  door(v, -104, -98, 17, -54);
  for (const x of [-116, -110, -92, -88]) win(v, L, 's', x, x + 2, 8, 12, -54, 'ghost');
  for (const x of [-116, -110, -104, -98, -92, -88]) win(v, L, 's', x, x + 2, 20, 25, -54, 'ghost');
  for (const z of [-74, -64]) { win(v, L, 'w', z, z + 2, 20, 25, -120, 'ghost'); win(v, L, 'e', z, z + 2, 20, 25, -82, 'ghost'); }
  v.box(-96, 13, -53, -94, 20, -53, 'paper').box(-96, 21, -53, -94, 21, -53, 'wood');                             // scroll sign
  v.box(-117, 0, -52, -113, 3, -49, 'wood').box(-116, 4, -51, -114, 4, -50, 'paper');                             // book crate
  return { key: 'scribe', door: [-101, -50] };
}
function lookout(v, L) {                    // Hollow Plate: crenellated stone lookout with a beacon
  shell(v, 116, 0, -84, 140, 54, -60, 'stone');
  for (let x = 116; x <= 140; x++) for (let z = -84; z <= -60; z++) if ((x === 116 || x === 140 || z === -84 || z === -60) && (x + z) % 2 === 0) v.box(x, 55, z, x, 57, z, 'stone');
  door(v, 125, 131, 16, -60);
  for (const [x, y] of [[120, 24], [135, 24], [128, 34], [120, 44], [135, 44]]) win(v, L, 's', x, x + 1, y, y + 5, -60, 'cyan');
  for (const y of [24, 40]) { win(v, L, 'w', -74, -73, y, y + 5, 116, 'cyan'); win(v, L, 'e', -74, -73, y, y + 5, 140, 'cyan'); }
  v.box(125, 55, -75, 131, 55, -69, 'metal');
  for (let x = 126; x <= 130; x++) for (let z = -74; z <= -70; z++) L.set(x, 56, z, 'cyan');                       // beacon fire
  v.box(137, 55, -81, 137, 74, -81, 'wood').box(131, 68, -81, 136, 73, -81, 'plume');                              // banner
  return { key: 'armor', door: [128, -56] };
}
function clockTower(v, L) {                 // Clockwork Bat: the village clock tower
  shell(v, 38, 0, -36, 54, 64, -20, 'stone');
  for (let k = 0; k <= 9; k++) shell(v, 37 + k, 65 + k, -37 + k, 55 - k, 65 + k, -19 - k, 'slate');
  v.box(45, 75, -29, 47, 77, -27, 'gold');
  const hands = new Set(); for (let y = 54; y <= 59; y++) hands.add(`46,${y}`); for (let x = 46; x <= 49; x++) hands.add(`${x},54`);
  for (let x = 39; x <= 53; x++) for (let y = 46; y <= 62; y++) {
    const d = (x - 46) ** 2 + (y - 54) ** 2;
    if (d <= 30) { if (hands.has(`${x},${y}`)) v.set(x, y, -20, 'ink'); else { v.set(x, y, -20, 'paper'); L.set(x, y, -20, 'yellow'); } }
    else if (d <= 42) v.set(x, y, -20, 'gold');
  }
  door(v, 43, 49, 14, -20);
  for (const z of [-31, -26]) { win(v, L, 'w', z, z + 1, 50, 56, 38, 'yellow'); win(v, L, 'e', z, z + 1, 50, 56, 54, 'yellow'); }
  return { key: 'bat', door: [46, -14] };
}
function weaver(v, L) {                     // Silkscript Spider: thatched cottage with a written web outside
  v.box(78, 0, -22, 106, 1, -4, 'stone');
  shell(v, 78, 2, -22, 106, 18, -4, 'plaster'); timber(v, 78, 2, -22, 106, 18, -4, 7);
  roof(v, { x0: 78, x1: 106, z0: -22, z1: -4, y: 19, mat: 'thatch', gableMat: 'plaster', over: 2 });
  door(v, 89, 95, 14, -4);
  win(v, L, 's', 81, 84, 7, 11, -4, 'rose'); win(v, L, 's', 99, 102, 7, 11, -4, 'rose');
  win(v, L, 'e', -16, -12, 7, 11, 106, 'rose');
  v.box(119, 0, -3, 120, 27, -2, 'wood').line([[106, 22, -2.5], [119.5, 27, -2.5]], 0.8, 0.8, 'wood');
  const cx = 113, cy = 13;
  for (let k = 0; k < 10; k++) { const a = k * Math.PI / 5; v.line([[cx + 0.5, cy, -2.5], [cx + 0.5 + Math.cos(a) * 6.5, cy + Math.sin(a) * 10, -2.5]], 0.6, 0.6, 'silk'); }
  for (const r of [3, 5.5]) for (let k = 0, n = Math.round(r * 7); k < n; k++) {
    const a = k / n * Math.PI * 2, x = Math.floor(cx + 0.5 + Math.cos(a) * r * 0.65), y = Math.floor(cy + Math.sin(a) * r);
    if (hash3(k, r * 10, 3) < 0.4) { v.set(x, y, -3, 'hood'); L.set(x, y, -3, 'rose'); } else v.set(x, y, -3, 'silk');
  }
  v.box(110, 0, -18, 115, 3, -14, 'thatch').box(111, 4, -17, 114, 5, -15, 'thatch');
  return { key: 'spider', door: [92, 0] };
}
function chapel(v, L) {                     // Prism Gargoyle: stone chapel with a crystal rose window
  shell(v, -74, 0, 34, -50, 26, 70, 'stone');
  roof(v, { x0: -74, x1: -50, z0: 34, z1: 70, y: 27, mat: 'slate', gableMat: 'stone', along: 'z' });
  shell(v, -66, 27, 36, -58, 44, 43, 'stone');
  for (let k = 0; k <= 4; k++) shell(v, -66 + k, 45 + k * 2, 36 + k, -58 - k, 46 + k * 2, 43 - k, 'slate');
  for (let x = -67; x <= -57; x++) for (let y = 15; y <= 25; y++) {
    const d = (x + 62) ** 2 + (y - 20) ** 2;
    if (d <= 20) { v.set(x, y, 70, 'prism'); L.set(x, y, 70, 'core'); } else if (d <= 28) v.set(x, y, 70, 'gold');
  }
  door(v, -65, -59, 12, 70);
  for (const z of [40, 50, 60]) { win(v, L, 'e', z, z + 1, 8, 18, -50, 'core'); win(v, L, 'w', z, z + 1, 8, 18, -74, 'core'); }
  return { key: 'gargoyle', door: [-62, 75] };
}
function shrine(v, L) {                     // Tide Seer: domed shrine by the pond
  const cx = 56, cz = 50, R = 10;
  for (let x = cx - R - 1; x <= cx + R; x++) for (let z = cz - R - 1; z <= cz + R; z++) {
    const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz); if (d > R) continue;
    if (d > R - 1.3) for (let y = 0; y <= 16; y++) v.set(x, y, z, y === 16 ? 'coral' : 'shell');
  }
  for (let x = cx - R; x <= cx + R; x++) for (let z = cz - R; z <= cz + R; z++) for (let y = 17; y <= 17 + R; y++) {
    const d = Math.hypot(x + 0.5 - cx, (y - 17) * 1.0, z + 0.5 - cz); if (d <= R && d > R - 1.4) v.set(x, y, z, 'prism');
  }
  v.box(cx - 1, 27, cz - 1, cx, 30, cz, 'coral');
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4 + Math.PI / 8, x = Math.floor(cx + Math.cos(a) * (R - 0.4)), z = Math.floor(cz + Math.sin(a) * (R - 0.4));
    for (let y = 5; y <= 11; y++) { v.set(x, y, z, 'hood'); L.set(x, y, z, 'tide'); }
  }
  door(v, cx - 3, cx + 2, 12, cz + R - 1);
  for (const x of [cx - 7, cx + 5]) {           // two windows facing the road, beside the door
    for (const xx of [x, x + 1]) { const z = Math.floor(cz + Math.sqrt(Math.max(0, R * R - (xx + 0.5 - cx) ** 2)) - 0.5); for (let y = 5; y <= 10; y++) { v.set(xx, y, z, 'hood'); L.set(xx, y, z, 'tide'); } }
  }
  for (let x = 78; x <= 110; x++) for (let z = 46; z <= 76; z++) {              // the pond
    const d = Math.hypot(x + 0.5 - 94, (z + 0.5 - 61) * 1.15); if (d > 15) continue;
    if (d > 13) v.box(x, 0, z, x, hash3(x, 3, z) < 0.35 ? 1 : 0, z, 'stone');
    else v.set(x, 0, z, hash3(x, 4, z) < 0.04 ? 'moss' : 'water');
  }
  for (const [x, z] of [[82, 52], [106, 66], [86, 72]]) v.line([[x, 1, z], [x + 0.5, 5, z - 0.5]], 0.8, 0.4, 'coral');
  return { key: 'seer', door: [56, 64], pond: [94, 61] };
}
function magicTower(v, L) {                 // the Voidwyrm's tower
  const cz = -70, top = 62;
  for (let y = 0; y <= top; y++) {
    const R = 13 - (y / top) * 2, ring = (y === 16 || y === 34 || y === 52);
    for (let x = -14; x <= 14; x++) for (let z = cz - 14; z <= cz + 14; z++) {
      const d = Math.hypot(x + 0.5, z + 0.5 - cz); if (d > R || d < R - 1.4) continue;
      if (ring) { v.set(x, y, z, 'hood'); L.set(x, y, z, 'violet'); } else v.set(x, y, z, 'tower');
    }
  }
  for (let k = 0; k < 7; k++) {                   // spiral of slit windows
    const y = 6 + k * 8, a = k * 0.9 + Math.PI / 2, R = 13 - (y / top) * 2;
    for (let dy = 0; dy < 4; dy++) { const x = Math.floor(Math.cos(a) * (R - 0.5)), z = Math.floor(cz + Math.sin(a) * (R - 0.5)); v.set(x, y + dy, z, 'hood'); L.set(x, y + dy, z, 'violet'); }
  }
  for (let x = -16; x <= 15; x++) for (let z = cz - 16; z <= cz + 15; z++) {
    const d = Math.hypot(x + 0.5, z + 0.5 - cz); if (d > 15.5) continue;
    v.set(x, top + 1, z, 'tower'); v.set(x, top + 2, z, 'tower');
    if (d > 14 && (Math.floor(Math.atan2(z + 0.5 - cz, x + 0.5) * 6) & 1)) v.box(x, top + 3, z, x, top + 4, z, 'tower');
  }
  for (const a of [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]) {
    const x = Math.cos(a) * 13.8, z = cz + Math.sin(a) * 13.8;
    const sp = new Vox().line([[x, top + 3, z], [x + 0.3, top + 10, z]], 1.2, 0.4, 'violet');
    for (const [px, py, pz] of sp.m.values()) { v.set(px, py, pz, 'hood'); L.set(px, py, pz, 'violet'); }
  }
  for (let x = -4; x <= 3; x++) for (let y = 1; y <= 17; y++) {    // arched door
    if (y > 14 && Math.abs(x + 0.5) > 3.5 - (y - 14)) continue;
    v.set(x, y, cz + 12, (Math.abs(x + 0.5) > 3 || y === 17) ? 'char' : 'wood');
  }
  return { key: 'voidwyrm', door: [0, -52], perch: [0, top + 3, cz] };
}

/** Everything static, plus per-building light layers. */
export function buildVillage() {
  const v = new Vox(), lights = {}, sites = {};
  for (const fn of [smithy, archive, lookout, clockTower, weaver, chapel, shrine, magicTower]) {
    const bv = new Vox(), L = new Vox(), info = fn(bv, L);
    sites[info.key] = { ...info, vox: bv, lights: L };
  }
  // trees, lamps, the well, hay, fences
  const props = new Vox();
  for (const [x, z, s] of [[-140, -86, 1.1], [-138, -40, 1], [-136, 32, 1.2], [-128, 66, 1], [-104, 40, 0.9], [-98, 78, 1.1], [-22, -84, 1], [26, -86, 1.2],
    [-42, -64, 0.9], [36, -62, 0.8], [70, -50, 1], [142, -30, 1], [142, 38, 1.1], [124, 84, 1], [18, 80, 0.9], [-20, 84, 1], [-142, 84, 1], [-122, -12, 0.8], [-30, -36, 0.9], [22, -34, 0.8], [146, 70, 0.8]])
    tree(props, x, z, s);
  for (const [x, z] of [[-11, -40], [11, -40], [-11, 40], [11, 70], [-50, 20], [50, 20], [-118, 20], [110, 20]]) lampPost(props, x, z);
  for (let x = -18; x <= -9; x++) for (let z = 3; z <= 12; z++) { const d = Math.hypot(x + 0.5 + 13.5, z + 0.5 - 7.5); if (d <= 4.6 && d > 3.2) props.box(x, 0, z, x, 3, z, 'stone'); else if (d <= 3.2) props.set(x, 0, z, 'water'); }
  props.box(-18, 4, 7, -18, 10, 7, 'wood').box(-9, 4, 7, -9, 10, 7, 'wood').box(-19, 11, 5, -8, 11, 10, 'tile');
  for (const [x, z] of [[-106, -18], [-108, -12]]) props.box(x, 0, z, x + 4, 3, z + 3, 'thatch');
  for (let x = 76; x <= 112; x += 4) props.box(x, 0, 80, x, 4, 80, 'wood');
  props.box(76, 3, 80, 112, 3, 80, 'wood');
  for (const s of Object.values(sites)) for (const [x, y, z, m] of s.vox.m.values()) v.set(x, y, z, m);
  // the island's edge: dirt then stone
  const rim = new Vox();
  for (let x = -FX; x < FX; x++) for (let y = -8; y <= -1; y++) { const m = y >= -2 ? 'dirt' : 'stone'; rim.set(x, y, -FZ, m); rim.set(x, y, FZ - 1, m); }
  for (let z = -FZ; z < FZ; z++) for (let y = -8; y <= -1; y++) { const m = y >= -2 ? 'dirt' : 'stone'; rim.set(-FX, y, z, m); rim.set(FX - 1, y, z, m); }
  return { sites, props, rim };
}

// ---------- the road graph ----------
export const NODES = {
  T: [0, -54], N1: [0, -20], C: [0, 14], S1: [0, 50], S2: [0, 86],
  W1: [-36, 12], W2: [-78, 12], W3: [-101, 12], W4: [-140, 12],
  E1: [30, 12], E2: [46, 12], E3: [92, 12], E4: [128, 12], E5: [146, 12],
  smith: [-78, 0], scribe: [-101, -50], armor: [128, -56], spider: [92, 0], bat: [46, -14],
  CH1: [-36, 75], gargoyle: [-62, 75], SE1: [30, 64], seer: [56, 64]
};
const EDGES = [['T', 'N1'], ['N1', 'C'], ['C', 'S1'], ['S1', 'S2'], ['C', 'W1'], ['W1', 'W2'], ['W2', 'W3'], ['W3', 'W4'], ['C', 'E1'], ['E1', 'E2'], ['E2', 'E3'], ['E3', 'E4'], ['E4', 'E5'],
  ['W2', 'smith'], ['W3', 'scribe'], ['E4', 'armor'], ['E3', 'spider'], ['E2', 'bat'], ['W1', 'CH1'], ['CH1', 'gargoyle'], ['E1', 'SE1'], ['SE1', 'seer']];
export const ROAD_NODES = ['T', 'N1', 'C', 'S1', 'S2', 'W1', 'W2', 'W3', 'W4', 'E1', 'E2', 'E3', 'E4', 'E5'];
const ADJ = {}; for (const [a, b] of EDGES) { (ADJ[a] ||= []).push(b); (ADJ[b] ||= []).push(a); }
export const neighbours = n => ADJ[n] || [];

export function nearestNode(x, z, only) {
  let best = null, bd = Infinity;
  for (const [k, [nx, nz]] of Object.entries(NODES)) { if (only && !only.includes(k)) continue; const d = Math.hypot(nx - x, nz - z); if (d < bd) { bd = d; best = k; } }
  return best;
}
/** Shortest list of nodes from `from` to `to` (breadth-first), excluding `from`. */
export function route(from, to) {
  if (from === to) return [to];
  const prev = { [from]: null }, q = [from];
  while (q.length) {
    const n = q.shift();
    for (const m of neighbours(n)) if (!(m in prev)) { prev[m] = n; if (m === to) { const out = [m]; let p = n; while (p !== from) { out.unshift(p); p = prev[p]; } return out; } q.push(m); }
  }
  return [to];
}
