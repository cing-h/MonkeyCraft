// MonkeyCraft ape village: the cast (species, poses, forward kinematics) and how one ape is drawn.

import { lerp, mat } from './fb.js';

// ---------- the cast ----------
export const C = {
  wood: [118, 84, 54], dark: [34, 26, 22], thatch: [168, 136, 78], stone: [116, 112, 104], paper: [222, 210, 180], gold: [222, 178, 70],
  leaf: [58, 96, 52], leaf2: [82, 120, 60], bark: [92, 70, 52], grass: [78, 98, 44], dirt: [118, 92, 58], red: [196, 58, 48], rope: [150, 120, 80]
};
export const LIGHT = { chief: [196, 132, 255], scout: [96, 232, 240], smith: [255, 146, 56], inspector: [240, 240, 255], archivist: [118, 240, 156], writer: [255, 128, 204], sage: [120, 168, 255], ringer: [255, 222, 86] };

export const SPECIES = {
  chief:     { name: 'THE CHIEF', species: 'Silverback gorilla', role: 'Manager · plans and hands out the work', posture: 'knuckle', canopy: null, tl: 9, tr: 5.6, pr: 4.6, hr: 3.6, neck: 3, ua: 6.5, la: 6, ar: 1.9, ul: 4.4, ll: 4, lr: 2.1, fur: [40, 38, 44], face: [30, 28, 32], tail: 0, walk: 12, run: 24 },
  scout:     { name: 'THE SCOUT', species: 'White-handed gibbon', role: 'Researcher · scouts the web', posture: 'biped', canopy: 'brachiate-fast', tl: 5.6, tr: 2.8, pr: 2.4, hr: 2.4, neck: 2, ua: 7, la: 6.6, ar: 0.95, ul: 4.2, ll: 3.8, lr: 1.05, fur: [196, 168, 128], face: [34, 30, 30], tail: 0, walk: 16, run: 34 },
  smith:     { name: 'THE SMITH', species: 'Chimpanzee', role: 'Builder · runs commands and code', posture: 'knuckle', canopy: 'brachiate', tl: 7, tr: 3.9, pr: 3.3, hr: 2.9, neck: 2.4, ua: 5.2, la: 4.8, ar: 1.25, ul: 4, ll: 3.8, lr: 1.4, fur: [54, 42, 34], face: [196, 160, 128], tail: 0, walk: 14, run: 32 },
  inspector: { name: 'THE INSPECTOR', species: 'Mandrill', role: 'Tester · checks the work', posture: 'quad', canopy: 'branchwalk', tl: 7, tr: 3.5, pr: 3.2, hr: 3, neck: 2.4, ua: 4.6, la: 4.2, ar: 1.3, ul: 4.4, ll: 4, lr: 1.4, fur: [100, 94, 60], face: [212, 52, 48], tail: 3, walk: 15, run: 34 },
  archivist: { name: 'THE ARCHIVIST', species: 'Orangutan', role: 'Archivist · reads and files documents', posture: 'fist', canopy: 'brachiate-slow', tl: 7, tr: 4.6, pr: 4, hr: 3.2, neck: 1.8, ua: 7, la: 6.6, ar: 1.5, ul: 3.2, ll: 3, lr: 1.4, fur: [182, 86, 36], face: [98, 74, 62], tail: 0, walk: 9, run: 20 },
  writer:    { name: 'THE WRITER', species: 'Bonobo', role: 'Writer · drafts and edits text', posture: 'biped', canopy: 'brachiate', tl: 6.6, tr: 3.3, pr: 3, hr: 2.6, neck: 2.3, ua: 5, la: 4.6, ar: 1.1, ul: 4.6, ll: 4.2, lr: 1.3, fur: [34, 30, 36], face: [56, 42, 44], tail: 0, walk: 14, run: 30 },
  sage:      { name: 'THE SAGE', species: 'Snow monkey', role: 'Memory keeper · remembers and teaches skills', posture: 'quad', canopy: 'branchwalk', tl: 5.6, tr: 3.5, pr: 3.1, hr: 2.7, neck: 1.8, ua: 3.8, la: 3.4, ar: 1.25, ul: 3.6, ll: 3.2, lr: 1.3, fur: [170, 158, 144], face: [216, 112, 104], tail: 2, walk: 10, run: 24 },
  ringer:    { name: 'THE BELL-RINGER', species: 'Howler monkey', role: 'Timekeeper · runs scheduled jobs', posture: 'quad', canopy: 'branchwalk', tl: 6, tr: 3, pr: 2.8, hr: 2.5, neck: 2, ua: 4, la: 3.8, ar: 1.05, ul: 3.8, ll: 3.6, lr: 1.1, fur: [98, 40, 26], face: [26, 22, 22], tail: 11, walk: 15, run: 34 }
};
export const CREW = Object.keys(SPECIES);
for (const sp of Object.values(SPECIES)) { sp.m = mat(sp.fur); sp.mf = mat(sp.fur.map(v => v * 0.72)); sp.mface = mat(sp.face, { rim: 0.35 }); }

// ---------- poses: angles in a facing-right frame ----------
// torso: radians from straight UP, + leans forward. limbs: radians from straight DOWN, + swings forward.
// Every gait is a function of a phase p (one full stride = 2π) so feet can be matched to distance travelled.
export const TAU = Math.PI * 2;
export const pos = v => Math.max(0, v);
export const lean0 = sp => sp.posture === 'quad' ? 1.42 : sp.posture === 'fist' ? 0.95 : sp.posture === 'knuckle' ? 1.05 : 0.08;
export const P = {
  stand(sp, t, a = {}) {
    const br = Math.sin(t * 1.7) * 0.025, look = a.look || 0;
    if (sp.posture === 'biped') return { torso: 0.08 + br, sh: [0.12 + br, -0.1], el: [-0.25, -0.2], hip: [0.06, -0.06], kn: [-0.05, -0.05], head: look, plant: 'feet', tail: 0.4, lift: 0 };
    const L = lean0(sp);
    return { torso: L + br, sh: [L * 0.12 + 0.12, L * 0.12 - 0.08], el: [0, 0], hip: [0.12, -0.1], kn: [-0.05, 0], head: -L * 0.55 + look, plant: 'all', tail: 0.6, lift: 0 };
  },
  // quadrupedal / knuckle / fist walk: lateral-sequence gait — fore limbs lag hind limbs by ~quarter stride
  walk(sp, p) {
    const L = lean0(sp), A = sp.posture === 'quad' ? 0.42 : 0.5, pa = p + Math.PI * 0.55;
    if (sp.posture === 'biped') return P.bipedWalk(sp, p);
    return {
      torso: L + Math.sin(2 * p) * (sp.posture === 'quad' ? 0.045 : 0.085), plant: 'all', head: -L * 0.6 - Math.sin(2 * p) * (sp.posture === 'quad' ? 0.05 : 0.08),
      hip: [A * Math.sin(p), A * Math.sin(p + Math.PI)],
      kn: [-pos(Math.cos(p)) * 0.95 * A, -pos(Math.cos(p + Math.PI)) * 0.95 * A],
      sh: [L * 0.12 + A * 0.9 * Math.sin(pa), L * 0.12 + A * 0.9 * Math.sin(pa + Math.PI)],
      el: [-pos(Math.cos(pa)) * 0.75 * A, -pos(Math.cos(pa + Math.PI)) * 0.75 * A],
      lift: (sp.posture === 'quad' ? 0.55 : 0.9) * pos(Math.sin(2 * p)), tail: 0.55 + 0.15 * Math.sin(p)
    };
  },
  // bounding gallop: hind pair then fore pair, the spine flexes and there's a flight phase
  run(sp, p) {
    if (sp.posture === 'biped') return P.bipedRun(sp, p);
    const L = lean0(sp) - 0.08, A = sp.posture === 'fist' ? 0.6 : 0.9;
    const flex = Math.sin(p + Math.PI / 2);
    return {
      torso: L + flex * 0.2, plant: 'all', head: -L * 0.7 - flex * 0.22,
      hip: [A * Math.sin(p), A * Math.sin(p + 0.45)], kn: [-pos(Math.cos(p)) * 1.2 * A, -pos(Math.cos(p + 0.45)) * 1.2 * A],
      sh: [L * 0.15 + A * Math.sin(p + Math.PI * 0.95), L * 0.15 + A * Math.sin(p + Math.PI * 0.95 + 0.45)],
      el: [-pos(Math.cos(p + Math.PI * 0.95)) * 0.9 * A, -pos(Math.cos(p + Math.PI * 0.95 + 0.45)) * 0.9 * A],
      lift: 2.4 * Math.pow(pos(Math.sin(p + 0.25)), 1.5), tail: 0.25 + 0.35 * flex
    };
  },
  bipedWalk(sp, p) {
    const gib = sp.canopy === 'brachiate-fast', A = 0.48;
    return {
      torso: 0.07 + Math.sin(2 * p) * 0.03, plant: 'feet', head: -0.05 - Math.sin(2 * p) * 0.03,
      hip: [A * Math.sin(p), A * Math.sin(p + Math.PI)], kn: [-0.08 - pos(Math.cos(p)) * 1.05, -0.08 - pos(Math.cos(p + Math.PI)) * 1.05],
      sh: gib ? [2.45 + 0.22 * Math.sin(p + 1), 2.3 + 0.22 * Math.sin(p + Math.PI + 1)] : [0.45 * Math.sin(p + Math.PI), 0.45 * Math.sin(p)],
      el: gib ? [0.5 + 0.2 * Math.sin(p + 2), 0.6 + 0.2 * Math.sin(p + Math.PI + 2)] : [-0.3 - 0.3 * pos(Math.cos(p + Math.PI)), -0.3 - 0.3 * pos(Math.cos(p))],
      lift: 0.6 * pos(Math.sin(2 * p + Math.PI / 2)), tail: 0.4
    };
  },
  bipedRun(sp, p) {
    const A = 0.95;
    if (sp.canopy === 'brachiate-fast') return {   // the gibbon runs upright with both long arms held high for balance
      torso: 0.22 + Math.sin(2 * p) * 0.05, plant: 'feet', head: -0.2,
      hip: [A * Math.sin(p), A * Math.sin(p + Math.PI)], kn: [-0.15 - pos(Math.cos(p)) * 1.5, -0.15 - pos(Math.cos(p + Math.PI)) * 1.5],
      sh: [2.6 + 0.22 * Math.sin(p + 0.6), 2.4 + 0.22 * Math.sin(p + Math.PI + 0.6)], el: [0.45 + 0.15 * Math.sin(p + 1.5), 0.55 + 0.15 * Math.sin(p + Math.PI + 1.5)],
      lift: 1.7 * pos(Math.sin(2 * p)), tail: 0.3
    };
    return {
      torso: 0.36 + Math.sin(2 * p) * 0.05, plant: 'feet', head: -0.3,
      hip: [A * Math.sin(p), A * Math.sin(p + Math.PI)], kn: [-0.15 - pos(Math.cos(p)) * 1.6, -0.15 - pos(Math.cos(p + Math.PI)) * 1.6],
      sh: [0.95 * Math.sin(p + Math.PI), 0.95 * Math.sin(p)], el: [-1.5, -1.5],
      lift: 1.9 * pos(Math.sin(2 * p)), tail: 0.3
    };
  },
  // climbing: reach, grip, pull — the body surges up on the pull (see climbRate in the scene)
  climb(sp, p) {
    const s = Math.sin(p), s2 = Math.sin(p + Math.PI);
    return { torso: -0.05 + 0.06 * s, plant: 'none', head: 0.3 - 0.1 * s, sh: [2.75 + 0.45 * s, 2.75 + 0.45 * s2], el: [-0.35 - 0.55 * pos(-s), -0.35 - 0.55 * pos(-s2)],
      hip: [1.15 + 0.55 * s2, 1.15 + 0.55 * s], kn: [-1.55 - 0.45 * s2, -1.55 - 0.45 * s], tail: -0.4, lift: 0 };
  },
  // pendulum swing under a branch. theta = body angle (− behind the grip, + ahead), u = 0..1 through this swing.
  hang(sp, theta, u, fast) {
    const g = 0, r = 1, reach = Math.min(1, u * 1.4);
    const sh = [0, 0], el = [0, 0];
    sh[g] = Math.PI - theta; el[g] = 0;
    sh[r] = Math.PI - theta - 1.25 + 1.0 * reach; el[r] = -0.7 + 0.6 * reach;   // the free arm reaches for the next hold
    const trail = -theta * 0.7;                                                 // legs lag behind the swing
    return { torso: theta * 0.85, plant: 'hand', grip: g, head: -0.25 - theta * 0.3, sh, el,
      hip: fast ? [0.9 + trail, 0.7 + trail] : [0.35 + trail, 0.15 + trail], kn: fast ? [-1.7, -1.5] : [-0.5, -0.35], tail: -0.7 - theta, lift: 0 };
  },
  // a leap changes shape through the arc: arms up and knees tucked while rising,
  // then arms spread for balance and legs reaching for the ground as it falls
  leap(sp, vy) {
    const f = Math.max(0, Math.min(1, (vy + 30) / 70));     // 0 = launching upward … 1 = about to land
    return { torso: lerp(0.15, 0.6, f), plant: 'none', head: lerp(-0.5, 0.1, f),
      sh: [lerp(2.9, 1.2, f), lerp(2.6, 0.7, f)], el: [lerp(-0.2, -0.5, f), lerp(-0.4, -0.3, f)],
      hip: [lerp(1.5, 0.75, f), lerp(1.2, 0.35, f)], kn: [lerp(-2.0, -0.45, f), lerp(-1.8, -0.3, f)], tail: lerp(1.3, 0.3, f), lift: 0 };
  },
  land(sp, k) { // k: 1 at touchdown → 0 recovered
    const L = sp.posture === 'biped' ? 0.5 : lean0(sp) + 0.2;
    return { torso: L + 0.25 * k, plant: 'all', head: -L * 0.6, sh: [0.7 + 0.3 * k, 0.5 + 0.3 * k], el: [-0.2, -0.2], hip: [1.0 + 0.4 * k, 0.8 + 0.4 * k], kn: [-1.6 - 0.4 * k, -1.6 - 0.4 * k], tail: 1, lift: 0 };
  },
  sit(sp, t) { return { torso: 0.18 + Math.sin(t * 1.7) * 0.02, plant: 'feet', head: Math.sin(t * 0.5) * 0.25, sh: [0.45, 0.3], el: [-0.9, -0.7], hip: [1.55, 1.45], kn: [-1.6, -1.6], tail: 1.2, sitting: true, lift: 0 }; },
  scratch(sp, t) { const b = P.sit(sp, t); return { ...b, sh: [2.6 + Math.sin(t * 16) * 0.12, 0.3], el: [-2.1, -0.7], head: 0.35 }; },
  look(sp, t) { return P.stand(sp, t, { look: Math.sin(t * 1.3) * 0.45 }); },
  slump(sp, t) { return { torso: 0.6, plant: 'feet', head: 0.75, sh: [0.6, 0.4], el: [-0.3, -0.2], hip: [1.55, 1.45], kn: [-1.6, -1.6], tail: 1.3, sitting: true, lift: 0 }; },
  sleep(sp, t) { return { torso: 1.52, plant: 'all', head: 0.5 + Math.sin(t * 0.8) * 0.04, sh: [1.4, 1.2], el: [-1.6, -1.6], hip: [1.6, 1.4], kn: [-2.0, -2.0], tail: 1.4, sitting: true, lying: true, lift: 0 }; },
  // asking: rear up on the hind legs and wave, with an excited little hop now and then
  wave(sp, t) {
    const w = t * 9, hop = pos(Math.sin(t * 3.1)) > 0.9 ? 1.6 * Math.sin((t * 3.1 % TAU) * 3) : 0;
    return { torso: sp.posture === 'biped' ? 0.05 : 0.28, plant: 'feet', head: -0.4, sh: [2.95 + Math.sin(w) * 0.35, 0.35], el: [-0.5 + Math.sin(w + 1) * 0.45, -0.5],
      hip: [0.15, -0.1], kn: [-0.2, -0.15], tail: 0.8, lift: pos(hop) };
  },
  talk(sp, t) { const b = P.stand(sp, t); return { ...b, sh: [b.sh[0] + 0.5 + Math.sin(t * 5) * 0.3, b.sh[1]], el: [-0.8 + Math.sin(t * 5 + 1) * 0.3, b.el[1]], head: b.head + Math.sin(t * 6) * 0.08 }; },
  // the Chief's rest poses on his platform (see chief.js); slow breathing keeps them alive
  lieSide(sp, t) { const br = Math.sin(t * 1.1) * 0.03;   // on his side, propped up on one elbow, legs stretched out behind
    return { torso: 1.2 + br, plant: 'all', head: -0.95 + Math.sin(t * 0.4) * 0.15, sh: [0.15, 0.55], el: [1.35, 1.1], hip: [-1.25, -0.95], kn: [0.1, -0.5], tail: 1.2, sitting: true, lying: true, lift: 0 }; },
  lieBack(sp, t) { const br = Math.sin(t * 1.1) * 0.03;   // flat on his back, hands on his belly, one knee up
    return { torso: -1.5 + br, plant: 'all', head: -0.15 + Math.sin(t * 0.35) * 0.12, sh: [1.15, 0.95], el: [-2.0, -1.8], hip: [2.75, 1.6], kn: [-2.55, -0.15], tail: 1.2, sitting: true, lying: true, lift: 0 }; },
  lean(sp, t) { const br = Math.sin(t * 1.4) * 0.02;      // sitting back against the trunk, legs out, hands in his lap
    return { torso: -0.32 + br, plant: 'feet', head: 0.2 + Math.sin(t * 0.5) * 0.2, sh: [0.55, 0.35], el: [-1.15, -0.95], hip: [1.45, 1.6], kn: [-0.45, -0.2], tail: 1.2, sitting: true, lift: 0 }; },
  chestbeat(sp, t) {
    const f = Math.sin(t * 16);
    return { torso: 0.02, plant: 'feet', head: -0.4, sh: [1.25 + 0.3 * f, 1.25 - 0.3 * f], el: [-2.25, -2.25], hip: [0.12, -0.1], kn: [-0.1, -0.05], lift: 0, tail: 0 };
  }
};
export const POSE_KEYS = ['torso', 'head', 'lift', 'tail'];
/** Blend two poses (b at weight w) so moves flow into each other instead of snapping. */
export function blendPose(a, b, w) {
  if (!a || w >= 1) return b;
  const o = { ...b };
  for (const k of POSE_KEYS) o[k] = lerp(a[k] ?? b[k] ?? 0, b[k] ?? 0, w);
  for (const k of ['sh', 'el', 'hip', 'kn']) o[k] = [lerp(a[k][0], b[k][0], w), lerp(a[k][1], b[k][1], w)];
  return o;
}

export const dirDown = a => [Math.sin(a), Math.cos(a)];
/** Forward kinematics → joint positions, facing right, pelvis at (0,0). */
export function fk(sp, q) {
  const tu = [Math.sin(q.torso), -Math.cos(q.torso)], ch = [tu[0] * sp.tl, tu[1] * sp.tl];
  const ha = q.torso * 0.85 + (q.head || 0), hd = [Math.sin(ha), -Math.cos(ha)];
  const head = [ch[0] + hd[0] * sp.neck, ch[1] + hd[1] * sp.neck];
  const arm = i => { const e = dirDown(q.sh[i]), el = [ch[0] + e[0] * sp.ua, ch[1] + e[1] * sp.ua], h = dirDown(q.sh[i] + q.el[i]); return [el, [el[0] + h[0] * sp.la, el[1] + h[1] * sp.la]]; };
  const leg = i => { const k = dirDown(q.hip[i]), kn = [k[0] * sp.ul, k[1] * sp.ul], f = dirDown(q.hip[i] + q.kn[i]); return [kn, [kn[0] + f[0] * sp.ll, kn[1] + f[1] * sp.ll]]; };
  return { ch, head, ha, arms: [arm(0), arm(1)], legs: [leg(0), leg(1)] };
}

/**
 * Draw one creature. at = { x, y, mode: 'ground' (y = surface) | 'hand' (y = branch, x = grip x) | 'pelvis' (x,y = pelvis) }
 * facing = 1 right / -1 left. scale for depth.
 */
export function drawApe(fb, key, q, at, facing, scale = 1, t = 0) {
  const sp = SPECIES[key], k = fk(sp, q), s = scale, f = facing;
  // place the body
  let ox, oy;
  if (at.mode === 'ground') {
    let low = 0;
    const pts = [k.legs[0][1], k.legs[1][1]]; if (q.plant === 'all') pts.push(k.arms[0][1], k.arms[1][1]);
    if (q.sitting) pts.push([0, sp.pr * 0.8]);
    for (const p of pts) low = Math.max(low, p[1] + sp.lr * 0.6);
    ox = at.x; oy = at.y - (low + (q.lift || 0)) * s;
  } else if (at.mode === 'hand') {
    const h = k.arms[q.grip][1]; ox = at.x - h[0] * s * f; oy = at.y - (h[1] - sp.ar * 0.5) * s;
  } else { ox = at.x; oy = at.y; }
  const X = p => ox + p[0] * s * f, Y = p => oy + p[1] * s;
  const limb = (i, far) => {
    const m = far ? sp.mf : sp.m, [el, hd] = k.arms[i];
    fb.cap(X(k.ch), Y(k.ch), X(el), Y(el), sp.ar * 1.15 * s, sp.ar * s, m); fb.cap(X(el), Y(el), X(hd), Y(hd), sp.ar * s, sp.ar * 0.9 * s, m);
    fb.ell(X(hd), Y(hd), sp.ar * 1.1 * s, sp.ar * 0.9 * s, far ? sp.mf : sp.mface.b ? mat(sp.face.map(v => (v + sp.fur[0]) / 2)) : m);
  };
  const leg = (i, far) => {
    const m = far ? sp.mf : sp.m, [kn, ft] = k.legs[i];
    fb.cap(X([0, 0]), Y([0, 0]), X(kn), Y(kn), sp.lr * 1.25 * s, sp.lr * s, m); fb.cap(X(kn), Y(kn), X(ft), Y(ft), sp.lr * s, sp.lr * 0.9 * s, m);
    fb.ell(X(ft) + sp.lr * 0.6 * s * f, Y(ft), sp.lr * 1.1 * s, sp.lr * 0.7 * s, m);
  };
  // far side
  leg(1, true); limb(1, true);
  if (sp.tail) { const a = (q.tail ?? 0.5), base = [-sp.pr * 0.6, -sp.pr * 0.2]; let p0 = base, ang = -Math.PI / 2 - a; const segs = Math.max(2, Math.round(sp.tail / 2.5));
    for (let i = 0; i < segs; i++) { ang += (key === 'ringer' ? 0.32 : 0.1) * (1 + Math.sin(t * 1.5 + i) * 0.2); const p1 = [p0[0] + Math.cos(ang) * sp.tail / segs, p0[1] - Math.sin(ang) * sp.tail / segs]; fb.cap(X(p0), Y(p0), X(p1), Y(p1), sp.lr * 0.8 * s, sp.lr * 0.55 * s, sp.mf); p0 = p1; } }
  // body
  fb.cap(X([0, 0]), Y([0, 0]), X(k.ch), Y(k.ch), sp.pr * s, sp.tr * s, sp.m);
  if (key === 'chief') { const mid = [k.ch[0] * 0.45 - Math.cos(q.torso) * sp.tr * 0.35, k.ch[1] * 0.45 - Math.sin(q.torso) * sp.tr * 0.35]; fb.ell(X(mid), Y(mid), sp.tr * 0.9 * s, sp.tr * 0.55 * s, mat([150, 152, 160]), q.torso * f + Math.PI / 2); }
  if (key === 'smith') fb.cap(X([Math.cos(q.torso) * 1.6, Math.sin(q.torso) * 1.6]), Y([Math.cos(q.torso) * 1.6, Math.sin(q.torso) * 1.6]), X([k.ch[0] * 0.8 + Math.cos(q.torso) * 2.2, k.ch[1] * 0.8 + Math.sin(q.torso) * 2.2]), Y([k.ch[0] * 0.8 + Math.cos(q.torso) * 2.2, k.ch[1] * 0.8 + Math.sin(q.torso) * 2.2]), 2 * s, 2.3 * s, mat([96, 62, 38]));
  if (key === 'archivist') for (const i of [0, 1]) { const [el] = k.arms[i]; fb.cap(X(el), Y(el), X([el[0] - 0.5, el[1] + 2.5]), Y([el[0] - 0.5, el[1] + 2.5]), 1.1 * s, 0.4 * s, i ? sp.mf : sp.m); } // shaggy arm hair
  // head
  const hx = X(k.head), hy = Y(k.head), hr = sp.hr * s, fwd = [Math.cos(k.ha) * f, Math.sin(k.ha)];
  if (key === 'chief') fb.ell(hx - fwd[0] * hr * 0.3, hy - hr * 0.55, hr * 0.7, hr * 0.8, sp.m); // crest
  fb.ell(hx, hy, hr, hr * 0.95, sp.m);
  const faceC = [hx + fwd[0] * hr * 0.45, hy + fwd[1] * hr * 0.45 + hr * 0.2];
  if (key === 'archivist') fb.ell(hx + fwd[0] * hr * 0.2, hy + hr * 0.1, hr * 1.15, hr * 0.75, sp.mface); // cheek pads
  if (key === 'scout') fb.ell(faceC[0], faceC[1] - hr * 0.1, hr * 0.72, hr * 0.68, mat([232, 226, 214], { rim: 0.2 }));      // white face ring
  fb.ell(faceC[0], faceC[1], hr * 0.58, hr * 0.52, sp.mface);
  if (key === 'inspector') { fb.cap(faceC[0] - fwd[0] * hr * 0.2, faceC[1] - hr * 0.5, faceC[0] + fwd[0] * hr * 0.55, faceC[1] + hr * 0.1, hr * 0.22, hr * 0.28, mat([214, 48, 46])); fb.put(faceC[0] - fb.ox, faceC[1] + hr * 0.1, [80, 120, 210]); fb.ell(faceC[0] - fwd[0] * hr * 0.3, faceC[1] + hr * 0.6, hr * 0.5, hr * 0.32, mat([224, 196, 86])); }
  if (key === 'writer') fb.put(faceC[0] + fwd[0] * hr * 0.4 - fb.ox, faceC[1] + hr * 0.25, [210, 126, 140]);
  if (key === 'ringer') fb.ell(faceC[0] - fwd[0] * hr * 0.2, faceC[1] + hr * 0.6, hr * 0.45, hr * 0.42, sp.mf); // throat beard
  // eye: one dark pixel with a glint of light
  const ex = hx + fwd[0] * hr * 0.45 - fb.ox, ey = hy - hr * 0.2;
  fb.put(ex, ey, key === 'scout' || key === 'chief' || key === 'writer' || key === 'ringer' ? [10, 8, 8] : [24, 16, 14]);
  if (key === 'archivist') { for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) fb.put(ex + dx, ey + dy, [210, 200, 160]); fb.put(ex, ey, [24, 16, 14]); } // spectacles
  // accessories
  if (key === 'chief') for (let i = 0; i < 3; i++) fb.cap(hx - fwd[0] * hr * 0.4 + (i - 1) * 1.6 * s * f, hy - hr * 1.1, hx - fwd[0] * hr * 0.8 + (i - 1) * 2.4 * s * f, hy - hr * 2.4 - (i === 1 ? 1.5 : 0) * s, 0.9 * s, 0.5 * s, mat(i === 1 ? C.gold : C.red));
  if (key === 'scout') fb.cap(hx - fwd[0] * hr, hy - hr * 0.35, hx + fwd[0] * hr * 0.3, hy - hr * 0.75, 0.9 * s, 0.9 * s, mat([60, 150, 170]));  // bandana
  if (key === 'sage') { fb.cap(hx - fwd[0] * hr, hy - hr * 0.45, hx + fwd[0] * hr * 0.4, hy - hr * 0.8, 0.8 * s, 0.8 * s, mat([80, 110, 200])); for (let i = 0; i < 4; i++) fb.put(X(k.ch) + (i - 1.5) * s - fb.ox, Y(k.ch) + 1.5 * s + Math.abs(i - 1.5) * 0.5, [120, 170, 255]); }
  if (key === 'ringer') fb.cap(X(k.ch) - 2 * s * f, Y(k.ch) + 0.5 * s, X(k.ch) + 2 * s * f, Y(k.ch) + 1 * s, 1 * s, 1 * s, mat(C.gold)); // scarf
  if (key === 'writer') fb.cap(hx - fwd[0] * hr * 0.4, hy - hr * 0.5, hx - fwd[0] * hr * 1.6, hy - hr * 2, 0.6 * s, 0.4 * s, mat([236, 232, 222])); // quill behind the ear
  // near side
  leg(0, false); limb(0, false);
  const hand = k.arms[0][1], hX = X(hand), hY = Y(hand);
  if (key === 'chief' && q.plant !== 'all') fb.cap(hX, hY - 9 * s, hX, hY + 3 * s, 0.8 * s, 0.8 * s, mat(C.wood));
  if (key === 'smith' && q.plant !== 'hand') { fb.cap(hX, hY, hX + 3 * s * f, hY - 2 * s, 0.6 * s, 0.6 * s, mat(C.wood)); fb.ell(hX + 3.5 * s * f, hY - 2.4 * s, 1.5 * s, 1.1 * s, mat([120, 126, 136])); }
  if (key === 'inspector' && q.plant !== 'all') { fb.cap(hX, hY, hX + 2 * s * f, hY - 2.5 * s, 0.5 * s, 0.5 * s, mat(C.wood)); fb.ell(hX + 2.6 * s * f, hY - 3.6 * s, 1.5 * s, 1.5 * s, mat([180, 220, 230], { rim: 0.8 })); }
  if (key === 'ringer' && q.plant !== 'all') fb.ell(hX, hY + 1.6 * s, 1.5 * s, 1.8 * s, mat(C.gold));
  if (key === 'scout' && q.plant === 'feet' && !q.sitting) fb.ell(X([0, 0]) - 1.5 * s * f, Y([0, 0]) + 0.5 * s, 1.8 * s, 1.4 * s, mat([120, 90, 50])); // satchel
  return { headX: hx, headY: hy - hr };
}


// how each tree-swinger brachiates: swing amplitude and half-period
export const AGILE = { 'brachiate-fast': { amp: 0.95, T: 0.42 }, brachiate: { amp: 0.7, T: 0.55 }, 'brachiate-slow': { amp: 0.45, T: 0.85 } };
export const bodyLen = sp => (sp.ua + sp.la) * 0.95 + sp.tl * 0.55;
