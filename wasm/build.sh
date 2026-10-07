#!/usr/bin/env bash
# FFmpeg 8.1 최소 구성(mov 디먹서 + hevc 디코더)을 wasm으로 빌드하고 g3d_dec.c를 붙여 web/g3d.mjs·g3d.wasm을 만든다.
# 리눅스 + Emscripten 환경(GitHub Actions)에서 실행. FFmpeg 라이브러리는 wasm/ffbuild에 캐시된다.
set -euo pipefail
FFMPEG_VERSION=8.1
cd "$(dirname "$0")"
emcc --version | head -1

if [ ! -f ffbuild/lib/libavcodec.a ]; then
  curl -fsSL "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" | tar xJ
  (
    cd "ffmpeg-${FFMPEG_VERSION}"
    emconfigure ./configure --prefix="$PWD/../ffbuild" \
      --target-os=none --arch=wasm32 --enable-cross-compile \
      --cc=emcc --cxx=em++ --ar=emar --ranlib=emranlib --nm=emnm \
      --extra-cflags="-O3 -msimd128" --disable-stripping --disable-pthreads \
      --disable-everything --disable-programs --disable-doc --disable-network --disable-autodetect \
      --disable-avdevice --disable-avfilter --disable-swscale --disable-swresample \
      --enable-protocol=file --enable-demuxer=mov --enable-decoder=hevc --enable-parser=hevc
    grep -E "^(HAVE_SIMD128|ARCH_WASM|CONFIG_HEVC_DECODER)=" ffbuild/config.mak
    emmake make -j"$(nproc)"
    emmake make install
  )
fi

emcc -O3 -msimd128 g3d_dec.c -Iffbuild/include -Lffbuild/lib -lavformat -lavcodec -lavutil \
  -sMODULARIZE -sEXPORT_ES6 -sENVIRONMENT=worker -sALLOW_MEMORY_GROWTH -sINITIAL_MEMORY=64MB \
  -sFORCE_FILESYSTEM -lworkerfs.js -sEXPORTED_RUNTIME_METHODS=FS,cwrap,HEAPU8 \
  -o ../web/g3d.mjs
ls -la ../web/g3d.*
