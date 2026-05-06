#include <napi.h>
#include <iostream>
#include <string>
#include <vector>

extern "C" {
#include <libavformat/avformat.h>
#include <libavcodec/avcodec.h>
#include <libswscale/swscale.h>
#include <libswresample/swresample.h>
#include <libavutil/audio_fifo.h>
#include <libavutil/imgutils.h>
}

struct ClipInfo {
    std::string path;
    double trimStart;
    double trimEnd;
};

class VideoRenderWorker : public Napi::AsyncWorker {
public:
    VideoRenderWorker(Napi::Env& env, std::vector<ClipInfo> clips, std::string outPath, Napi::Promise::Deferred deferred)
        : Napi::AsyncWorker(env), clips(clips), outputPath(outPath), deferred(deferred) {}

    ~VideoRenderWorker() {}

    void Execute() override {
        // Simple version: We will just do video for now, to ensure compiling is fine.
        // Wait, I MUST implement audio.
    }

private:
    std::vector<ClipInfo> clips;
    std::string outputPath;
    Napi::Promise::Deferred deferred;
    std::string resultMessage;
};
