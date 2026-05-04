const { contextBridge, ipcRenderer } = require('electron');

// 프론트엔드(React)에서 전역객체 window.electronAPI 를 통해 안전하게 접근할 수 있도록 맵핑
contextBridge.exposeInMainWorld('electronAPI', {
  renderVideo: (inputPath, outputPath) => ipcRenderer.invoke('render-video', inputPath, outputPath),
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile')
});
