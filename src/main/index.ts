import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { ConfigManager } from './config';
import { StorageManager } from './core/StorageManager';
import { WindowManager } from './core/WindowManager';
import { ClipboardMonitor } from './core/ClipboardMonitor';
import { registerIpcHandlers } from './api/ipcHandlers';
import { IPC_CHANNELS } from '../shared/constants';

let configManager: ConfigManager;
let storageManager: StorageManager;
let windowManager: WindowManager;
let clipboardMonitor: ClipboardMonitor;

const isDev = !app.isPackaged;

function initApp() {
  // 1. 初始化路径与配置管理
  const userDataPath = app.getPath('userData');
  const configPath = path.join(userDataPath, 'config.json');
  configManager = new ConfigManager(configPath);
  
  const defaultStorageDir = isDev
    ? path.join(app.getAppPath(), 'storage')
    : path.join(app.getPath('pictures'), 'ScreenshotStorage');
  const storageDir = configManager.getConfig().customStoragePath || defaultStorageDir;

  const preloadPath = path.join(__dirname, '../renderer/js/preload.js');
  const mainHtmlPath = path.join(__dirname, '../../src/renderer/index.html');
  const floatHtmlPath = path.join(__dirname, '../../src/renderer/float.html');

  // 2. 依赖实例化 (Dependency Injection)
  storageManager = new StorageManager(storageDir, configManager);
  windowManager = new WindowManager(preloadPath, mainHtmlPath, floatHtmlPath);
  clipboardMonitor = new ClipboardMonitor(configManager);

  // 3. 异步初始化存储管理器
  storageManager.init().then(() => {
    console.log(`StorageManager initialized. Storage dir: ${storageDir}`);
  }).catch(err => {
    console.error('Failed to initialize StorageManager:', err);
  });

  // 4. 注册 IPC 消息处理
  registerIpcHandlers(configManager, storageManager, windowManager, clipboardMonitor);

  // 5. 绑定剪贴板/文件监听事件与窗口推送 (Event-Driven)
  clipboardMonitor.onImageCaptured(async (buffer) => {
    try {
      const record = await storageManager.saveImage(buffer);
      console.log(`New image captured from clipboard: ${record.filename}`);
      // 推送给渲染进程
      windowManager.sendToMainWindow(IPC_CHANNELS.ON_NEW_IMAGE, record);
      windowManager.sendToFloatWindow(IPC_CHANNELS.ON_NEW_IMAGE, record);
    } catch (err) {
      console.error('Failed to handle clipboard image capture:', err);
    }
  });

  clipboardMonitor.onFileCaptured(async (filePath) => {
    try {
      const record = await storageManager.saveImageFromFile(filePath);
      console.log(`New image captured from folder: ${record.filename} (source: ${filePath})`);
      windowManager.sendToMainWindow(IPC_CHANNELS.ON_NEW_IMAGE, record);
      windowManager.sendToFloatWindow(IPC_CHANNELS.ON_NEW_IMAGE, record);
    } catch (err) {
      console.error(`Failed to handle folder file capture: ${filePath}`, err);
    }
  });

  // 6. 启动监控与创建主窗口
  clipboardMonitor.start();
  windowManager.createMainWindow();

  // 7. 记忆功能：若上次开启了悬浮窗，在启动时自动拉起
  const config = configManager.getConfig();
  if (config.showFloatWindowOnStart) {
    setTimeout(() => {
      windowManager.createFloatWindow();
    }, 600);
  }
}

app.whenReady().then(() => {
  initApp();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      windowManager.createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // 停止监听器
  if (clipboardMonitor) {
    clipboardMonitor.stop();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
