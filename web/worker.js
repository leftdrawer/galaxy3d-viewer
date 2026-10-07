// 무거운 일(영상 변환, HEIC 디코딩)을 화면 밖에서 처리한다. 파일은 이 기기 밖으로 나가지 않는다.
import { estimateDx, judge } from './stereo.js';
import { decodeStereoHeic, grayPair } from './heic.js';

let g3d, heif, mb;
const post = (msg, transfer) => postMessage(msg, transfer);

onmessage = async ({ data: { kind, file } }) => {
  try {
    if (kind === 'video') await convertVideo(file);
    else await decodePhoto(file);
  } catch (e) {
    post({ type: 'error', message: e?.message || String(e) });
  }
};

async function decodePhoto(file) {
  post({ type: 'status', text: '사진을 푸는 중…' });
  heif ??= await (await import('./vendor/libheif-bundle.mjs')).default();
  const t0 = performance.now();
  const { left, right } = await decodeStereoHeic(heif, new Uint8Array(await file.arrayBuffer()));
  const s = estimateDx(grayPair(left, right), 2 * left.width, left.width, left.height, 0, left.width);
  const { swap, warn } = judge([s]);
  const [l, r] = await Promise.all([left, right].map((i) => createImageBitmap(new ImageData(i.data, i.width, i.height))));
  post({ type: 'photo', left: swap ? r : l, right: swap ? l : r, warn, sec: (performance.now() - t0) / 1000 }, [l, r]);
}

const OPEN_ERR = {
  [-1]: '영상을 열지 못했습니다.',
  [-3]: '영상 트랙이 없습니다.',
  [-6]: '디코더를 열지 못했습니다.',
  [-7]: '영상 크기가 이상합니다.',
  [-10]: '10bit·HDR 영상은 아직 지원하지 않습니다.',
};

async function pickEncoder(width, height, fps) {
  const base = { width, height, framerate: fps, bitrate: Math.round(width * height * fps * 0.12), latencyMode: 'quality' };
  const cands = [
    ['avc', { codec: 'avc1.640033', avc: { format: 'avc' } }], // H.264 High 5.1
    ['avc', { codec: 'avc1.640032', avc: { format: 'avc' } }], // High 5.0 (3840×1080@30은 5.0 범위)
    ['hevc', { codec: 'hvc1.1.6.L153.B0', hevc: { format: 'hevc' } }],
  ];
  for (const [codec, extra] of cands) {
    const cfg = { ...base, ...extra };
    if ((await VideoEncoder.isConfigSupported(cfg)).supported) return { codec, cfg };
  }
  throw new Error(`이 기기는 ${width}×${height} 영상 인코딩을 지원하지 않습니다.`);
}

async function convertVideo(file) {
  if (!('VideoEncoder' in self)) throw new Error('이 브라우저는 영상 인코딩(WebCodecs)을 지원하지 않습니다. 최신 크롬을 써 주세요.');
  post({ type: 'status', text: '변환 엔진을 불러오는 중…' });
  g3d ??= await (await import('./g3d.mjs')).default();
  mb ??= await import('./vendor/mediabunny.min.mjs');
  const M = g3d, fn = (name, ret = 'number', args = []) => M.cwrap(name, ret, args);

  try { M.FS.mkdir('/in'); } catch {}
  M.FS.mount(M.FS.filesystems.WORKERFS, { files: [file] }, '/in');
  try {
    const r = fn('g3d_open', 'number', ['string'])('/in/' + file.name);
    // HEVC가 아니거나(-4) 시점이 1개(-5): SBS 영상이거나 3D 정보가 빠진 파일 → 화면에서 바로 재생해 본다
    if (r === -4 || r === -5) return post({ type: 'flat-video' });
    if (r < 0) throw new Error(OPEN_ERR[r] ?? `영상 열기 오류 ${r}`);

    const W = fn('g3d_width')(), H = fn('g3d_height')(), fps = fn('g3d_fps')() || 30;
    const total = fn('g3d_nb_frames')() || Math.round((fn('g3d_duration_us')() / 1e6) * fps);
    const next = fn('g3d_next'), ptsUs = fn('g3d_pts_us'), ptr = fn('g3d_sbs')();
    const SW = 2 * W, size = (SW * H * 3) / 2;
    const { codec, cfg } = await pickEncoder(SW, H, fps);

    const { Output, Mp4OutputFormat, BufferTarget, EncodedVideoPacketSource, EncodedAudioPacketSource,
      EncodedPacket, EncodedPacketSink, Input, BlobSource, ALL_FORMATS } = mb;
    const out = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const vsrc = new EncodedVideoPacketSource(codec);
    out.addVideoTrack(vsrc, { frameRate: fps });

    // 오디오는 원본 패킷을 그대로 옮긴다 (재인코딩 없음)
    const audio = [];
    let asrc, aconf, ai = 0;
    const at = await new Input({ source: new BlobSource(file), formats: ALL_FORMATS }).getPrimaryAudioTrack();
    if (at?.codec) {
      aconf = await at.getDecoderConfig();
      asrc = new EncodedAudioPacketSource(at.codec);
      out.addAudioTrack(asrc);
      for await (const p of new EncodedPacketSink(at).packets()) audio.push(p);
    }
    const audioUntil = async (t) => {
      for (; ai < audio.length && audio[ai].timestamp <= t; ai++)
        await asrc.add(audio[ai], ai === 0 ? { decoderConfig: aconf } : undefined);
    };
    await out.start();

    let chain = Promise.resolve(), failed;
    const enc = new VideoEncoder({
      output: (chunk, meta) => {
        chain = chain.then(async () => {
          const p = EncodedPacket.fromEncodedChunk(chunk);
          if (asrc) await audioUntil(p.timestamp);
          await vsrc.add(p, meta);
        });
      },
      error: (e) => (failed = e),
    });
    enc.configure(cfg);

    // 앞·중간·끝 세 프레임으로 좌우 검산
    const picks = new Set([Math.min(15, total - 1), total >> 1, Math.max(0, total - 16)]);
    const samples = [], t0 = performance.now(), gop = Math.round(fps * 2);
    let n = 0, r2;
    post({ type: 'status', text: '3D 영상을 변환하는 중…' });
    while ((r2 = next()) === 1) {
      if (failed) throw failed;
      const pix = M.HEAPU8.subarray(ptr, ptr + size); // 메모리가 늘면 HEAPU8이 바뀌므로 매번 새로 잡는다
      if (picks.has(n)) samples.push(estimateDx(pix, SW, W, H, 0, W));
      const frame = new VideoFrame(pix, { format: 'I420', codedWidth: SW, codedHeight: H,
        timestamp: Math.round(ptsUs()), duration: Math.round(1e6 / fps) });
      enc.encode(frame, { keyFrame: n % gop === 0 });
      frame.close();
      n++;
      if (n % 5 === 0) post({ type: 'progress', done: n, total, fps: n / ((performance.now() - t0) / 1000) });
      while (enc.encodeQueueSize > 3) await new Promise((res) => enc.addEventListener('dequeue', res, { once: true }));
    }
    if (r2 < 0) throw new Error(OPEN_ERR[r2] ?? `디코딩 오류 ${r2}`);
    await enc.flush();
    await chain;
    if (failed) throw failed;
    if (asrc) await audioUntil(Infinity);
    enc.close();
    vsrc.close();
    asrc?.close();
    await out.finalize();

    const { swap, warn } = judge(samples);
    post({ type: 'video', blob: new Blob([out.target.buffer], { type: 'video/mp4' }), swap, warn,
      frames: n, sec: (performance.now() - t0) / 1000, codec: cfg.codec });
  } finally {
    fn('g3d_close', null)();
    M.FS.unmount('/in');
  }
}
