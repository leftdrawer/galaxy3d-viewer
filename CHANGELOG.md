# 변경 이력 (CHANGELOG) — galaxy3d-viewer

> 규칙: 상위 `C:\AI Projects\AGENTS.md`. 최신 항목이 위. 작업 규칙은 `AGENTS.md`.

## 2026-11-18 — astryx 테마 이식으로 UX/UI 정비

- 무엇을 바꿨는지 / 사용자 지시: "astryx와 stageshow를 활용해 웹에 배포된 사이트 UXUI 손보기", 테마만 이식하고 HIG는 보조 기준. Neutral 0.7.16을 화면 기준으로 두고, Figtree를 저장소에 넣어 외부 글꼴 요청 없이 쓰게 했다. 테마 CSS가 비워 둔 글꼴 두께·간격 토큰을 채우고, 카드·끌어놓기 테두리를 구분되는 중립색으로 올렸다. 3D로 그리는 코드와 한국어 문구는 그대로다. stageshow 삽화는 넣지 않았다.
- 왜: 이 페이지는 파일을 골라 입체로 보는 도구라, 사진과 적청 확인을 방해하지 않는 무채색 Neutral이 맞다. 테마 파일만 두면 제목 굵기가 빠지고 라틴 글꼴이 로드되지 않는다. 44px 터치, 포커스, 대비, 라이트/다크, 동작 줄이기는 토큰 밖의 보조 기준이다.
- 관련 파일: `web/index.html`, `web/sw.js`, `web/manifest.webmanifest`, `web/vendor/astryx/`, `web/vendor/astryx-theme-neutral-0.7.16.css`, `DESIGN.md`, `AGENTS.md`
- 작업자: Cursor Cloud Agent (Grok Bot 구록이 경유)
- 남은 일·확인 필요: 샘플 3D 파일로 평행/교차, 조절 패널, 크기 보정 창을 폰 가로 전체화면에서 볼 것. 이미 설치된 앱이 `g3d-v12` 캐시로 글꼴까지 받는지 볼 것.

## 2026-11-17 — Astryx Neutral 뷰어 화면 적용

- Astryx Neutral 0.7.16과 MIT 라이선스를 `web/vendor/`에 고정 포함하고 정적 뷰어 UI를 토큰 기반으로 정리했다. 기존 DOM ID·파일 입력·검정 감상 무대·기기 내 처리 동작을 유지했고 `web/app.js`는 수정하지 않았다. 서비스 워커를 `g3d-v11`로 올리고 테마 CSS를 오프라인 셸에 추가했다.
- 검증: `node web/stereo.test.mjs`, `node --check web/app.js`, `node --check web/sw.js`, 최종 `git diff --check` 통과. Impeccable 검출 결과 없음. 정적 검토로 380px 단일 열, 44px 조작 영역, 포커스 및 동작 줄이기 규칙을 확인했으나 브라우저 시각 검증은 로컬 브라우저 도구 시작 실패로 미완료. 샘플 파일은 열지 않았다.
- 동기화: 로컬 커밋만 진행하며 푸시·배포하지 않음.
- 관련 파일: `web/index.html`, `web/sw.js`, `DESIGN.md`, `web/vendor/astryx-theme-neutral-0.7.16.css`, `web/vendor/astryx-theme-neutral-LICENSE.txt`.
- 작업자: Cue.

## 2026-11-02 — 빠진 기록 보충 (audit_projects.py 점검)

- 기록 보충: 마지막 기록 뒤 커밋 4개가 CHANGELOG에 없어 커밋 기록으로만 적는다(코드는 열지 않음).
  - 2c89354 11-01 03:04 사진/영상 선택 버튼 분리
  - f21045a 11-01 04:02 사진 선택기 방식 비교용 임시 시험 페이지
  - 30442a0 11-01 04:07 폰에서 사진 고르기 방식을 직접 골라 저장
  - 247347a 11-01 16:52 사진 선택기 accept 고정(image/*+HEIC), 임시 시험 페이지 제거, sw v10
- 확인 못 한 것: 누가 작업했는지는 기록 없음.
- 작업자: Grok Bot (은호당님 승인 'A와 C부터', 점검 Page 자동 적용 항목)

## 2026-11-01 — 의존성 버전을 고정하고 배포 전에 pytest를 돌림

- 무엇: `core/requirements.txt`의 numpy·opencv-python·pillow·pillow-heif·pytest를 코드가 부르는 API의 하한으로 고정했다(ster 그룹은 pillow-heif 1.8.0, EXIF는 Pillow 11.1.0, Python 3.12 휠 기준 numpy 1.26.4와 OpenCV 4.10). GitHub Pages 워크플로는 배포 전에 `pytest`와 `web/stereo.test.mjs`를 돌리고, 실패하면 wasm 빌드와 배포로 가지 않는다. 같은 검사는 풀 리퀘스트에서도 돈다. 샘플이 없어도 좌우 판정, 잘못된 입력 거부, FFmpeg 7.1·MV-HEVC 확인, CLI 집계를 검사하는 테스트를 더했다. 변환 동작은 바꾸지 않았다.
- 왜: 버전이 풀려 있으면 설치할 때마다 라이브러리가 달라지고, 테스트가 깨져도 Pages에 올라갔다. 사용자 지시(기본기만 보강, 동작은 유지).
- 동기화: 시작 전 `main`은 `origin/main`과 같았다. 이 변경만 커밋·푸시.
- 작업자: Cursor Cloud Agent / Grok 4.7

## 2026-11-01 — 적청 안경 깊이 점검 페이지를 git에 넣음

- 무엇: 커밋되지 않고 남아 있던 `web/anaglyph-test.html`을 커밋했다. 빨강-청록(적청) 안경으로 보는 깊이 진단용 한 페이지 시험 도구다. 시차(두 눈 어긋남)를 0~80px 슬라이더로 바꿔 보며 오브젝트가 배경보다 앞으로 떠 보이는지, 좌우 번갈아 보기로 정렬을 확인한다. 10-24 '적청 안경 모드 추가'(`5551c1f`) 작업과 이어지는 수동 점검 페이지다. 다른 코드는 바꾸지 않았다.
- 왜: 전체 진단에서 커밋 안 된 파일로 남아 있었다. 사용자 지시("나머지는 진행해").
- 동기화: 시작 전 `git pull --ff-only`, 이 파일과 시험 페이지만 커밋·푸시.
- 작업자: Kiro / Claude Opus 5.5

## 2026-10-31 — 규칙 파일을 AGENTS.md로

- 무엇: `CLAUDE.md`의 작업 규칙을 글자 그대로 `AGENTS.md`로 옮기고 `CLAUDE.md`는 `@AGENTS.md` 한 줄로. `web/stereo.js` 주석의 "CLAUDE.md 원칙 5"를 "AGENTS.md 원칙 5"로. 코드 동작은 그대로.
- 왜: 상위 규칙(규칙은 AGENTS.md에 두고 CLAUDE.md는 불러오기만)과 전체 진단(`C:\AI Projects\CHANGELOG.md` 같은 날 항목). Claude Code만 읽던 규칙을 Kiro·Codex도 읽게. 사용자 지시 "응"(규칙 파일 정리).
- 동기화: 시작 전 `git pull --ff-only`(이미 최신), 이 세 파일과 함께 커밋·푸시. 커밋 안 된 `web/anaglyph-test.html`(10-31 21:06, 다른 작업의 것)은 그대로 둠.
- 기록 보충: 10-24의 커밋 세 개(적청 안경 모드 추가 `5551c1f`, 앱 아이콘 교체 `42e4bb3`·`518cca4`)는 이 파일을 만들기(10-27) 전 것이라 여기 없다.
- 작업자: Kiro / Claude Opus 5.5

## 2026-10-27 — 웹 뷰어 화면을 Apple HIG 기준으로 다듬음

- 사용자 지시: `C:\AI Projects` 아래 웹페이지는 모두 Apple 디자인 가이드라인(developer.apple.com/kr/design) 기반으로 예쁘게 만들 것
- 적용한 HIG(색상·타이포그래피·레이아웃 페이지를 읽고 반영): 시스템 의미 색과 강조색 하나(tint), 라이트/다크 자동 전환, 텍스트 스타일 단계(큰 제목 34/41, 본문 17, 각주 13), 알약 버튼과 44px 터치 영역, 둥근 묶음 카드(반경 26)와 시트(34), 보기 화면의 조작 층(버튼·패널)에만 유리 재질, 투명도 줄이기·움직임 줄이기 설정 존중, 키보드 포커스 링
- 바꾼 것은 `web/index.html`의 스타일과 `theme-color`뿐. 요소 id·클래스·스크립트는 그대로. 강조색은 노란색에서 시스템 파랑으로 바뀜
- `web/sw.js`: 캐시 이름 `g3d-v6` → `g3d-v7` (이미 설치된 앱이 새 화면을 받도록)
- 확인: 첫 화면을 라이트·다크 모드로 모바일 크기에서 직접 확인함. **파일을 열었을 때의 보기 화면(캔버스, 아래 막대, 조절 패널, 크기 보정 창)은 샘플 파일 없이 확인하지 못함**
- 관련 파일: `web/index.html`, `web/sw.js`
- 작업자: Claude Code / Sonnet 5.5
- 남은 일: 실제 3D 파일로 보기 화면 확인
