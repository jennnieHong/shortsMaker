const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
// C++ 코어 엔진 로드
const engine = require('./engine/build/Release/video_engine.node');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, // 보안을 위해 false
      contextIsolation: true, // 보안을 위해 true
      webSecurity: false // 로컬 비디오 파일 미리보기를 위해 임시 해제
    }
  });

  // 개발 환경에서는 Vite 개발 서버 주소를 불러옵니다.
  mainWindow.loadURL('http://localhost:5173');
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

const fs = require('fs');

// 프론트엔드에서 비디오 렌더링 요청을 보냈을 때 실행되는 리스너
ipcMain.handle('render-video', async (event, clips, outputPath, overlayBase64) => {
  try {
    console.log(`[Electron Main] 비디오 분석 요청 수신! (클립 수: ${clips.length})`);
    
    let overlayImagePath = "";
    if (Array.isArray(overlayBase64) && overlayBase64.length > 0) {
      const textClips = overlayBase64;
      overlayImagePath = path.join(__dirname, 'temp.ass');
      
      let assContent = `[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Inter,24,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,1,7,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

      function formatAssTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        const cs = Math.floor((seconds % 1) * 100);
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
      }

      textClips.forEach(clip => {
        const start = formatAssTime(clip.startTime);
        const end = formatAssTime(clip.endTime);
        const x = Math.round(clip.x * 2);
        const y = Math.round(clip.y * 2);
        const fontSize = Math.round(clip.fontSize * 2);
        
        let bgr = "FFFFFF";
        if (clip.color && clip.color.length === 7) {
          bgr = clip.color.substring(5,7) + clip.color.substring(3,5) + clip.color.substring(1,3);
        }
        
        const cleanText = clip.text.replace(/\n/g, '\\N');
        assContent += `Dialogue: 0,${start},${end},Default,,0,0,0,,{\\pos(${x},${y})\\c&H${bgr}&\\fs${fontSize}}${cleanText}\n`;
      });

      fs.writeFileSync(overlayImagePath, assContent, 'utf8');
      console.log('[Electron Main] ASS 자막 파일 생성 완료:', overlayImagePath);
    } else if (typeof overlayBase64 === 'string' && overlayBase64.startsWith('data:image')) {
      overlayImagePath = path.join(__dirname, 'temp_overlay.png');
      const base64Data = overlayBase64.replace(/^data:image\/png;base64,/, "");
      fs.writeFileSync(overlayImagePath, base64Data, 'base64');
      console.log('[Electron Main] 오버레이 PNG 임시 저장 완료:', overlayImagePath);
    }
    
    // C++ 엔진의 renderVideo 함수를 호출합니다. (세 번째 인자로 overlayImagePath 전달)
    const result = engine.renderVideo(clips, outputPath, overlayImagePath);
    console.log('[Electron Main] C++ 엔진 응답 완료:', result);
    return result;
  } catch (err) {
    console.error('렌더링 중 오류 발생:', err);
    throw err;
  }
});

// 파일 선택 다이얼로그 호출용 리스너 (다중 선택 지원)
ipcMain.handle('dialog:openFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: '입력 비디오 선택',
    defaultPath: 'C:\\Users\\uoshj\\Videos\\Captures',
    filters: [
      { name: 'Videos', extensions: ['mp4', 'avi', 'mov', 'mkv', 'webm'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile', 'multiSelections']
  });
  
  if (canceled) {
    return [];
  } else {
    return filePaths; // 배열 반환
  }
});

// 폴더 선택 다이얼로그 호출용 리스너
ipcMain.handle('dialog:openDirectory', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: '비디오 폴더 선택',
    defaultPath: 'C:\\Users\\uoshj\\Videos\\Captures',
    properties: ['openDirectory']
  });
  
  if (canceled || filePaths.length === 0) {
    return [];
  } else {
    const dirPath = filePaths[0];
    const files = fs.readdirSync(dirPath);
    const videoExts = ['.mp4', '.avi', '.mov', '.mkv', '.webm'];
    
    // 비디오 파일만 필터링하여 절대 경로 배열로 반환
    const videoFiles = files
      .filter(file => videoExts.includes(path.extname(file).toLowerCase()))
      .map(file => path.join(dirPath, file));
      
    return videoFiles;
  }
});
