// Dev tool: render the station headless to a PNG so Claude can look at it.
//   node scripts/render-station.js out.png [steps] [mode:smith=working,...] [yawSteps]
import zlib from 'node:zlib';
import fs from 'node:fs';
import { makeStation, CREW_IDS } from '../ui/station/scene.js';

const [out = 'station.png', stepsArg = '40', modesArg = '', yawArg = '0'] = process.argv.slice(2);
const modes = Object.fromEntries(CREW_IDS.map(k => [k, k === 'smith' ? 'idle' : 'asleep']));
for (const kv of modesArg.split(',').filter(Boolean)) { const [k, v] = kv.split('='); modes[k] = v; }
let last;
const ops = [];
const ctx = { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData(img) { last = img; ops.length = 0; }, fillRect: (...a) => ops.push([ctx._fs, ...a]), set fillStyle(v) { ctx._fs = v; } };
const canvas = { width: 0, height: 0, getContext: () => ctx, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 848 }) };
const t0 = Date.now();
const st = makeStation(canvas, { modeOf: id => modes[id] });
const t1 = Date.now();
for (let i = 0; i < +yawArg; i++) st.rotate(1);
const n = +stepsArg; for (let i = 0; i < n; i++) st.step(0);
console.log(`init ${t1 - t0} ms, ${((Date.now() - t1) / Math.max(1, n)).toFixed(1)} ms/frame`);
const W = canvas.width, H = canvas.height, img = Uint8ClampedArray.from(last.data);
for (const [fs_, x, y, w, h] of ops) { const c = [parseInt(fs_.slice(1, 3), 16), parseInt(fs_.slice(3, 5), 16), parseInt(fs_.slice(5, 7), 16)]; for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (xx >= 0 && yy >= 0 && xx < W && yy < H) img.set([...c, 255], (yy * W + xx) * 4); }
const k = 2, PW = W * k, PH = H * k, raw = Buffer.alloc((PW * 4 + 1) * PH);
for (let y = 0; y < PH; y++) { raw[y * (PW * 4 + 1)] = 0; for (let x = 0; x < PW; x++) { const s = (Math.floor(y / k) * W + Math.floor(x / k)) * 4, d = y * (PW * 4 + 1) + 1 + x * 4; const a = img[s + 3] / 255; raw[d] = img[s] * a; raw[d + 1] = img[s + 1] * a; raw[d + 2] = img[s + 2] * a; raw[d + 3] = 255; } }
const tbl = []; for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tbl[i] = c >>> 0; }
const crc = b => { let c = -1; for (const x of b) c = tbl[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (ty, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(ty), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ih = Buffer.alloc(13); ih.writeUInt32BE(PW, 0); ih.writeUInt32BE(PH, 4); ih[8] = 8; ih[9] = 6;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
