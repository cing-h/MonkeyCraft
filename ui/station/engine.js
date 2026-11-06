// AutoCraft voxel engine: materials, voxel models, and a 55° orthographic
// renderer with a z-buffer, 5-tone face lighting, a 1px inner outline, and glow
// only for lights that belong to working creatures.
// Ported from the art-direction page (artifact 9FoPZGP6EqqC553pVZKsnc).
// No DOM access beyond the canvas handed to View.

const DEG = Math.PI / 180, PHI = 55 * DEG, SP = Math.sin(PHI), CP = Math.cos(PHI);
const Lw = (() => { const v = [-0.45, 1, 0.6], n = Math.hypot(...v); return v.map(x => x / n); })();

// ---------- materials (ramp: dark -> light) ----------
const MAT = {
  obsidian: { r: ['#0d0a15', '#1b1429', '#2b2042', '#433366', '#66529a'], n: 0.12 },
  belly:    { r: ['#1c1426', '#2f2340', '#4a3a5f', '#6b5a84', '#9483ad'], n: 0.1 },
  membrane: { r: ['#140a22', '#241238', '#371b55', '#50287c', '#6f3fab'], n: 0.05 },
  horn:     { r: ['#2a2433', '#4a4158', '#756a86', '#a69bb6', '#d8cfe4'], n: 0 },
  stone:    { r: ['#100d15', '#1d1925', '#2b2537', '#3e364e', '#5a506c'], n: 0.35 },
  floor:    { r: ['#0f0d14', '#1a1721', '#25212e', '#2f2a3a', '#3b3548'], n: 0 },
  moss:     { r: ['#0c1812', '#142b20', '#1d4030', '#2a5a43', '#3f7c5a'], n: 0.35 },
  steel:    { r: ['#13171d', '#262d36', '#424c58', '#6f7c8a', '#b2bfcb'], n: 0.04 },
  gold:     { r: ['#2a1e08', '#5a3f10', '#97701c', '#d1a83a', '#f6dc86'], n: 0 },
  plume:    { r: ['#24080c', '#4a1118', '#7a1c26', '#ad2f39', '#d9555a'], n: 0.1 },
  hood:     { r: ['#050509', '#060609', '#08080c', '#0a0a10', '#0c0c13'], n: 0 },
  rock:     { r: ['#16100e', '#261c18', '#3a2b25', '#534036', '#735c4c'], n: 0.25 },
  char:     { r: ['#0c0908', '#151010', '#1f1817', '#2b2220', '#3a2f2c'], n: 0.15 },
  leather:  { r: ['#190f0a', '#2d1b11', '#462f1e', '#65452c', '#896241'], n: 0.15 },
  wood:     { r: ['#1a100a', '#2e1d12', '#4a301d', '#6a472b', '#8f623c'], n: 0.3 },
  paper:    { r: ['#3a3328', '#5a5040', '#857a62', '#b5a988', '#ddd3b3'], n: 0.1 },
  metal:    { r: ['#181c22', '#2a3038', '#434c57', '#66717d', '#95a0ab'], n: 0.05 },
  crystal:  { r: ['#07222a', '#0c3c47', '#126472', '#249dab', '#7de2e5'], n: 0.15 },
  prism:    { r: ['#061a22', '#0a2e38', '#0f4a58', '#18707f', '#3aa3ad'], n: 0.1 },
  violet:   { r: ['#3c1d5c', '#6b34a3', '#a556f2', '#d39bff', '#f6e3ff'], e: 1 },
  cyan:     { r: ['#103b45', '#1f6f7d', '#38c3cf', '#8ff3f2', '#e6fffd'], e: 1 },
  lava:     { r: ['#4a150a', '#8f2a10', '#ef5a1d', '#ffa64a', '#ffe7a6'], e: 1 },
  yellow:   { r: ['#4a3a0a', '#8f7414', '#f2c531', '#ffe683', '#fffbe0'], e: 1 },
  core:     { r: ['#1d5a55', '#3aa7a0', '#7fffee', '#c8fff8', '#ffffff'], e: 1 },
  bone:     { r: ['#2b2620', '#544c3e', '#8a8068', '#bfb497', '#e9e0c8'], n: 0.1 },
  ink:      { r: ['#07080f', '#0d1020', '#151a33', '#1f2647', '#2c365e'], n: 0 },
  robe:     { r: ['#1a0b0d', '#2e1418', '#4a2128', '#6a333b', '#8f4a52'], n: 0.15 },
  chitin:   { r: ['#0b0f0e', '#141c1a', '#1f2b28', '#2f403b', '#465c55'], n: 0.12 },
  silk:     { r: ['#3a3a44', '#5f5f6e', '#8f8fa0', '#c3c3d2', '#ececf5'], n: 0.05 },
  kelp:     { r: ['#061418', '#0b222a', '#11353f', '#1a4c59', '#286b78'], n: 0.25 },
  coral:    { r: ['#2c0f0c', '#5a1e17', '#94352a', '#cf5a44', '#f28e6f'], n: 0.1 },
  shell:    { r: ['#3a2c26', '#6a5246', '#a08372', '#d1b6a0', '#f2e1cf'], n: 0.05 },
  water:    { r: ['#06121c', '#0a1f30', '#103049', '#184766', '#23628a'], n: 0.2 },
  copper:   { r: ['#2a120a', '#552414', '#8a3e22', '#bf6236', '#e8925c'], n: 0.05 },
  ghost:    { r: ['#123d26', '#1f6b41', '#3fcf7a', '#9bf5bd', '#e8fff0'], e: 1 },
  rose:     { r: ['#4a0f33', '#8a1f5e', '#e0459b', '#ff9ad0', '#ffe6f4'], e: 1 },
  tide:     { r: ['#0f1f4a', '#1c3a8f', '#3f7bff', '#9ab9ff', '#e8efff'], e: 1 }
};
const hexRGB = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
for (const m of Object.values(MAT)) m.rgb = m.r.map(hexRGB);
const hash3 = (x, y, z) => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296;
};

// ---------- voxel builder ----------
class Vox {
  constructor() { this.m = new Map(); }
  key(x, y, z) { return (x + 512) * 1048576 + (y + 512) * 1024 + (z + 512); }
  set(x, y, z, mat) { x = Math.floor(x); y = Math.floor(y); z = Math.floor(z); const k = this.key(x, y, z); if (mat == null) this.m.delete(k); else this.m.set(k, [x, y, z, mat]); return this; }
  has(x, y, z) { return this.m.has(this.key(x, y, z)); }
  box(x0, y0, z0, x1, y1, z1, mat) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) this.set(x, y, z, mat);
    return this;
  }
  ell(cx, cy, cz, rx, ry, rz, mat) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, dz = (z + 0.5 - cz) / rz;
      if (dx * dx + dy * dy + dz * dz <= 1) this.set(x, y, z, mat);
    }
    return this;
  }
  line(pts, r0, r1, mat) {
    let total = 0; const seg = [];
    for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1], pts[i + 1][2] - pts[i][2]); seg.push(l); total += l; }
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [a, b] = [pts[i], pts[i + 1]], n = Math.max(2, Math.ceil(seg[i] / 0.4));
      for (let k = 0; k <= n; k++) {
        const t = k / n, u = (acc + seg[i] * t) / (total || 1), r = r0 + (r1 - r0) * u;
        this.ell(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, r, r, r, mat);
      }
      acc += seg[i];
    }
    return this;
  }
  recolor(fn) { for (const v of this.m.values()) { const m = fn(v[0], v[1], v[2], v[3]); if (m) v[3] = m; } return this; }
  faces(skipTop) {
    const out = [], D = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]]; // -Y is never visible from above
    for (const [x, y, z, mat] of this.m.values()) for (const d of D) {
      if (skipTop && d[1] === 1) continue;
      if (this.has(x + d[0], y + d[1], z + d[2])) continue;
      const a = d[0] ? 0 : d[1] ? 1 : 2, s = d[a], b = (a + 1) % 3, c = (a + 2) % 3, base = [x, y, z];
      const pl = base[a] + (s > 0 ? 1 : 0), cs = [];
      for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { const p = [0, 0, 0]; p[a] = pl; p[b] = base[b] + u; p[c] = base[c] + v; cs.push(p[0], p[1], p[2]); }
      out.push({ c: cs, n: d, m: MAT[mat], h: hash3(x * 3 + a, y * 7 + s, z * 5) });
    }
    return out;
  }
}
const part = (name, vox, pivot, skipTop) => ({ name, pivot, faces: vox.faces(skipTop) });

// ---------- matrices ----------
const rX = a => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const rY = a => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const rZ = a => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
const mm = (A, B) => { const R = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) R[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]; return R; };
const mv = (A, v) => [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
const NO_POSE = { rx: 0, ry: 0, rz: 0, dx: 0, dy: 0, dz: 0 };

// ---------- the renderer: a 55° orthographic camera over a z-buffer ----------
class View {
  constructor(canvas, W, H, S, cx0, cy0) {
    Object.assign(this, { W, H, S, cx0, cy0 });
    canvas.width = W; canvas.height = H;
    this.ctx = canvas.getContext('2d'); this.img = this.ctx.createImageData(W, H);
    this.col = new Uint8ClampedArray(W * H * 4); this.dep = new Float32Array(W * H); this.id = new Int16Array(W * H); this.em = new Uint8Array(W * H);
    this.setYaw(0);
  }
  setYaw(y) { this.yaw = y; this.C = rY(-y); }
  clear() { this.col.fill(0); this.dep.fill(-1e9); this.id.fill(-1); this.em.fill(0); }
  snapshot() { this.base = { col: this.col.slice(), dep: this.dep.slice(), id: this.id.slice() }; }
  restore() { this.col.set(this.base.col); this.dep.set(this.base.dep); this.id.set(this.base.id); this.em.fill(0); }
  toScreen(c) { return [this.cx0 + this.S * c[0], this.cy0 + this.S * (c[2] * SP - c[1] * CP), c[2] * CP + c[1] * SP]; }
  /** World point → canvas pixel [x, y] under the current camera. */
  project(w) { const [x, y] = this.toScreen(mv(this.C, w)); return [x, y]; }
  // obj: { model, pos, facing, pose(name) }, on: true (working) | false (idle) | null (static prop)
  draw(obj, id, on, t) {
    const F = rY(obj.facing || 0);
    for (const p of obj.model.parts) {
      const ps = (obj.pose && obj.pose(p.name)) || NO_POSE;
      const Rp = mm(rY(ps.ry || 0), mm(rZ(ps.rz || 0), rX(ps.rx || 0)));
      const M = mm(F, Rp), pv = p.pivot, rpv = mv(Rp, pv);
      const tw = mv(F, [pv[0] + (ps.dx || 0) - rpv[0], pv[1] + (ps.dy || 0) - rpv[1], pv[2] + (ps.dz || 0) - rpv[2]]);
      const T = [tw[0] + obj.pos[0], tw[1] + obj.pos[1], tw[2] + obj.pos[2]];
      const A = mm(this.C, M), b = mv(this.C, T);
      this.faces(p.faces, M, A, b, id, on, t);
    }
  }
  faces(list, M, A, b, id, on, t) {
    const q = new Float64Array(8);
    for (const f of list) {
      const nw = mv(M, f.n), nc = mv(this.C, nw);
      if (nc[1] * SP + nc[2] * CP <= 0.02) continue; // faces turned away from the camera
      const mat = f.m; let tone;
      if (mat.e) {
        if (on === true) tone = 3 + ((hash3(f.h * 1e6 | 0, (t * 9) | 0, 3) > 0.5) ? 1 : 0);
        else tone = on === null ? 2 : (f.h < 0.5 ? 1 : 2);
      } else {
        const lit = 0.32 + 0.68 * Math.max(0, nw[0] * Lw[0] + nw[1] * Lw[1] + nw[2] * Lw[2]);
        tone = Math.min(4, Math.floor(lit * 5));
        if (mat.n) { if (f.h < mat.n * 0.5) tone--; else if (f.h > 1 - mat.n * 0.5) tone++; }
        tone = Math.max(0, Math.min(4, tone));
      }
      const rgb = mat.rgb[tone];
      let dsum = 0;
      for (let k = 0; k < 4; k++) {
        const x = f.c[k * 3], y = f.c[k * 3 + 1], z = f.c[k * 3 + 2];
        const cx = A[0] * x + A[1] * y + A[2] * z + b[0], cy = A[3] * x + A[4] * y + A[5] * z + b[1], cz = A[6] * x + A[7] * y + A[8] * z + b[2];
        q[k * 2] = this.cx0 + this.S * cx; q[k * 2 + 1] = this.cy0 + this.S * (cz * SP - cy * CP); dsum += cz * CP + cy * SP;
      }
      this.quad(q, dsum / 4, rgb, id, (mat.e && on === true) ? 1 : 0);
    }
  }
  quad(q, d, rgb, id, em) {
    const W = this.W, H = this.H;
    const mx = (q[0] + q[2] + q[4] + q[6]) / 4, my = (q[1] + q[3] + q[5] + q[7]) / 4;
    for (let k = 0; k < 8; k += 2) { const dx = q[k] - mx, dy = q[k + 1] - my, l = Math.hypot(dx, dy) || 1; q[k] += dx / l * 0.35; q[k + 1] += dy / l * 0.35; }
    const x0 = Math.max(0, Math.floor(Math.min(q[0], q[2], q[4], q[6]))), x1 = Math.min(W - 1, Math.ceil(Math.max(q[0], q[2], q[4], q[6])));
    const y0 = Math.max(0, Math.floor(Math.min(q[1], q[3], q[5], q[7]))), y1 = Math.min(H - 1, Math.ceil(Math.max(q[1], q[3], q[5], q[7])));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5; let pos = 0, neg = 0;
      for (let k = 0; k < 8; k += 2) {
        const ax = q[k], ay = q[k + 1], bx = q[(k + 2) % 8], by = q[(k + 3) % 8];
        const e = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
        if (e > 0) pos++; else if (e < 0) neg++;
      }
      if (pos && neg) continue;
      const i = y * W + x;
      if (d <= this.dep[i]) continue;
      this.dep[i] = d; this.id[i] = id; this.em[i] = em;
      const o = i * 4; this.col[o] = rgb[0]; this.col[o + 1] = rgb[1]; this.col[o + 2] = rgb[2]; this.col[o + 3] = 255;
    }
  }
  // a soft round shadow on the floor (id 0) or, with ground=false, painted onto empty background
  shadow(wx, wz, r, k, ground = true) {
    const c = mv(this.C, [wx, 0, wz]), [sx, sy] = this.toScreen(c), rx = r * this.S, ry = r * this.S * SP;
    for (let y = Math.max(0, Math.floor(sy - ry)); y <= Math.min(this.H - 1, Math.ceil(sy + ry)); y++)
      for (let x = Math.max(0, Math.floor(sx - rx)); x <= Math.min(this.W - 1, Math.ceil(sx + rx)); x++) {
        const u = ((x + 0.5 - sx) / rx) ** 2 + ((y + 0.5 - sy) / ry) ** 2; if (u > 1) continue;
        const i = y * this.W + x, o = i * 4, f = u < 0.45 ? k : (1 + k) / 2;
        if (ground) { if (this.id[i] !== 0) continue; this.col[o] *= f; this.col[o + 1] *= f; this.col[o + 2] *= f; }
        else if (this.id[i] === -1) { this.col.set([0, 0, 0, Math.round((1 - f) * 255)], o); }
      }
  }
  spark(w, rgb) {
    const [sx, sy, d] = this.toScreen(mv(this.C, w)), x = Math.floor(sx), y = Math.floor(sy);
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    const i = y * this.W + x; if (d <= this.dep[i]) return;
    this.col.set([rgb[0], rgb[1], rgb[2], 255], i * 4); this.em[i] = 1; this.dep[i] = d;
  }
  present() {
    const W = this.W, H = this.H, out = this.img.data; out.set(this.col);
    // 1px outline on the inside edge of every object, wherever it meets something behind it
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, me = this.id[i]; if (me <= 0) continue;
      let edge = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) { edge = true; break; }
        const j = yy * W + xx, o = this.id[j];
        if (o !== me && (o <= 0 || this.dep[j] < this.dep[i] - 0.6)) { edge = true; break; }
      }
      if (edge && !this.em[i]) { const o = i * 4; out[o] = this.col[o] * 0.3; out[o + 1] = this.col[o + 1] * 0.3; out[o + 2] = this.col[o + 2] * 0.34; }
    }
    // soft glow around lights that belong to working creatures
    let any = false; for (let i = 0; i < W * H; i++) if (this.em[i]) { any = true; break; }
    if (any) {
      const acc = new Float32Array(W * H * 3);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x; if (!this.em[i]) continue;
        const r = this.col[i * 4], g = this.col[i * 4 + 1], b = this.col[i * 4 + 2];
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
          const xx = x + dx, yy = y + dy, dd = Math.hypot(dx, dy);
          if (!dd || dd > 3 || xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const w = 0.09 / dd, j = (yy * W + xx) * 3; acc[j] += r * w; acc[j + 1] += g * w; acc[j + 2] += b * w;
        }
      }
      for (let i = 0; i < W * H; i++) {
        const a = acc[i * 3] + acc[i * 3 + 1] + acc[i * 3 + 2]; if (!a) continue;
        const o = i * 4;
        if (out[o + 3] === 0) { out[o] = acc[i * 3] * 3; out[o + 1] = acc[i * 3 + 1] * 3; out[o + 2] = acc[i * 3 + 2] * 3; out[o + 3] = Math.min(255, a * 0.9); }
        else { out[o] += acc[i * 3]; out[o + 1] += acc[i * 3 + 1]; out[o + 2] += acc[i * 3 + 2]; }
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
  }
}

// ---------- models ----------
function buildSmith() {
  const legL = new Vox().box(-4, 2, -1, -2, 7, 1, 'char').box(-4, 0, -1, -2, 1, 2, 'leather');
  const legR = new Vox().box(1, 2, -1, 3, 7, 1, 'char').box(1, 0, -1, 3, 1, 2, 'leather');
  const torso = new Vox().box(-5, 8, -2, 4, 15, 2, 'rock').box(-4, 16, -2, 3, 16, 2, 'rock').box(-5, 8, -2, 4, 8, 2, 'leather')
    .box(-3, 3, 3, 2, 14, 3, 'leather').box(-3, 15, 3, -3, 16, 3, 'leather').box(2, 15, 3, 2, 16, 3, 'leather').set(-1, 8, 3, 'gold').set(0, 8, 3, 'gold');
  for (const [x, y, z] of [[-5, 12, 0], [-5, 13, 1], [-5, 11, -1], [4, 11, -1], [4, 12, 0], [4, 14, 1], [-2, 16, -2], [1, 16, -2]]) torso.set(x, y, z, 'lava');
  const head = new Vox().ell(0, 19.5, 0, 3.2, 3.2, 3.2, 'rock').box(-2, 16, 2, 1, 17, 3, 'char').box(-2, 21, 2, 1, 21, 2, 'char');
  head.set(-2, 20, 2, 'yellow').set(1, 20, 2, 'yellow');
  for (let x = -2; x <= 1; x++) for (let z = -2; z <= 2; z++) { const h = 1 + Math.floor(hash3(x, 9, z) * 3); for (let y = 23; y < 23 + h; y++) head.set(x, y, z, 'lava'); }
  const armR = new Vox().box(5, 9, -1, 6, 15, 1, 'rock').set(6, 12, 0, 'lava').set(5, 10, 1, 'lava')
    .box(5, 8, 1, 6, 8, 5, 'leather').box(4, 7, 5, 7, 10, 7, 'metal');
  const armL = new Vox().box(-7, 9, -1, -6, 15, 1, 'rock').set(-7, 12, 1, 'lava').box(-7, 8, -1, -6, 8, 1, 'char');
  return {
    shadowR: 6.5,
    parts: [part('legL', legL, [-2.5, 8, 0]), part('legR', legR, [2.5, 8, 0]), part('torso', torso, [0, 8, 0]), part('head', head, [0, 16, 0]), part('armR', armR, [6, 15.5, 0]), part('armL', armL, [-6, 15.5, 0])],
    pose(s) {
      const sw = s.moving ? Math.sin(s.phase) : 0, bobY = s.moving ? Math.abs(sw) * 0.6 : 0;
      const strike = 0.5 + 0.5 * Math.sin(s.t * 5);
      return name => {
        switch (name) {
          case 'legL': return { rx: 0.6 * sw };
          case 'legR': return { rx: -0.6 * sw };
          case 'torso': return { dy: bobY };
          case 'head': return { dy: bobY, ry: s.work ? 0 : Math.sin(s.t * 0.7) * 0.2, rx: s.work ? 0.15 : 0 };
          case 'armL': return { dy: bobY, rx: -0.5 * sw };
          case 'armR': return { dy: bobY, rx: s.work ? -1.5 + 1.3 * strike : (s.moving ? 0.5 * sw : -0.15) };
        }
      };
    }
  };
}

function buildArmor() {
  const helm = new Vox().ell(0, 21.5, 0, 3.6, 3.8, 3.6, 'steel');
  for (let x = -2; x <= 1; x++) { helm.set(x, 21, 3, 'hood').set(x, 21, 2, 'hood'); }
  helm.set(-1, 21, 3, 'cyan').set(0, 21, 3, 'cyan');
  for (let z = -3; z <= 2; z++) { const y = 25 + (z < 0 ? 1 : 0); helm.set(-1, y, z, 'plume').set(0, y, z, 'plume'); }
  helm.set(-1, 27, -3, 'plume').set(0, 27, -4, 'plume');
  const chest = new Vox();
  for (let x = -5; x <= 4; x++) for (let y = 10; y <= 17; y++) for (let z = -3; z <= 3; z++) {
    const wall = x === -5 || x === 4 || z === -3 || z === 3 || y === 10;
    const corner = (x === -5 || x === 4) && (z === -3 || z === 3);
    if (wall && !corner) chest.set(x, y, z, y === 17 ? 'gold' : 'steel');
  }
  chest.box(-1, 11, 4, 0, 16, 4, 'steel');
  chest.box(-2, 11, -1, 1, 11, 1, 'cyan').set(-1, 12, 0, 'cyan').set(0, 13, 0, 'cyan');
  const skirt = new Vox().box(-4, 7, 3, 3, 8, 3, 'steel').box(-4, 7, -3, 3, 8, -3, 'steel').box(-5, 7, -2, -5, 8, 2, 'steel').box(4, 7, -2, 4, 8, 2, 'steel');
  const padL = new Vox().ell(-6.5, 17, 0, 2.7, 2.1, 3.1, 'steel').box(-8, 18, 0, -6, 18, 0, 'gold');
  const padR = new Vox().ell(6.5, 17, 0, 2.7, 2.1, 3.1, 'steel').box(5, 18, 0, 7, 18, 0, 'gold');
  const handL = new Vox().box(-8, 9, 0, -7, 11, 2, 'steel');
  const handR = new Vox().box(7, 9, 0, 8, 11, 2, 'steel').line([[8, 10.5, 2.5], [8, 12, 8]], 0.7, 0.9, 'gold');
  const wisp = new Vox();
  for (const [x, y, z] of [[-1, 5, 0], [0, 4, 1], [1, 6, -1], [-2, 3, 0], [0, 2, -1]]) wisp.set(x, y, z, 'cyan');
  return {
    shadowR: 5.5,
    parts: [part('helm', helm, [0, 18, 0]), part('chest', chest, [0, 14, 0]), part('skirt', skirt, [0, 8, 0]), part('padL', padL, [-6.5, 17, 0]),
      part('padR', padR, [6.5, 17, 0]), part('handL', handL, [-7.5, 10, 1]), part('handR', handR, [7.5, 10, 1]), part('wisp', wisp, [0, 4, 0])],
    pose(s) {
      const f = ph => Math.sin(s.t * 1.6 + ph) * 0.9;
      const lean = s.moving ? 0.12 : 0;
      return name => {
        switch (name) {
          case 'helm': return { dy: f(0), ry: s.work ? 0 : Math.sin(s.t * 0.5) * 0.25, rx: s.work ? 0.3 : lean };
          case 'chest': return { dy: f(0.8), rx: lean };
          case 'skirt': return { dy: f(1.6) - 0.4 };
          case 'padL': return { dy: f(0.3) };
          case 'padR': return { dy: f(1.1) };
          case 'handL': return { dy: f(2.6), rx: s.moving ? Math.sin(s.phase) * 0.4 : 0 };
          case 'handR': return s.work ? { dy: 5 + f(3.2) * 0.4, dz: -1, rx: -0.5 } : { dy: f(3.2), rx: s.moving ? -Math.sin(s.phase) * 0.4 : 0 };
          case 'wisp': return { dy: f(2) * 1.5 };
        }
      };
    }
  };
}

function buildGargoyle() {
  const body = new Vox().ell(0, 9.5, 0, 5, 4, 6.5, 'crystal');
  for (const z of [-4, -1, 2]) body.line([[0, 12.5, z + 0.5], [0, 16, z - 0.5]], 0.8, 0.3, 'crystal');
  body.set(-1, 8, 6, 'core').set(0, 8, 6, 'core').set(-1, 9, 6, 'core').set(0, 9, 6, 'core');
  const head = new Vox().ell(0, 13, 8, 3.4, 3, 3.4, 'crystal').box(-2, 11, 10, 1, 12, 12, 'crystal')
    .line([[-1.5, 15, 8], [-4, 19, 5]], 0.8, 0.35, 'crystal').line([[1.5, 15, 8], [4, 19, 5]], 0.8, 0.35, 'crystal');
  for (let x = -2; x <= 1; x++) head.set(x, 14, 10, 'hood');
  head.set(-2, 13, 10, 'core').set(1, 13, 10, 'core');
  const legFL = new Vox().box(-5, 0, 3, -3, 6, 5, 'crystal').set(-5, 0, 6, 'horn').set(-3, 0, 6, 'horn');
  const legFR = new Vox().box(2, 0, 3, 4, 6, 5, 'crystal').set(2, 0, 6, 'horn').set(4, 0, 6, 'horn');
  const legBL = new Vox().ell(-4, 6.5, -4, 2.6, 3, 3, 'crystal').box(-5, 0, -5, -3, 4, -3, 'crystal');
  const legBR = new Vox().ell(4, 6.5, -4, 2.6, 3, 3, 'crystal').box(3, 0, -5, 5, 4, -3, 'crystal');
  const wing = sign => {
    const v = new Vox();
    for (let i = 0; i <= 8; i++) {
      const x = sign < 0 ? -5 - i : 4 + i, top = 13 + i * 1.0, bot = 12 + i * 0.5 + (i % 3 === 2 ? 1 : 0);
      for (let y = Math.floor(bot); y <= Math.floor(top); y++) v.set(x, y, -2, 'prism').set(x, y, -1, 'prism');
    }
    v.line([[sign * 4.5, 13, -1], [sign * 13, 21.5, -1]], 0.7, 0.4, 'crystal');
    return v;
  };
  const tail = new Vox().line([[0, 7, -6], [0, 4, -11], [2, 3, -14]], 1.2, 0.6, 'crystal').set(2, 3, -15, 'core');
  return {
    shadowR: 7.5,
    parts: [part('body', body, [0, 9, 0]), part('head', head, [0, 12, 6]), part('legFL', legFL, [-4, 7, 4]), part('legFR', legFR, [3, 7, 4]),
      part('legBL', legBL, [-4, 7, -4]), part('legBR', legBR, [4, 7, -4]), part('wingL', wing(-1), [-4.5, 13, -1]), part('wingR', wing(1), [4.5, 13, -1]), part('tail', tail, [0, 7, -6])],
    pose(s) {
      const sw = s.moving ? Math.sin(s.phase) : 0, bobY = s.moving ? Math.abs(sw) * 0.5 : 0;
      const fold = s.work ? -0.15 + 0.3 * Math.sin(s.t * 5) : 0.55;
      return name => {
        switch (name) {
          case 'body': return { dy: bobY };
          case 'head': return { dy: bobY, rx: s.work ? 0.2 * Math.sin(s.t * 3) : 0, ry: s.work ? 0 : Math.sin(s.t * 0.6) * 0.25 };
          case 'legFL': case 'legBR': return { rx: 0.55 * sw };
          case 'legFR': case 'legBL': return { rx: -0.55 * sw };
          case 'wingL': return { dy: bobY, rz: -fold };
          case 'wingR': return { dy: bobY, rz: fold };
          case 'tail': return { dy: bobY, ry: Math.sin(s.t * 1.2) * 0.35 };
        }
      };
    }
  };
}

function buildWyrm() {
  const isl = new Vox();
  for (let x = -21; x <= 21; x++) for (let z = -21; z <= 21; z++) {
    const rr = Math.hypot(x + 0.5, z + 0.5), ang = Math.atan2(z + 0.5, x + 0.5);
    const edge = 17 + 1.6 * Math.sin(3 * ang + 1) + 1.1 * Math.sin(5 * ang);
    if (rr > edge) continue;
    isl.set(x, 0, z, 'moss');
    const depth = Math.floor((1 - rr / edge) * 14 + 2 + hash3(x, 1, z) * 3);
    for (let y = -1; y >= -depth; y--) isl.set(x, y, z, y === -1 && rr > edge - 1.5 ? 'moss' : 'stone');
  }
  for (let k = 0; k < 6; k++) {
    const a = k * 1.05 + 0.4, r = 14, px = Math.cos(a) * r, pz = Math.sin(a) * r;
    isl.line([[px, 1, pz], [px + 0.6, 3 + (k % 2) * 2, pz + 0.4]], 0.9, 0.3, 'violet');
  }
  const body = new Vox().ell(0, 6, 0, 6.5, 5, 8.5, 'obsidian');
  const coil = [];
  for (let i = 0; i <= 28; i++) { const u = i / 28, a = Math.PI + u * 1.3 * Math.PI; coil.push([Math.sin(a) * 11, 3.5 - u * 2, Math.cos(a) * 11]); }
  body.line([[0, 4, -7], ...coil], 3.2, 0.8, 'obsidian');
  for (let i = 0; i < coil.length - 4; i += 3) { const [x, y, z] = coil[i], r = 3.2 * (1 - i / 28) + 0.8; body.line([[x, y + r - 0.5, z], [x, y + r + 1.5, z]], 0.7, 0.25, 'horn'); }
  for (const z of [-5, -2, 1, 4]) body.line([[0, 10.5, z], [0, 13, z - 1]], 0.9, 0.3, 'horn');
  body.recolor((x, y, z, m) => (m === 'obsidian' && y <= 4 && z >= 2 && Math.abs(x) < 5) ? 'belly' : null);
  body.recolor((x, y, z, m) => (m === 'obsidian' && hash3(x, y, z) < 0.035) ? 'violet' : null);
  const neck = new Vox().line([[0, 9, 5], [0, 15, 8], [0, 19, 9.5]], 3, 2.3, 'obsidian');
  neck.recolor((x, y, z, m) => (z >= 9 + (y - 9) * 0.1 && Math.abs(x) <= 1) ? 'belly' : null);
  const head = new Vox().ell(0, 21, 11, 3.6, 3, 4.5, 'obsidian').box(-2, 19, 14, 1, 21, 18, 'obsidian').box(-2, 18, 13, 1, 18, 17, 'obsidian')
    .line([[-2, 23, 9], [-4, 26, 5], [-5, 28, 2]], 0.9, 0.35, 'horn').line([[2, 23, 9], [4, 26, 5], [5, 28, 2]], 0.9, 0.35, 'horn');
  head.set(-4, 22, 13, 'violet').set(3, 22, 13, 'violet').set(-2, 20, 18, 'violet').set(1, 20, 18, 'violet');
  const wing = sign => {
    const v = new Vox();
    for (let i = 0; i <= 17; i++) {
      const x = sign < 0 ? -6 - i : 5 + i, top = 11 + i * 0.85 + Math.sin(i / 17 * Math.PI) * 2, bot = 10.5 + i * 0.25 + Math.abs(Math.sin(i * 0.9)) * 2.2;
      for (let y = Math.floor(bot); y <= Math.floor(top); y++) v.set(x, y, -1, 'membrane');
    }
    v.line([[sign * 5.5, 11.5, -0.5], [sign * 23, 26, -0.5]], 1, 0.6, 'obsidian');
    v.line([[sign * 5.5, 11.5, -0.5], [sign * 22.5, 19, -0.5]], 0.8, 0.5, 'obsidian');
    v.line([[sign * 5.5, 11.5, -0.5], [sign * 17.5, 13.5, -0.5]], 0.8, 0.5, 'obsidian');
    v.line([[sign * 23, 26, -0.5], [sign * 24, 28, -0.5]], 0.6, 0.3, 'horn');
    return v;
  };
  return {
    shadowR: 17,
    parts: [part('island', isl, [0, 0, 0]), part('body', body, [0, 0, 0]), part('neck', neck, [0, 9, 5]), part('head', head, [0, 9, 5]),
      part('wingL', wing(-1), [-5, 11, 0]), part('wingR', wing(1), [5, 11, 0])],
    pose(s) {
      const sway = Math.sin(s.t * 0.6) * (s.on ? 0.35 : 0.15), breathe = Math.sin(s.t * 1.2) * 0.3;
      const wl = s.on ? -0.2 + 0.45 * Math.sin(s.t * 4) : -0.85;
      return name => {
        switch (name) {
          case 'body': return { dy: breathe * 0.5 };
          case 'neck': return { ry: sway, dy: breathe };
          case 'head': return { ry: sway, dy: breathe, rx: s.on ? -0.12 : 0 };
          case 'wingL': return { rz: wl, dy: breathe };
          case 'wingR': return { rz: -wl, dy: breathe };
        }
      };
    }
  };
}

function buildScribe() {
  const legL = new Vox().box(-3, 1, -1, -2, 7, 0, 'bone').box(-3, 0, -1, -2, 0, 2, 'bone');
  const legR = new Vox().box(1, 1, -1, 2, 7, 0, 'bone').box(1, 0, -1, 2, 0, 2, 'bone');
  const body = new Vox();
  for (let y = 6; y <= 13; y++) { const w = Math.round(4 + (13 - y) * 0.15); body.box(-w, y, -2, w - 1, y, 2, 'robe'); }
  body.box(-3, 14, -2, 2, 19, 1, 'bone');                       // ribcage
  for (const y of [15, 17]) for (const x of [-3, -2, 1, 2]) body.set(x, y, 1, 'ink');
  body.box(-4, 14, -3, 3, 19, -3, 'robe');                      // cloak down the back
  body.box(-5, 20, -3, 4, 20, 2, 'paper');                      // parchment mantle
  for (let x = -5; x <= 4; x++) for (let z = -3; z <= 2; z++) if (hash3(x, 20, z) < 0.22) body.set(x, 20, z, 'ink');
  body.box(-5, 12, -2, 4, 12, 2, 'leather').box(4, 10, 1, 5, 11, 2, 'ink').set(4, 12, 2, 'gold');
  body.line([[-5, 11, 1.5], [-6, 6, 2]], 0.7, 0.7, 'paper');     // a scroll hanging from the belt
  body.box(-1, 21, -1, 0, 21, 0, 'bone');
  const head = new Vox().ell(0, 24, 0, 3.2, 3.2, 3.2, 'bone').box(-2, 21, 0, 1, 21, 2, 'bone');
  for (let x = -2; x <= 1; x++) head.set(x, 22, 2, x % 2 ? 'bone' : 'hood');
  head.set(-2, 24, 2, 'ghost').set(1, 24, 2, 'ghost').set(-2, 25, 2, 'hood').set(1, 25, 2, 'hood').set(-1, 23, 2, 'hood').set(0, 23, 2, 'hood');
  head.box(-1, 27, -1, 0, 29, 0, 'paper').set(-2, 27, -1, 'paper').set(1, 27, 0, 'paper').set(1, 28, 0, 'paper'); // candle stub
  head.set(-1, 30, -1, 'ghost').set(0, 30, 0, 'ghost').set(-1, 31, 0, 'ghost');
  const armR = new Vox().box(4, 13, -1, 4, 19, 0, 'bone').box(4, 12, 0, 5, 12, 1, 'bone')
    .line([[5, 12, 1.5], [6, 16.5, 2.5]], 0.6, 0.45, 'silk').set(5, 11, 1, 'ink');
  const armL = new Vox().box(-5, 13, -1, -5, 19, 0, 'bone').box(-9, 10, 1, -5, 15, 3, 'leather').box(-8, 15, 1, -6, 15, 3, 'paper').set(-7, 12, 4, 'gold');
  return {
    shadowR: 5.5,
    parts: [part('legL', legL, [-2.5, 7, 0]), part('legR', legR, [1.5, 7, 0]), part('body', body, [0, 7, 0]), part('head', head, [0, 21, 0]),
      part('armR', armR, [4.5, 19.5, 0]), part('armL', armL, [-5, 19.5, 0])],
    pose(s) {
      const sw = s.moving ? Math.sin(s.phase) : 0, bob = s.moving ? Math.abs(sw) * 0.5 : 0;
      return name => {
        switch (name) {
          case 'legL': return { rx: 0.5 * sw };
          case 'legR': return { rx: -0.5 * sw };
          case 'body': return { dy: bob };
          case 'head': return { dy: bob, rx: s.work ? 0.3 : 0, ry: s.work ? 0 : Math.sin(s.t * 0.5) * 0.3 };
          case 'armR': return { dy: bob, rx: s.work ? -0.9 + 0.08 * Math.sin(s.t * 7) : (s.moving ? 0.4 * sw : 0), rz: s.work ? 0.06 * Math.sin(s.t * 11) : 0 };
          case 'armL': return { dy: bob, rx: s.work ? -0.5 : (s.moving ? -0.3 * sw : -0.2) };
        }
      };
    }
  };
}

function buildSpider() {
  const abd = new Vox().ell(0, 8, -7, 6, 5, 7.5, 'chitin');
  abd.recolor((x, y, z, m) => (y >= 10 && [-3, -6, -9, -12].includes(z) && Math.abs(x + 0.5) <= 3.5 && hash3(x, 5, z) < 0.65) ? 'rose' : null);
  abd.recolor((x, y, z, m) => (y >= 9 && (x === -5 || x === 4) && z % 3 === 0) ? 'silk' : null);
  abd.box(-1, 6, -15, 0, 7, -15, 'silk');
  const body = new Vox().ell(0, 7, 3, 4.2, 3.5, 4, 'chitin').ell(0, 7.5, 7.5, 2.8, 2.6, 2.2, 'chitin');
  for (const [x, y, z] of [[-2, 8, 9], [1, 8, 9], [-1, 9, 9], [0, 9, 9], [-1, 8, 10], [0, 8, 10]]) body.set(x, y, z, 'rose');
  body.set(-1, 5, 9, 'horn').set(0, 5, 9, 'horn').set(-1, 4, 10, 'horn').set(0, 4, 10, 'horn');
  for (const sg of [-1, 1]) body.line([[sg * 1.8, 6, 9], [sg * 2.5, 5, 11], [sg * 2, 3, 12]], 0.65, 0.5, 'chitin').set(sg < 0 ? -3 : 2, 3, 12, 'silk');
  const leg = (sg, i) => {
    const zi = [4.5, 2, -0.5, -3][i], hip = [sg * 3.5, 7, zi], knee = [sg * 9, 13, zi * 1.5 + (i < 2 ? 1 : -1)], foot = [sg * 13, 0.5, zi * 2.2 + (i < 2 ? 2 : -2)];
    const v = new Vox().line([hip, knee], 1.0, 0.8, 'chitin').line([knee, foot], 0.8, 0.5, 'chitin').ell(knee[0], knee[1], knee[2], 1.1, 1.1, 1.1, 'silk');
    return part((sg < 0 ? 'l' : 'r') + i, v, hip);
  };
  const legs = []; for (let i = 0; i < 4; i++) legs.push(leg(-1, i), leg(1, i));
  return {
    shadowR: 9,
    parts: [part('abd', abd, [0, 8, -1]), part('body', body, [0, 7, 3]), ...legs],
    pose(s) {
      const p = s.phase;
      return name => {
        if (name === 'abd') return { rx: s.work ? 0.15 + 0.06 * Math.sin(s.t * 3) : 0.03 * Math.sin(s.t), dy: s.moving ? 0.3 * Math.abs(Math.sin(p)) : 0 };
        if (name === 'body') return { dy: s.moving ? 0.3 * Math.abs(Math.sin(p)) : 0 };
        const sg = name[0] === 'l' ? -1 : 1, i = +name[1], grp = ((i + (sg < 0 ? 0 : 1)) % 2) ? Math.PI : 0;
        if (s.work && i === 0) return { rz: sg * (0.6 + 0.3 * Math.sin(s.t * 6 + (sg > 0 ? Math.PI : 0))) };
        if (!s.moving) return { ry: s.work ? 0 : -sg * 0.04 * Math.sin(s.t * 0.8 + i) };
        return { ry: -sg * 0.28 * Math.sin(p + grp), dy: Math.max(0, Math.sin(p + grp)) * 1.2 };
      };
    }
  };
}

function buildSeer() {
  const robe = new Vox();
  for (let y = 1; y <= 15; y++) { const r = 5.2 - y * 0.14; robe.ell(0, y + 0.5, 0, r, 0.5, r * 0.85, 'kelp'); }
  robe.recolor((x, y, z, m) => (z >= 2 && (x === -1 || x === 0) && y <= 13) ? 'coral' : null);
  robe.set(-1, 14, 3, 'shell').set(0, 14, 3, 'shell');
  robe.ell(0, 13, -4.5, 4.2, 5, 2.6, 'shell');                    // a spiral shell carried on the back
  robe.recolor((x, y, z, m) => (m === 'shell' && z < -2 && Math.floor(Math.hypot(x + 0.5, y + 0.5 - 13) * 1.1) % 2 === 0) ? 'coral' : null);
  const hem = new Vox();
  for (let k = 0; k < 10; k++) { const a = k * Math.PI / 5, px = Math.cos(a) * 4.8, pz = Math.sin(a) * 4.1; hem.line([[px, 1.5, pz], [px * 1.25, 0.5, pz * 1.25]], 0.6, 0.45, 'coral'); }
  const head = new Vox().ell(0, 18.5, 0.5, 3.4, 3.3, 3.4, 'kelp').box(-2, 17, 3, 1, 19, 3, 'hood').set(-2, 18, 3, 'tide').set(1, 18, 3, 'tide');
  for (const x of [-2, -1, 0, 1]) head.line([[x + 0.5, 16.6, 3.4], [x + 0.5 + (x < 0 ? -0.5 : 0.5), 13.5, 4.3]], 0.5, 0.45, 'coral');
  for (const sg of [-1, 1]) head.line([[sg * 2, 20.5, 0], [sg * 4, 24, -1], [sg * 6.5, 26, 0]], 0.8, 0.4, 'coral').line([[sg * 4, 24, -1], [sg * 3.5, 27.5, -2]], 0.6, 0.35, 'coral');
  const armR = new Vox().box(4, 12, -1, 5, 17, 1, 'kelp').box(5, 12, 1, 6, 13, 2, 'coral');
  const armL = new Vox().box(-6, 12, -1, -5, 17, 1, 'kelp').box(-7, 11, 0, -5, 12, 2, 'coral').line([[-6, 11, 1.5], [-6.5, 8.5, 2.5]], 0.5, 0.45, 'coral');
  const staff = new Vox().box(6, 2, 2, 6, 21, 2, 'wood').line([[6.5, 21.5, 2.5], [8, 23.5, 2.5], [7, 25.5, 2.5], [5.5, 24.8, 2.5]], 0.7, 0.6, 'wood')
    .ell(6.8, 23.6, 2.5, 1.4, 1.4, 1.4, 'tide');
  return {
    shadowR: 6,
    parts: [part('robe', robe, [0, 0, 0]), part('hem', hem, [0, 0, 0]), part('head', head, [0, 16, 0]), part('armR', armR, [4.5, 17, 0]),
      part('armL', armL, [-5.5, 17, 0]), part('staff', staff, [5.5, 12.5, 2])],
    pose(s) {
      const bob = s.moving ? Math.abs(Math.sin(s.phase)) * 0.4 : Math.sin(s.t * 1.4) * 0.3;
      return name => {
        switch (name) {
          case 'robe': return { dy: bob * 0.5 };
          case 'hem': return { ry: Math.sin(s.t * (s.moving ? 3 : 1.2)) * 0.18 };
          case 'head': return { dy: bob, rx: s.work ? 0.25 : 0, ry: s.work ? 0 : Math.sin(s.t * 0.4) * 0.3 };
          case 'armL': return { dy: bob, rx: s.work ? -1.2 + 0.1 * Math.sin(s.t * 2) : -0.15 };
          case 'armR': return { dy: bob, rx: s.work ? -0.3 : 0 };
          case 'staff': return { dy: bob + (s.work ? 2.5 : 0), rx: s.work ? -0.3 : 0 };
        }
      };
    }
  };
}

function buildBat() {
  const B = 5, body = new Vox().ell(0, 6 + B, 0, 3.2, 3.8, 3, 'gold');
  body.recolor((x, y, z, m) => hash3(x, y, z) < 0.08 ? 'copper' : null);
  for (let x = -3; x <= 2; x++) for (let y = 2 + B; y <= 9 + B; y++) {   // clock face on the chest
    const dx = x + 0.5, dy = y + 0.5 - (6 + B), d = dx * dx + dy * dy;
    if (d <= 6.5) body.set(x, y, 3, 'yellow'); else if (d <= 10) body.set(x, y, 3, 'copper');
  }
  body.ell(0, 11.5 + B, 0.5, 2.8, 2.5, 2.6, 'gold').set(-2, 12 + B, 3, 'yellow').set(1, 12 + B, 3, 'yellow')
    .set(-1, 10 + B, 3, 'gold').set(0, 10 + B, 3, 'gold').set(-1, 9 + B, 3, 'horn').set(0, 9 + B, 3, 'horn');
  for (const sg of [-1, 1]) body.line([[sg * 1.5, 13.5 + B, 0.5], [sg * 3.2, 17.5 + B, 0]], 1, 0.35, 'gold').set(sg < 0 ? -3 : 2, 15 + B, 1, 'copper');
  const hands = new Vox().line([[0, 6 + B, 4.5], [0, 8.6 + B, 4.5]], 0.5, 0.5, 'ink').line([[0, 6 + B, 4.5], [1.8, 6 + B, 4.5]], 0.5, 0.5, 'ink');
  const gear = new Vox();
  for (let x = -5; x <= 4; x++) for (let y = 1 + B; y <= 11 + B; y++) {
    const dx = x + 0.5, dy = y + 0.5 - (6.5 + B), d = Math.hypot(dx, dy), tooth = Math.floor((Math.atan2(dy, dx) + Math.PI) * 8 / Math.PI) % 2 === 0;
    if ((d >= 1.2 && d <= 3.2) || (d > 3.2 && d <= 4.3 && tooth)) gear.set(x, y, -4, 'copper'); else if (d < 1.2) gear.set(x, y, -4, 'gold');
  }
  const pend = new Vox().line([[0, 2.5 + B, 0], [0, -2.5 + B, 0]], 0.5, 0.5, 'gold').ell(0, -3.5 + B, 0, 1.4, 1.4, 1, 'copper');
  const wing = sg => {
    const v = new Vox();
    for (let i = 0; i <= 12; i++) {
      const x = sg < 0 ? -3 - i : 2 + i, front = 1.5 - i * 0.1, back = -1 - Math.sin(i / 12 * Math.PI) * 4.5 + Math.abs(Math.sin(i * Math.PI / 4)) * 2;
      for (let z = Math.floor(back); z <= Math.floor(front); z++) v.set(x, 7 + B + Math.round(i * 0.15), z, 'leather');
    }
    for (const tip of [[15, 9.5, 1], [11, 8.5, -5], [6, 8, -5.5]]) v.line([[sg * 2.5, 8 + B, 0.5], [sg * tip[0], tip[1] + B, tip[2]]], 0.6, 0.4, 'gold');
    return v;
  };
  return {
    shadowR: 8,
    parts: [part('body', body, [0, 11, 0]), part('hands', hands, [0, 6 + B, 4.5]), part('gear', gear, [0, 6.5 + B, -4]), part('pend', pend, [0, 2.5 + B, 0]),
      part('wingL', wing(-1), [-2.5, 8 + B, 0]), part('wingR', wing(1), [2.5, 8 + B, 0])],
    pose(s) {
      const k = s.work ? 13 : 6, fl = Math.sin(s.t * k), amp = s.work ? 0.55 : 0.45, bob = Math.sin(s.t * k + 1.6) * (s.work ? 0.4 : 0.7);
      return name => {
        switch (name) {
          case 'body': return { dy: bob };
          case 'wingL': return { dy: bob, rz: -fl * amp - 0.1 };
          case 'wingR': return { dy: bob, rz: fl * amp + 0.1 };
          case 'gear': return { dy: bob, rz: s.t * (s.work ? 4 : 0.5) };
          case 'hands': return { dy: bob, rz: -s.t * (s.work ? 3 : 0.2) };
          case 'pend': return { dy: bob, rz: 0.45 * Math.sin(s.t * 3.2) };
        }
      };
    }
  };
}

// ---------- the station: floor, props, stations ----------
const FX = 76, FZ = 52;
function buildProps() {
  const v = new Vox();
  v.box(-64, 0, -3, -52, 6, 5, 'stone').box(-64, 7, -3, -52, 7, 5, 'stone').box(-62, 7, -1, -54, 7, 3, 'lava').box(-63, 8, -3, -60, 18, 0, 'stone');
  v.box(-43, 0, 16, -37, 1, 20, 'metal').box(-42, 2, 17, -38, 4, 19, 'metal').box(-45, 5, 16, -35, 6, 20, 'metal').box(-34, 5, 17, -32, 5, 19, 'metal').set(-31, 5, 18, 'metal').box(-41, 7, 17, -38, 7, 18, 'lava');
  v.box(37, 6, 5, 51, 7, 14, 'wood');
  for (const [x, z] of [[38, 6], [50, 6], [38, 13], [50, 13]]) v.box(x, 0, z, x, 5, z, 'wood');
  v.box(39, 8, 7, 49, 8, 12, 'paper').ell(47, 10, 9, 1.6, 1.6, 1.6, 'gold').box(41, 9, 8, 43, 9, 8, 'leather');
  v.box(-4, 0, 28, 3, 5, 35, 'stone').box(-5, 6, 27, 4, 6, 36, 'stone').line([[0, 7, 31.5], [0, 15, 32]], 1.6, 0.5, 'crystal').set(0, 9, 30, 'core').set(-1, 9, 31, 'core');
  for (const [x, z] of [[-70, -46], [70, -46], [-70, 46], [70, 46]]) {
    v.box(x - 3, 0, z - 3, x + 2, 16, z + 2, 'stone').box(x - 4, 17, z - 4, x + 3, 18, z + 3, 'stone').line([[x, 19, z], [x, 23, z]], 1.1, 0.4, 'violet');
  }
  for (const [x, z] of [[-20, -14], [54, -30], [40, 44], [-66, -12]]) {
    v.line([[x, 0, z], [x + 0.5, 4, z]], 1, 0.3, 'violet').line([[x + 2, 0, z + 1], [x + 3, 2.5, z + 1.5]], 0.8, 0.3, 'violet');
  }
  // Bone Scribe: a tall shelf of ledgers, a scroll pile and a lectern
  v.box(-58, 0, -40, -42, 0, -36, 'wood').box(-58, 1, -40, -58, 21, -36, 'wood').box(-42, 1, -40, -42, 21, -36, 'wood').box(-58, 22, -40, -42, 22, -36, 'wood').box(-57, 1, -40, -43, 21, -40, 'wood');
  for (const y0 of [1, 8, 15]) {
    v.box(-57, y0 + 6, -39, -43, y0 + 6, -36, 'wood');
    for (let x = -57; x <= -43; x++) {
      const h = hash3(x, y0, 4); if (h < 0.12) continue;
      v.box(x, y0, -39, x, y0 + 3 + Math.floor(h * 3), -37, ['leather', 'plume', 'ink', 'moss', 'paper'][Math.floor(hash3(x, y0, 9) * 5)]);
    }
  }
  v.line([[-52, 0.6, -31], [-47, 0.6, -30]], 1, 1, 'paper').line([[-51, 2, -29], [-46, 2, -31]], 0.9, 0.9, 'paper');
  v.box(-36, 0, -20, -32, 1, -17, 'wood').box(-35, 2, -19, -33, 9, -18, 'wood').box(-37, 10, -21, -31, 10, -17, 'wood').box(-36, 11, -21, -32, 11, -18, 'paper').box(-35, 11, -20, -33, 11, -20, 'ink');
  v.box(-31, 11, -21, -31, 12, -21, 'paper').set(-31, 13, -21, 'ghost');
  // Silkscript Spider: a web loom with written silk
  v.box(21, 0, -39, 22, 22, -37, 'wood').box(41, 0, -39, 42, 22, -37, 'wood').box(21, 23, -39, 42, 24, -37, 'wood');
  for (let k = 0; k < 10; k++) { const a = k * Math.PI / 5; v.line([[31.5, 12, -37.5], [31.5 + Math.cos(a) * 9.6, 12 + Math.sin(a) * 10.6, -37.5]], 0.6, 0.6, 'silk'); }
  for (const r of [3.5, 6.5, 9]) for (let k = 0; k < Math.round(r * 7); k++) {
    const a = k / Math.round(r * 7) * Math.PI * 2;
    v.set(31.5 + Math.cos(a) * r, 12 + Math.sin(a) * r * 1.1, -38, hash3(k, r * 10, 3) < 0.3 ? 'rose' : 'silk');
  }
  v.ell(25, 1.5, -31, 1.6, 1.6, 1.6, 'silk').ell(37, 1.2, -32, 1.3, 1.3, 1.3, 'silk');
  // Tide Seer: a tide pool ringed with stone and coral
  for (let x = -35; x <= -17; x++) for (let z = 33; z <= 51; z++) {
    const d = Math.hypot(x + 0.5 + 26, z + 0.5 - 42); if (d > 8) continue;
    if (d > 6.2) v.box(x, 0, z, x, 1 + (hash3(x, 3, z) < 0.3 ? 1 : 0), z, 'stone');
    else v.set(x, 0, z, hash3(x, 4, z) < 0.05 ? 'tide' : 'water');
  }
  for (const [x, z] of [[-33, 38], [-19, 46], [-31, 48]]) v.line([[x, 2, z], [x + 0.5, 6, z - 0.5]], 0.8, 0.4, 'coral');
  // Clockwork Bat: a clock tower with a bell and a perch
  v.box(59, 0, 15, 65, 25, 21, 'stone').box(58, 26, 14, 66, 27, 22, 'metal').box(60, 28, 16, 64, 29, 20, 'metal').box(61, 30, 17, 63, 31, 19, 'gold');
  for (let x = 59; x <= 65; x++) for (let y = 14; y <= 24; y++) { const d = (x - 62) ** 2 + (y - 19) ** 2; if (d <= 7) v.set(x, y, 22, 'paper'); else if (d <= 11) v.set(x, y, 22, 'gold'); }
  v.box(62, 19, 23, 62, 22, 23, 'ink').box(62, 19, 23, 64, 19, 23, 'ink');
  v.box(53, 22, 17, 58, 22, 18, 'metal').box(58, 20, 17, 58, 21, 18, 'metal');
  v.box(-62, 0, 28, -57, 5, 33, 'wood').box(-55, 0, 33, -51, 4, 37, 'wood').box(56, 0, -10, 61, 5, -5, 'wood');
  const rim = new Vox();
  for (let x = -FX; x < FX; x++) for (let y = -6; y <= -1; y++) { rim.set(x, y, -FZ, 'stone'); rim.set(x, y, FZ - 1, 'stone'); }
  for (let z = -FZ; z < FZ; z++) for (let y = -6; y <= -1; y++) { rim.set(-FX, y, z, 'stone'); rim.set(FX - 1, y, z, 'stone'); }
  return [{ model: { parts: [part('props', v, [0, 0, 0])] }, pos: [0, 0, 0] }, { model: { parts: [part('rim', rim, [0, 0, 0], true)] }, pos: [0, 0, 0] }];
}
function floorRGB(x, z) {
  const vx = Math.floor(x), vz = Math.floor(z), gx = ((vx % 8) + 8) % 8, gz = ((vz % 8) + 8) % 8;
  const bx = Math.floor(vx / 8), bz = Math.floor(vz / 8), bh = hash3(bx, 7, bz);
  const mat = bh < 0.1 ? MAT.moss : MAT.floor;
  if (gx === 0 || gz === 0) return mat.rgb[1];
  const h = hash3(vx, 0, vz); let tone = 3;
  if (h < 0.22) tone = 2; else if (h > 0.92) tone = 4;
  if (bh > 0.85) tone--;
  return mat.rgb[Math.max(0, tone)];
}
function buildBase(view, props) {
  const { W, H, S, cx0, cy0 } = view, c = Math.cos(view.yaw), s = Math.sin(view.yaw);
  view.clear();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, o = i * 4, c0 = (x + 0.5 - cx0) / S, c2 = ((y + 0.5 - cy0) / S) / SP;
    const wx = c0 * c + c2 * s, wz = -c0 * s + c2 * c;
    if (wx >= -FX && wx < FX && wz >= -FZ && wz < FZ) {
      view.col.set([...floorRGB(wx, wz), 255], o); view.dep[i] = c2 * CP; view.id[i] = 0;
    } else {
      const st = hash3(x, y, 11), g = 9 + (y / H) * 6;
      view.col.set(st > 0.995 ? [120, 105, 150, 255] : [g, g * 0.8, g * 1.5, 255], o);
    }
  }
  props.forEach((p, k) => view.draw(p, 10 + k, null, 0));
  view.snapshot();
}


export { DEG, PHI, SP, CP, MAT, hash3, Vox, part, rX, rY, rZ, mm, mv, View, FX, FZ,
  buildWyrm, buildArmor, buildSmith, buildGargoyle, buildScribe, buildSpider, buildSeer, buildBat, buildProps, buildBase };
