import { app, BrowserWindow, clipboard } from 'electron';
import * as path from 'path';
import { exec } from 'child_process';
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

// 封装 Windows 平台图片与文件混合写入（不含 text 格式，避免死循环及 IDE 粘贴地址问题）
function writeImageAndFileDropToClipboardWin32(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const escapedPath = filePath.replace(/'/g, "''");
    const psCommand = `Add-Type -AssemblyName System.Windows.Forms; ` +
      `Add-Type -AssemblyName System.Drawing; ` +
      `$dataObject = New-Object System.Windows.Forms.DataObject; ` +
      `$fileList = New-Object System.Collections.Specialized.StringCollection; ` +
      `$fileList.Add('${escapedPath}') > $null; ` +
      `$dataObject.SetFileDropList($fileList); ` +
      `$img = [System.Drawing.Image]::FromFile('${escapedPath}'); ` +
      `$dataObject.SetImage($img); ` +
      `[System.Windows.Forms.Clipboard]::SetDataObject($dataObject, $true);`;
    
    exec(`powershell -NoProfile -Command "${psCommand}"`, (error) => {
      if (error) {
        console.error('Failed to write hybrid image to clipboard via PowerShell:', error);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'].includes(ext);
}

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
      
      // 先将去重缓存路径设为当前文件，确保后面写入剪贴板时不会被 checkClipboard 触发二次事件
      clipboardMonitor.setLastFilePaths(record.filepath);

      if (process.platform === 'win32') {
        await writeImageAndFileDropToClipboardWin32(record.filepath);
      } else {
        const { nativeImage } = require('electron');
        const img = nativeImage.createFromBuffer(buffer);
        clipboard.write({
          image: img,
          ...({
            'file-paths': [record.filepath]
          } as any)
        });
      }

      // 推送给渲染进程
      windowManager.sendToMainWindow(IPC_CHANNELS.ON_NEW_IMAGE, record);
      windowManager.sendToFloatWindow(IPC_CHANNELS.ON_NEW_IMAGE, record);
    } catch (err) {
      console.error('Failed to handle clipboard image capture:', err);
    }
  });

  clipboardMonitor.onFileCaptured(async (filePath) => {
    try {
      const storageDir = storageManager.getStoragePath();
      // 核心安全防线：如果捕获的文件本来就保存在暂存箱的存储目录中，则直接忽略，防止无限循环
      if (path.resolve(filePath).startsWith(path.resolve(storageDir))) {
        return;
      }

      const record = await storageManager.saveImageFromFile(filePath);
      console.log(`New image captured from folder: ${record.filename} (source: ${filePath})`);
      
      // 先将去重缓存路径设为当前文件
      clipboardMonitor.setLastFilePaths(record.filepath);

      if (isImageFile(record.filepath)) {
        if (process.platform === 'win32') {
          await writeImageAndFileDropToClipboardWin32(record.filepath);
        } else {
          const { nativeImage } = require('electron');
          const img = nativeImage.createFromPath(record.filepath);
          clipboard.write({
            image: img,
            ...({
              'file-paths': [record.filepath]
            } as any)
          });
        }
      } else {
        // 非图片的多媒体文件（视频、音频等）只写入纯文本路径，保证在终端和 IDE 中均可正常粘贴物理路径
        clipboard.writeText(record.filepath);
      }

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
