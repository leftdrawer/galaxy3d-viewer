// 갤럭시 3D 영상(MV-HEVC) → 한 프레임씩 SBS(왼|오른) I420 버퍼. Emscripten으로 빌드해 web/worker.js가 쓴다.
// 좌우는 프레임마다 붙는 Stereo 3D 사이드데이터의 view(left/right)로 정한다. view_id 0이 오른눈이라 순서로 정하면 틀린다(docs/FORMAT.md 2절).
#include <string.h>
#include <emscripten/emscripten.h>
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/stereo3d.h>

static AVFormatContext *fmt;
static AVCodecContext *dec;
static AVPacket *pkt;
static AVFrame *frm;
static int vidx = -1, flushed, W, H, have;
static int64_t cur_pts = AV_NOPTS_VALUE, out_pts;
static uint8_t *sbs;

EMSCRIPTEN_KEEPALIVE int g3d_width(void) { return W; }
EMSCRIPTEN_KEEPALIVE int g3d_height(void) { return H; }
EMSCRIPTEN_KEEPALIVE uint8_t *g3d_sbs(void) { return sbs; }
EMSCRIPTEN_KEEPALIVE double g3d_fps(void) { return av_q2d(fmt->streams[vidx]->avg_frame_rate); }
EMSCRIPTEN_KEEPALIVE double g3d_duration_us(void) { return (double)fmt->duration; }
EMSCRIPTEN_KEEPALIVE double g3d_nb_frames(void) { return (double)fmt->streams[vidx]->nb_frames; }
EMSCRIPTEN_KEEPALIVE double g3d_pts_us(void) {
    return (double)av_rescale_q(out_pts, fmt->streams[vidx]->time_base, AV_TIME_BASE_Q);
}

EMSCRIPTEN_KEEPALIVE void g3d_close(void) {
    avcodec_free_context(&dec);
    avformat_close_input(&fmt);
    av_packet_free(&pkt);
    av_frame_free(&frm);
    av_freep(&sbs);
    vidx = -1, flushed = 0, have = 0, cur_pts = AV_NOPTS_VALUE;
}

// 0 성공. 음수: -1 열기 실패, -3 영상 없음, -4 HEVC 아님, -5 3D 아님(시점 1개), -6 디코더 실패, -7 크기 이상
EMSCRIPTEN_KEEPALIVE int g3d_open(const char *path) {
    g3d_close();
    if (avformat_open_input(&fmt, path, NULL, NULL) < 0 || avformat_find_stream_info(fmt, NULL) < 0)
        return -1;
    vidx = av_find_best_stream(fmt, AVMEDIA_TYPE_VIDEO, -1, -1, NULL, 0);
    if (vidx < 0)
        return -3;
    AVStream *st = fmt->streams[vidx];
    if (st->codecpar->codec_id != AV_CODEC_ID_HEVC)
        return -4;
    if (!av_packet_side_data_get(st->codecpar->coded_side_data, st->codecpar->nb_coded_side_data, AV_PKT_DATA_STEREO3D))
        return -5;

    const AVCodec *c = avcodec_find_decoder(AV_CODEC_ID_HEVC);
    dec = avcodec_alloc_context3(c);
    avcodec_parameters_to_context(dec, st->codecpar);
    dec->pkt_timebase = st->time_base;
    AVDictionary *opt = NULL;
    av_dict_set(&opt, "view_ids", "-1", 0); // 모든 시점 디코딩
    int r = avcodec_open2(dec, c, &opt);
    av_dict_free(&opt);
    if (r < 0)
        return -6;

    W = st->codecpar->width, H = st->codecpar->height;
    if (W <= 0 || H <= 0 || (W & 1) || (H & 1))
        return -7;
    sbs = av_malloc((size_t)2 * W * H * 3 / 2);
    pkt = av_packet_alloc();
    frm = av_frame_alloc();
    return 0;
}

// eye 0 = 왼쪽 절반, 1 = 오른쪽 절반
static void put(const AVFrame *f, int eye) {
    int sw = 2 * W;
    uint8_t *Y = sbs, *U = Y + sw * H, *V = U + (sw / 2) * (H / 2);
    for (int y = 0; y < H; y++)
        memcpy(Y + y * sw + eye * W, f->data[0] + y * f->linesize[0], W);
    for (int y = 0; y < H / 2; y++) {
        memcpy(U + y * sw / 2 + eye * W / 2, f->data[1] + y * f->linesize[1], W / 2);
        memcpy(V + y * sw / 2 + eye * W / 2, f->data[2] + y * f->linesize[2], W / 2);
    }
}

static int eye_of(const AVFrame *f) {
    const AVFrameSideData *sd = av_frame_get_side_data(f, AV_FRAME_DATA_STEREO3D);
    if (!sd)
        return -1;
    enum AVStereo3DView v = ((const AVStereo3D *)sd->data)->view;
    return v == AV_STEREO3D_VIEW_LEFT ? 0 : v == AV_STEREO3D_VIEW_RIGHT ? 1 : -1;
}

// 1 = 좌우가 모인 SBS 프레임 준비됨, 0 = 끝, 음수 = 오류(-10 지원 안 하는 픽셀 형식, 그 외 FFmpeg 오류)
EMSCRIPTEN_KEEPALIVE int g3d_next(void) {
    for (;;) {
        int r = avcodec_receive_frame(dec, frm);
        if (r == 0) {
            if (frm->format != AV_PIX_FMT_YUV420P || frm->width != W || frm->height != H) {
                av_frame_unref(frm);
                return -10; // ponytail: 8bit SDR만. 10bit HDR 샘플이 생기면 변환 추가
            }
            int64_t pts = frm->pts != AV_NOPTS_VALUE ? frm->pts : frm->best_effort_timestamp;
            if (pts != cur_pts)
                have = 0, cur_pts = pts;
            int e = eye_of(frm);
            if (e >= 0)
                put(frm, e), have |= 1 << e;
            av_frame_unref(frm);
            if (have == 3) {
                have = 0, out_pts = cur_pts;
                return 1;
            }
            continue;
        }
        if (r == AVERROR_EOF)
            return 0;
        if (r != AVERROR(EAGAIN))
            return r;
        if (flushed)
            return 0;
        if (av_read_frame(fmt, pkt) < 0) {
            avcodec_send_packet(dec, NULL);
            flushed = 1;
            continue;
        }
        if (pkt->stream_index == vidx && (r = avcodec_send_packet(dec, pkt)) < 0 && r != AVERROR_INVALIDDATA) {
            av_packet_unref(pkt);
            return r;
        }
        av_packet_unref(pkt);
    }
}
