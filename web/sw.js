// 오프라인 동작: 앱 파일을 캐시에 두고, 있으면 캐시로 바로 띄운 뒤 뒤에서 새 버전을 받아 둔다(다음 실행에 반영).
// 사용자 파일은 여기를 지나지 않는다(blob URL·워커 메모리에서만 처리).
const CACHE = 'g3d-v1';
const SHELL = ['./', 'index.html', 'app.js', 'worker.js', 'stereo.js', 'heic.js', 'g3d.mjs', 'g3d.wasm',
  'vendor/mediabunny.min.mjs', 'vendor/libheif-bundle.mjs', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', (e) =>
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; });
    if (hit) { net.catch(() => {}); return hit; }
    return net;
  }));
});
