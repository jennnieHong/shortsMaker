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
  const [overlayText, setOverlayText] = useState("여기에 자막을 입력하세요! 🎉");

  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0, initialCropX: 0.5, initialCropY: 0.5 });

  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<any>(null);

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
      
      let overlayBase64 = null;
      if (stageRef.current) {
        overlayBase64 = stageRef.current.toDataURL({ pixelRatio: 2.0 }); // 720x1280 해상도로 추출
      }

      // @ts-ignore
      if (window.electronAPI) {
        // @ts-ignore
        const result = await window.electronAPI.renderVideo(timelineClips, outputPath, overlayBase64);
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
          <button 
            onClick={async () => {
              // @ts-ignore
              if (window.electronAPI && window.electronAPI.openFileDialog) {
                // @ts-ignore
                const filePath = await window.electronAPI.openFileDialog();
                if (filePath) {
                  // 파일명만 추출 (윈도우 경로는 \ 기준)
                  const fileName = filePath.split('\\').pop() || 'Unknown Video';
                  
                  // 비디오 전체 길이(Duration) 파싱
                  const tempVideo = document.createElement('video');
                  tempVideo.src = `file://${filePath}`;
                  tempVideo.onloadedmetadata = () => {
                    const newAsset: Asset = {
                      id: Math.random().toString(36).substr(2, 9),
                      name: fileName,
                      path: filePath,
                      duration: tempVideo.duration
                    };
                    setAssets(prev => [...prev, newAsset]);
                    if (!selectedAssetId) setSelectedAssetId(newAsset.id);
                  };
                  tempVideo.onerror = () => {
                     // 메타데이터 로드 실패시 기본값
                     const newAsset: Asset = { id: Math.random().toString(36).substr(2, 9), name: fileName, path: filePath, duration: 30 };
                     setAssets(prev => [...prev, newAsset]);
                  };
                }
              }
            }}
            className="btn-primary"
            style={{ width: '100%', padding: '12px', fontSize: '14px', background: 'var(--accent)', fontWeight: 600 }}
          >
            + 새 동영상 불러오기
          </button>

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
                    onClick={() => setSelectedAssetId(asset.id)}
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
                    >
                      타임라인 추가
                    </button>
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
            {activeClip ? (
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
            ) : (
              <div style={{ color: '#666', fontSize: '14px' }}>타임라인에 영상을 올리고 재생해보세요.</div>
            )}
          </div>
          
           {/* 2. Konva Canvas for WYSIWYG editing (비디오 앞단 투명 레이어) */}
           <Stage ref={stageRef} width={360} height={640} style={{ position: 'absolute', zIndex: 10, pointerEvents: 'none' }}>
            <Layer>
              <Text 
                text={overlayText} 
                x={80} 
                y={100} 
                fill="#fff" 
                fontSize={20} 
                fontFamily="Inter"
                shadowColor="black"
                shadowBlur={5}
              />
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
          {selectedTimelineClipId ? (() => {
            const clip = timelineClips.find(c => c.id === selectedTimelineClipId);
            if (!clip) return <div style={{ color: '#666', fontSize: '12px' }}>클립을 찾을 수 없습니다.</div>;
            return (
              <>
                <div style={{ background: 'var(--bg-dark)', padding: '10px', borderRadius: '4px', fontSize: '12px', color: 'var(--accent)' }}>
                  선택됨: {clip.assetName}
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>컷 시작 시간 (초)</label>
                  <input 
                    type="number" 
                    step="0.1"
                    min="0"
                    value={clip.trimStart} 
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setTimelineClips(prev => prev.map(c => c.id === clip.id ? { ...c, trimStart: val } : c));
                    }}
                    style={{ width: '100%', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'white', borderRadius: '4px' }} 
                  />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>컷 종료 시간 (초)</label>
                  <input 
                    type="number" 
                    step="0.1"
                    min="0.1"
                    value={clip.trimEnd} 
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setTimelineClips(prev => prev.map(c => c.id === clip.id ? { ...c, trimEnd: val } : c));
                    }}
                    style={{ width: '100%', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'white', borderRadius: '4px' }} 
                  />
                </div>
                <div style={{ fontSize: '11px', color: '#888', marginTop: '-5px' }}>
                  현재 클립 길이: {(clip.trimEnd - clip.trimStart).toFixed(1)}초
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
          })() : (
            <div style={{ color: '#666', fontSize: '12px' }}>타임라인에서 클립을 클릭하여 속성을 편집하세요.</div>
          )}

          <div style={{ marginTop: '30px', borderTop: '1px solid var(--border)', paddingTop: '20px' }}>
            <h2 className="panel-title" style={{ fontSize: '14px' }}>💬 전역 텍스트 오버레이</h2>
            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>화면에 표시될 자막을 입력하세요</label>
            <textarea 
              value={overlayText}
              onChange={(e) => setOverlayText(e.target.value)}
              style={{ width: '100%', height: '60px', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'white', borderRadius: '4px', resize: 'none' }}
            />
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
            // 패딩 20px 고려
            const clickX = e.clientX - rect.left - 20;
            if (clickX >= 0) {
              setCurrentTime(clickX / 20); // 1초당 20px 기준
            }
          }}
        >
          {/* Playhead (빨간 선) */}
          <div style={{
            position: 'absolute',
            left: `${20 + currentTime * 20}px`,
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
          <div style={{ height: '60px', background: 'var(--bg-dark)', marginBottom: '10px', borderRadius: '4px', position: 'relative', display: 'flex', overflow: 'hidden' }}>
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
          
          {/* Track 2: Text/Effect */}
          <div style={{ height: '40px', background: 'var(--bg-dark)', marginBottom: '10px', borderRadius: '4px', position: 'relative' }}>
             <div style={{ position: 'absolute', left: '100px', width: '150px', height: '100%', background: '#10b981', borderRadius: '4px', display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: '12px' }}>
                제목 텍스트
             </div>
          </div>
          {/* Track 3: Audio */}
          <div style={{ height: '40px', background: 'var(--bg-dark)', marginBottom: '10px', borderRadius: '4px', position: 'relative' }}>
             <div style={{ position: 'absolute', left: '0px', width: '500px', height: '100%', background: '#8b5cf6', borderRadius: '4px', display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: '12px' }}>
                배경음악 (BGM)
             </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default App;
