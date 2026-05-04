#include <napi.h>
#include <string>
#include <iostream>

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/avutil.h>
}

// C++ 기반의 자체 엔진 함수
Napi::String RenderVideo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    // React/Electron에서 전달한 두 개의 인자(입력경로, 출력경로)를 받습니다.
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
        Napi::TypeError::New(env, "2개의 문자열 인자(inputPath, outputPath)가 필요합니다.").ThrowAsJavaScriptException();
        return Napi::String::New(env, "");
    }
    
    std::string inputPath = info[0].As<Napi::String>().Utf8Value();
    std::string outputPath = info[1].As<Napi::String>().Utf8Value();
    
    std::cout << "======================================" << std::endl;
    std::cout << "[C++ 코어 엔진] 비디오 정보 분석 시작!" << std::endl;
    std::cout << "입력 파일 경로: " << inputPath << std::endl;
    
    // 1. FFmpeg 파일 열기 (Demuxing 준비)
    AVFormatContext* formatContext = nullptr;
    if (avformat_open_input(&formatContext, inputPath.c_str(), nullptr, nullptr) != 0) {
        std::string err = "에러: 비디오 파일을 열 수 없습니다. 경로를 확인해주세요: " + inputPath;
        std::cout << err << std::endl;
        std::cout << "======================================" << std::endl;
        return Napi::String::New(env, err);
    }
    
    // 2. 스트림 정보 찾기 (비디오인지, 오디오인지 등 상세 정보 파악)
    if (avformat_find_stream_info(formatContext, nullptr) < 0) {
        avformat_close_input(&formatContext);
        std::string err = "에러: 스트림 정보를 찾을 수 없습니다.";
        std::cout << err << std::endl;
        std::cout << "======================================" << std::endl;
        return Napi::String::New(env, err);
    }
    
    // 3. 비디오 스트림 찾기 (오디오 말고 영상 트랙을 찾습니다)
    int videoStreamIndex = -1;
    for (unsigned int i = 0; i < formatContext->nb_streams; i++) {
        if (formatContext->streams[i]->codecpar->codec_type == AVMEDIA_TYPE_VIDEO) {
            videoStreamIndex = i;
            break;
        }
    }
    
    std::string resultMessage;
    if (videoStreamIndex == -1) {
        resultMessage = "에러: 비디오 트랙을 찾을 수 없습니다. (영상이 없는 파일일 수 있습니다)";
    } else {
        // 비디오 스트림 정보에서 가로, 세로 해상도 및 길이를 가져옵니다.
        AVCodecParameters* codecpar = formatContext->streams[videoStreamIndex]->codecpar;
        int width = codecpar->width;
        int height = codecpar->height;
        
        // 길이는 AV_TIME_BASE 로 나누어 초(Seconds) 단위로 변환합니다.
        int64_t duration = formatContext->duration;
        double durationSeconds = (double)duration / AV_TIME_BASE;
        
        resultMessage = "성공! 비디오 해상도: " + std::to_string(width) + "x" + std::to_string(height) + 
                        ", 길이: " + std::to_string(durationSeconds) + "초";
    }
    
    // 4. 리소스 정리 (메모리 누수 방지)
    avformat_close_input(&formatContext);
    
    std::cout << "[C++ 코어 엔진] 분석 결과: " << resultMessage << std::endl;
    std::cout << "======================================" << std::endl;
    
    return Napi::String::New(env, resultMessage);
}

// 자바스크립트 모듈로 수출(Export)하는 부분
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "renderVideo"), Napi::Function::New(env, RenderVideo));
    return exports;
}

NODE_API_MODULE(video_engine, Init)
