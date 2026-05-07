#include <napi.h>
#include <iostream>
#include <string>
#include <vector>

extern "C" {
#include <libavformat/avformat.h>
#include <libavcodec/avcodec.h>
#include <libswscale/swscale.h>
#include <libavutil/imgutils.h>
#include <libavfilter/avfilter.h>
#include <libavfilter/buffersrc.h>
#include <libavfilter/buffersink.h>
#include <libavutil/opt.h>
}

struct ClipInfo {
    std::string path;
    double trimStart;
    double trimEnd;
    double cropX;
    double cropY;
    double scale;
};

// 비동기 렌더링 작업을 수행할 워커 클래스 (Napi::AsyncWorker 상속)
class VideoRenderWorker : public Napi::AsyncWorker {
public:
    VideoRenderWorker(Napi::Env& env, std::vector<ClipInfo> clips, std::string outPath, std::string overlayPath, Napi::Promise::Deferred deferred)
        : Napi::AsyncWorker(env), clips(clips), outputPath(outPath), overlayPath(overlayPath), deferred(deferred) {}

    ~VideoRenderWorker() {}

    void Execute() override {
        std::cout << "======================================" << std::endl;
        std::cout << "[C++ 엔진] 멀티 클립 인코딩 시작! (오디오 포함)" << std::endl;
        
        AVFormatContext* ofmt_ctx = nullptr;
        if (avformat_alloc_output_context2(&ofmt_ctx, nullptr, nullptr, outputPath.c_str()) < 0 || !ofmt_ctx) {
            SetError("출력 컨텍스트를 생성할 수 없습니다."); return;
        }
        
        // ----------------------------------------
        // 비디오 출력 스트림 설정
        // ----------------------------------------
        const AVCodec* enc = avcodec_find_encoder_by_name("libx264");
        if (!enc) enc = avcodec_find_encoder(AV_CODEC_ID_MPEG4);
        AVStream* out_video_stream = avformat_new_stream(ofmt_ctx, enc);
        AVCodecContext* enc_ctx = avcodec_alloc_context3(enc);
        
        enc_ctx->width = 720;
        enc_ctx->height = 1280;
        enc_ctx->pix_fmt = AV_PIX_FMT_YUV420P;
        enc_ctx->time_base = {1, 30}; // 30 FPS
        out_video_stream->time_base = enc_ctx->time_base;
        if (avcodec_open2(enc_ctx, enc, nullptr) < 0) {
            SetError("비디오 인코더를 열 수 없습니다."); return;
        }
        avcodec_parameters_from_context(out_video_stream->codecpar, enc_ctx);

        // ----------------------------------------
        // 오디오 출력 스트림 설정 (Stream Copy 방식)
        // ----------------------------------------
        AVStream* out_audio_stream = avformat_new_stream(ofmt_ctx, nullptr);
        
        if (!(ofmt_ctx->oformat->flags & AVFMT_NOFILE)) {
            if (avio_open(&ofmt_ctx->pb, outputPath.c_str(), AVIO_FLAG_WRITE) < 0) {
                SetError("출력 파일을 생성할 수 없습니다."); return;
            }
        }

        // 첫 번째 클립의 오디오 파라미터를 복사해서 출력 오디오 스트림에 세팅
        if (clips.size() > 0) {
            AVFormatContext* tmp_ctx = nullptr;
            if (avformat_open_input(&tmp_ctx, clips[0].path.c_str(), nullptr, nullptr) == 0) {
                avformat_find_stream_info(tmp_ctx, nullptr);
                for (unsigned int i = 0; i < tmp_ctx->nb_streams; i++) {
                    if (tmp_ctx->streams[i]->codecpar->codec_type == AVMEDIA_TYPE_AUDIO) {
                        avcodec_parameters_copy(out_audio_stream->codecpar, tmp_ctx->streams[i]->codecpar);
                        out_audio_stream->codecpar->codec_tag = 0;
                        break;
                    }
                }
                avformat_close_input(&tmp_ctx);
            }
        }

        if (avformat_write_header(ofmt_ctx, nullptr) < 0) {
            SetError("출력 파일 헤더를 쓸 수 없습니다."); return;
        }

        // --- AVFilterGraph 초기화 (오버레이 적용) ---
        AVFilterGraph *filter_graph = nullptr;
        AVFilterContext *buffersink_ctx = nullptr;
        AVFilterContext *buffersrc_ctx = nullptr;

        if (!overlayPath.empty()) {
            std::string sanitizedOverlay = overlayPath;
            for(char& c : sanitizedOverlay) {
                if(c == '\\') c = '/';
            }
            std::string escapedOverlay = "";
            for(char c : sanitizedOverlay) {
                if(c == ':') escapedOverlay += "\\:";
                else escapedOverlay += c;
            }

            char filter_desc[1024];
            snprintf(filter_desc, sizeof(filter_desc), "movie=filename='%s' [wm]; [in] [wm] overlay=0:0 [out]", escapedOverlay.c_str());

            const AVFilter *buffersrc  = avfilter_get_by_name("buffer");
            const AVFilter *buffersink = avfilter_get_by_name("buffersink");
            AVFilterInOut *outputs = avfilter_inout_alloc();
            AVFilterInOut *inputs  = avfilter_inout_alloc();
            filter_graph = avfilter_graph_alloc();

            char args[512];
            snprintf(args, sizeof(args), "video_size=%dx%d:pix_fmt=%d:time_base=%d/%d:pixel_aspect=%d/%d",
                     enc_ctx->width, enc_ctx->height, enc_ctx->pix_fmt, enc_ctx->time_base.num, enc_ctx->time_base.den, 1, 1);
            avfilter_graph_create_filter(&buffersrc_ctx, buffersrc, "in", args, nullptr, filter_graph);
            avfilter_graph_create_filter(&buffersink_ctx, buffersink, "out", nullptr, nullptr, filter_graph);
            
            enum AVPixelFormat pix_fmts[] = { AV_PIX_FMT_YUV420P, AV_PIX_FMT_NONE };
            av_opt_set_int_list(buffersink_ctx, "pix_fmts", pix_fmts, AV_PIX_FMT_NONE, AV_OPT_SEARCH_CHILDREN);

            outputs->name       = av_strdup("in");
            outputs->filter_ctx = buffersrc_ctx;
            outputs->pad_idx    = 0;
            outputs->next       = nullptr;

            inputs->name       = av_strdup("out");
            inputs->filter_ctx = buffersink_ctx;
            inputs->pad_idx    = 0;
            inputs->next       = nullptr;

            if (avfilter_graph_parse_ptr(filter_graph, filter_desc, &inputs, &outputs, nullptr) < 0 ||
                avfilter_graph_config(filter_graph, nullptr) < 0) {
                std::cout << "필터 그래프 초기화 실패! 오버레이 없이 진행합니다." << std::endl;
                avfilter_graph_free(&filter_graph);
                filter_graph = nullptr;
            }
            
            avfilter_inout_free(&inputs);
            avfilter_inout_free(&outputs);
        }

        AVFrame* out_frame = av_frame_alloc();
        out_frame->format = AV_PIX_FMT_YUV420P;
        out_frame->width = 720;
        out_frame->height = 1280;
        av_frame_get_buffer(out_frame, 32);

        int global_video_pts = 0;
        int64_t global_audio_pts = 0; // 오디오 재생 시간 연속성 유지용

        for (const ClipInfo& clip : clips) {
            std::cout << "-> 처리 중: " << clip.path << " (" << clip.trimStart << "~" << clip.trimEnd << "s)" << std::endl;
            
            AVFormatContext* ifmt_ctx = nullptr;
            if (avformat_open_input(&ifmt_ctx, clip.path.c_str(), nullptr, nullptr) < 0) {
                continue;
            }
            avformat_find_stream_info(ifmt_ctx, nullptr);
            
            int video_stream_idx = -1;
            int audio_stream_idx = -1;
            for (unsigned int i = 0; i < ifmt_ctx->nb_streams; i++) {
                if (ifmt_ctx->streams[i]->codecpar->codec_type == AVMEDIA_TYPE_VIDEO) video_stream_idx = i;
                if (ifmt_ctx->streams[i]->codecpar->codec_type == AVMEDIA_TYPE_AUDIO) audio_stream_idx = i;
            }

            AVCodecContext* dec_ctx = nullptr;
            SwsContext* sws_ctx = nullptr;
            AVStream* in_video_stream = nullptr;
            AVStream* in_audio_stream = nullptr;

            if (video_stream_idx != -1) {
                in_video_stream = ifmt_ctx->streams[video_stream_idx];
                const AVCodec* dec = avcodec_find_decoder(in_video_stream->codecpar->codec_id);
                dec_ctx = avcodec_alloc_context3(dec);
                avcodec_parameters_to_context(dec_ctx, in_video_stream->codecpar);
                avcodec_open2(dec_ctx, dec, nullptr);
                
                int target_w = (dec_ctx->height * 9 / 16) & ~1; 
                int target_h = dec_ctx->height & ~1;
                sws_ctx = sws_getContext(target_w, target_h, dec_ctx->pix_fmt,
                                         720, 1280, AV_PIX_FMT_YUV420P,
                                         SWS_BILINEAR, nullptr, nullptr, nullptr);
            }
            
            if (audio_stream_idx != -1) {
                in_audio_stream = ifmt_ctx->streams[audio_stream_idx];
            }

            AVPacket* pkt = av_packet_alloc();
            AVFrame* frame = av_frame_alloc();
            
            int64_t start_pts = (int64_t)(clip.trimStart * AV_TIME_BASE);
            av_seek_frame(ifmt_ctx, -1, start_pts, AVSEEK_FLAG_BACKWARD);

            bool video_done = false;

            while (av_read_frame(ifmt_ctx, pkt) >= 0 && !video_done) {
                
                // --- 비디오 처리 ---
                if (pkt->stream_index == video_stream_idx && dec_ctx) {
                    if (avcodec_send_packet(dec_ctx, pkt) >= 0) {
                        while (avcodec_receive_frame(dec_ctx, frame) == 0) {
                            double current_time_sec = frame->best_effort_timestamp * av_q2d(in_video_stream->time_base);
                            if (current_time_sec < clip.trimStart) continue;
                            if (current_time_sec > clip.trimEnd) {
                                video_done = true;
                                break;
                            }
                            
                            int in_w = dec_ctx->width;
                            int in_h = dec_ctx->height;
                            int target_w = (in_h * 9 / 16) & ~1; 
                            
                            // Scale에 따라 잘라낼 실제 원본 픽셀 영역 크기 축소 (줌인 효과)
                            double scale = clip.scale > 0.0 ? clip.scale : 1.0;
                            int crop_w = (target_w / scale);
                            int crop_h = (in_h / scale);
                            // 홀수 픽셀 에러 방지
                            crop_w &= ~1;
                            crop_h &= ~1;
                            
                            int max_crop_x = in_w - crop_w;
                            if (max_crop_x < 0) max_crop_x = 0;
                            
                            int max_crop_y = in_h - crop_h;
                            if (max_crop_y < 0) max_crop_y = 0;
                            
                            int crop_x = (int)(max_crop_x * clip.cropX) & ~1;
                            int crop_y = (int)(max_crop_y * clip.cropY) & ~1;

                            uint8_t* src_data[4];
                            int src_linesize[4];
                            for(int i=0; i<4; i++) {
                                src_data[i] = frame->data[i];
                                src_linesize[i] = frame->linesize[i];
                            }
                            if (src_data[0] != nullptr) {
                                src_data[0] += crop_y * src_linesize[0] + crop_x;
                                src_data[1] += (crop_y/2) * src_linesize[1] + (crop_x/2);
                                src_data[2] += (crop_y/2) * src_linesize[2] + (crop_x/2);
                                
                                sws_scale(sws_ctx, src_data, src_linesize, 0, crop_h, out_frame->data, out_frame->linesize);

                                out_frame->pts = global_video_pts++;
                                
                                if (filter_graph) {
                                    if (av_buffersrc_add_frame_flags(buffersrc_ctx, out_frame, AV_BUFFERSRC_FLAG_KEEP_REF) >= 0) {
                                        AVFrame* filtered_frame = av_frame_alloc();
                                        while (av_buffersink_get_frame(buffersink_ctx, filtered_frame) >= 0) {
                                            if (avcodec_send_frame(enc_ctx, filtered_frame) >= 0) {
                                                AVPacket* out_pkt = av_packet_alloc();
                                                while (avcodec_receive_packet(enc_ctx, out_pkt) == 0) {
                                                    out_pkt->stream_index = out_video_stream->index;
                                                    av_packet_rescale_ts(out_pkt, enc_ctx->time_base, out_video_stream->time_base);
                                                    av_interleaved_write_frame(ofmt_ctx, out_pkt);
                                                    av_packet_unref(out_pkt);
                                                }
                                                av_packet_free(&out_pkt);
                                            }
                                            av_frame_unref(filtered_frame);
                                        }
                                        av_frame_free(&filtered_frame);
                                    }
                                } else {
                                    if (avcodec_send_frame(enc_ctx, out_frame) >= 0) {
                                        AVPacket* out_pkt = av_packet_alloc();
                                        while (avcodec_receive_packet(enc_ctx, out_pkt) == 0) {
                                            out_pkt->stream_index = out_video_stream->index;
                                            av_packet_rescale_ts(out_pkt, enc_ctx->time_base, out_video_stream->time_base);
                                            av_interleaved_write_frame(ofmt_ctx, out_pkt);
                                            av_packet_unref(out_pkt);
                                        }
                                        av_packet_free(&out_pkt);
                                    }
                                }
                            }
                        }
                    }
                }
                
                // --- 오디오 처리 (Stream Copy) ---
                else if (pkt->stream_index == audio_stream_idx && in_audio_stream) {
                    double current_time_sec = pkt->pts * av_q2d(in_audio_stream->time_base);
                    if (current_time_sec >= clip.trimStart && current_time_sec <= clip.trimEnd) {
                        
                        av_packet_rescale_ts(pkt, in_audio_stream->time_base, out_audio_stream->time_base);
                        
                        pkt->stream_index = out_audio_stream->index;
                        
                        // 연속 재생을 위해 pts를 누적값으로 강제 변경
                        pkt->pts = global_audio_pts;
                        pkt->dts = global_audio_pts;
                        global_audio_pts += pkt->duration;
                        
                        av_interleaved_write_frame(ofmt_ctx, pkt);
                    }
                }
                
                av_packet_unref(pkt);
            }

            av_packet_free(&pkt);
            av_frame_free(&frame);
            if (sws_ctx) sws_freeContext(sws_ctx);
            if (dec_ctx) avcodec_free_context(&dec_ctx);
            avformat_close_input(&ifmt_ctx);
        }

        // 비디오 스트림 플러시
        avcodec_send_frame(enc_ctx, nullptr);
        AVPacket* out_pkt = av_packet_alloc();
        while (avcodec_receive_packet(enc_ctx, out_pkt) == 0) {
            out_pkt->stream_index = out_video_stream->index;
            av_packet_rescale_ts(out_pkt, enc_ctx->time_base, out_video_stream->time_base);
            av_interleaved_write_frame(ofmt_ctx, out_pkt);
            av_packet_unref(out_pkt);
        }
        av_packet_free(&out_pkt);

        av_write_trailer(ofmt_ctx);
        if (!(ofmt_ctx->oformat->flags & AVFMT_NOFILE)) {
            avio_closep(&ofmt_ctx->pb);
        }
        if (filter_graph) avfilter_graph_free(&filter_graph);
        avformat_free_context(ofmt_ctx);
        avcodec_free_context(&enc_ctx);
        av_frame_free(&out_frame);

        resultMessage = "✅ 오디오 포함 멀티 렌더링 완료! 저장됨: " + outputPath;
        std::cout << "[C++ 엔진] 오디오 Muxing 저장 완료!" << std::endl;
    }

    void OnOK() override {
        Napi::HandleScope scope(Env());
        deferred.Resolve(Napi::String::New(Env(), resultMessage));
    }

    void OnError(const Napi::Error& e) override {
        Napi::HandleScope scope(Env());
        deferred.Reject(Napi::String::New(Env(), e.Message()));
    }

private:
    std::vector<ClipInfo> clips;
    std::string outputPath;
    std::string overlayPath;
    Napi::Promise::Deferred deferred;
    std::string resultMessage;
};

Napi::Value RenderVideo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array clipsArray = info[0].As<Napi::Array>();
    std::vector<ClipInfo> clips;
    for (uint32_t i = 0; i < clipsArray.Length(); i++) {
        Napi::Object clipObj = clipsArray.Get(i).As<Napi::Object>();
        std::string path = clipObj.Get("path").As<Napi::String>().Utf8Value();
        double trimStart = clipObj.Has("trimStart") ? clipObj.Get("trimStart").As<Napi::Number>().DoubleValue() : 0.0;
        double trimEnd = clipObj.Has("trimEnd") ? clipObj.Get("trimEnd").As<Napi::Number>().DoubleValue() : 5.0;
        double cropX = clipObj.Has("cropX") ? clipObj.Get("cropX").As<Napi::Number>().DoubleValue() : 0.5;
        double cropY = clipObj.Has("cropY") ? clipObj.Get("cropY").As<Napi::Number>().DoubleValue() : 0.5;
        double scale = clipObj.Has("scale") ? clipObj.Get("scale").As<Napi::Number>().DoubleValue() : 1.0;
        clips.push_back({ path, trimStart, trimEnd, cropX, cropY, scale });
    }
    std::string outputPath = info[1].As<Napi::String>().Utf8Value();
    std::string overlayPath = "";
    if (info.Length() >= 3 && info[2].IsString()) {
        overlayPath = info[2].As<Napi::String>().Utf8Value();
    }
    
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
    VideoRenderWorker* worker = new VideoRenderWorker(env, clips, outputPath, overlayPath, deferred);
    worker->Queue();
    return deferred.Promise();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "renderVideo"), Napi::Function::New(env, RenderVideo));
    return exports;
}

NODE_API_MODULE(video_engine, Init)
