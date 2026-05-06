{
  "targets": [
    {
      "target_name": "video_engine",
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "sources": [ "src/main.cpp" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "<(module_root_dir)/ffmpeg/include"
      ],
      "libraries": [
        "<(module_root_dir)/ffmpeg/lib/avcodec.lib",
        "<(module_root_dir)/ffmpeg/lib/avformat.lib",
        "<(module_root_dir)/ffmpeg/lib/avutil.lib",
        "<(module_root_dir)/ffmpeg/lib/swscale.lib",
        "<(module_root_dir)/ffmpeg/lib/swresample.lib",
        "<(module_root_dir)/ffmpeg/lib/avfilter.lib"
      ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "AdditionalOptions": [ "/utf-8" ]
        }
      }
    }
  ]
}
