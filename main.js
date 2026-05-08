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
    console.log(`[Electron Main] 렌더링 요청 수신! (클립 수: ${clips.length})`);

    // 1. 프론트엔드가 구워준 WebM 파일을 디스크에 저장
    if (typeof overlayBase64 !== 'string' || !overlayBase64.startsWith('data:video/webm')) {
      throw new Error('WebM 오버레이 데이터가 없거나 잘못된 형식입니다.');
    }
    const webmPath = path.join(__dirname, 'temp_rendered.webm');
    const base64Data = overlayBase64.replace(/^data:video\/webm(?:;[^,]*)?;base64,/, '');
    fs.writeFileSync(webmPath, base64Data, 'base64');
    console.log('[Electron Main] WebM 임시 저장 완료:', webmPath);

    // 2. V1 클립들에서 오디오를 추출하기 위한 FFmpeg 인풋 생성
    // 각 클립의 trimStart~trimEnd 구간 오디오를 순서대로 concat
    const { execFile } = require('child_process');
    const ffmpegPath = 'd:\\workspace\\shortsMakers\\engine\\ffmpeg\\bin\\ffmpeg.exe';

    // 클립들의 오디오를 concat하는 필터 문자열 생성
    const v1Clips = clips.filter(c => (c.trackIndex || 0) === 0);
    
    await new Promise((resolve, reject) => {
      // 방법: WebM을 MP4로 변환하면서 V1 첫 번째 클립의 오디오를 추가
      // 여러 클립이 있는 경우 복잡한 concat이 필요하므로 우선 V1[0] 오디오 사용
      const audioClip = v1Clips[0];
      
      let ffmpegArgs;
      if (audioClip) {
        const aStart = audioClip.trimStart;
        const aDuration = audioClip.trimEnd - audioClip.trimStart;
        ffmpegArgs = [
          '-y',
          '-i', webmPath,                   // 입력 1: 프론트엔드 렌더 WebM (영상)
          '-ss', String(aStart),
          '-t', String(aDuration),
          '-i', audioClip.path,             // 입력 2: V1 원본 영상 (오디오 추출용)
          '-map', '0:v:0',                  // 영상은 WebM에서
          '-map', '1:a:0',                  // 오디오는 V1 원본에서
          '-c:v', 'libx264',               // H.264로 인코딩
          '-preset', 'fast',
          '-crf', '18',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-shortest',                      // 영상/오디오 중 짧은 쪽에 맞춤
          outputPath
        ];
      } else {
        // 오디오 없이 영상만 변환
        ffmpegArgs = [
          '-y',
          '-i', webmPath,
          '-c:v', 'libx264',
          '-preset', 'fast',
          '-crf', '18',
          '-pix_fmt', 'yuv420p',
          outputPath
        ];
      }

      console.log('[Electron Main] FFmpeg 실행:', ffmpegPath, ffmpegArgs.join(' '));
      execFile(ffmpegPath, ffmpegArgs, { maxBuffer: 1024 * 1024 * 500 }, (err, stdout, stderr) => {
        if (err) {
          console.error('[FFmpeg 오류]', stderr);
          reject(new Error('FFmpeg 변환 실패: ' + stderr));
        } else {
          console.log('[FFmpeg 완료]', stderr.slice(-200));
          resolve(null);
        }
      });
    });

    // 3. 임시 파일 정리
    try { fs.unlinkSync(webmPath); } catch(e) {}

    console.log('[Electron Main] 렌더링 완료! 저장 위치:', outputPath);
    return { success: true, path: outputPath };
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

// 파일 저장 다이얼로그 호출용 리스너
ipcMain.handle('dialog:saveFile', async () => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: '동영상 저장',
    defaultPath: path.join(app.getPath('videos'), 'output_shorts.mp4'),
    filters: [{ name: 'Videos', extensions: ['mp4'] }]
  });
  
  if (canceled) {
    return null;
  } else {
    return filePath;
  }
});
