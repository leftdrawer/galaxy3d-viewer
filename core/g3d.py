"""갤럭시 3D 사진·영상을 SBS로 푼다.

사용: python core/g3d.py convert <파일|폴더> [--order lr|rl|both] [--out 폴더] [--format jpg|png]
  lr = 평행법(왼눈 그림이 왼쪽), rl = 교차법
구조 근거: docs/FORMAT.md
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
import pillow_heif
from PIL import Image

MIN_INLIERS = 100  # 이보다 매칭점이 적은 프레임은 시차 판정에서 뺀다 (FORMAT.md 4절)
VIDEO_EXT = {'.mp4', '.mov'}
PHOTO_EXT = {'.heic', '.heif'}
RESEND = 'USB 케이블이나 Quick Share로 원본을 다시 옮기세요'


class G3DError(Exception):
    pass


def run(cmd):
    try:
        return subprocess.run([str(c) for c in cmd], capture_output=True, check=True)
    except subprocess.CalledProcessError as e:
        raise G3DError(f'{cmd[0]} 실패: {e.stderr.decode(errors="replace").strip()[-500:]}') from None


def check_ffmpeg():
    first = run(['ffmpeg', '-hide_banner', '-version']).stdout.decode().splitlines()[0]
    m = re.search(r'version n?(\d+)\.(\d+)', first)
    if m and (int(m[1]), int(m[2])) < (7, 1):
        raise G3DError(f'FFmpeg 7.1 이상이 필요합니다: {first}')
    if b'view_ids' not in run(['ffmpeg', '-hide_banner', '-h', 'decoder=hevc']).stdout:
        raise G3DError(f'이 FFmpeg는 MV-HEVC 디코딩을 지원하지 않습니다: {first}')
    return first


# ---------- 좌우 검산 ----------

def disparity(left, right, max_side=1600):
    """그레이 이미지 두 장의 (dx, dy, 매칭수). dx = x왼쪽후보 - x오른쪽후보, 원본 px. dx>0 이면 순서가 맞다."""
    s = min(1.0, max_side / max(left.shape))
    a, b = (cv2.resize(g, None, fx=s, fy=s, interpolation=cv2.INTER_AREA) if s < 1 else g for g in (left, right))
    orb = cv2.ORB_create(4000)
    ka, da = orb.detectAndCompute(a, None)
    kb, db = orb.detectAndCompute(b, None)
    if da is None or db is None:
        return 0.0, 0.0, 0
    m = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(da, db)
    if len(m) < 8:
        return 0.0, 0.0, 0
    pa = np.float32([ka[x.queryIdx].pt for x in m])
    pb = np.float32([kb[x.trainIdx].pt for x in m])
    _, mask = cv2.findFundamentalMat(pa, pb, cv2.FM_RANSAC, 1.0, 0.999)
    if mask is None:
        return 0.0, 0.0, 0
    keep = mask.ravel().astype(bool)
    d = (pa[keep] - pb[keep]) / s
    return float(np.median(d[:, 0])), float(np.median(d[:, 1])), int(keep.sum())


def judge(samples):
    """samples = [(dx, dy, n)] (메타데이터 기준 왼쪽, 오른쪽). 반환 (swap, dy, 경고들).
    메타데이터와 시차가 다르면 시차를 따른다 (CLAUDE.md 원칙 5)."""
    good = [(dx, dy) for dx, dy, n in samples if n >= MIN_INLIERS]
    if not good:
        return False, 0.0, ['시차 판정 불가(매칭점 부족) - 메타데이터를 따름']
    warns = []
    pos = sum(dx > 0 for dx, _ in good)
    if 0 < pos < len(good):
        warns.append(f'프레임별 시차 판정이 엇갈림 (정순 {pos}/{len(good)})')
    swap = pos * 2 < len(good)
    if swap:
        warns.append('시차 판별이 메타데이터와 반대 - 좌우를 바꿈')
    return swap, float(np.median([dy for _, dy in good])), warns


# ---------- 영상 ----------

def video_frame_pair(src, t, w, h):
    raw = run(['ffmpeg', '-v', 'error', '-ss', f'{t:.3f}', '-i', src,
               '-filter_complex', '[0:v:vpos:left][0:v:vpos:right]hstack,format=gray[v]',
               '-map', '[v]', '-frames:v', '1', '-f', 'rawvideo', '-']).stdout
    f = np.frombuffer(raw, np.uint8).reshape(h, 2 * w)
    return f[:, :w], f[:, w:]


def convert_video(src, out_dir, orders):
    info = json.loads(run(['ffprobe', '-v', 'error', '-print_format', 'json',
                           '-show_streams', '-show_format', src]).stdout)
    v = next(s for s in info['streams'] if s['codec_type'] == 'video')
    side = {sd.get('side_data_type') for sd in v.get('side_data_list', [])}
    if 'Stereo 3D' not in side:
        raise G3DError(f'3D 영상이 아닙니다(시점 1개). {RESEND}')
    if 'Display Matrix' in side:
        # ponytail: 샘플에 회전 영상이 없어 미검증. 세로 촬영 샘플이 생기면 transpose 처리 추가
        raise G3DError('회전 메타데이터가 있는 영상은 아직 지원하지 않습니다')
    w, h, dur = v['width'], v['height'], float(info['format']['duration'])

    times = (min(0.5, dur / 4), dur / 2, max(dur - 0.5, dur * 3 / 4))  # 앞·중간·끝
    samples = [disparity(*video_frame_pair(src, t, w, h)) for t in times]
    swap, dy, warns = judge(samples)
    L, R = ('right', 'left') if swap else ('left', 'right')

    n = len(orders)
    fc = (f'[0:v:vpos:{L}]split={n}' + ''.join(f'[l{i}]' for i in range(n)) + ';'
          f'[0:v:vpos:{R}]split={n}' + ''.join(f'[r{i}]' for i in range(n)) + ';'
          + ';'.join(f'[{o[0]}{i}][{o[1]}{i}]hstack[o{i}]' for i, o in enumerate(orders)))
    cmd = ['ffmpeg', '-v', 'error', '-y', '-i', src, '-filter_complex', fc]
    outs = []
    for i, o in enumerate(orders):
        dst = out_dir / f'{src.stem}_SBS_{o.upper()}.mp4'
        cmd += ['-map', f'[o{i}]', '-map', '0:a?', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium',
                '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-map_metadata', '0', '-movflags', '+faststart', dst]
        outs.append(dst)
    run(cmd)
    return {'outputs': outs, 'swap': swap, 'dx': [round(s[0], 1) for s in samples], 'dy': dy, 'warns': warns}


# ---------- 사진 ----------

def xmp_position(img):
    m = re.search(rb'steim:Position(?:="|>)(\w+)', img.info.get('xmp') or b'')
    return m and m[1].decode()


def convert_photo(src, out_dir, orders, fmt='jpg'):
    with open(src, 'rb') as f:
        head = f.read(12)
    if head[:3] == b'\xff\xd8\xff':
        raise G3DError(f'확장자는 HEIC지만 내용은 JPEG(평면 사진)입니다. 전송 중 3D 정보가 사라졌습니다. {RESEND}')
    if head[4:8] != b'ftyp':
        raise G3DError('HEIC 파일이 아닙니다')
    heif = pillow_heif.open_heif(src)
    groups = heif.info.get('entity_groups', [])
    ster = next((g for g in groups if g['type'] == 'ster'), None)
    if not ster or None in ster['images']:
        raise G3DError(f'스테레오 그룹(ster)이 없는 구조입니다. 3D 사진이 아니거나 모르는 형식: {groups}')
    li, ri = ster['images']  # HEIF 규격: [왼쪽, 오른쪽]
    warns = []
    pos = (xmp_position(heif[li]), xmp_position(heif[ri]))
    if pos != ('Left', 'Right'):
        warns.append(f'ster 순서와 XMP Position이 다름: {pos}')

    left, right = heif[li].to_pillow(), heif[ri].to_pillow()
    s = disparity(np.asarray(left.convert('L')), np.asarray(right.convert('L')))
    swap, dy, w2 = judge([s])
    warns += w2
    if swap:
        left, right = right, left

    exif = Image.Exif()
    if heif.info.get('exif'):
        exif.load(heif.info['exif'])
        exif[0x0112] = 1  # 회전은 디코딩 때 이미 적용됨
    icc = heif[li].info.get('icc_profile')
    outs = []
    for o in orders:
        a, b = (left, right) if o == 'lr' else (right, left)
        sbs = Image.new('RGB', (a.width + b.width, max(a.height, b.height)))
        sbs.paste(a, (0, 0))
        sbs.paste(b, (a.width, 0))
        dst = out_dir / f'{src.stem}_SBS_{o.upper()}.{fmt}'
        opts = {'quality': 95, 'subsampling': 0} if fmt == 'jpg' else {}
        sbs.save(dst, icc_profile=icc, exif=exif, **opts)
        outs.append(dst)
    return {'outputs': outs, 'swap': swap, 'dx': [round(s[0], 1)], 'dy': dy, 'warns': warns}


# ---------- CLI ----------

def convert(src, out_dir, orders, fmt='jpg'):
    src, out_dir = Path(src), Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    ext = src.suffix.lower()
    if ext in VIDEO_EXT:
        return convert_video(src, out_dir, orders)
    if ext in PHOTO_EXT:
        return convert_photo(src, out_dir, orders, fmt)
    raise G3DError(f'지원하지 않는 확장자: {ext}')


def main(argv=None):
    p = argparse.ArgumentParser(prog='g3d', description='갤럭시 3D 사진·영상 → SBS 변환')
    sub = p.add_subparsers(dest='cmd', required=True)
    c = sub.add_parser('convert')
    c.add_argument('path', type=Path)
    c.add_argument('--order', choices=['lr', 'rl', 'both'], default='both')
    c.add_argument('--out', type=Path, default=Path('out'))
    c.add_argument('--format', choices=['jpg', 'png'], default='jpg')
    a = p.parse_args(argv)

    orders = ['lr', 'rl'] if a.order == 'both' else [a.order]
    files = (sorted(f for f in a.path.iterdir() if f.suffix.lower() in VIDEO_EXT | PHOTO_EXT)
             if a.path.is_dir() else [a.path])
    try:
        if any(f.suffix.lower() in VIDEO_EXT for f in files):
            print(check_ffmpeg())
    except (G3DError, FileNotFoundError) as e:
        sys.exit(f'FFmpeg 확인 실패: {e}')

    failed = 0
    for f in files:
        try:
            r = convert(f, a.out, orders, a.format)
        except G3DError as e:
            failed += 1
            print(f'✗ {f.name}: {e}')
            continue
        print(f'✓ {f.name} → {", ".join(o.name for o in r["outputs"])}  (dx {r["dx"]}, 상하 {r["dy"]:+.1f}px)')
        for w in r['warns']:
            print(f'  ⚠ {w}')
    print(f'완료 {len(files) - failed}/{len(files)}')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
