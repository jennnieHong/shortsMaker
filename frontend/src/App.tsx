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
  cropX: number;     // 0.0 ~ 1.0 (X축 크롭 위치, 기본값 0.5)
  cropY: number;     // 0.0 ~ 1.0 (Y축 크롭 위치, 기본값 0.5)
  scale: number;     // 1.0 ~ 3.0 (화면 확대 비율, 기본값 1.0)
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
  
  const [textClips, setTextClips] = useState<TextClip[]>([]);
  const [selectedTextClipId, setSelectedTextClipId] = useState<string | null>(null);

  const [hiddenTracks, setHiddenTracks] = useState<number[]>([]);
  const [lockedTracks, setLockedTracks] = useState<number[]>([]);
  const [trackContextMenu, setTrackContextMenu] = useState<{x: number, y: number, trackIdx: number} | null>(null);

  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0, initialCropX: 0.5, initialCropY: 0.5 });

  const [draggingTextId, setDraggingTextId] = useState<string | null>(null);
  const [dragTextStart, setDragTextStart] = useState<{ x: number, y: number, initialStart: number, initialEnd: number, initialTrack: number } | null>(null);

  useEffect(() => {
    if (!draggingTextId || !dragTextStart) return;
    
    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragTextStart.x;
      const deltaSec = deltaX / 20; // 1초당 20px
      
      const deltaY = e.clientY - dragTextStart.y;
      const trackOffset = Math.round(deltaY / 50); // 트랙 하나당 높이 대략 50px (40px + margin 10px)
      
      setTextClips(prev => prev.map(c => {
        if (c.id === draggingTextId) {
          let newStart = dragTextStart.initialStart + deltaSec;
          if (newStart < 0) newStart = 0;
          const dur = dragTextStart.initialEnd - dragTextStart.initialStart;
          
          let newTrack = dragTextStart.initialTrack + trackOffset;
          if (newTrack < 0) newTrack = 0;
          
          return { ...c, startTime: newStart, endTime: newStart + dur, trackIndex: newTrack };
        }
        return c;
      }));
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

  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<any>(null);
  const subtitleFileInputRef = useRef<HTMLInputElement>(null);

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

  // 현재 시간에 재생되어야 할 클립 계산
  let accumTime = 0;
  let activeClip: TimelineClip | null = null;
  let activeClipLocalTime = 0;

  for (const clip of timelineClips) {
    const duration = clip.trimEnd - clip.trimStart;
    if (currentTime >= accumTime && currentTime < accumTime + duration) {
      activeClip = clip;
      activeClipLocalTime = clip.trimStart + (currentTime - accumTime);
      break;
    }
    accumTime += duration;
  }

  // 플레이헤드 재생 로직 (버퍼링 중일 때는 시간 정지)
  useEffect(() => {
    let interval: any;
    if (isPlaying && !isBuffering) {
      interval = setInterval(() => {
        setCurrentTime(prev => {
          const nextTime = prev + 0.1;
          
          let totalDuration = 0;
          let currentClipEnd = 0;
          for (const clip of timelineClips) {
            const dur = clip.trimEnd - clip.trimStart;
            if (prev >= totalDuration && prev < totalDuration + dur) {
              currentClipEnd = totalDuration + dur;
            }
            totalDuration += dur;
          }

          // 단일 클립 모드: 클립의 끝에 도달하면 일시정지
          if (!isContinuousPlay && currentClipEnd > 0 && nextTime >= currentClipEnd) {
             setIsPlaying(false);
             return currentClipEnd - 0.01;
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
  }, [isPlaying, isBuffering, timelineClips, isContinuousPlay]);

  // 비디오 탐색(Seek) 및 클립 연속 재생 동기화
  useEffect(() => {
    if (videoRef.current && activeClip) {
      const video = videoRef.current;
      
      const handleSync = () => {
        // 오차가 0.15초 이상일 때만 seek (잦은 탐색 방지)
        if (Math.abs(video.currentTime - activeClipLocalTime) > 0.15) {
           video.currentTime = activeClipLocalTime;
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
  }, [currentTime, activeClip, activeClipLocalTime, isPlaying]);

  const handleExport = async () => {
    if (timelineClips.length === 0) {
      setRenderStatus("하단 타임라인에 비디오를 먼저 추가해주세요.");
      return;
    }
    try {
      setRenderStatus("C++ 엔진 호출 중... (모든 타임라인 영상 인코딩 중)");
      
      // @ts-ignore
      if (window.electronAPI) {
        // @ts-ignore
        const result = await window.electronAPI.renderVideo(timelineClips, outputPath, textClips);
        setRenderStatus(result); // 알림창 대신 UI에 상태 표시
      } else {
        setRenderStatus("Electron 환경이 아닙니다.");
      }
    } catch (error) {
      console.error(error);
      setRenderStatus("렌더링 실패: " + error);
    }
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
            <label style={{ display: 'block', marginBottom: '10px', color: 'var(--text-muted)', fontSize: '12px' }}>업로드된 에셋 목록</label>
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
                          const newClip: TimelineClip = {
                            id: Math.random().toString(36).substr(2, 9),
                            assetId: asset.id,
                            assetName: asset.name,
                            path: asset.path,
                            trimStart: 0, // 기본값 0초부터
                            trimEnd: asset.duration ? Math.min(5, asset.duration) : 5,    // 최대 5초
                            duration: asset.duration,
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
          className="canvas-container" 
          style={{ 
            position: 'relative', width: 360, height: 640, flexShrink: 0, boxShadow: '0 10px 30px rgba(0,0,0,0.5)', overflow: 'hidden', backgroundColor: 'black',
            cursor: activeClip ? (isDraggingCanvas ? 'grabbing' : 'grab') : 'default'
          }}
          onWheel={(e) => {
            if (!activeClip) return;
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            const newScale = Math.max(1.0, Math.min(5.0, (activeClip.scale || 1.0) + delta));
            setTimelineClips(prev => prev.map(c => c.id === activeClip?.id ? { ...c, scale: newScale } : c));
          }}
          onMouseDown={(e) => {
            if (!activeClip) return;
            setIsDraggingCanvas(true);
            setDragStartPos({ x: e.clientX, y: e.clientY, initialCropX: activeClip.cropX, initialCropY: activeClip.cropY });
          }}
          onMouseMove={(e) => {
            if (!isDraggingCanvas || !activeClip) return;
            const deltaX = e.clientX - dragStartPos.x;
            const deltaY = e.clientY - dragStartPos.y;
            
            // 1:1 마우스 픽셀 매핑 계산 (가로 16:9 원본 영상 기준)
            const scale = activeClip.scale || 1.0;
            // object-fit: cover 기준 렌더링된 비디오 크기 (가로 1137px, 세로 640px)
            const hiddenWidth = Math.max(1, (640 * (16/9) * scale) - 360);
            const hiddenHeight = Math.max(1, (640 * scale) - 640);

            // 숨겨진 영역 픽셀 수의 역수를 곱하면 정확히 1픽셀 이동 시 1픽셀만큼 시각적으로 이동함
            const factorX = 1 / hiddenWidth;
            const factorY = 1 / hiddenHeight;

            let newCropX = dragStartPos.initialCropX - (deltaX * factorX);
            let newCropY = dragStartPos.initialCropY - (deltaY * factorY);

            newCropX = Math.max(0, Math.min(1, newCropX));
            newCropY = Math.max(0, Math.min(1, newCropY));

            setTimelineClips(prev => prev.map(c => c.id === activeClip?.id ? { ...c, cropX: newCropX, cropY: newCropY } : c));
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

              if (activeClip) {
                return (
                  <video 
                    ref={videoRef}
                    src={activeClip.path} 
                    style={{ 
                      width: '100%', 
                      height: '100%', 
                      objectFit: 'cover', // 세로 화면에 꽉 차게 
                      objectPosition: `${activeClip.cropX * 100}% ${activeClip.cropY * 100}%`, // C++ 좌표와 매칭
                      transform: `scale(${activeClip.scale || 1.0})`,
                      transformOrigin: `${activeClip.cropX * 100}% ${activeClip.cropY * 100}%`,
                      transition: 'object-position 0.1s ease, transform 0.1s ease'
                    }}
                    onWaiting={() => setIsBuffering(true)}
                    onCanPlay={() => setIsBuffering(false)}
                  />
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

          {/* Track 1: Video (동적 타임라인 블록 렌더링) */}
          <div style={{ height: '60px', background: 'var(--bg-dark)', marginBottom: '10px', borderRadius: '4px', display: 'flex' }}>
             <div style={{ position: 'sticky', left: 0, width: '80px', minWidth: '80px', zIndex: 15, background: '#1f2937', borderRight: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#888', borderTopLeftRadius: '4px', borderBottomLeftRadius: '4px', boxSizing: 'border-box' }}>
                <span style={{ fontWeight: 'bold' }}>V1</span>
             </div>
             <div style={{ flex: 1, position: 'relative', display: 'flex', overflow: 'hidden' }}>
               {timelineClips.length === 0 ? (
                 <div style={{ padding: '20px', color: '#555', fontSize: '12px', fontStyle: 'italic' }}>좌측 목록에서 '타임라인 추가'를 눌러 영상을 배치하세요.</div>
               ) : (
                 timelineClips.map((clip) => (
                   <div 
                     key={clip.id}
                     onClick={() => setSelectedTimelineClipId(clip.id)}
                     style={{ 
                       width: `${Math.max(10, (clip.trimEnd - clip.trimStart) * 20)}px`, // 1초당 20px 너비
                       height: '100%', 
                       background: selectedTimelineClipId === clip.id ? '#3b82f6' : 'var(--accent)', 
                       border: selectedTimelineClipId === clip.id ? '2px solid white' : 'none',
                       borderRight: '1px solid #1e3a8a',
                       display: 'flex', 
                       alignItems: 'center', 
                       padding: '0 10px', 
                       fontSize: '12px',
                       position: 'relative',
                       boxSizing: 'border-box',
                       cursor: 'pointer'
                     }}
                   >
                     <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{clip.assetName}</span>
                     <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setTimelineClips(prev => prev.filter(c => c.id !== clip.id));
                          if (selectedTimelineClipId === clip.id) setSelectedTimelineClipId(null);
                        }}
                        style={{ position: 'absolute', top: '4px', right: '4px', background: 'rgba(0,0,0,0.5)', color: 'white', border: 'none', borderRadius: '50%', width: '16px', height: '16px', fontSize: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >X</button>
                   </div>
                 ))
               )}
             </div>
          </div>
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
                     setTrackContextMenu({ x: e.clientX, y: e.clientY, trackIdx });
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
        const isLocked = lockedTracks.includes(trackContextMenu.trackIdx);
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
                if (window.confirm(`트랙 T${trackContextMenu.trackIdx + 1}을(를) 정말 삭제하시겠습니까?`)) {
                  setTextClips(prev => prev.filter(c => (c.trackIndex || 0) !== trackContextMenu.trackIdx));
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
