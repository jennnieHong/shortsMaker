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

// 프론트엔드에서 비디오 렌더링 요청을 보냈을 때 실행되는 리스너
ipcMain.handle('render-video', async (event, inputPath, outputPath) => {
  try {
    console.log(`[Electron Main] 비디오 분석 요청 수신! (입력: ${inputPath})`);
    // C++ 엔진의 renderVideo 함수를 2개의 인자로 호출합니다.
    const result = engine.renderVideo(inputPath, outputPath);
    console.log('[Electron Main] C++ 엔진 응답 완료:', result);
    return result;
  } catch (err) {
    console.error('렌더링 중 오류 발생:', err);
    throw err;
  }
});

// 파일 선택 다이얼로그 호출용 리스너
ipcMain.handle('dialog:openFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: '입력 비디오 선택',
    defaultPath: 'C:\\Users\\uoshj\\Videos\\Captures',
    filters: [
      { name: 'Videos', extensions: ['mp4', 'avi', 'mov', 'mkv', 'webm'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  
  if (canceled) {
    return null;
  } else {
    return filePaths[0]; // 첫 번째 선택한 파일 경로 반환
  }
});
