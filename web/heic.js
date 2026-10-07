// 갤럭시 3D 사진(HEIC) → 왼눈·오른눈 RGBA. 구조 근거: docs/FORMAT.md 3절.
// 좌우는 HEIF 'ster' 엔티티 그룹 [왼쪽, 오른쪽]의 item id로 찾는다. 0번 기본 이미지는 평면용이라 쓰지 않는다.

export const RESEND = 'USB 케이블이나 Quick Share로 원본을 다시 옮겨 주세요.';

// meta > grpl > ster 박스에서 [왼쪽 id, 오른쪽 id]. 없으면 null.
export function findSterGroup(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = (o) => String.fromCharCode(bytes[o + 4], bytes[o + 5], bytes[o + 6], bytes[o + 7]);
  function* boxes(start, end) {
    for (let o = start; o + 8 <= end;) {
      let size = dv.getUint32(o), hdr = 8;
      if (size === 1) { size = Number(dv.getBigUint64(o + 8)); hdr = 16; }
      else if (size === 0) size = end - o;
      if (size < hdr || o + size > end) return;
      yield { type: type(o), start: o + hdr, end: o + size };
      o += size;
    }
  }
  const find = (start, end, t) => { for (const b of boxes(start, end)) if (b.type === t) return b; return null; };
  const meta = find(0, bytes.length, 'meta');
  const grpl = meta && find(meta.start + 4, meta.end, 'grpl'); // meta는 FullBox
  const ster = grpl && find(grpl.start, grpl.end, 'ster');
  if (!ster || ster.end - ster.start < 20) return null;
  const n = dv.getUint32(ster.start + 8); // version/flags(4) group_id(4) num_entities(4)
  return n >= 2 ? [dv.getUint32(ster.start + 12), dv.getUint32(ster.start + 16)] : null;
}

const display = (img) => new Promise((resolve, reject) => {
  const width = img.get_width(), height = img.get_height();
  img.display({ data: new Uint8ClampedArray(width * height * 4), width, height },
    (r) => (r ? resolve(r) : reject(new Error('HEIC 디코딩 실패'))));
});

// lib = libheif-js 모듈. 반환 { left, right } 각각 { data(RGBA), width, height }
export async function decodeStereoHeic(lib, bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8)
    throw new Error(`확장자는 HEIC지만 내용은 평면 JPEG입니다. 옮기는 중에 3D 정보가 사라졌어요. ${RESEND}`);
  const ster = findSterGroup(bytes);
  if (!ster) throw new Error('3D 사진이 아닙니다(스테레오 그룹 없음).');
  const dec = new lib.HeifDecoder();
  const imgs = dec.decode(bytes);
  try {
    const ids = lib.heif_js_context_get_list_of_top_level_image_IDs(dec.decoder);
    const byId = new Map(Array.from(ids, (id, i) => [id, imgs[i]]));
    const [l, r] = ster.map((id) => byId.get(id));
    if (!l || !r) throw new Error('스테레오 그룹이 가리키는 이미지를 찾지 못했습니다.');
    return { left: await display(l), right: await display(r) };
  } finally {
    imgs.forEach((i) => i.free());
    lib.heif_context_free(dec.decoder);
  }
}

// RGBA 두 장 → 같은 크기의 SBS 밝기 배열 (시차 검산용)
export function grayPair(left, right) {
  const { width: w, height: h } = left;
  const g = new Uint8Array(2 * w * h);
  for (const [img, x0] of [[left, 0], [right, w]])
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4, d = img.data;
        g[y * 2 * w + x0 + x] = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8;
      }
  return g;
}
