// node web/heic.unit.test.mjs
// 샘플 파일 없이 ster 그룹 파서와 평면 JPEG 거부를 검사한다.
import assert from 'node:assert/strict';
import { decodeStereoHeic, findSterGroup } from './heic.js';

const u32 = (n) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n);
  return b;
};
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const box = (type, payload) => {
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(type.split('').map((c) => c.charCodeAt(0)), 4);
  out.set(payload, 8);
  return out;
};

const ster = box('ster', concat(u32(0), u32(1), u32(2), u32(154), u32(105)));
const meta = box('meta', concat(u32(0), box('grpl', ster)));
assert.deepEqual(findSterGroup(meta), [154, 105]);

const one = box('ster', concat(u32(0), u32(1), u32(1), u32(7)));
assert.equal(findSterGroup(box('meta', concat(u32(0), box('grpl', one)))), null);
assert.equal(findSterGroup(new Uint8Array(32)), null);

await assert.rejects(
  decodeStereoHeic({}, new Uint8Array([0xff, 0xd8, 0xff, 0xd9])),
  /평면 JPEG/,
);

console.log('heic unit ok');
