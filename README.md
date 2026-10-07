# 갤럭시 3D 뷰어

갤럭시로 찍은 3D 사진(HEIC)·3D 영상(MV-HEVC mp4)을 왼눈·오른눈으로 풀어 매직아이(평행법·교차법)로 보는 웹앱.

- 웹: https://leftdrawer.github.io/galaxy3d-viewer/ — 파일을 끌어다 놓으면 브라우저 안에서 바로 변환해 보여 준다. 파일은 기기 밖으로 나가지 않는다.
- PC 변환기: `python core/g3d.py convert <파일|폴더>` → SBS jpg/mp4 (`docs/PHASE1.md`)

## 구조

| 경로 | 내용 |
| --- | --- |
| `web/` | 정적 웹앱. 영상은 FFmpeg 8.1 wasm(`wasm/`)으로 두 시점을 풀고 WebCodecs로 SBS mp4를 만든다. 사진은 libheif-js |
| `wasm/` | FFmpeg 최소 빌드(mov + hevc) + `g3d_dec.c`. GitHub Actions에서 빌드 |
| `core/` | Python 변환기와 pytest |
| `docs/` | 계획서, 실측 파일 구조(`FORMAT.md`), 단계 보고 |

## 테스트

```
python -m pytest core -v     # samples/ 필요
node web/stereo.test.mjs
node web/heic.test.mjs       # samples/ 필요
```

## 라이선스 참고

FFmpeg(LGPL 2.1+, 이 빌드는 GPL 구성요소 없음), libheif(LGPL 3), mediabunny(MPL 2.0)를 사용한다. 각 라이선스는 `web/vendor/`와 각 프로젝트 저장소에 있다.
