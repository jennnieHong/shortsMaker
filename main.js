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
    if (overlayBase64) {
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
