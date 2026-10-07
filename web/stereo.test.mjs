// node web/stereo.test.mjs
import assert from 'node:assert/strict';
import { estimateDx, judge } from './stereo.js';

// 무늬 있는 오른눈 그림을 만들고, 왼눈은 12px 오른쪽으로 민 그림. 둘을 SBS로 붙인다.
const w = 640, h = 360, shift = 12;
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const base = new Float32Array((w + shift) * h);
for (let i = 0; i < base.length; i++) base[i] = rnd() * 255;
const blur = (x, y) => { let s = 0; for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) s += base[Math.min(h - 1, Math.max(0, y + j)) * (w + shift) + Math.min(w + shift - 1, Math.max(0, x + i))]; return s / 25; };
const sbs = new Uint8Array(2 * w * h);
for (let y = 0; y < h; y++)
  for (let x = 0; x < w; x++) {
    sbs[y * 2 * w + x] = blur(x, y);              // 왼눈: 물체가 shift 만큼 오른쪽
    sbs[y * 2 * w + w + x] = blur(x + shift, y);  // 오른눈
  }

const ok = estimateDx(sbs, 2 * w, w, h, 0, w, 640);
assert.ok(ok.n >= 30 && Math.abs(ok.dx - shift) <= 1, JSON.stringify(ok));
const rev = estimateDx(sbs, 2 * w, w, h, w, 0, 640);
assert.ok(Math.abs(rev.dx + shift) <= 1, JSON.stringify(rev));

assert.equal(judge([{ dx: 10, n: 100 }]).swap, false);
assert.equal(judge([{ dx: -10, n: 100 }, { dx: -8, n: 100 }]).swap, true);
assert.match(judge([{ dx: 10, n: 3 }]).warn, /확인하지 못/);
assert.match(judge([{ dx: 10, n: 99 }, { dx: 10, n: 99 }, { dx: -10, n: 99 }]).warn, /엇갈/);
console.log('stereo ok', ok, rev);
