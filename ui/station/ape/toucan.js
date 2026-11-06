// The messenger toucan: perches on the Chief's lodge, flies off with the note
// when the Chief asks Claude Code something (link.request), and flies home when
// every open request has its answer (link.reply) or its job has ended.
// Truthful: it is away exactly while a request is open. Pure: no DOM, no clock.

const FLY_S = 2.4;                    // seconds for the flight out or home
export const HOME = { x: 512, y: 14 };   // feet on the lodge roof ridge (world px)
const AWAY = { x: 700, y: -24 };     // off the top of the view, toward the far canopy

export function makeToucan() {
  // phase: 'home' | 'out' | 'away' | 'back'; u: 0..1 along the current flight
  const b = { phase: 'home', u: 0, flap: 0, hop: 0 };
  const smooth = u => u * u * (3 - 2 * u);
  const pathAt = u => {          // a lifting arc: rises fast, then glides off
    const s = smooth(u);
    return { x: HOME.x + (AWAY.x - HOME.x) * s, y: HOME.y + (AWAY.y - HOME.y) * s - Math.sin(Math.PI * u) * 10 };
  };
  return {
    /** Set whether a request is open. `animate` false (replayed history, reduced motion) snaps straight there. */
    setAway(away, animate = true) {
      if (!animate) { b.phase = away ? 'away' : 'home'; b.u = away ? 1 : 0; return; }
      if (away && (b.phase === 'home' || b.phase === 'back')) b.phase = 'out';
      else if (!away && (b.phase === 'away' || b.phase === 'out')) b.phase = 'back';
    },
    get phase() { return b.phase; },
    update(dt) {
      b.flap += dt; b.hop += dt;
      if (b.phase === 'out') { b.u = Math.min(1, b.u + dt / FLY_S); if (b.u >= 1) b.phase = 'away'; }
      else if (b.phase === 'back') { b.u = Math.max(0, b.u - dt / FLY_S); if (b.u <= 0) b.phase = 'home'; }
    },
    /** Where it is and how it looks now, or null while away. */
    pose() {
      if (b.phase === 'away') return null;
      if (b.phase === 'home') return { x: HOME.x, y: HOME.y, flying: false, facing: Math.sin(b.hop * 0.4) > 0.6 ? -1 : 1, wingUp: false };
      const p = pathAt(b.u);
      return { x: p.x, y: p.y, flying: true, facing: b.phase === 'out' ? 1 : -1, wingUp: Math.sin(b.flap * 22) > 0 };
    }
  };
}

const BLACK = [24, 22, 28], WHITE = [238, 230, 200], BILL = [246, 160, 40], BILL_HI = [255, 214, 90], TIP = [40, 30, 30], EYE = [120, 200, 255], RED = [220, 60, 50];

/** Draw it into the framebuffer at world coords (fb.ox holds the camera). ~12 px long with its bill. */
export function drawToucan(fb, p) {
  if (!p) return;
  const f = p.facing, x0 = Math.round(p.x - fb.ox), y0 = Math.round(p.y);
  const put = (dx, dy, c) => fb.put(x0 + dx * f, y0 + dy, c);
  // body (feet at y0), tail behind, white throat, big two-tone bill in front
  for (let dy = -6; dy <= -2; dy++) for (let dx = -3; dx <= 1; dx++) put(dx, dy, BLACK);
  put(-4, -3, BLACK); put(-5, -2, BLACK); put(-5, -1, BLACK);          // tail
  put(1, -5, WHITE); put(2, -5, WHITE); put(1, -4, WHITE); put(2, -4, WHITE); put(1, -3, WHITE);   // throat
  put(1, -7, BLACK); put(0, -7, BLACK); put(1, -6, EYE);                // head and eye
  for (let dx = 2; dx <= 5; dx++) put(dx, -6, dx < 5 ? BILL_HI : TIP);  // bill, top
  for (let dx = 2; dx <= 4; dx++) put(dx, -5, BILL);                    // bill, bottom
  put(-1, -1, RED);                                                      // red under the tail
  if (p.flying) {
    const w = p.wingUp ? -1 : 1;                                         // wing above or below the back
    put(-1, -6 - 2 * (w < 0), BLACK); put(-2, -6 - 3 * (w < 0) + (w > 0 ? 3 : 0), BLACK); put(0, -6 - 2 * (w < 0) + (w > 0 ? 2 : 0), BLACK);
  } else { put(-1, 0, TIP); put(0, 0, TIP); }                            // feet on the ridge
}
