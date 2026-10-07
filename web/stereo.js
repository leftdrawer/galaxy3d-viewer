// 좌우 순서 검산: 블록 매칭으로 수평 시차 중앙값을 잰다 (core/g3d.py disparity의 브라우저판).
// dx = x(왼쪽 후보) - x(오른쪽 후보). 두 렌즈가 나란한 카메라에선 왼눈 그림의 물체가 더 오른쪽에 찍히므로 dx > 0 이면 순서가 맞다.

const MIN_PATCHES = 30; // 이보다 적으면 판정 불가 (어둡거나 평평한 장면)

// gray: 8bit 밝기 배열. 왼쪽 후보는 x=xl, 오른쪽 후보는 x=xr 에서 시작하는 w×h 영역.
export function estimateDx(gray, stride, w, h, xl, xr, target = 960) {
  const f = Math.max(1, Math.round(w / target));
  const sw = Math.floor(w / f), sh = Math.floor(h / f);
  const shrink = (x0) => {
    const out = new Float32Array(sw * sh);
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++) {
        let s = 0;
        for (let j = 0; j < f; j++) {
          const row = (y * f + j) * stride + x0 + x * f;
          for (let i = 0; i < f; i++) s += gray[row + i];
        }
        out[y * sw + x] = s / (f * f);
      }
    return out;
  };
  const a = shrink(xl), b = shrink(xr);
  const P = 16, R = Math.round(sw * 0.05);
  const found = [];
  for (let y = 0; y + P <= sh; y += P)
    for (let x = R; x + P + R <= sw; x += P) {
      let m = 0, v = 0;
      for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) m += b[(y + j) * sw + x + i];
      m /= P * P;
      for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) v += (b[(y + j) * sw + x + i] - m) ** 2;
      if (v / (P * P) < 40) continue; // 무늬 없는 패치는 매칭이 무의미
      const sads = new Float32Array(2 * R + 1);
      let bestS = 0, best = Infinity;
      for (let s = -R; s <= R; s++) {
        let sad = 0;
        for (let j = 0; j < P; j++) {
          const ra = (y + j) * sw + x + s, rb = (y + j) * sw + x;
          for (let i = 0; i < P; i++) sad += Math.abs(a[ra + i] - b[rb + i]);
        }
        sads[s + R] = sad;
        if (sad < best) { best = sad; bestS = s; }
      }
      let second = Infinity; // 최소점 주변(±2)을 뺀 나머지 중 최소
      for (let s = -R; s <= R; s++) if (Math.abs(s - bestS) > 2) second = Math.min(second, sads[s + R]);
      if (best < second * 0.8) found.push(bestS); // 애매한 매칭(반복 무늬)은 버린다
    }
  if (found.length < MIN_PATCHES) return { dx: 0, n: found.length };
  found.sort((p, q) => p - q);
  return { dx: found[found.length >> 1] * f, n: found.length };
}

// 여러 표본의 판정. 반환 { swap, warn }. 메타데이터와 시차가 다르면 시차를 따른다 (CLAUDE.md 원칙 5).
export function judge(samples) {
  const good = samples.filter((s) => s.n >= MIN_PATCHES);
  if (!good.length) return { swap: false, warn: '시차로 좌우를 확인하지 못했습니다(장면이 어둡거나 평평함). 메타데이터를 따릅니다.' };
  const pos = good.filter((s) => s.dx > 0).length;
  const swap = pos * 2 < good.length;
  const warn = swap ? '시차 검사 결과가 메타데이터와 반대라 좌우를 바꿨습니다.'
    : pos < good.length ? `프레임마다 시차 판정이 엇갈립니다 (정순 ${pos}/${good.length}).` : '';
  return { swap, warn };
}
