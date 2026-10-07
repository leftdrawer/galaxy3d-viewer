// 화면: 파일 받기 → (워커에서 변환) → 좌우를 mm 단위로 배치해 그린다.
const $ = (id) => document.getElementById(id);
const CARD_MM = 85.6;

// ---------- 설정 (기기별 저장) ----------
const DEFAULTS = {
  pxPerMm: 96 / 25.4, calibrated: false, mode: 'parallel',
  parallel: { gap: 60, width: 56 }, // 평행법은 중심 간격이 눈 사이(약 63mm)보다 좁아야 한다
  cross: { gap: 110, width: 105 },
  dy: 0, shift: 0, dots: true,
};
let S = structuredClone(DEFAULTS);
try { S = { ...S, ...JSON.parse(localStorage.getItem('g3d-settings') || '{}') }; } catch {}
const save = () => { try { localStorage.setItem('g3d-settings', JSON.stringify(S)); } catch {} };

// ---------- 상태 ----------
// src: { els: [왼눈 소스, 오른눈 소스], rects: [[x,y,w,h] 왼눈, 오른눈], w, h(한쪽 눈) }
let src = null, objectUrl = null, baseName = '', videoGen = 0;
const cv = $('cv'), ctx = cv.getContext('2d'), vid = $('vid');
const worker = new Worker('worker.js', { type: 'module' });

// ---------- 파일 받기 ----------
$('file').addEventListener('change', (e) => e.target.files[0] && openFile(e.target.files[0]));
const drop = $('drop');
for (const t of ['dragenter', 'dragover']) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const t of ['dragleave', 'drop']) drop.addEventListener(t, () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); e.dataTransfer.files[0] && openFile(e.dataTransfer.files[0]); });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => { e.preventDefault(); if (!$('home').hidden && e.dataTransfer.files[0]) openFile(e.dataTransfer.files[0]); });

let current = null;
function openFile(file) {
  current = file;
  baseName = file.name.replace(/\.[^.]+$/, '');
  const ext = file.name.split('.').pop().toLowerCase();
  showError('');
  if (ext === 'heic' || ext === 'heif') return work('photo', file);
  if (ext === 'mp4' || ext === 'mov') return work('video', file);
  if (file.type.startsWith('image/')) return showSbsImage(file);
  showError('지원하지 않는 파일입니다. 갤럭시 3D 원본(HEIC·MP4)이나 SBS 사진·영상을 넣어 주세요.');
}

function work(kind, file) {
  busy(kind === 'video' ? '영상을 여는 중…' : '사진을 여는 중…', 0);
  worker.postMessage({ kind, file });
}

worker.onmessage = async ({ data: m }) => {
  if (m.type === 'status') busy(m.text);
  else if (m.type === 'progress')
    busy(`변환 중 ${m.done}/${m.total || '?'} 프레임 · 초당 ${m.fps.toFixed(1)}프레임`, m.total ? m.done / m.total : 0);
  else if (m.type === 'error') showError(m.message);
  else if (m.type === 'flat-video') showSbsVideo(current, true);
  else if (m.type === 'photo') {
    const { width: w, height: h } = m.left;
    show({ els: [m.left, m.right], rects: [[0, 0, w, h], [0, 0, w, h]], w, h },
      [m.warn, `사진 ${m.sec.toFixed(1)}초`]);
    $('save').hidden = false;
    $('save').removeAttribute('href');
    $('save').onclick = async (e) => { // 누를 때만 SBS JPEG를 만든다 (8000×3000이라 미리 만들면 낭비)
      e.preventDefault();
      const c = new OffscreenCanvas(w * 2, h), g = c.getContext('2d');
      g.drawImage(m.left, 0, 0);
      g.drawImage(m.right, w, 0);
      download(await c.convertToBlob({ type: 'image/jpeg', quality: 0.95 }), `${baseName}_SBS_LR.jpg`);
    };
  } else if (m.type === 'video') {
    await showVideo(m.blob, m.swap);
    $('save').onclick = null;
    $('save').href = objectUrl;
    $('save').download = `${baseName}_SBS_LR.mp4`;
    $('save').hidden = m.swap; // ponytail: 좌우가 뒤집힌 드문 경우엔 저장 대신 화면에서만 바로잡는다
    setMsg([m.warn, `변환 ${m.frames}프레임 ${m.sec.toFixed(1)}초 (${m.codec})`]);
  }
};

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

function busy(text, frac) {
  $('busy').hidden = false;
  $('busytext').textContent = text;
  if (frac !== undefined) $('barfill').style.width = `${Math.round(frac * 100)}%`;
}
function showError(text) {
  $('busy').hidden = true;
  $('err').hidden = !text;
  $('err').textContent = text;
  if (text) home();
}

async function showSbsImage(file) {
  const bm = await createImageBitmap(file);
  const w = bm.width / 2;
  show({ els: [bm, bm], rects: [[0, 0, w, bm.height], [w, 0, w, bm.height]], w, h: bm.height });
}

async function showSbsVideo(file, fromMp4) {
  await showVideo(file, false);
  if (fromMp4 && vid.videoWidth / vid.videoHeight < 2.2) {
    showError('3D 영상이 아닙니다(시점이 하나뿐). 옮기는 중에 3D 정보가 사라졌을 수 있어요. USB 케이블이나 Quick Share로 원본을 다시 옮겨 주세요.');
  }
}

async function showVideo(blob, swap) {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(blob);
  vid.src = objectUrl;
  await new Promise((res, rej) => { vid.onloadedmetadata = res; vid.onerror = () => rej(new Error('영상을 재생할 수 없습니다.')); })
    .catch((e) => showError(e.message));
  const w = vid.videoWidth / 2, h = vid.videoHeight;
  const halves = [[0, 0, w, h], [w, 0, w, h]];
  show({ els: [vid, vid], rects: swap ? halves.reverse() : halves, w, h });
  $('play').hidden = $('seek').hidden = false;
  $('seek').max = vid.duration || 1;
  vid.play().catch(() => {}); // 소리 자동재생이 막히면 재생 버튼으로
  const gen = ++videoGen; // 이전 영상의 프레임 콜백이 남아 루프가 겹치지 않게
  const tick = () => { if (gen === videoGen && src?.els[0] === vid) { draw(); vid.requestVideoFrameCallback(tick); } };
  vid.requestVideoFrameCallback(tick);
}

// ---------- 보기 ----------
function show(s, msgs = []) {
  src = s;
  $('home').hidden = true;
  $('busy').hidden = true;
  $('view').hidden = false;
  $('save').hidden = true;
  if (s.els[0] !== vid) $('play').hidden = $('seek').hidden = true;
  setMsg([...msgs, S.calibrated ? '' : '크기 보정 전 — 조절 → 크기 보정']);
  syncUi();
  resize();
  poke();
}

function home() {
  src = null;
  vid.pause();
  vid.removeAttribute('src');
  $('view').hidden = true;
  $('home').hidden = false;
  $('file').value = '';
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function setMsg(list) { $('msg').textContent = list.filter(Boolean).join(' · '); }

function resize() {
  const dpr = devicePixelRatio || 1;
  cv.width = Math.round(innerWidth * dpr);
  cv.height = Math.round(innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}
addEventListener('resize', resize);

function draw() {
  if (!src) return;
  const vw = innerWidth, vh = innerHeight, mm = S.pxPerMm, p = S[S.mode];
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, vw, vh);
  const aspect = src.h / src.w;
  let w = p.width * mm, h = w * aspect;
  if (h > vh * 0.9) { h = vh * 0.9; w = h / aspect; }
  const gap = p.gap * mm, y = (vh - h) / 2;
  const slotX = [vw / 2 - gap / 2 - w / 2, vw / 2 + gap / 2 - w / 2];
  const order = S.mode === 'parallel' ? [0, 1] : [1, 0]; // 슬롯별로 그릴 눈 (0 왼눈, 1 오른눈)
  const sh = Math.abs(S.shift) * (src.w / w); // 깊이 이동: 좌우 그림의 내용을 서로 반대로 민다 (원본 px)
  ctx.imageSmoothingQuality = 'high';
  order.forEach((eye, slot) => {
    const [sx, sy, sw, shh] = src.rects[eye];
    const cut = (eye === 0) === (S.shift > 0) ? sh : 0;
    ctx.drawImage(src.els[eye], sx + cut, sy, sw - sh, shh, slotX[slot], y + (eye === 1 ? S.dy : 0), w, h);
    if (S.dots) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(slotX[slot] + w / 2, Math.max(8, y - 14), 4, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

// ---------- 조작 ----------
const ui = $('ui');
let hideTimer;
function poke() {
  ui.classList.remove('hide');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { if ($('panel').hidden) ui.classList.add('hide'); }, 3500);
}
cv.addEventListener('pointerdown', () => (ui.classList.contains('hide') ? poke() : ui.classList.add('hide')));
ui.addEventListener('pointerdown', poke);

function toggleMode() { S.mode = S.mode === 'parallel' ? 'cross' : 'parallel'; save(); syncUi(); draw(); }
$('mode').onclick = toggleMode;
$('back').onclick = home;
$('adj').onclick = () => { $('panel').hidden = !$('panel').hidden; $('adj').classList.toggle('on', !$('panel').hidden); poke(); };
$('dots').onclick = () => { S.dots = !S.dots; save(); syncUi(); draw(); };
$('reset').onclick = () => {
  S = { ...structuredClone(DEFAULTS), pxPerMm: S.pxPerMm, calibrated: S.calibrated, mode: S.mode };
  save(); syncUi(); draw();
};
$('play').onclick = () => (vid.paused ? vid.play() : vid.pause());
vid.onplay = vid.onpause = () => ($('play').textContent = vid.paused ? '재생' : '일시정지');
vid.ontimeupdate = () => ($('seek').value = vid.currentTime);
$('seek').oninput = (e) => { vid.currentTime = +e.target.value; };

async function fullscreen() {
  try {
    if (document.fullscreenElement) return document.exitFullscreen();
    await $('view').requestFullscreen();
    await screen.orientation?.lock?.('landscape').catch(() => {});
    await navigator.wakeLock?.request('screen').catch(() => {});
  } catch {}
}
$('fs').onclick = fullscreen;
addEventListener('keydown', (e) => {
  if ($('view').hidden || e.target.tagName === 'INPUT') return;
  if (e.key === 's' || e.key === 'S') toggleMode();
  else if (e.key === 'f' || e.key === 'F') fullscreen();
  else if (e.key === ' ' && src?.els[0] === vid) { e.preventDefault(); $('play').click(); }
});

const sliders = [['sWidth', 'vWidth', () => S[S.mode], 'width', 'mm'], ['sGap', 'vGap', () => S[S.mode], 'gap', 'mm'],
  ['sDy', 'vDy', () => S, 'dy', 'px'], ['sShift', 'vShift', () => S, 'shift', 'px']];
for (const [sid, , obj, key] of sliders)
  $(sid).addEventListener('input', (e) => { obj()[key] = +e.target.value; save(); syncUi(); draw(); });

function syncUi() {
  $('mode').textContent = S.mode === 'parallel' ? '평행법' : '교차법';
  $('dots').classList.toggle('on', S.dots);
  for (const [sid, vid_, obj, key, unit] of sliders) {
    $(sid).value = obj()[key];
    $(vid_).textContent = `${obj()[key] > 0 && unit === 'px' ? '+' : ''}${obj()[key]}${unit}`;
  }
  const p = S[S.mode];
  $('gapHint').textContent = S.mode === 'parallel'
    ? (p.gap > 63 ? '평행법은 간격이 63mm(눈 사이)를 넘으면 겹치기 어렵습니다.' : '평행법은 간격 55~63mm가 편합니다.')
    : '교차법은 간격이 넓을수록 크게 볼 수 있습니다.';
}

// ---------- 크기 보정 ----------
const dlg = $('calib'), card = $('card'), cal = $('calScale');
const drawCard = () => { card.style.width = `${CARD_MM * cal.value}px`; card.style.height = `${53.98 * cal.value}px`; };
$('calOpen').onclick = () => { cal.value = S.pxPerMm; drawCard(); dlg.showModal(); };
cal.oninput = drawCard;
$('calCancel').onclick = () => dlg.close();
$('calOk').onclick = () => {
  S.pxPerMm = +cal.value; S.calibrated = true; save(); dlg.close();
  setMsg([]); draw();
};

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
