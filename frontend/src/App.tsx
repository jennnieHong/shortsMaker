import React, { useState } from 'react';
import './App.css';
import { Play, Pause, Download, MonitorPlay } from 'lucide-react';
import { Stage, Layer, Rect, Text } from 'react-konva';

function App() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [inputPath, setInputPath] = useState("");
  const [outputPath, setOutputPath] = useState("C:/output_shorts.mp4");
  const [renderStatus, setRenderStatus] = useState("");

  const handleExport = async () => {
    try {
      setRenderStatus("C++ 엔진 호출 중...");
      // @ts-ignore
      if (window.electronAPI) {
        // @ts-ignore
        const result = await window.electronAPI.renderVideo(inputPath, outputPath);
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
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ background: 'var(--bg-dark)', padding: '15px', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>입력 비디오 경로 (테스트용)</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input 
                type="text" 
                value={inputPath} 
                onChange={(e) => setInputPath(e.target.value)}
                style={{ flex: 1, padding: '8px', background: '#222', border: '1px solid var(--border)', color: 'white', borderRadius: '4px' }} 
              />
              <button 
                onClick={async () => {
                  // @ts-ignore
                  if (window.electronAPI && window.electronAPI.openFileDialog) {
                    // @ts-ignore
                    const filePath = await window.electronAPI.openFileDialog();
                    if (filePath) setInputPath(filePath);
                  }
                }}
                className="btn-primary"
                style={{ padding: '0 12px', fontSize: '12px' }}
              >
                파일 찾기
              </button>
            </div>
          </div>
          <div style={{ background: 'var(--bg-dark)', padding: '15px', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>출력 비디오 경로 (테스트용)</label>
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
      <main className="preview-area">
        {/* 상태 메시지 영역 (alert 대체) */}
        {renderStatus && (
          <div style={{ marginBottom: '15px', padding: '10px', background: 'rgba(16, 185, 129, 0.2)', color: '#10b981', borderRadius: '4px', border: '1px solid #10b981', fontSize: '14px', textAlign: 'center' }}>
            {renderStatus}
            <br/>
            <small style={{ color: '#aaa' }}>*현재 단계에서는 실제 파일이 저장되지 않고 위 메타데이터만 추출합니다.</small>
          </div>
        )}

        <div className="canvas-container" style={{ position: 'relative', width: 360, height: 640 }}>
          {/* 1. 실제 비디오 미리보기 (맨 뒷단) */}
          {inputPath ? (
            <video 
              src={`file://${inputPath}`} 
              style={{ position: 'absolute', width: '100%', height: '100%', objectFit: 'contain', zIndex: 0 }} 
              controls 
            />
          ) : (
            <div style={{ position: 'absolute', width: '100%', height: '100%', background: '#111', zIndex: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
               <span style={{ color: '#aaa', fontSize: '14px' }}>좌측에서 비디오를 선택해주세요</span>
            </div>
          )}
          
           {/* 2. Konva Canvas for WYSIWYG editing (비디오 앞단 투명 레이어) */}
           <Stage width={360} height={640} style={{ position: 'absolute', zIndex: 1, pointerEvents: 'none' }}>
            <Layer>
              <Text 
                text="[테스트 텍스트 레이어]" 
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
      </main>

      {/* Right Sidebar - Properties */}
      <aside className="sidebar-right">
        <h2 className="panel-title">속성 설정 (Properties)</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>X 위치</label>
            <input type="number" defaultValue="100" style={{ width: '100%', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'white', borderRadius: '4px' }} />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>Y 위치</label>
            <input type="number" defaultValue="300" style={{ width: '100%', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'white', borderRadius: '4px' }} />
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
          <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>00:00:00:00</span>
        </div>
        
        {/* Timeline Tracks */}
        <div style={{ flex: 1, padding: '20px', overflowX: 'auto', position: 'relative' }}>
          
          {/* Track 1: Video */}
          <div style={{ height: '60px', background: 'var(--bg-dark)', marginBottom: '10px', borderRadius: '4px', position: 'relative' }}>
             <div style={{ position: 'absolute', left: '50px', width: '300px', height: '100%', background: 'var(--accent)', borderRadius: '4px', display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: '12px' }}>
                비디오 클립 1
             </div>
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
