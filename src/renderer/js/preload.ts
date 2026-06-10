const { contextBridge, ipcRenderer } = require('electron');
const { IPC_CHANNELS } = require('../../shared/constants');

contextBridge.exposeInMainWorld('electronAPI', {
  getImages: () => ipcRenderer.invoke(IPC_CHANNELS.GET_IMAGES),
  deleteImage: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_IMAGE, id),
  clearAll: (type?: 'all' | 'image' | 'video') => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_ALL, type),
  getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.GET_CONFIG),
  updateConfig: (config: any) => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_CONFIG, config),
  selectFolder: (title?: string) => ipcRenderer.invoke(IPC_CHANNELS.SELECT_FOLDER, title),
  toggleFloatWindow: () => ipcRenderer.invoke(IPC_CHANNELS.TOGGLE_FLOAT_WINDOW),
  getFloatWindowState: () => ipcRenderer.invoke(IPC_CHANNELS.FLOAT_WINDOW_STATE),
  
  // 拖拽方法
  startDrag: (filePath: string) => ipcRenderer.send(IPC_CHANNELS.START_DRAG, filePath),
  resizeFloatWindow: (width: number, height: number) => ipcRenderer.send('window:resize-float', width, height),
  openFile: (filePath: string) => ipcRenderer.invoke('file:open', filePath),
  triggerMainPreview: (filePath: string) => ipcRenderer.invoke('window:trigger-preview', filePath),
  copyFileToClipboard: (filePath: string) => ipcRenderer.invoke('file:copy-to-clipboard', filePath),
  checkForUpdates: (manual: boolean) => ipcRenderer.invoke('app:check-for-updates', manual),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  startDownloadUpdate: (assets: any[]) => ipcRenderer.invoke('app:start-download-update', assets),
  installUpdate: (filePath: string) => ipcRenderer.send('app:install-update', filePath),
  triggerScreenshot: () => ipcRenderer.invoke('app:trigger-screenshot'),

  // 主进程向渲染进程通知的监听器
  onUpdateAvailable: (callback: (data: any) => void) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on('app:update-available', listener);
    return () => {
      ipcRenderer.removeListener('app:update-available', listener);
    };
  },
  onDownloadProgress: (callback: (progress: any) => void) => {
    const listener = (_event: any, progress: any) => callback(progress);
    ipcRenderer.on('app:download-progress', listener);
    return () => {
      ipcRenderer.removeListener('app:download-progress', listener);
    };
  },
  onDownloadComplete: (callback: (filePath: string) => void) => {
    const listener = (_event: any, filePath: string) => callback(filePath);
    ipcRenderer.on('app:download-complete', listener);
    return () => {
      ipcRenderer.removeListener('app:download-complete', listener);
    };
  },
  onNewImage: (callback: (record: any) => void) => {
    const listener = (_event: any, record: any) => callback(record);
    ipcRenderer.on(IPC_CHANNELS.ON_NEW_IMAGE, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.ON_NEW_IMAGE, listener);
    };
  },
  onImageDeleted: (callback: (id: string) => void) => {
    const listener = (_event: any, id: string) => callback(id);
    ipcRenderer.on(IPC_CHANNELS.ON_IMAGE_DELETED, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.ON_IMAGE_DELETED, listener);
    };
  },
  onConfigChanged: (callback: (config: any) => void) => {
    const listener = (_event: any, config: any) => callback(config);
    ipcRenderer.on(IPC_CHANNELS.ON_CONFIG_CHANGED, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.ON_CONFIG_CHANGED, listener);
    };
  },
  onFloatWindowStateChanged: (callback: (state: boolean) => void) => {
    const listener = (_event: any, state: boolean) => callback(state);
    ipcRenderer.on('window:float-state-changed', listener);
    return () => {
      ipcRenderer.removeListener('window:float-state-changed', listener);
    };
  },
  onTriggerPreview: (callback: (filePath: string) => void) => {
    const listener = (_event: any, filePath: string) => callback(filePath);
    ipcRenderer.on('event:open-preview-in-main', listener);
    return () => {
      ipcRenderer.removeListener('event:open-preview-in-main', listener);
    };
  }
});
