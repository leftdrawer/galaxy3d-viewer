# Phase 1 보고: PC 변환 엔진

## 데모

```
pip install -r core/requirements.txt          # FFmpeg 7.1 이상은 따로 설치(PATH)
python core/g3d.py convert samples --out out  # 폴더 통째로, LR·RL 둘 다
python core/g3d.py convert 파일.mp4 --order lr
python -m pytest core -v                      # samples/ 기준 검증
```

## 보고

`core/g3d.py` 한 파일에 변환기를 넣었다. 영상은 FFmpeg의 `vpos:left/right` 지정자로 두 시점을 골라 `hstack` 후 H.264(CRF 18) mp4로 내고, 오디오는 재인코딩 없이 복사한다. 촬영일·위치 메타데이터도 유지한다. LR·RL을 한 번의 디코딩으로 함께 뽑는다. 사진은 HEIF `ster` 그룹에서 좌우를 찾아 XMP `Position`으로 교차 확인한다. 결과는 JPEG q95(4:4:4) 또는 PNG로 저장하고, 색 프로필(Display P3)과 EXIF를 유지한다. 두 경로 모두 메타데이터 판정을 시차(ORB)로 다시 검산한다. 영상은 앞·중간·끝 세 프레임으로 판정하고, 매칭점 100개 미만인 프레임은 판정에서 뺀다. 시차와 메타데이터가 엇갈리면 시차를 따르고 경고한다. 전송 중 JPEG로 바뀐 평면 파일과 시점이 하나뿐인 영상은 "원본을 다시 옮기세요"로 걸러낸다.

## 테스트 결과 (2026-10-06)

```
core/test_g3d.py::test_disparity_synthetic PASSED
core/test_g3d.py::test_judge PASSED
core/test_g3d.py::test_photo[20261006_035542.heic] PASSED
core/test_g3d.py::test_flat_jpeg_rejected[20261001_112412.heic] PASSED
core/test_g3d.py::test_flat_jpeg_rejected[20261002_151021.heic] PASSED
core/test_g3d.py::test_flat_jpeg_rejected[20261002_152219.heic] PASSED
core/test_g3d.py::test_video[20261001_112343.mp4] PASSED
core/test_g3d.py::test_video[20261006_035550.mp4] PASSED
core/test_g3d.py::test_video[20261006_035612.mp4] PASSED
9 passed in 161.27s
```

영상 테스트 항목: 결과 해상도 = 한쪽 눈의 2배 폭, 비디오·오디오 프레임 수 원본과 동일, 길이 차 1프레임 이하, 결과물 왼쪽 절반이 실제 왼눈(시차 양수).
사진 테스트 항목: 8000×3000, LR 결과 시차 양수 / RL 결과 시차 음수.

전체 샘플 변환(영상 3개 LR+RL, 사진 1장) 127초.

## 게이트

- 샘플 전부 변환 성공: 진짜 3D 파일 4/4 성공, 평면 파일 3개는 의도대로 거부.
- 좌우 판별 자동 테스트: 통과.
- 남은 일: 3D 사진 샘플이 1장뿐이다(계획 3장). 원본 HEIC가 더 들어오면 `pytest`만 다시 돌리면 된다.

## 알려진 한계

- 회전 메타데이터가 있는 영상(세로 촬영 등)은 샘플이 없어 미검증이라 거부한다.
- 사진의 HDR 게인맵은 버린다(SDR SBS만 생성).
- 결과물에 GPS 위치가 남는다. 남에게 공유할 일이 생기면 제거 옵션을 추가한다.
