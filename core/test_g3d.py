"""python -m pytest core -v   (samples/ 가 없으면 샘플 테스트는 건너뜀)"""
import json
import subprocess
from pathlib import Path

import cv2
import numpy as np
import pytest
from PIL import Image

import g3d

SAMPLES = Path(__file__).resolve().parents[1] / 'samples'


def is_jpeg(p):
    return p.read_bytes()[:3] == b'\xff\xd8\xff'


ALL = sorted(SAMPLES.glob('*')) if SAMPLES.exists() else []
VIDEOS = [p for p in ALL if p.suffix.lower() in g3d.VIDEO_EXT]
PHOTOS = [p for p in ALL if p.suffix.lower() in g3d.PHOTO_EXT and not is_jpeg(p)]
FLAT = [p for p in ALL if p.suffix.lower() in g3d.PHOTO_EXT and is_jpeg(p)]
ids = lambda ps: [p.name for p in ps]


def probe(p):
    return json.loads(subprocess.run(['ffprobe', '-v', 'error', '-print_format', 'json', '-count_frames',
                                      '-show_streams', '-show_format', str(p)], capture_output=True, check=True).stdout)


def halves_dx(img):
    """SBS 그레이 이미지의 왼쪽 절반 vs 오른쪽 절반 시차."""
    w = img.shape[1] // 2
    dx, _, n = g3d.disparity(img[:, :w], img[:, w:])
    assert n >= g3d.MIN_INLIERS, f'매칭점 부족 {n}'
    return dx


# ---------- 샘플 없이 도는 테스트 ----------

def test_disparity_synthetic():
    rng = np.random.default_rng(0)
    base = cv2.GaussianBlur(rng.integers(0, 255, (600, 800), np.uint8), (5, 5), 0)
    left = np.roll(base, 12, axis=1)  # 왼눈 그림에서는 물체가 더 오른쪽
    dx, dy, n = g3d.disparity(left, base)
    assert n >= g3d.MIN_INLIERS and 10 < dx < 14 and abs(dy) < 1
    assert g3d.disparity(base, left)[0] < 0


def test_judge():
    assert g3d.judge([(10, 0, 500)] * 3)[:2] == (False, 0.0)
    swap, _, warns = g3d.judge([(-10, 0, 500)] * 3)
    assert swap and any('반대' in w for w in warns)
    swap, _, warns = g3d.judge([(10, 0, 5)])  # 매칭점 부족 → 메타데이터 유지
    assert not swap and any('판정 불가' in w for w in warns)
    swap, _, warns = g3d.judge([(10, 0, 500), (10, 0, 500), (-10, 0, 500)])
    assert not swap and any('엇갈림' in w for w in warns)


# ---------- 샘플 테스트 ----------

@pytest.mark.parametrize('src', PHOTOS, ids=ids(PHOTOS))
def test_photo(tmp_path, src):
    r = g3d.convert(src, tmp_path, ['lr', 'rl'])
    assert not r['swap'] and r['warns'] == []
    lr, rl = (np.asarray(Image.open(p).convert('L')) for p in r['outputs'])
    assert lr.shape == (3000, 8000)  # 한쪽 눈 4000×3000 (FORMAT.md)
    assert halves_dx(lr) > 0 and halves_dx(rl) < 0


@pytest.mark.parametrize('src', FLAT, ids=ids(FLAT))
def test_flat_jpeg_rejected(tmp_path, src):
    with pytest.raises(g3d.G3DError, match='원본을 다시'):
        g3d.convert(src, tmp_path, ['lr'])


@pytest.mark.parametrize('src', VIDEOS, ids=ids(VIDEOS))
def test_video(tmp_path, src):
    r = g3d.convert(src, tmp_path, ['lr'])
    assert not r['swap']
    out = r['outputs'][0]
    a, b = probe(src), probe(out)
    va = next(s for s in a['streams'] if s['codec_type'] == 'video')
    vb = next(s for s in b['streams'] if s['codec_type'] == 'video')
    assert (vb['width'], vb['height']) == (2 * va['width'], va['height'])
    assert vb['nb_read_frames'] == va['nb_read_frames']
    aa = next(s for s in a['streams'] if s['codec_type'] == 'audio')
    ab = next(s for s in b['streams'] if s['codec_type'] == 'audio')
    assert ab['nb_read_frames'] == aa['nb_read_frames']
    num, den = map(int, va['r_frame_rate'].split('/'))
    assert abs(float(b['format']['duration']) - float(a['format']['duration'])) <= den / num

    # 결과물 앞쪽 프레임을 다시 읽어 왼쪽 절반이 진짜 왼눈인지 확인
    w, h = vb['width'], vb['height']
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', '0.5', '-i', str(out), '-vf', 'format=gray',
                          '-frames:v', '1', '-f', 'rawvideo', '-'], capture_output=True, check=True).stdout
    assert halves_dx(np.frombuffer(raw, np.uint8).reshape(h, w)) > 0
