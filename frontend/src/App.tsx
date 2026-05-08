import React, { useState, useRef, useEffect } from 'react';
import './App.css';
import { Play, Pause, Download, MonitorPlay } from 'lucide-react';
import { Stage, Layer, Rect, Text } from 'react-konva';

interface Asset {
  id: string;
  name: string;
  path: string;
  duration?: number;
}

interface TimelineClip {
  id: string;
  assetId: string;
  assetName: string;
  path: string;
  trimStart: number; // 원본 영상에서 잘라낼 시작 시간(초)
  trimEnd: number;   // 원본 영상에서 잘라낼 종료 시간(초)
  duration?: number; // 원본 영상 전체 길이
  startTime: number; // 타임라인 시작 위치(초)
  trackIndex: number; // 트랙 번호 (V1=0, V2=1...)
  cropX: number;     // 0.0 ~ 1.0 (X축 크롭 위치, 기본값 0.5)
  cropY: number;     // 0.0 ~ 1.0 (Y축 크롭 위치, 기본값 0.5)
  scale: number;     // 1.0 ~ 3.0 (화면 확대 비율, 기본값 1.0)
  x?: number;        // 화면 내 X 픽셀 오프셋 (기본값 0)
  y?: number;        // 화면 내 Y 픽셀 오프셋 (기본값 0)
  maskTop?: number;  // 0.0 ~ 1.0 (위쪽 테두리 자르기 비율)
  maskBottom?: number;// 0.0 ~ 1.0 (아래쪽 테두리 자르기 비율)
  maskLeft?: number; // 0.0 ~ 1.0 (왼쪽 테두리 자르기 비율)
  maskRight?: number;// 0.0 ~ 1.0 (오른쪽 테두리 자르기 비율)
  maskShape?: 'rectangle' | 'circle' | 'ellipse'; // 마스크 모양 (기본값: rectangle)
  maskCenterX?: number; // 0.0 ~ 1.0 (마스크 중심 X, 기본 0.5)
  maskCenterY?: number; // 0.0 ~ 1.0 (마스크 중심 Y, 기본 0.5)
  maskRadiusX?: number; // 0.0 ~ 1.0 (마스크 가로 반지름, 기본 0.5)
  maskRadiusY?: number; // 0.0 ~ 1.0 (마스크 세로 반지름, 기본 0.5)
  fadeIn?: boolean;     // 1초 페이드 인
  fadeOut?: boolean;    // 1초 페이드 아웃
  animation?: 'none' | 'zoom-in' | 'zoom-out'; // 줌 애니메이션 프리셋
}

interface TextClip {
  id: string;
  text: string;
  x: number;
  y: number;
  startTime: number;
  endTime: number;
  fontSize: number;
  color: string;
  trackIndex: number; // 다중 텍스트 트랙 식별자
}

const parseSubtitles = (content: string, targetTrack: number = 0): TextClip[] => {
  const isVTT = content.trim().startsWith('WEBVTT');
  const blocks = content.split(/\n\s*\n/);
  const clips: TextClip[] = [];
  
  blocks.forEach(block => {
    if (isVTT && block.startsWith('WEBVTT')) return;
    const lines = block.split('\n').filter(l => l.trim() !== '');
    if (lines.length >= 2) {
      let timeLineIdx = 0;
      if (!lines[0].includes('-->')) timeLineIdx = 1;
      
      if (timeLineIdx < lines.length && lines[timeLineIdx].includes('-->')) {
        const timeLine = lines[timeLineIdx];
        const textLines = lines.slice(timeLineIdx + 1).join('\n').replace(/<[^>]+>/g, '');
        
        let start = 0, end = 0;
        
        if (isVTT) {
          const timeMatch = timeLine.match(/(\d{2}:)?(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}:)?(\d{2}):(\d{2})\.(\d{3})/);
          if (timeMatch) {
            const h1 = timeMatch[1] ? parseInt(timeMatch[1].replace(':', '')) : 0;
            start = h1*3600 + parseInt(timeMatch[2])*60 + parseInt(timeMatch[3]) + parseInt(timeMatch[4])/1000;
            const h2 = timeMatch[5] ? parseInt(timeMatch[5].replace(':', '')) : 0;
            end = h2*3600 + parseInt(timeMatch[6])*60 + parseInt(timeMatch[7]) + parseInt(timeMatch[8])/1000;
          }
        } else {
          const timeMatch = timeLine.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
          if (timeMatch) {
            start = parseInt(timeMatch[1])*3600 + parseInt(timeMatch[2])*60 + parseInt(timeMatch[3]) + parseInt(timeMatch[4])/1000;
            end = parseInt(timeMatch[5])*3600 + parseInt(timeMatch[6])*60 + parseInt(timeMatch[7]) + parseInt(timeMatch[8])/1000;
          }
        }
        
        if (start !== 0 || end !== 0) {
          clips.push({
            id: Math.random().toString(36).substr(2, 9),
            text: textLines.trim(),
            startTime: start,
            endTime: end,
            x: 100,
            y: 500, // 하단 중앙 부근
            fontSize: 24,
            color: '#ffffff',
          });
        }
      }
    }
  });
  return clips;
};

function App() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false); // 클립 전환 시 로딩 지연 방지용
  const [isContinuousPlay, setIsContinuousPlay] = useState(true); // 연속 재생 여부 토글
  const [currentTime, setCurrentTime] = useState(0); // 타임라인 현재 시간(초)
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [timelineClips, setTimelineClips] = useState<TimelineClip[]>([]);
  const [selectedTimelineClipId, setSelectedTimelineClipId] = useState<string | null>(null); // 속성 편집용 타임라인 선택
  const [outputPath, setOutputPath] = useState("output_shorts.mp4");
  const [renderStatus, setRenderStatus] = useState("");
  const [insertMode, setInsertMode] = useState<'playhead' | 'end_all' | 'end_selected' | 'new_track'>('playhead');
  
  const [textClips, setTextClips] = useState<TextClip[]>([]);
  const [selectedTextClipId, setSelectedTextClipId] = useState<string | null>(null);

  const [hiddenTracks, setHiddenTracks] = useState<number[]>([]);
  const [lockedTracks, setLockedTracks] = useState<number[]>([]);
  const [hiddenVideoTracks, setHiddenVideoTracks] = useState<number[]>([]);
  const [lockedVideoTracks, setLockedVideoTracks] = useState<number[]>([]);
  const [trackContextMenu, setTrackContextMenu] = useState<{x: number, y: number, trackIdx: number, type: 'text' | 'video'} | null>(null);

  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0, initialCropX: 0.5, initialCropY: 0.5, initialX: 0, initialY: 0 });

  const [draggingTextId, setDraggingTextId] = useState<string | null>(null);
  const [dragTextStart, setDragTextStart] = useState<{ x: number, y: number, initialStart: number, initialEnd: number, initialTrack: number } | null>(null);

  useEffect(() => {
    if (!draggingTextId || !dragTextStart) return;
    
    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragTextStart.x;
      const deltaSec = deltaX / 20; // 1초당 20px
      
      const deltaY = e.clientY - dragTextStart.y;
      const trackOffset = Math.round(deltaY / 50); // 트랙 하나당 높이 대략 50px (40px + margin 10px)
      
      setTextClips(prev => {
        // 텍스트 자석 효과(Snapping) 포인트 수집
        const snapPoints = [0, currentTime];
        prev.forEach(p => {
          if (p.id !== draggingTextId) {
            snapPoints.push(p.startTime);
            snapPoints.push(p.endTime);
          }
        });

        return prev.map(c => {
          if (c.id === draggingTextId) {
            let newStart = dragTextStart.initialStart + deltaSec;
            const dur = dragTextStart.initialEnd - dragTextStart.initialStart;
            let newEnd = newStart + dur;

            // 0.5초(약 10px) 이내면 자석처럼 달라붙음
            const SNAP_THRESHOLD = 0.5;
            for (const sp of snapPoints) {
               if (Math.abs(newStart - sp) < SNAP_THRESHOLD) {
                 newStart = sp;
                 break;
               }
               if (Math.abs(newEnd - sp) < SNAP_THRESHOLD) {
                 newStart = sp - dur;
                 break;
               }
            }

            if (newStart < 0) newStart = 0;
            
            let newTrack = dragTextStart.initialTrack + trackOffset;
            if (newTrack < 0) newTrack = 0;
            
            return { ...c, startTime: newStart, endTime: newStart + dur, trackIndex: newTrack };
          }
          return c;
        });
      });
    };
    
    const handleMouseUp = () => {
      setDraggingTextId(null);
      setDragTextStart(null);
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingTextId, dragTextStart]);

  const [draggingVideoId, setDraggingVideoId] = useState<string | null>(null);
  const [dragVideoStart, setDragVideoStart] = useState<{ x: number, y: number, initialStart: number, initialTrack: number } | null>(null);

  useEffect(() => {
    if (!draggingVideoId || !dragVideoStart) return;
    
    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragVideoStart.x;
      const deltaSec = deltaX / 20; // 1초당 20px
      
      const deltaY = e.clientY - dragVideoStart.y;
      const trackOffset = Math.round(deltaY / 70); // 비디오 트랙 높이 (60px + margin 10px = 70px)
      
      setTimelineClips(prev => {
        // 자석 효과(Snapping)를 위한 모든 자석 포인트 수집
        const snapPoints = [0, currentTime];
        prev.forEach(p => {
          if (p.id !== draggingVideoId) {
            snapPoints.push(p.startTime);
            snapPoints.push(p.startTime + (p.trimEnd - p.trimStart));
          }
        });

        return prev.map(c => {
          if (c.id === draggingVideoId) {
            let newStart = dragVideoStart.initialStart + deltaSec;
            const dur = c.trimEnd - c.trimStart;
            let newEnd = newStart + dur;
            
            // 0.5초(약 10px) 이내면 자석처럼 달라붙음
            const SNAP_THRESHOLD = 0.5;
            for (const sp of snapPoints) {
               // 시작점 스냅
               if (Math.abs(newStart - sp) < SNAP_THRESHOLD) {
                 newStart = sp;
                 break;
               }
               // 끝점 스냅
               if (Math.abs(newEnd - sp) < SNAP_THRESHOLD) {
                 newStart = sp - dur;
                 break;
               }
            }

            if (newStart < 0) newStart = 0;
            
            let newTrack = dragVideoStart.initialTrack + trackOffset;
            if (newTrack < 0) newTrack = 0;
            
            return { ...c, startTime: newStart, trackIndex: newTrack };
          }
          return c;
        });
      });
    };
    
    const handleMouseUp = () => {
      setDraggingVideoId(null);
      setDragVideoStart(null);
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingVideoId, dragVideoStart]);

  const videoRefs = useRef<{ [id: string]: HTMLVideoElement | null }>({});
  const stageRef = useRef<any>(null);
  const subtitleFileInputRef = useRef<HTMLInputElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvasEl = canvasContainerRef.current;
    if (!canvasEl) return;
    
    // 비표준 passive wheel 이벤트를 방지하여 브라우저 스크롤을 막음
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
    };
    canvasEl.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvasEl.removeEventListener('wheel', handleWheel);
  }, []);

  const handleSubtitleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        const newClips = parseSubtitles(content);
        setTextClips(prev => [...prev, ...newClips]);
      }
      if (subtitleFileInputRef.current) subtitleFileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  // 현재 시간에 재생되어야 할 클립 계산 (다중 비디오 트랙 레이어링)
  const overlappingVideoClips = timelineClips.filter(c => 
    currentTime >= c.startTime && currentTime < c.startTime + (c.trimEnd - c.trimStart)
  );

  const visibleVideoClips = overlappingVideoClips.filter(c => !hiddenVideoTracks.includes(c.trackIndex || 0));

  // 플레이헤드 재생 로직 제어(단일 모드 정지 등)를 위한 최상단 클립
  let topClip: TimelineClip | null = null;
  if (visibleVideoClips.length > 0) {
    const sorted = [...visibleVideoClips].sort((a, b) => (b.trackIndex || 0) - (a.trackIndex || 0));
    topClip = sorted[0];
  }
  
  // 드래그/확대 등 화면 편집 타겟 클립 (현재 선택된 클립 우선, 없으면 최상단 클립)
  const editingClip = selectedTimelineClipId 
    ? visibleVideoClips.find(c => c.id === selectedTimelineClipId) || topClip
    : topClip;

  // 플레이헤드 재생 로직 (버퍼링 중일 때는 시간 정지)
  useEffect(() => {
    let interval: any;
    if (isPlaying && !isBuffering) {
      interval = setInterval(() => {
        setCurrentTime(prev => {
          const nextTime = prev + 0.1;
          
          const totalDuration = timelineClips.length > 0 
            ? Math.max(...timelineClips.map(c => c.startTime + (c.trimEnd - c.trimStart))) 
            : 0;

          // 단일 클립 모드: 최상단 클립의 끝에 도달하면 일시정지
          if (!isContinuousPlay && topClip) {
             const currentClipEnd = topClip.startTime + (topClip.trimEnd - topClip.trimStart);
             if (nextTime >= currentClipEnd) {
               setIsPlaying(false);
               return currentClipEnd - 0.01;
             }
          }

          // 전체 타임라인 끝에 도달하면 정지
          if (nextTime >= totalDuration && totalDuration > 0) {
            setIsPlaying(false);
            return 0;
          }
          return nextTime;
        });
      }, 100);
    }
    return () => clearInterval(interval);
  }, [isPlaying, isBuffering, timelineClips, isContinuousPlay, topClip]);

  // 비디오 탐색(Seek) 및 다중 클립 연속 재생 동기화
  useEffect(() => {
    visibleVideoClips.forEach(clip => {
      const video = videoRefs.current[clip.id];
      if (video) {
        const localTime = clip.trimStart + (currentTime - clip.startTime);
        
        const handleSync = () => {
          // 오차가 0.15초 이상일 때만 seek (잦은 탐색 방지)
          if (Math.abs(video.currentTime - localTime) > 0.15) {
             video.currentTime = localTime;
          }
          if (isPlaying && video.paused) {
            video.play().catch((e: any) => console.error("Play error:", e));
          } else if (!isPlaying && !video.paused) {
            video.pause();
          }
        };

        if (video.readyState >= 1 /* HAVE_METADATA */) {
          handleSync();
        } else {
          // 영상 소스가 갓 변경된 경우 로딩 완료될 때까지 기다림
          video.addEventListener('loadedmetadata', handleSync, { once: true });
        }
      }
    });
  }, [currentTime, visibleVideoClips, isPlaying]);

  const handleExport = async () => {
    if (timelineClips.length === 0) {
      setRenderStatus("하단 타임라인에 비디오를 먼저 추가해주세요.");
      return;
    }
    
    // V1(배경) 클립과 V2 이상(오버레이) 클립 분리
    const v1Clips = timelineClips.filter(c => (c.trackIndex || 0) === 0);
    const v2Clips = timelineClips.filter(c => (c.trackIndex || 0) > 0);
    
    if (v1Clips.length === 0) {
      setRenderStatus("에러: V1(배경) 트랙에 최소 1개의 영상이 있어야 합니다.");
      return;
    }

    try {
      setRenderStatus("프론트엔드 오프스크린 렌더링 중... (화면 캡처 중, 잠시만 기다려주세요)");
      
      let overlayBase64: any = textClips; // 텍스트만 있으면 ASS 생성용으로 넘김

      // V2 이상 클립이나 텍스트가 있다면 WebM 오버레이 생성 (하이브리드 방식)
      if (v2Clips.length > 0 || textClips.length > 0) {
         const totalDuration = Math.max(
           ...timelineClips.map(c => c.startTime + (c.trimEnd - c.trimStart)),
           ...textClips.map(t => t.endTime)
         );
         
         overlayBase64 = await recordOverlayCanvas(v2Clips, textClips, totalDuration);
      }

      setRenderStatus("C++ 엔진 호출 중... (배경 인코딩 및 오버레이 합성 중)");
      
      // @ts-ignore
      if (window.electronAPI) {
        // C++ 엔진에는 V1 클립들만 넘기고, 나머지는 투명 WebM 오버레이로 전달
        // @ts-ignore
        const result = await window.electronAPI.renderVideo(v1Clips, outputPath, overlayBase64);
        setRenderStatus(result);
      } else {
        setRenderStatus("Electron 환경이 아닙니다.");
      }
    } catch (error) {
      console.error(error);
      setRenderStatus("렌더링 실패: " + error);
    }
  };

  // 캔버스 레코딩 (하이브리드 렌더링 핵심 로직)
  const recordOverlayCanvas = async (v2Clips: TimelineClip[], tClips: TextClip[], maxDuration: number): Promise<string> => {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      canvas.width = 720;
      canvas.height = 1280;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject("Canvas 2D context failed");

      // 비디오 엘리먼트 수집
      const overlayVideos: { clip: TimelineClip, el: HTMLVideoElement }[] = [];
      v2Clips.forEach(c => {
         const el = videoRefs.current[c.id];
         if (el) overlayVideos.push({ clip: c, el });
      });

      const stream = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp8' });
      const chunks: Blob[] = [];
      recorder.ondataavailable = e => chunks.push(e.data);
      
      recorder.onstop = async () => {
         const blob = new Blob(chunks, { type: 'video/webm' });
         const buffer = await blob.arrayBuffer();
         const base64 = Buffer.from(buffer).toString('base64');
         resolve(`data:video/webm;base64,${base64}`);
      };

      recorder.start();

      let recTime = 0;
      const fps = 30;
      const step = 1 / fps;
      
      // 오프스크린 렌더링 루프 (비실시간 강제 프레임 진행)
      const renderFrame = async () => {
         if (recTime > maxDuration) {
            recorder.stop();
            return;
         }

         ctx.clearRect(0, 0, 720, 1280);

         // 1. V2 비디오 그리기
         for (const item of overlayVideos) {
            const c = item.clip;
            if (recTime >= c.startTime && recTime <= c.startTime + (c.trimEnd - c.trimStart)) {
               const vTime = c.trimStart + (recTime - c.startTime);
               // 비디오 프레임 동기화를 위해 수동으로 currentTime 설정 (오프스크린 렌더링의 핵심)
               if (Math.abs(item.el.currentTime - vTime) > 0.05) {
                   item.el.currentTime = vTime;
                   // seek 완료 대기 (실제 구현 시 약간의 비동기 대기 필요할 수 있음)
                   await new Promise(r => setTimeout(r, 10)); 
               }

               ctx.save();
               
               // 페이드 인/아웃 계산
               let opacity = 1.0;
               const clipLocalTime = recTime - c.startTime;
               const duration = c.trimEnd - c.trimStart;
               if (c.fadeIn && clipLocalTime < 1.0) opacity = clipLocalTime;
               if (c.fadeOut && (duration - clipLocalTime) < 1.0) opacity = duration - clipLocalTime;
               ctx.globalAlpha = Math.max(0, Math.min(1, opacity));

               // 위치 이동 및 스케일
               const renderScale = c.scale || 1.0;
               // translate는 영상의 0,0 좌표를 화면 x,y로 이동
               ctx.translate(c.x || 0, c.y || 0);

               // 마스크(clip-path) 적용
               if (c.maskShape === 'circle') {
                  ctx.beginPath();
                  ctx.arc((c.maskCenterX||0.5)*720, (c.maskCenterY||0.5)*1280, (c.maskRadiusX||0.5)*720, 0, Math.PI*2);
                  ctx.clip();
               } else if (c.maskShape === 'ellipse') {
                  ctx.beginPath();
                  ctx.ellipse((c.maskCenterX||0.5)*720, (c.maskCenterY||0.5)*1280, (c.maskRadiusX||0.4)*720, (c.maskRadiusY||0.25)*1280, 0, 0, Math.PI*2);
                  ctx.clip();
               }

               // 줌 애니메이션
               let currentScale = renderScale;
               if (c.animation === 'zoom-in') currentScale += (clipLocalTime / duration) * 0.2;
               else if (c.animation === 'zoom-out') currentScale += (1.0 - clipLocalTime / duration) * 0.2;
               
               ctx.translate((c.cropX||0.5)*720, (c.cropY||0.5)*1280);
               ctx.scale(currentScale, currentScale);
               ctx.translate(-(c.cropX||0.5)*720, -(c.cropY||0.5)*1280);

               // 비디오 원본 비율에 맞게 크롭 렌더링
               const vAspect = item.el.videoWidth / item.el.videoHeight;
               const cAspect = 720 / 1280;
               let drawW = 720, drawH = 1280, offsetX = 0, offsetY = 0;
               if (vAspect > cAspect) {
                   drawW = 1280 * vAspect;
                   offsetX = (720 - drawW) * (c.cropX || 0.5);
               } else {
                   drawH = 720 / vAspect;
                   offsetY = (1280 - drawH) * (c.cropY || 0.5);
               }
               ctx.drawImage(item.el, offsetX, offsetY, drawW, drawH);
               ctx.restore();
            }
         }

         // 2. 텍스트 그리기 (단순 HTML Canvas FillText)
         tClips.forEach(t => {
            if (recTime >= t.startTime && recTime <= t.endTime) {
               ctx.save();
               ctx.font = `bold ${t.fontSize * 2}px Inter`;
               ctx.fillStyle = t.color || "white";
               ctx.textAlign = "center";
               ctx.shadowColor = "rgba(0,0,0,0.8)";
               ctx.shadowBlur = 10;
               ctx.fillText(t.text, (t.x || 360) * 2, (t.y || 320) * 2);
               ctx.restore();
            }
         });

         recTime += step;
         setTimeout(renderFrame, 1000 / fps); // 실제 시간에 맞춰 레코딩 진행
      };

      renderFrame();
    });
  };

  return (
    <div className="editor-container">
      {/* Top Header */}
      <header className="editor-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <MonitorPlay size={24} color="var(--accent)" />
          <h1 style={{ fontSize: '18px', fontWeight: 600 }}>ShortsMaker</h1>
        </div>
        <button className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }} onClick={handleExport}>
          <Download size={16} />
          비디오 분석 테스트 (현재 단계)
        </button>
      </header>

      {/* Left Sidebar - Templates & Assets */}
      <aside className="sidebar-left">
        <h2 className="panel-title">에셋 & 템플릿</h2>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button 
              onClick={async () => {
                // @ts-ignore
                if (window.electronAPI && window.electronAPI.openFileDialog) {
                  // @ts-ignore
                  const filePaths = await window.electronAPI.openFileDialog();
                  if (filePaths && filePaths.length > 0) {
                    filePaths.forEach((filePath: string) => {
                      const fileName = filePath.split('\\').pop() || 'Unknown Video';
                      const tempVideo = document.createElement('video');
                      tempVideo.src = `file://${filePath}`;
                      tempVideo.onloadedmetadata = () => {
                        const newAsset: Asset = { id: Math.random().toString(36).substr(2, 9), name: fileName, path: filePath, duration: tempVideo.duration };
                        setAssets(prev => {
                          const updated = [...prev, newAsset];
                          if (updated.length === 1) setSelectedAssetId(newAsset.id);
                          return updated;
                        });
                      };
                      tempVideo.onerror = () => {
                         const newAsset: Asset = { id: Math.random().toString(36).substr(2, 9), name: fileName, path: filePath, duration: 30 };
                         setAssets(prev => [...prev, newAsset]);
                      };
                    });
                  }
                }
              }}
              className="btn-primary"
              style={{ flex: 1, padding: '10px', fontSize: '12px', background: 'var(--accent)', fontWeight: 600 }}
            >
              + 파일 여러 개
            </button>
            <button 
              onClick={async () => {
                // @ts-ignore
                if (window.electronAPI && window.electronAPI.openDirectoryDialog) {
                  // @ts-ignore
                  const filePaths = await window.electronAPI.openDirectoryDialog();
                  if (filePaths && filePaths.length > 0) {
                    filePaths.forEach((filePath: string) => {
                      const fileName = filePath.split('\\').pop() || 'Unknown Video';
                      const tempVideo = document.createElement('video');
                      tempVideo.src = `file://${filePath}`;
                      tempVideo.onloadedmetadata = () => {
                        const newAsset: Asset = { id: Math.random().toString(36).substr(2, 9), name: fileName, path: filePath, duration: tempVideo.duration };
                        setAssets(prev => {
                          const updated = [...prev, newAsset];
                          if (updated.length === 1) setSelectedAssetId(newAsset.id);
                          return updated;
                        });
                      };
                      tempVideo.onerror = () => {
                         const newAsset: Asset = { id: Math.random().toString(36).substr(2, 9), name: fileName, path: filePath, duration: 30 };
                         setAssets(prev => [...prev, newAsset]);
                      };
                    });
                  }
                }
              }}
              className="btn-primary"
              style={{ flex: 1, padding: '10px', fontSize: '12px', background: '#3b82f6', fontWeight: 600 }}
            >
              📁 폴더 통째로
            </button>
          </div>

          {/* 에셋 목록 (리스트형 UI) */}
          <div style={{ background: 'var(--bg-dark)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', minHeight: '200px', maxHeight: '400px', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <label style={{ color: 'var(--text-muted)', fontSize: '12px', margin: 0 }}>업로드된 에셋 목록</label>
              <select 
                value={insertMode} 
                onChange={(e) => setInsertMode(e.target.value as any)}
                style={{ background: '#333', color: 'white', border: '1px solid #555', borderRadius: '4px', fontSize: '11px', padding: '2px 4px', cursor: 'pointer' }}
                title="타임라인에 추가될 위치"
              >
                <option value="playhead">▶️ 재생 위치 (빈칸 자동)</option>
                <option value="end_selected">🎯 선택된 클립 뒤에</option>
                <option value="end_all">⏭️ 타임라인 맨 끝에</option>
                <option value="new_track">🆕 새로운 트랙(V층) 생성</option>
              </select>
            </div>
            {assets.length === 0 ? (
              <div style={{ color: '#666', fontSize: '12px', textAlign: 'center', marginTop: '40px' }}>버튼을 눌러 영상을<br/>불러와주세요.</div>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {assets.map(asset => (
                  <li 
                    key={asset.id}
                    onClick={() => { setSelectedAssetId(asset.id); setSelectedTextClipId(null); }}
                    style={{ 
                      padding: '10px', 
                      background: selectedAssetId === asset.id ? 'rgba(59, 130, 246, 0.2)' : '#222', 
                      border: `1px solid ${selectedAssetId === asset.id ? 'var(--accent)' : '#444'}`,
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}
                    title={asset.path}
                  >
                    <div style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      🎥 {asset.name}
                    </div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation(); // 클릭 이벤트 버블링 방지
                          
                          const newTrimEnd = asset.duration ? Math.min(5, asset.duration) : 5;
                          const newDuration = newTrimEnd; // trimStart is 0
                          
                          let targetStartTime = currentTime;
                          let targetTrack = 0;

                          if (insertMode === 'playhead') {
                            targetStartTime = currentTime;
                            // 빈 비디오 트랙 찾기
                            while (true) {
                              // @ts-ignore
                              const isOccupied = timelineClips.some(c => (c.trackIndex || 0) === targetTrack && Math.max(targetStartTime, c.startTime) < Math.min(targetStartTime + newDuration, c.startTime + (c.trimEnd - c.trimStart)));
                              if (!isOccupied) break;
                              targetTrack++;
                            }
                          } else if (insertMode === 'end_selected') {
                            if (!selectedTimelineClipId) {
                               alert("타임라인에서 기준이 될 영상 블록(파란색 테두리)을 먼저 클릭해주세요.");
                               return;
                            }
                            const selClip = timelineClips.find(c => c.id === selectedTimelineClipId);
                            if (selClip) {
                               targetTrack = selClip.trackIndex || 0;
                               const clipsOnTrack = timelineClips.filter(c => (c.trackIndex || 0) === targetTrack);
                               targetStartTime = clipsOnTrack.length > 0 ? Math.max(...clipsOnTrack.map(c => c.startTime + (c.trimEnd - c.trimStart))) : 0;
                            } else {
                               alert("선택된 영상 블록을 찾을 수 없습니다.");
                               return;
                            }
                          } else if (insertMode === 'end_all') {
                            if (timelineClips.length > 0) {
                              // 전체 클립 중 가장 늦게 끝나는 클립을 찾아 해당 클립의 트랙에 이어붙임
                              const lastClip = timelineClips.reduce((latest, current) => {
                                 const latestEnd = latest.startTime + (latest.trimEnd - latest.trimStart);
                                 const currentEnd = current.startTime + (current.trimEnd - current.trimStart);
                                 return currentEnd > latestEnd ? current : latest;
                              });
                              targetStartTime = lastClip.startTime + (lastClip.trimEnd - lastClip.trimStart);
                              targetTrack = lastClip.trackIndex || 0;
                            } else {
                              targetStartTime = 0;
                              targetTrack = 0;
                            }
                          } else if (insertMode === 'new_track') {
                            targetStartTime = currentTime;
                            targetTrack = timelineClips.length > 0 ? Math.max(...timelineClips.map(c => c.trackIndex || 0)) + 1 : 0;
                          }

                          const newClip: TimelineClip = {
                            id: Math.random().toString(36).substr(2, 9),
                            assetId: asset.id,
                            assetName: asset.name,
                            path: asset.path,
                            trimStart: 0, // 기본값 0초부터
                            trimEnd: newTrimEnd,    // 최대 5초
                            duration: asset.duration,
                            startTime: targetStartTime,
                            trackIndex: targetTrack,
                            cropX: 0.5,
                            cropY: 0.5,
                            scale: 1.0
                          };
                          setTimelineClips(prev => [...prev, newClip]);
                          setSelectedTimelineClipId(newClip.id); // 추가 후 즉시 속성창에 띄우기
                        }}
                        style={{ marginLeft: '8px', padding: '4px 8px', fontSize: '10px', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                        title="타임라인에 추가"
                      >
                        + 추가
                      </button>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setAssets(prev => prev.filter(a => a.id !== asset.id));
                          if (selectedAssetId === asset.id) setSelectedAssetId(null);
                        }}
                        style={{ padding: '4px 6px', fontSize: '10px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                        title="에셋 삭제"
                      >
                        X
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div style={{ background: 'var(--bg-dark)', padding: '15px', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>최종 출력 파일명</label>
            <input 
              type="text" 
              value={outputPath} 
              onChange={(e) => setOutputPath(e.target.value)}
              style={{ width: '100%', padding: '8px', background: '#222', border: '1px solid var(--border)', color: 'white', borderRadius: '4px' }} 
            />
          </div>
        </div>
      </aside>

      {/* Center Preview - Canvas */}
      <main className="preview-area" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', padding: '20px', overflowY: 'auto' }}>
        {/* 상태 메시지 영역 (alert 대체) */}
        {renderStatus && (
          <div style={{ marginBottom: '15px', padding: '10px', background: 'rgba(16, 185, 129, 0.2)', color: '#10b981', borderRadius: '4px', border: '1px solid #10b981', fontSize: '14px', textAlign: 'center' }}>
            {renderStatus}
          </div>
        )}

        <div 
          ref={canvasContainerRef}
          className="canvas-container" 
          style={{ 
            position: 'relative', width: 360, height: 640, flexShrink: 0, boxShadow: '0 10px 30px rgba(0,0,0,0.5)', overflow: 'hidden', backgroundColor: 'black',
            cursor: editingClip ? (isDraggingCanvas ? 'grabbing' : 'grab') : 'default'
          }}
          onWheel={(e) => {
            if (!editingClip) return;
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            const newScale = Math.max(0.1, Math.min(5.0, (editingClip.scale || 1.0) + delta));
            setTimelineClips(prev => prev.map(c => c.id === editingClip?.id ? { ...c, scale: newScale } : c));
          }}
          onMouseDown={(e) => {
            if (!editingClip) return;
            setIsDraggingCanvas(true);
            setDragStartPos({ 
              x: e.clientX, 
              y: e.clientY, 
              initialCropX: editingClip.cropX, 
              initialCropY: editingClip.cropY,
              initialX: editingClip.x || 0,
              initialY: editingClip.y || 0
            });
          }}
          onMouseMove={(e) => {
            if (!isDraggingCanvas || !editingClip) return;
            const deltaX = e.clientX - dragStartPos.x;
            const deltaY = e.clientY - dragStartPos.y;
            
            const scale = editingClip.scale || 1.0;
            
            if (scale < 1.0) {
              // 축소 모드 (PIP): 내용물이 아닌 영상 박스(Position X, Y) 자체를 이동
              const newX = dragStartPos.initialX + deltaX;
              const newY = dragStartPos.initialY + deltaY;
              setTimelineClips(prev => prev.map(c => c.id === editingClip?.id ? { ...c, x: newX, y: newY } : c));
            } else {
              // 확대/꽉찬 모드: 팬앤스캔 (내용물 훑어보기, Crop X, Y)
              const hiddenWidth = (640 * (16/9) * scale) - 360;
              const hiddenHeight = (640 * scale) - 640;

              const factorX = hiddenWidth > 0 ? 1 / hiddenWidth : 1 / 360;
              const factorY = hiddenHeight > 0 ? 1 / hiddenHeight : 1 / 640;

              let newCropX = dragStartPos.initialCropX - (deltaX * factorX);
              let newCropY = dragStartPos.initialCropY - (deltaY * factorY);

              // [-1.0, 2.0] 제한
              newCropX = Math.max(-1.0, Math.min(2.0, newCropX));
              newCropY = Math.max(-1.0, Math.min(2.0, newCropY));

              setTimelineClips(prev => prev.map(c => c.id === editingClip?.id ? { ...c, cropX: newCropX, cropY: newCropY } : c));
            }
          }}
          onMouseUp={() => setIsDraggingCanvas(false)}
          onMouseLeave={() => setIsDraggingCanvas(false)}
        >
          {/* Video Canvas Layer */}
          <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {(() => {
              const isAssetPreviewMode = selectedAssetId && !selectedTimelineClipId && !isPlaying;
              const previewAsset = isAssetPreviewMode ? assets.find(a => a.id === selectedAssetId) : null;
              
              if (isAssetPreviewMode && previewAsset) {
                return (
                  <video 
                    src={previewAsset.path} 
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    controls={false}
                  />
                );
              }

              if (visibleVideoClips.length > 0) {
                // V1(낮은 트랙)부터 그려서 V2(높은 트랙)가 위로 덮이도록 오름차순 정렬
                const sortedClips = [...visibleVideoClips].sort((a, b) => (a.trackIndex || 0) - (b.trackIndex || 0));
                
                return (
                  <>
                    {sortedClips.map((clip, index) => {
                      const clipDuration = clip.trimEnd - clip.trimStart;
                      const clipCurrentTime = currentTime - clip.startTime;
                      
                      let opacity = 1.0;
                      if (clip.fadeIn && clipCurrentTime < 1.0) {
                        opacity = Math.max(0, clipCurrentTime);
                      }
                      if (clip.fadeOut && (clip.startTime + clipDuration - currentTime) < 1.0) {
                        opacity = Math.max(0, clip.startTime + clipDuration - currentTime);
                      }
                      opacity = Math.max(0, Math.min(1, opacity));

                      let renderScale = clip.scale || 1.0;
                      if (clip.animation === 'zoom-in') {
                        const progress = Math.max(0, Math.min(1, clipCurrentTime / clipDuration));
                        renderScale += progress * 0.2; // 0.2만큼 천천히 확대
                      } else if (clip.animation === 'zoom-out') {
                        const progress = Math.max(0, Math.min(1, clipCurrentTime / clipDuration));
                        renderScale += (1 - progress) * 0.2; // 0.2에서 0으로 서서히 축소
                      }

                      return (
                        <video 
                          key={clip.id}
                          ref={(el) => { videoRefs.current[clip.id] = el; }}
                          src={clip.path} 
                          style={{ 
                            position: 'absolute',
                            top: 0, left: 0,
                            width: '100%', 
                            height: '100%', 
                            objectFit: 'cover', // 세로 화면에 꽉 차게 
                            objectPosition: `${clip.cropX * 100}% ${clip.cropY * 100}%`, // 팬앤스캔 크롭 좌표
                            transform: `translate(${clip.x || 0}px, ${clip.y || 0}px) scale(${renderScale})`,
                            transformOrigin: `${clip.cropX * 100}% ${clip.cropY * 100}%`,
                            clipPath: clip.maskShape === 'circle' 
                              ? `circle(${(clip.maskRadiusX ?? 0.5) * 100}% at ${(clip.maskCenterX ?? 0.5) * 100}% ${(clip.maskCenterY ?? 0.5) * 100}%)` 
                              : clip.maskShape === 'ellipse' 
                                ? `ellipse(${(clip.maskRadiusX ?? 0.4) * 100}% ${(clip.maskRadiusY ?? 0.25) * 100}% at ${(clip.maskCenterX ?? 0.5) * 100}% ${(clip.maskCenterY ?? 0.5) * 100}%)` 
                                : `inset(${(clip.maskTop || 0) * 100}% ${(clip.maskRight || 0) * 100}% ${(clip.maskBottom || 0) * 100}% ${(clip.maskLeft || 0) * 100}%)`,
                            opacity: opacity,
                            transition: isDraggingCanvas ? 'none' : 'object-position 0.1s ease, transform 0.1s ease',
                            zIndex: clip.trackIndex || 0 // CSS z-index로 레이어 강제
                          }}
                          onWaiting={() => setIsBuffering(true)}
                          onCanPlay={() => setIsBuffering(false)}
                        />
                      );
                    })}
                  </>
                );
              }

              return <div style={{ color: '#666', fontSize: '14px' }}>타임라인에 영상을 올리거나 에셋을 선택해보세요.</div>;
            })()}
          </div>
          
           {/* 2. Konva Canvas for WYSIWYG editing (비디오 앞단 투명 레이어) */}
           <Stage 
            ref={stageRef} 
            width={360} height={640} 
            style={{ position: 'absolute', zIndex: 10 }}
            onMouseDown={(e) => {
              // 텍스트를 클릭한게 아니라면 선택 해제 (캔버스 드래그로 넘어감)
              if (e.target === e.target.getStage()) {
                setSelectedTextClipId(null);
              }
            }}
          >
            <Layer>
              {textClips.filter(t => currentTime >= t.startTime && currentTime <= t.endTime && !hiddenTracks.includes(t.trackIndex || 0)).map(tClip => (
                <Text 
                  key={tClip.id}
                  text={tClip.text} 
                  x={tClip.x} 
                  y={tClip.y} 
                  fill={tClip.color} 
                  fontSize={tClip.fontSize} 
                  fontFamily="Inter"
                  shadowColor="black"
                  shadowBlur={5}
                  draggable
                  onDragStart={(e) => {
                    e.cancelBubble = true; // 비디오 드래그 방지
                  }}
                  onDragEnd={(e) => {
                    setTextClips(prev => prev.map(c => c.id === tClip.id ? { ...c, x: e.target.x(), y: e.target.y() } : c));
                  }}
                  onClick={(e) => {
                    e.cancelBubble = true;
                    setSelectedTextClipId(tClip.id); 
                    setSelectedTimelineClipId(null); 
                  }}
                  onTap={(e) => {
                    e.cancelBubble = true;
                    setSelectedTextClipId(tClip.id); 
                    setSelectedTimelineClipId(null); 
                  }}
                />
              ))}
            </Layer>
          </Stage>
        </div>

        {/* ✂️ Visual Clip Trimmer UI */}
        {selectedTimelineClipId && (() => {
          const clip = timelineClips.find(c => c.id === selectedTimelineClipId);
          if (!clip) return null;
          
          const maxDuration = clip.duration || 60; // fallback

          return (
            <div style={{ width: '100%', maxWidth: '400px', background: 'var(--bg-dark)', padding: '15px', borderRadius: '8px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)' }}>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' }}>🎯 {clip.assetName} 잘라내기</span>
                <span style={{ flexShrink: 0 }}>{clip.trimStart.toFixed(1)}s ~ {clip.trimEnd.toFixed(1)}s</span>
              </div>
              
              {/* 듀얼 슬라이더 트랙 */}
              <div style={{ position: 'relative', height: '30px', background: '#111', borderRadius: '4px', overflow: 'hidden' }}>
                {/* 선택된 구간 하이라이트 (시각적 피드백) */}
                <div style={{ 
                  position: 'absolute', 
                  top: 0, bottom: 0, 
                  left: `${(clip.trimStart / maxDuration) * 100}%`, 
                  right: `${100 - (clip.trimEnd / maxDuration) * 100}%`, 
                  background: 'var(--accent)', 
                  opacity: 0.8 
                }} />

                {/* 시작 지점 슬라이더 */}
                <input 
                  type="range" min="0" max={maxDuration} step="0.1" value={clip.trimStart}
                  onChange={(e) => {
                    const val = Math.min(parseFloat(e.target.value), clip.trimEnd - 0.5);
                    setTimelineClips(prev => prev.map(c => c.id === clip.id ? { ...c, trimStart: val } : c));
                  }}
                  className="trim-slider"
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', margin: 0, appearance: 'none', background: 'transparent', pointerEvents: 'none', zIndex: 3 }}
                />
                
                {/* 종료 지점 슬라이더 */}
                <input 
                  type="range" min="0" max={maxDuration} step="0.1" value={clip.trimEnd}
                  onChange={(e) => {
                    const val = Math.max(parseFloat(e.target.value), clip.trimStart + 0.5);
                    setTimelineClips(prev => prev.map(c => c.id === clip.id ? { ...c, trimEnd: val } : c));
                  }}
                  className="trim-slider"
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', margin: 0, appearance: 'none', background: 'transparent', pointerEvents: 'none', zIndex: 4 }}
                />
              </div>
              <div style={{ fontSize: '10px', color: '#666', textAlign: 'center' }}>전체 비디오 길이: {maxDuration.toFixed(1)}초 (좌우 핸들을 드래그하세요)</div>
            </div>
          );
        })()}
      </main>

      {/* Right Sidebar - Properties */}
      <aside className="sidebar-right">
        <h2 className="panel-title">속성 설정 (Properties)</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          {/* --- 비디오 속성 편집 --- */}
          {selectedTimelineClipId && (() => {
            const clip = timelineClips.find(c => c.id === selectedTimelineClipId);
            if (!clip) return null;
            return (
              <>
                <div style={{ background: 'var(--bg-dark)', padding: '10px', borderRadius: '4px', fontSize: '12px', color: 'var(--accent)' }}>
                  선택됨: {clip.assetName}
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>컷 시작 시간 (초)</label>
                  <input 
                    type="number" step="0.1" min="0" value={clip.trimStart} 
                    onChange={(e) => setTimelineClips(prev => prev.map(c => c.id === clip.id ? { ...c, trimStart: parseFloat(e.target.value) || 0 } : c))}
                    style={{ width: '100%', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'white', borderRadius: '4px' }} 
                  />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>컷 종료 시간 (초)</label>
                  <input 
                    type="number" step="0.1" min="0.1" value={clip.trimEnd} 
                    onChange={(e) => setTimelineClips(prev => prev.map(c => c.id === clip.id ? { ...c, trimEnd: parseFloat(e.target.value) || 0 } : c))}
                    style={{ width: '100%', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'white', borderRadius: '4px' }} 
                  />
                </div>
                <div style={{ marginTop: '15px', background: 'var(--bg-dark)', padding: '10px', borderRadius: '4px' }}>
                  <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>🔍 줌 인 (확대: {clip.scale ? clip.scale.toFixed(1) : 1.0}x)</label>
                  <input 
                    type="range" min="1" max="3" step="0.1" value={clip.scale || 1.0}
                    onChange={(e) => setTimelineClips(prev => prev.map(c => c.id === clip.id ? { ...c, scale: parseFloat(e.target.value) } : c))}
                    style={{ width: '100%', cursor: 'ew-resize', marginBottom: '15px' }} 
                  />
                  <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>↔️ 좌/우 이동</label>
                  <input 
                    type="range" min="0" max="1" step="0.01" value={clip.cropX} 
                    onChange={(e) => setTimelineClips(prev => prev.map(c => c.id === clip.id ? { ...c, cropX: parseFloat(e.target.value) } : c))}
                    style={{ width: '100%', cursor: 'ew-resize', marginBottom: '15px' }} 
                  />
                  <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>↕️ 상/하 이동</label>
                  <input 
                    type="range" min="0" max="1" step="0.01" value={clip.cropY} 
                    onChange={(e) => setTimelineClips(prev => prev.map(c => c.id === clip.id ? { ...c, cropY: parseFloat(e.target.value) } : c))}
                    style={{ width: '100%', cursor: 'ns-resize' }} 
                  />
                </div>
                <div style={{ marginTop: '15px', background: 'var(--bg-dark)', padding: '10px', borderRadius: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: '12px', fontWeight: 'bold' }}>✂️ 테두리 자르기 (마스크)</span>
                    <select 
                      value={clip.maskShape || 'rectangle'} 
                      onChange={(e) => setTimelineClips(prev => prev.map(c => c.id === clip.id ? { ...c, maskShape: e.target.value as any } : c))}
                      style={{ background: '#333', color: 'white', border: 'none', borderRadius: '4px', fontSize: '11px', padding: '2px 4px' }}
                    >
                      <option value="rectangle">사각형 (기본)</option>
                      <option value="circle">원형 (Circle)</option>
                      <option value="ellipse">타원형 (Ellipse)</option>
                    </select>
                  </div>
                  
                  {(!clip.maskShape || clip.maskShape === 'rectangle') && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div>
                        <label style={{ fontSize: '10px', color: '#888' }}>왼쪽</label>
                        <input type="range" min="0" max="1" step="0.01" value={clip.maskLeft || 0} onChange={(e) => setTimelineClips(prev => prev.map(c => c.id === clip.id ? { ...c, maskLeft: parseFloat(e.target.value) } : c))} style={{ width: '100%' }} />
                      </div>
                      <div>
                        <label style={{ fontSize: '10px', color: '#888' }}>오른쪽</label>
                        <input type="range" min="0" max="1" step="0.01" value={clip.maskRight || 0} onChange={(e) => setTimelineClips(prev => prev.map(c => c.id === clip.id ? { ...c, maskRight: parseFloat(e.target.value) } : c))} style={{ width: '100%' }} />
                      </div>
                      <div>
                        <label style={{ fontSize: '10px', color: '#888' }}>위쪽</label>
                        <input type="range" min="0" max="1" step="0.01" value={clip.maskTop || 0} onChange={(e) => setTimelineClips(prev => prev.map(c => c.id === clip.id ? { ...c, maskTop: parseFloat(e.target.value) } : c))} style={{ width: '100%' }} />
                      </div>
                      <div>
                        <label style={{ fontSize: '10px', color: '#888' }}>아래쪽</label>
                        <input type="range" min="0" max="1" step="0.01" value={clip.maskBottom || 0} onChange={(e) => setTimelineClips(prev => prev.map(c => c.id === clip.id ? { ...c, maskBottom: parseFloat(e.target.value) } : c))} style={{ width: '100%' }} />
                      </div>
                    </div>
                  )}
                  {clip.maskShape === 'circle' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div style={{ gridColumn: '1 / span 2' }}>
                        <label style={{ fontSize: '10px', color: '#888' }}>반지름 크기</label>
                        <input type="range" min="0" max="1" step="0.01" value={clip.maskRadiusX ?? 0.5} onChange={(e) => setTimelineClips(prev => prev.map(c => c.id === clip.id ? { ...c, maskRadiusX: parseFloat(e.target.value) } : c))} style={{ width: '100%' }} />
                      </div>
                      <div>
                        <label style={{ fontSize: '10px', color: '#888' }}>중심 이동 (X)</label>
                        <input type="range" min="0" max="1" step="0.01" value={clip.maskCenterX ?? 0.5} onChange={(e) => setTimelineClips(prev => prev.map(c => c.id === clip.id ? { ...c, maskCenterX: parseFloat(e.target.value) } : c))} style={{ width: '100%' }} />
                      </div>
                      <div>
                        <label style={{ fontSize: '10px', color: '#888' }}>중심 이동 (Y)</label>
                        <input type="range" min="0" max="1" step="0.01" value={clip.maskCenterY ?? 0.5} onChange={(e) => setTimelineClips(prev => prev.map(c => c.id === clip.id ? { ...c, maskCenterY: parseFloat(e.target.value) } : c))} style={{ width: '100%' }} />
                      </div>
                    </div>
                  )}
                  {clip.maskShape === 'ellipse' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div>
                        <label style={{ fontSize: '10px', color: '#888' }}>가로 반지름</label>
                        <input type="range" min="0" max="1" step="0.01" value={clip.maskRadiusX ?? 0.4} onChange={(e) => setTimelineClips(prev => prev.map(c => c.id === clip.id ? { ...c, maskRadiusX: parseFloat(e.target.value) } : c))} style={{ width: '100%' }} />
                      </div>
                      <div>
                        <label style={{ fontSize: '10px', color: '#888' }}>세로 반지름</label>
                        <input type="range" min="0" max="1" step="0.01" value={clip.maskRadiusY ?? 0.25} onChange={(e) => setTimelineClips(prev => prev.map(c => c.id === clip.id ? { ...c, maskRadiusY: parseFloat(e.target.value) } : c))} style={{ width: '100%' }} />
                      </div>
                      <div>
                        <label style={{ fontSize: '10px', color: '#888' }}>중심 이동 (X)</label>
                        <input type="range" min="0" max="1" step="0.01" value={clip.maskCenterX ?? 0.5} onChange={(e) => setTimelineClips(prev => prev.map(c => c.id === clip.id ? { ...c, maskCenterX: parseFloat(e.target.value) } : c))} style={{ width: '100%' }} />
                      </div>
                      <div>
                        <label style={{ fontSize: '10px', color: '#888' }}>중심 이동 (Y)</label>
                        <input type="range" min="0" max="1" step="0.01" value={clip.maskCenterY ?? 0.5} onChange={(e) => setTimelineClips(prev => prev.map(c => c.id === clip.id ? { ...c, maskCenterY: parseFloat(e.target.value) } : c))} style={{ width: '100%' }} />
                      </div>
                    </div>
                  )}
                </div>
                
                <div style={{ marginTop: '15px', background: 'var(--bg-dark)', padding: '10px', borderRadius: '4px' }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: '12px', marginBottom: '10px', fontWeight: 'bold' }}>✨ 애니메이션 프리셋 (1초 전환)</div>
                  <div style={{ display: 'flex', gap: '15px', marginBottom: '10px' }}>
                    <label style={{ fontSize: '11px', color: 'white', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <input type="checkbox" checked={clip.fadeIn || false} onChange={(e) => setTimelineClips(prev => prev.map(c => c.id === clip.id ? { ...c, fadeIn: e.target.checked } : c))} />
                      페이드 인 (나타나기)
                    </label>
                    <label style={{ fontSize: '11px', color: 'white', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <input type="checkbox" checked={clip.fadeOut || false} onChange={(e) => setTimelineClips(prev => prev.map(c => c.id === clip.id ? { ...c, fadeOut: e.target.checked } : c))} />
                      페이드 아웃 (사라지기)
                    </label>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', color: '#888' }}>줌 애니메이션</span>
                    <select 
                      value={clip.animation || 'none'} 
                      onChange={(e) => setTimelineClips(prev => prev.map(c => c.id === clip.id ? { ...c, animation: e.target.value as any } : c))}
                      style={{ background: '#333', color: 'white', border: 'none', borderRadius: '4px', fontSize: '11px', padding: '4px 8px' }}
                    >
                      <option value="none">없음</option>
                      <option value="zoom-in">서서히 확대 (Zoom In)</option>
                      <option value="zoom-out">서서히 축소 (Zoom Out)</option>
                    </select>
                  </div>
                </div>
              </>
            );
          })()}

          {/* --- 텍스트 속성 편집 --- */}
          {selectedTextClipId && (() => {
            const tClip = textClips.find(t => t.id === selectedTextClipId);
            if (!tClip) return null;
            return (
              <>
                <div style={{ background: 'var(--bg-dark)', padding: '10px', borderRadius: '4px', fontSize: '12px', color: '#10b981' }}>
                  텍스트 설정
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>자막 내용</label>
                  <textarea 
                    value={tClip.text}
                    onChange={(e) => setTextClips(prev => prev.map(c => c.id === tClip.id ? { ...c, text: e.target.value } : c))}
                    style={{ width: '100%', height: '60px', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'white', borderRadius: '4px', resize: 'none' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>시작 (초)</label>
                    <input 
                      type="number" step="0.1" min="0" value={tClip.startTime} 
                      onChange={(e) => setTextClips(prev => prev.map(c => c.id === tClip.id ? { ...c, startTime: parseFloat(e.target.value) || 0 } : c))}
                      style={{ width: '100%', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'white', borderRadius: '4px' }} 
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>종료 (초)</label>
                    <input 
                      type="number" step="0.1" min="0" value={tClip.endTime} 
                      onChange={(e) => setTextClips(prev => prev.map(c => c.id === tClip.id ? { ...c, endTime: parseFloat(e.target.value) || 0 } : c))}
                      style={{ width: '100%', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'white', borderRadius: '4px' }} 
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>폰트 크기</label>
                    <input 
                      type="number" value={tClip.fontSize} 
                      onChange={(e) => setTextClips(prev => prev.map(c => c.id === tClip.id ? { ...c, fontSize: parseInt(e.target.value) || 20 } : c))}
                      style={{ width: '100%', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'white', borderRadius: '4px' }} 
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>색상</label>
                    <input 
                      type="color" value={tClip.color} 
                      onChange={(e) => setTextClips(prev => prev.map(c => c.id === tClip.id ? { ...c, color: e.target.value } : c))}
                      style={{ width: '100%', height: '34px', padding: '0', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer' }} 
                    />
                  </div>
                </div>
                <div style={{ marginTop: '10px' }}>
                  <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>트랙 번호 (레이어 순서)</label>
                  <input 
                    type="number" min="0" value={tClip.trackIndex || 0} 
                    onChange={(e) => setTextClips(prev => prev.map(c => c.id === tClip.id ? { ...c, trackIndex: parseInt(e.target.value) || 0 } : c))}
                    style={{ width: '100%', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'white', borderRadius: '4px' }} 
                  />
                  <div style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>숫자가 클수록 화면 위(Z-index 우위)에 렌더링됩니다.</div>
                </div>
              </>
            );
          })()}

          {!selectedTimelineClipId && !selectedTextClipId && (
            <div style={{ color: '#666', fontSize: '12px' }}>타임라인에서 클립이나 자막을 클릭하여 속성을 편집하세요.</div>
          )}

          <div style={{ marginTop: '20px', borderTop: '1px solid var(--border)', paddingTop: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <button 
              className="btn-primary" 
              onClick={() => {
                setTextClips(prev => {
                  let track = 0;
                  while (true) {
                    const overlapping = prev.some(c => (c.trackIndex || 0) === track && (c.startTime < currentTime + 3.0 && c.endTime > currentTime));
                    if (!overlapping) break;
                    track++;
                  }
                  
                  const newText: TextClip = {
                    id: Math.random().toString(36).substr(2, 9),
                    text: "새로운 텍스트",
                    x: 100, y: 150,
                    startTime: currentTime,
                    endTime: currentTime + 3.0,
                    fontSize: 24,
                    color: "#ffffff",
                    trackIndex: track
                  };
                  
                  setSelectedTimelineClipId(null);
                  setSelectedTextClipId(newText.id);
                  return [...prev, newText];
                });
              }}
              style={{ width: '100%', padding: '10px', fontSize: '13px', background: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}
            >
              + 현재 시간에 텍스트 추가
            </button>
            <input 
              type="file" 
              accept=".srt,.vtt" 
              ref={subtitleFileInputRef} 
              style={{ display: 'none' }} 
              onChange={handleSubtitleUpload} 
            />
            <button 
              className="btn-secondary" 
              onClick={() => subtitleFileInputRef.current?.click()}
              style={{ width: '100%', padding: '10px', fontSize: '13px', background: 'var(--bg-dark)', color: '#34d399', border: '1px solid #10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', cursor: 'pointer', borderRadius: '4px' }}
            >
              📂 외부 자막 (SRT/VTT) 불러오기
            </button>
          </div>
        </div>
      </aside>

      {/* Bottom Timeline */}
      <section className="timeline-area">
        {/* Timeline Controls */}
        <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '15px' }}>
          <button 
            onClick={() => setIsPlaying(!isPlaying)}
            style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
          >
            {isPlaying ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>
             {Math.floor(currentTime / 60).toString().padStart(2, '0')}:{(currentTime % 60).toFixed(1).padStart(4, '0')}
          </span>
          <div style={{ marginLeft: '10px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
             <input 
               type="checkbox" 
               id="continuousToggle" 
               checked={isContinuousPlay} 
               onChange={(e) => setIsContinuousPlay(e.target.checked)} 
               style={{ cursor: 'pointer' }}
             />
             <label htmlFor="continuousToggle" style={{ color: 'var(--text-muted)', cursor: 'pointer' }}>전체 클립 연속 재생</label>
          </div>
        </div>
        
        {/* Timeline Tracks */}
        <div 
          style={{ flex: 1, padding: '20px', overflowX: 'auto', position: 'relative', cursor: 'text' }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            // 패딩 20px + 헤더 80px 고려
            const clickX = e.clientX - rect.left - 100;
            if (clickX >= 0) {
              setCurrentTime(clickX / 20); // 1초당 20px 기준
            }
          }}
        >
          {/* Playhead (빨간 선) */}
          <div style={{
            position: 'absolute',
            left: `${100 + currentTime * 20}px`,
            top: 0,
            bottom: 0,
            width: '2px',
            background: 'red',
            zIndex: 10,
            pointerEvents: 'none'
          }}>
             <div style={{ width: '10px', height: '10px', background: 'red', borderRadius: '50%', transform: 'translateX(-4px)' }} />
          </div>

          {/* Dynamic Video Tracks */}
          {Array.from({ length: Math.max(1, timelineClips.length > 0 ? Math.max(...timelineClips.map(c => c.trackIndex || 0)) + 1 : 1) }).map((_, trackIdx) => {
            const clipsInThisTrack = timelineClips.filter(c => (c.trackIndex || 0) === trackIdx);
            const isHidden = hiddenVideoTracks.includes(trackIdx);
            const isLocked = lockedVideoTracks.includes(trackIdx);
            return (
              <div key={`video-track-${trackIdx}`} style={{ height: '60px', background: 'var(--bg-dark)', marginBottom: '10px', borderRadius: '4px', display: 'flex', opacity: isHidden ? 0.5 : 1 }}>
                 <div 
                   onContextMenu={(e) => {
                     e.preventDefault();
                     setTrackContextMenu({ x: e.clientX, y: e.clientY, trackIdx, type: 'video' });
                   }}
                   style={{ position: 'sticky', left: 0, width: '80px', minWidth: '80px', zIndex: 15, background: '#1f2937', borderRight: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px', fontSize: '10px', color: '#888', borderTopLeftRadius: '4px', borderBottomLeftRadius: '4px', boxSizing: 'border-box' }}
                 >
                    <span style={{ fontWeight: 'bold' }}>V{trackIdx + 1}</span>
                    <div style={{ display: 'flex', gap: '2px' }}>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setHiddenVideoTracks(prev => prev.includes(trackIdx) ? prev.filter(id => id !== trackIdx) : [...prev, trackIdx]);
                        }}
                        style={{ background: 'transparent', color: isHidden ? '#666' : '#fff', border: 'none', cursor: 'pointer', fontSize: '12px', padding: '2px' }}
                        title={isHidden ? `트랙 ${trackIdx + 1} 표시` : `트랙 ${trackIdx + 1} 숨기기`}
                      >
                        {isHidden ? '👁️‍🗨️' : '👁️'}
                      </button>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setLockedVideoTracks(prev => prev.includes(trackIdx) ? prev.filter(id => id !== trackIdx) : [...prev, trackIdx]);
                        }}
                        style={{ background: 'transparent', color: isLocked ? '#ef4444' : '#666', border: 'none', cursor: 'pointer', fontSize: '12px', padding: '2px' }}
                        title={isLocked ? `트랙 ${trackIdx + 1} 잠금 해제` : `트랙 ${trackIdx + 1} 잠금`}
                      >
                        {isLocked ? '🔒' : '🔓'}
                      </button>
                    </div>
                 </div>
                 <div style={{ flex: 1, position: 'relative' }}>
                   {clipsInThisTrack.length === 0 ? (
                     <div style={{ padding: '20px', color: '#555', fontSize: '12px', fontStyle: 'italic', whiteSpace: 'nowrap' }}>
                       {trackIdx === 0 ? "좌측 목록에서 '타임라인 추가'를 눌러 영상을 배치하세요." : `비디오 트랙 ${trackIdx + 1} (비어있음)`}
                     </div>
                   ) : (
                     clipsInThisTrack.map((clip) => (
                       <div 
                         key={clip.id}
                         onClick={(e) => { e.stopPropagation(); setSelectedTimelineClipId(clip.id); setSelectedTextClipId(null); }}
                         onMouseDown={(e) => {
                           e.stopPropagation();
                           if (isLocked) return; // 잠긴 트랙 드래그 방지
                           setDraggingVideoId(clip.id);
                           setDragVideoStart({ x: e.clientX, y: e.clientY, initialStart: clip.startTime, initialTrack: clip.trackIndex || 0 });
                           setSelectedTimelineClipId(clip.id);
                           setSelectedTextClipId(null);
                         }}
                         style={{ 
                           position: 'absolute',
                           left: `${clip.startTime * 20}px`,
                           width: `${Math.max(10, (clip.trimEnd - clip.trimStart) * 20)}px`, // 1초당 20px 너비
                           height: '100%', 
                           background: selectedTimelineClipId === clip.id ? '#3b82f6' : 'var(--accent)', 
                           border: selectedTimelineClipId === clip.id ? '2px solid white' : 'none',
                           borderRight: '1px solid #1e3a8a',
                           borderRadius: '4px',
                           display: 'flex', 
                           alignItems: 'center', 
                           padding: '0 10px', 
                           fontSize: '12px',
                           boxSizing: 'border-box',
                           cursor: isLocked ? 'not-allowed' : (draggingVideoId === clip.id ? 'grabbing' : 'grab')
                         }}
                       >
                         <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{clip.assetName}</span>
                         {!isLocked && (
                           <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                setTimelineClips(prev => prev.filter(c => c.id !== clip.id));
                                if (selectedTimelineClipId === clip.id) setSelectedTimelineClipId(null);
                              }}
                              style={{ position: 'absolute', top: '4px', right: '4px', background: 'rgba(0,0,0,0.5)', color: 'white', border: 'none', borderRadius: '50%', width: '16px', height: '16px', fontSize: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            >X</button>
                         )}
                       </div>
                     ))
                   )}
                 </div>
              </div>
            );
          })}
          {/* Dynamic Text Tracks */}
          {Array.from({ length: Math.max(1, textClips.length > 0 ? Math.max(...textClips.map(t => t.trackIndex || 0)) + 1 : 1) }).map((_, trackIdx) => {
            const clipsInThisTrack = textClips.filter(t => (t.trackIndex || 0) === trackIdx);
            const isHidden = hiddenTracks.includes(trackIdx);
            const isLocked = lockedTracks.includes(trackIdx);
            return (
              <div key={`text-track-${trackIdx}`} style={{ height: '40px', background: 'var(--bg-dark)', marginBottom: '10px', borderRadius: '4px', display: 'flex', opacity: isHidden ? 0.5 : 1 }}>
                 <div 
                   onContextMenu={(e) => {
                     e.preventDefault();
                     setTrackContextMenu({ x: e.clientX, y: e.clientY, trackIdx, type: 'text' });
                   }}
                   style={{ position: 'sticky', left: 0, width: '80px', minWidth: '80px', zIndex: 15, background: '#1f2937', borderRight: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px', borderTopLeftRadius: '4px', borderBottomLeftRadius: '4px', boxSizing: 'border-box' }}
                 >
                   <span style={{ fontSize: '10px', color: '#888', fontWeight: 'bold' }}>T{trackIdx + 1}</span>
                   <div style={{ display: 'flex', gap: '2px' }}>
                     <button 
                       onClick={(e) => {
                         e.stopPropagation();
                         setHiddenTracks(prev => prev.includes(trackIdx) ? prev.filter(id => id !== trackIdx) : [...prev, trackIdx]);
                       }}
                       style={{ background: 'transparent', color: isHidden ? '#666' : '#fff', border: 'none', cursor: 'pointer', fontSize: '12px', padding: '2px' }}
                       title={isHidden ? `트랙 ${trackIdx + 1} 표시` : `트랙 ${trackIdx + 1} 숨기기`}
                     >
                       {isHidden ? '👁️‍🗨️' : '👁️'}
                     </button>
                     <button 
                       onClick={(e) => {
                         e.stopPropagation();
                         setLockedTracks(prev => prev.includes(trackIdx) ? prev.filter(id => id !== trackIdx) : [...prev, trackIdx]);
                       }}
                       style={{ background: 'transparent', color: isLocked ? '#ef4444' : '#666', border: 'none', cursor: 'pointer', fontSize: '12px', padding: '2px' }}
                       title={isLocked ? `트랙 ${trackIdx + 1} 잠금 해제` : `트랙 ${trackIdx + 1} 잠금`}
                     >
                       {isLocked ? '🔒' : '🔓'}
                     </button>
                   </div>
                 </div>
                 <div style={{ flex: 1, position: 'relative' }}>
                   {clipsInThisTrack.length === 0 ? (
                     <div style={{ padding: '12px 20px', color: '#555', fontSize: '12px', fontStyle: 'italic', whiteSpace: 'nowrap' }}>
                       {trackIdx === 0 ? "우측의 '현재 시간에 텍스트 추가' 버튼을 눌러 자막을 생성하세요." : `자막 트랙 ${trackIdx + 1} (비어있음)`}
                     </div>
                   ) : (
                     clipsInThisTrack.map((clip) => (
                       <div 
                         key={clip.id}
                         onClick={(e) => { e.stopPropagation(); setSelectedTextClipId(clip.id); setSelectedTimelineClipId(null); }}
                         onMouseDown={(e) => {
                           e.stopPropagation();
                           if (isLocked) return; // 잠긴 트랙 드래그 방지
                           setDraggingTextId(clip.id);
                           setDragTextStart({ x: e.clientX, y: e.clientY, initialStart: clip.startTime, initialEnd: clip.endTime, initialTrack: clip.trackIndex || 0 });
                           setSelectedTextClipId(clip.id);
                           setSelectedTimelineClipId(null);
                         }}
                         style={{ 
                           position: 'absolute', 
                           left: `${clip.startTime * 20}px`, 
                           width: `${Math.max(10, (clip.endTime - clip.startTime) * 20)}px`, 
                           height: '100%', 
                           background: selectedTextClipId === clip.id ? '#34d399' : '#10b981', 
                           border: selectedTextClipId === clip.id ? '2px solid white' : '1px solid #059669',
                           borderRadius: '4px', 
                           display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: '12px',
                           cursor: isLocked ? 'not-allowed' : (draggingTextId === clip.id ? 'grabbing' : 'grab'), whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', boxSizing: 'border-box'
                         }}
                       >
                          {clip.text}
                          {!isLocked && (
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                setTextClips(prev => prev.filter(c => c.id !== clip.id));
                                if (selectedTextClipId === clip.id) setSelectedTextClipId(null);
                              }}
                              style={{ position: 'absolute', top: '4px', right: '4px', background: 'rgba(0,0,0,0.5)', color: 'white', border: 'none', borderRadius: '50%', width: '14px', height: '14px', fontSize: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            >X</button>
                          )}
                       </div>
                     ))
                   )}
                 </div>
              </div>
            );
          })}
          {/* Track 3: Audio */}
          <div style={{ height: '40px', background: 'var(--bg-dark)', marginBottom: '10px', borderRadius: '4px', display: 'flex' }}>
             <div style={{ position: 'sticky', left: 0, width: '80px', minWidth: '80px', zIndex: 15, background: '#1f2937', borderRight: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#888', borderTopLeftRadius: '4px', borderBottomLeftRadius: '4px', boxSizing: 'border-box' }}>
                <span style={{ fontWeight: 'bold' }}>A1</span>
             </div>
             <div style={{ flex: 1, position: 'relative' }}>
                <div style={{ position: 'absolute', left: '0px', width: '500px', height: '100%', background: '#8b5cf6', borderRadius: '4px', display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: '12px' }}>
                   배경음악 (BGM)
                </div>
             </div>
          </div>
        </div>
      </section>

      {/* 우클릭 컨텍스트 메뉴 (트랙 삭제) */}
      {trackContextMenu && (() => {
        const isVideo = trackContextMenu.type === 'video';
        const isLocked = isVideo 
           ? lockedVideoTracks.includes(trackContextMenu.trackIdx) 
           : lockedTracks.includes(trackContextMenu.trackIdx);
        const trackName = `${isVideo ? 'V' : 'T'}${trackContextMenu.trackIdx + 1}`;
        
        return (
          <div 
            style={{
              position: 'fixed',
              top: trackContextMenu.y,
              left: trackContextMenu.x,
              background: '#1f2937',
              border: '1px solid #374151',
              borderRadius: '6px',
              padding: '4px',
              zIndex: 9999,
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
            }}
            onMouseLeave={() => setTrackContextMenu(null)} // 마우스 벗어나면 닫힘
          >
            <button 
              onClick={() => {
                if (isLocked) return;
                if (window.confirm(`트랙 ${trackName}을(를) 정말 삭제하시겠습니까?`)) {
                  if (isVideo) {
                    setTimelineClips(prev => prev.filter(c => (c.trackIndex || 0) !== trackContextMenu.trackIdx));
                  } else {
                    setTextClips(prev => prev.filter(c => (c.trackIndex || 0) !== trackContextMenu.trackIdx));
                  }
                }
                setTrackContextMenu(null);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 12px',
                background: 'transparent',
                color: isLocked ? '#6b7280' : '#ef4444',
                border: 'none',
                cursor: isLocked ? 'not-allowed' : 'pointer',
                fontSize: '13px',
                borderRadius: '4px'
              }}
              onMouseEnter={(e) => {
                if (!isLocked) e.currentTarget.style.background = '#374151';
              }}
              onMouseLeave={(e) => {
                if (!isLocked) e.currentTarget.style.background = 'transparent';
              }}
              disabled={isLocked}
            >
              🗑️ 트랙 삭제 (Delete Track) {isLocked && '(잠김)'}
            </button>
          </div>
        );
      })()}
    </div>
  );
}

export default App;
