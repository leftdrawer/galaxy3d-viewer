// node web/heic.test.mjs   (samples/ 의 진짜 3D HEIC로 검증, 없으면 건너뜀)
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import libheif from './vendor/libheif-bundle.mjs';
import { decodeStereoHeic, findSterGroup, grayPair } from './heic.js';
import { estimateDx } from './stereo.js';

const dir = new URL('../samples/', import.meta.url);
let files = [];
try { files = readdirSync(dir).filter((f) => /\.heic$/i.test(f)); } catch {}
if (!files.length) { console.log('samples/ 없음 - 건너뜀'); process.exit(0); }

const lib = await libheif();
for (const f of files) {
  const bytes = new Uint8Array(readFileSync(new URL(f, dir)));
  if (bytes[0] === 0xff) {
    await assert.rejects(decodeStereoHeic(lib, bytes), /평면 JPEG/);
    console.log(f, '평면 JPEG 거부 OK');
    continue;
  }
  const t = performance.now();
  const { left, right } = await decodeStereoHeic(lib, bytes);
  const ms = performance.now() - t;
  assert.equal(left.width, 4000); assert.equal(left.height, 3000);
  const r = estimateDx(grayPair(left, right), 2 * left.width, left.width, left.height, 0, left.width);
  assert.ok(r.n >= 30 && r.dx > 0, JSON.stringify(r));
  console.log(f, 'ster', findSterGroup(bytes), 'decode', Math.round(ms), 'ms', 'dx', r);
}
