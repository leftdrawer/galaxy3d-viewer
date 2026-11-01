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
    swap, dy, warns = g3d.judge([(10, 2.0, 500), (10, 4.0, 500)])
    assert (swap, dy, warns) == (False, 3.0, [])
    swap, _, warns = g3d.judge([(-10, 0, 500)] * 3)
    assert swap and any('반대' in w for w in warns)
    swap, _, warns = g3d.judge([(10, 0, 5)])  # 매칭점 부족 → 메타데이터 유지
    assert not swap and any('판정 불가' in w for w in warns)
    swap, _, warns = g3d.judge([(10, 0, 500), (10, 0, 500), (-10, 0, 500)])
    assert not swap and any('엇갈림' in w for w in warns)
    # 정순이 딱 절반이면 바꾸지 않는다. 절반 미만일 때만 시차를 따른다.
    swap, _, warns = g3d.judge([(10, 0, 500), (-10, 0, 500)])
    assert not swap and any('엇갈림' in w for w in warns)


def test_disparity_no_features():
    blank = np.zeros((80, 80), np.uint8)
    assert g3d.disparity(blank, blank) == (0.0, 0.0, 0)


def test_disparity_ransac_rejected(monkeypatch):
    rng = np.random.default_rng(0)
    base = cv2.GaussianBlur(rng.integers(0, 255, (600, 800), np.uint8), (5, 5), 0)
    left = np.roll(base, 12, axis=1)
    monkeypatch.setattr(g3d.cv2, 'findFundamentalMat', lambda *a, **k: (None, None))
    assert g3d.disparity(left, base) == (0.0, 0.0, 0)


def test_xmp_position():
    assert g3d.xmp_position(_Img({'xmp': b'steim:Position="Left"'})) == 'Left'
    assert g3d.xmp_position(_Img({'xmp': b'<steim:Position>Right</steim:Position>'})) == 'Right'
    assert g3d.xmp_position(_Img({})) is None


def test_rejects_bad_input(tmp_path):
    out = tmp_path / 'out'
    jpeg = tmp_path / 'flat.heic'
    jpeg.write_bytes(b'\xff\xd8\xff\xe1' + b'\x00' * 16)
    with pytest.raises(g3d.G3DError, match='원본을 다시'):
        g3d.convert(jpeg, out, ['lr'])
    short = tmp_path / 'short.heif'
    short.write_bytes(b'\x00\x00')
    with pytest.raises(g3d.G3DError, match='HEIC 파일이 아닙니다'):
        g3d.convert(short, out, ['lr'])
    other = tmp_path / 'a.png'
    other.write_bytes(b'\x89PNG')
    with pytest.raises(g3d.G3DError, match='지원하지 않는 확장자'):
        g3d.convert(other, out, ['lr'])


def test_photo_without_stereo_group(tmp_path, monkeypatch):
    src = _heif_stub(tmp_path / 'a.heic')
    monkeypatch.setattr(g3d.pillow_heif, 'open_heif', lambda p: _Heif([], [{'type': 'altr', 'images': [0]}]))
    with pytest.raises(g3d.G3DError, match='ster'):
        g3d.convert(src, tmp_path / 'out', ['lr'])
    monkeypatch.setattr(g3d.pillow_heif, 'open_heif', lambda p: _Heif([], [{'type': 'ster', 'images': [0, None]}]))
    with pytest.raises(g3d.G3DError, match='ster'):
        g3d.convert(src, tmp_path / 'out', ['lr'])


def test_photo_sbs_orders(tmp_path, monkeypatch):
    src = _heif_stub(tmp_path / 'shot.heic')
    left, right = _rgb_pair()
    exif = Image.Exif()
    exif[0x0112] = 6
    heif = _Heif(
        [_Img(left, b'steim:Position="Left"'), _Img(right, b'steim:Position="Right"')],
        [{'type': 'ster', 'images': [0, 1]}],
        exif.tobytes(),
    )
    monkeypatch.setattr(g3d.pillow_heif, 'open_heif', lambda p: heif)
    r = g3d.convert(src, tmp_path / 'out', ['lr', 'rl'])
    assert not r['swap'] and r['warns'] == []
    assert [p.name for p in r['outputs']] == ['shot_SBS_LR.jpg', 'shot_SBS_RL.jpg']
    lr, rl = (np.asarray(Image.open(p).convert('L')) for p in r['outputs'])
    assert lr.shape == rl.shape == (600, 1600)
    assert halves_dx(lr) > 0 and halves_dx(rl) < 0
    assert Image.open(r['outputs'][0]).getexif()[0x0112] == 1


def test_photo_follows_disparity_when_metadata_disagrees(tmp_path, monkeypatch):
    src = _heif_stub(tmp_path / 'shot.heic')
    left, right = _rgb_pair()  # left가 왼눈. 메타데이터는 반대로 둔다.
    heif = _Heif(
        [_Img(right, b'steim:Position="Left"'), _Img(left, b'steim:Position="Right"')],
        [{'type': 'ster', 'images': [0, 1]}],
    )
    monkeypatch.setattr(g3d.pillow_heif, 'open_heif', lambda p: heif)
    r = g3d.convert(src, tmp_path / 'out', ['lr'])
    assert r['swap'] and any('반대' in w for w in r['warns'])
    assert halves_dx(np.asarray(Image.open(r['outputs'][0]).convert('L'))) > 0


def test_photo_warns_when_xmp_disagrees(tmp_path, monkeypatch):
    src = _heif_stub(tmp_path / 'shot.heic')
    left, right = _rgb_pair(shift=0)
    heif = _Heif(
        [_Img(left, b'steim:Position="Right"'), _Img(right, b'steim:Position="Left"')],
        [{'type': 'ster', 'images': [0, 1]}],
    )
    monkeypatch.setattr(g3d.pillow_heif, 'open_heif', lambda p: heif)
    monkeypatch.setattr(g3d, 'disparity', lambda a, b: (12.0, 0.0, 500))
    r = g3d.convert(src, tmp_path / 'out', ['lr'])
    assert not r['swap'] and any('XMP' in w for w in r['warns'])


def _ffmpeg_run(version_line, decoder):
    def run(cmd):
        class R:
            stderr = b''
            stdout = version_line if '-version' in cmd else decoder
        return R()
    return run


def test_check_ffmpeg(monkeypatch):
    monkeypatch.setattr(g3d, 'run', _ffmpeg_run(b'ffmpeg version n7.1.1\n', b'... view_ids ...'))
    assert '7.1.1' in g3d.check_ffmpeg()
    monkeypatch.setattr(g3d, 'run', _ffmpeg_run(b'ffmpeg version 6.1.1\n', b'view_ids'))
    with pytest.raises(g3d.G3DError, match='7.1'):
        g3d.check_ffmpeg()
    monkeypatch.setattr(g3d, 'run', _ffmpeg_run(b'ffmpeg version 8.0\n', b'hevc decoder'))
    with pytest.raises(g3d.G3DError, match='MV-HEVC'):
        g3d.check_ffmpeg()


def _video_probe(side):
    payload = {
        'streams': [{
            'codec_type': 'video',
            'width': 16,
            'height': 16,
            'side_data_list': [{'side_data_type': s} for s in side],
        }],
        'format': {'duration': '2.0'},
    }

    def run(cmd):
        class R:
            stdout = json.dumps(payload).encode()
            stderr = b''
        return R()
    return run


def test_video_rejects_non_stereo_and_rotation(tmp_path, monkeypatch):
    src = tmp_path / 'a.mp4'
    src.write_bytes(b'\x00')
    monkeypatch.setattr(g3d, 'run', _video_probe([]))
    with pytest.raises(g3d.G3DError, match='원본을 다시'):
        g3d.convert(src, tmp_path / 'out', ['lr'])
    monkeypatch.setattr(g3d, 'run', _video_probe(['Stereo 3D', 'Display Matrix']))
    with pytest.raises(g3d.G3DError, match='회전'):
        g3d.convert(src, tmp_path / 'out', ['lr'])


def test_main_reports_failure_and_filters_directory(tmp_path, monkeypatch, capsys):
    bad = tmp_path / 'note.txt'
    bad.write_text('x')
    rc = g3d.main(['convert', str(bad), '--out', str(tmp_path / 'out'), '--order', 'lr'])
    assert rc == 1
    out = capsys.readouterr().out
    assert '지원하지 않는 확장자' in out and '완료 0/1' in out

    folder = tmp_path / 'in'
    folder.mkdir()
    (folder / 'a.txt').write_text('x')
    (folder / 'b.heic').write_bytes(b'x')
    (folder / 'c.MP4').write_bytes(b'x')
    seen = []

    def fake_convert(path, out_dir, orders, fmt='jpg'):
        seen.append((path.name, orders, fmt))
        return {'outputs': [out_dir / f'{path.stem}.jpg'], 'swap': False, 'dx': [1.0], 'dy': 0.0, 'warns': []}

    monkeypatch.setattr(g3d, 'check_ffmpeg', lambda: 'ffmpeg version 7.1')
    monkeypatch.setattr(g3d, 'convert', fake_convert)
    rc = g3d.main(['convert', str(folder), '--out', str(tmp_path / 'out2'), '--format', 'png'])
    assert rc == 0
    assert seen == [('b.heic', ['lr', 'rl'], 'png'), ('c.MP4', ['lr', 'rl'], 'png')]
    assert '완료 2/2' in capsys.readouterr().out


class _Img:
    def __init__(self, info_or_array, xmp=None):
        if isinstance(info_or_array, dict):
            self.info = info_or_array
            self.arr = None
        else:
            self.arr = info_or_array
            self.info = {'xmp': xmp} if xmp is not None else {}

    def to_pillow(self):
        return Image.fromarray(self.arr, 'RGB')


class _Heif:
    def __init__(self, images, groups, exif=None):
        self.images = images
        self.info = {'entity_groups': groups}
        if exif is not None:
            self.info['exif'] = exif

    def __getitem__(self, i):
        return self.images[i]


def _heif_stub(path):
    path.write_bytes(b'\x00\x00\x00\x18ftypheic' + b'\x00' * 8)
    return path


def _rgb_pair(shift=12):
    rng = np.random.default_rng(0)
    base = cv2.GaussianBlur(rng.integers(0, 255, (600, 800), np.uint8), (5, 5), 0)
    moved = np.roll(base, shift, axis=1)
    rgb = lambda g: np.dstack([g, g, g])
    return rgb(moved), rgb(base)


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
