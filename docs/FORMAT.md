# 갤럭시 3D 파일 구조 실측 보고서 (Phase 0)

- 측정일: 2026-10-06
- 기종: Galaxy S26 Ultra, 광각 23mm(35mm 환산), One UI 최신(파일 메타 `com.android.version=17`)
- 도구: FFmpeg 8.1 (gyan.dev full build), ExifTool 13.59, pillow-heif 1.8.0, OpenCV(ORB)
- 샘플: `samples/` (커밋 안 함)

## 요약

| | 3D 영상 (.mp4) | 3D 사진 (.heic) |
| --- | --- | --- |
| 코덱·컨테이너 | MV-HEVC (Main, 2 레이어), mp4 (`mp42`), AAC 48kHz 스테레오 | HEIF (`mif1, heic, tmap`), 512 타일 그리드 |
| 한쪽 눈 해상도 | 1920×1080, 30fps 또는 29.97fps, SDR bt709 8bit | 4000×3000, 8bit, Display P3 ICC |
| 좌우 찾는 법 | 프레임 Stereo 3D 사이드데이터의 `view` = left/right. FFmpeg `vpos:left` / `vpos:right` 지정자로 바로 선택 | `ster` 엔티티 그룹 `[왼쪽, 오른쪽]` + 아이템별 XMP `steim:Position` |
| 주의 | **view_id 0(기본 레이어) = 오른눈**, view_id 1 = 왼눈. "0번=왼쪽" 가정은 틀림 | 기본(primary) 이미지 0번은 좌우 어느 쪽도 아닌 별도 평면 이미지(오른눈 대비 dx +6, dy +12.5px). 쓰지 않는다 |
| 렌즈 간격 | `baseline=17906` (µm, 17.9mm) | `BaselineFromMultiCal=17.905846` (mm) |
| 주 카메라 | `primary_eye=right` | `MainCameraView=Right` |
| 수평 화각 | 57.389° | 70.358° |
| 수직 시차 | 0px (보정된 쌍) | 0px |

시차 검산은 표본 전부에서 메타데이터와 일치했다(아래 4절). 메타데이터와 시차 판별이 서로 엇갈린 사례는 없다.

### 전송 중 3D가 사라진 파일

`20261001_112412.heic`, `20261002_151021.heic`, `20261002_152219.heic`는 확장자만 .heic이고 내용은 **JPEG**이다(첫 바이트 `FF D8 FF E1`, 2190×1643). MPF 부속 이미지는 27KB 한 장(게인맵으로 추정)뿐이고 스테레오 정보가 없다. 공유·변환 과정에서 평면 사진이 된 것이다. 변환기는 이런 파일을 감지해 "원본으로 다시 옮기세요"를 띄워야 한다(계획서 위험 요소 표).

## 1. 영상 스트림

```
ffprobe -v error -show_entries "format=format_name,duration:format_tags:stream=index,codec_type,codec_name,profile,width,height,r_frame_rate,pix_fmt,color_transfer,color_primaries:stream_tags:stream_side_data" -of default=nw=1 20261006_035550.mp4
```
```
index=0
codec_name=hevc
profile=Main
codec_type=video
width=1920
height=1080
pix_fmt=yuv420p
color_transfer=bt709
color_primaries=bt709
r_frame_rate=30/1
TAG:creation_time=2026-10-05T18:55:59.000000Z
TAG:language=eng
TAG:handler_name=VideoHandle
side_data_type=Stereo 3D
type=unspecified
inverted=0
view=packed
primary_eye=right
baseline=17906
horizontal_disparity_adjustment=204/10000
horizontal_field_of_view=57389/1000
side_data_type=Spherical Mapping
projection=rectilinear
yaw=0
pitch=0
roll=0
index=1
codec_name=aac
profile=LC
codec_type=audio
format_name=mov,mp4,m4a,3gp,3g2,mj2
duration=7.296678
TAG:major_brand=mp42
TAG:compatible_brands=isommp42
TAG:com.android.version=17
TAG:com.android.capture.fps=30.000000
TAG:com.samsung.android.utc_offset=+0900
```

세 영상 모두 같은 구조다. 차이는 `20261006_035612.mp4`가 `r_frame_rate=30000/1001`이라는 점뿐이다. 길이는 각각 19.46초, 7.30초, 12.72초.

## 2. 영상 시점별 좌우

```
ffmpeg -hide_banner -i 20261006_035550.mp4 -filter_complex "[0:v:vpos:left]showinfo[a];[0:v:vpos:right]showinfo[b]" -map [a] -map [b] -frames:v 1 -f null -
```
```
[Parsed_showinfo_0] n:   0 pts:      0 ... s:1920x1080 i:P iskey:1 type:P checksum:6DA32FAA
[Parsed_showinfo_0]   side data - View ID: view id: 1
[Parsed_showinfo_0]   side data - Stereo 3D: type - frame alternate, view - left, primary_eye - right, baseline: 17906, horizontal_disparity_adjustment: 0.0204, horizontal_field_of_view: 57.389
[Parsed_showinfo_1] n:   0 pts:      0 ... s:1920x1080 i:P iskey:1 type:I checksum:FC1A7845
[Parsed_showinfo_1]   side data - View ID: view id: 0
[Parsed_showinfo_1]   side data - Stereo 3D: type - frame alternate, view - right, primary_eye - right, baseline: 17906, horizontal_disparity_adjustment: 0.0204, horizontal_field_of_view: 57.389
```

FFmpeg 8.1에서 `-view_ids`는 스트림 지정자와 함께 쓰면 오류가 난다("Manually selecting views with -view_ids cannot be combined with view selection via stream specifiers"). 계획서의 `-view_ids -1 ... [0:v:view:0]` 대신 `vpos` 지정자를 쓴다.

## 3. 사진 아이템과 그룹

```
python heic_items.py 20261006_035542.heic   # pillow_heif.open_heif → 아이템별 info, XMP steim
```
```
primary idx 0  n 3
0 (4000, 3000) primary  []                                            aux: hdrgainmap(item 55)
1 (4000, 3000)          [('Position', 'Right'), ('MainCameraView', 'Right')]
2 (4000, 3000)          [('Position', 'Left'),  ('MainCameraView', 'Right')]
entity_groups: [{'id': 160, 'type': 'altr', 'entities': [56, 49], 'images': [None, 0]},
                {'id': 161, 'type': 'ster', 'entities': [154, 105], 'images': [2, 1]}]
```

- `ster` 그룹은 HEIF 규격상 `[왼쪽, 오른쪽]` 순서다 → 2번 = 왼눈, 1번 = 오른눈. XMP `Position`과 일치한다.
- `altr` 그룹(56, 49)은 기본 이미지 49(0번)와 그 대체 표현이다. 56은 이미지가 아닌 엔티티(내용 미확인, 좌우 판별과 무관).
- 왼눈 PNG(5.6MB)가 오른눈(7.7MB)보다 작다. 오른쪽이 주 카메라(`MainCameraView=Right`)이고, 왼쪽은 보조 렌즈에서 잘라 키운 것으로 보여 디테일이 적다. 영상 프레임도 대체로 L 쪽 PNG가 작다.

ExifTool 발췌 (`exiftool -G1 -a -s 20261006_035542.heic`):
```
[Meta]          PrimaryItemReference            : 49
[XMP-steim]     Position                        : Right
[XMP-steim]     MainCameraView                  : Right
[XMP-steim]     HorizontalFOV                   : 70.358116
[XMP-steim]     HorizontalDispAdj               : 0.015877
[XMP-steim]     BaselineFromMultiCal            : 17.905846
[XMP-steim]     AfDistanceCM                    : -100, 845.6
[XMP-steim]     Position                        : Left
[XMP-steim]     MainCameraView                  : Right
[QuickTime]     AuxiliaryImageType              : urn:com:samsung:photo:2024:aux:hdrgainmap
[Composite]     LensID                          : Galaxy S26 Ultra Wide-angle lens 6.500mm f/1.40
```

## 4. 시차 검산 (ORB + 기본행렬 RANSAC, dx = x왼쪽후보 − x오른쪽후보)

영상 프레임 추출:
```
ffmpeg -ss <t> -i in.mp4 -filter_complex "[0:v:vpos:left]null[l];[0:v:vpos:right]null[r]" -map [l] -frames:v 1 L.png -map [r] -frames:v 1 R.png
```
```
photo 035542 item2(L) vs item1(R): dx=+28.8px dy=+0.0px inliers=2377 -> OK
photo 035542 item0(primary) vs item1(R): dx=+6.0px dy=+12.5px inliers=2041 -> OK
20261001_112343_t0.5:   dx=+10.0px dy=+0.0px inliers=2220 -> OK
20261001_112343_t9.73:  dx=+8.3px  dy=+0.0px inliers=2038 -> OK
20261001_112343_t18.96: dx=+8.3px  dy=+0.0px inliers=1912 -> OK
20261006_035550_t0.5:   dx=+18.0px dy=+0.0px inliers=1775 -> OK
20261006_035550_t3.65:  dx=+26.9px dy=+0.0px inliers=629  -> OK
20261006_035550_t6.8:   dx=+34.8px dy=+0.0px inliers=374  -> OK
20261006_035612_t0.5:   dx=+26.9px dy=+0.0px inliers=393  -> OK
20261006_035612_t6.36:  dx=+35.1px dy=-8.6px inliers=12   -> OK (매칭점 12개, 신뢰 불가)
20261006_035612_t12.22: dx=+21.6px dy=+1.7px inliers=1537 -> OK
```

Phase 1 반영 사항: 매칭점이 적은 프레임(어두움·흔들림)은 판정에서 빼야 한다. 기준선 예: 100개 미만은 "판정 불가".

## 5. SBS 변환 시험

```
ffmpeg -i 20261006_035550.mp4 -filter_complex "[0:v:vpos:left][0:v:vpos:right]hstack[v]" -map [v] -map 0:a -c:v libx264 -crf 18 -preset medium -c:a copy -map_metadata 0 out_SBS_LR.mp4
```
```
원본: video 1920x1080 nb_frames=219 duration=7.296678 | audio nb_frames=341 duration=7.274563
SBS:  video 3840x1080 nb_frames=219 duration=7.300000 | audio nb_frames=341 duration=7.274563
인코딩 10.7초 (7.3초 영상, PC)
```

프레임 수와 오디오가 같다. 길이 차이 3.3ms는 1프레임(33ms)보다 작다.

## 게이트 판정

- 영상: 3개 모두 좌우 두 시점을 무손실 PNG로 추출했고, 판정 근거(메타데이터 + 시차)를 확보했다. **통과.**
- 사진: 진짜 3D HEIC가 1장뿐이다. 그 1장은 통과했다. 나머지 3장은 JPEG로 변환된 평면 사진이다. 계획서 기준(3장)을 채우려면 **원본 HEIC 2장이 더 필요**하다.
