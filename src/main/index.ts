import { app, BrowserWindow, clipboard } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { exec, execSync } from 'child_process';
import { ConfigManager } from './config';

// 注入 Chromium 命令行参数以优化内存占用
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=128');
import { StorageManager } from './core/StorageManager';
import { WindowManager } from './core/WindowManager';
import { ClipboardMonitor } from './core/ClipboardMonitor';
import { UpdateManager } from './core/UpdateManager';
import { registerIpcHandlers } from './api/ipcHandlers';
import { IPC_CHANNELS } from '../shared/constants';
import { ShortcutManager } from './core/ShortcutManager';

let configManager: ConfigManager;
let storageManager: StorageManager;
let windowManager: WindowManager;
let clipboardMonitor: ClipboardMonitor;
let updateManager: UpdateManager;
let shortcutManager: ShortcutManager;

const isDev = !app.isPackaged;

// 探测系统默认的截图与录屏目录
function detectDefaultWatchFolders(): string[] {
  const folders: string[] = [];
  const platform = process.platform;

  if (platform === 'win32') {
    try {
      const picturesDir = app.getPath('pictures');
      const winScreenshots = path.join(picturesDir, 'Screenshots');
      if (!fs.existsSync(winScreenshots)) {
        fs.mkdirSync(winScreenshots, { recursive: true });
      }
      folders.push(path.resolve(winScreenshots));
    } catch (err) {
      console.error('Failed to get or create pictures screenshots path:', err);
    }

    try {
      const videosDir = app.getPath('videos');
      const winCaptures = path.join(videosDir, 'Captures');
      if (!fs.existsSync(winCaptures)) {
        fs.mkdirSync(winCaptures, { recursive: true });
      }
      folders.push(path.resolve(winCaptures));
    } catch (err) {
      console.error('Failed to get or create videos captures path:', err);
    }
  } else if (platform === 'darwin') {
    let macCapturePath = '';
    try {
      macCapturePath = execSync('defaults read com.apple.screencapture location', { encoding: 'utf8' }).trim();
    } catch (err) {
      // 如果命令失败，说明使用系统默认位置（桌面）
    }

    if (macCapturePath) {
      // 处理可能的 ~ 符号
      if (macCapturePath.startsWith('~')) {
        const homeDir = app.getPath('home');
        macCapturePath = path.join(homeDir, macCapturePath.slice(1));
      }
      try {
        if (!fs.existsSync(macCapturePath)) {
          fs.mkdirSync(macCapturePath, { recursive: true });
        }
        folders.push(path.resolve(macCapturePath));
      } catch (err) {
        console.error('Failed to resolve custom mac screencapture path:', err);
      }
    } else {
      try {
        const desktopDir = app.getPath('desktop');
        folders.push(path.resolve(desktopDir));
      } catch (err) {
        console.error('Failed to get desktop path:', err);
      }
    }
  }

  return folders;
}

// 封装 Windows 平台图片与文件混合写入（支持 text/plain 纯文本路径以在终端粘贴）
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
      `$dataObject.SetText('${escapedPath}'); ` +
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

  // 自动侦测并初始化默认的系统截图与录屏监听目录
  const currentConfig = configManager.getConfig();
  if (!currentConfig.watchFolders || currentConfig.watchFolders.length === 0) {
    const defaultWatchFolders = detectDefaultWatchFolders();
    if (defaultWatchFolders.length > 0) {
      configManager.updateConfig({ watchFolders: defaultWatchFolders });
      console.log(`Auto-detected and configured default watch folders: ${defaultWatchFolders.join(', ')}`);
    }
  }
  
  const defaultStorageDir = isDev
    ? path.join(app.getAppPath(), 'storage')
    : path.join(app.getPath('pictures'), 'ScreenshotStorage');
  const storageDir = configManager.getConfig().customStoragePath || defaultStorageDir;

  const preloadPath = path.join(__dirname, '../renderer/js/preload.js');
  const mainHtmlPath = path.join(__dirname, '../../src/renderer/index.html');
  const floatHtmlPath = path.join(__dirname, '../../src/renderer/float.html');
  const toastHtmlPath = path.join(__dirname, '../../src/renderer/toast.html');

  // 2. 依赖实例化 (Dependency Injection)
  storageManager = new StorageManager(storageDir, configManager);
  windowManager = new WindowManager(preloadPath, mainHtmlPath, floatHtmlPath, toastHtmlPath);
  clipboardMonitor = new ClipboardMonitor(configManager);
  clipboardMonitor.setStorageDir(storageDir);
  updateManager = new UpdateManager(windowManager);
  shortcutManager = new ShortcutManager(configManager);

  // 3. 异步初始化存储管理器
  storageManager.init().then(() => {
    console.log(`StorageManager initialized. Storage dir: ${storageDir}`);
  }).catch(err => {
    console.error('Failed to initialize StorageManager:', err);
  });

  // 4. 注册 IPC 消息处理
  registerIpcHandlers(configManager, storageManager, windowManager, clipboardMonitor, updateManager, shortcutManager);

  // 5. 绑定剪贴板/文件监听事件与窗口推送 (Event-Driven)
  clipboardMonitor.onImageCaptured(async (buffer) => {
    try {
      const record = await storageManager.saveImage(buffer);
      if (!record) return; // 过滤重复录入
      console.log(`New image captured from clipboard: ${record.filename}`);
      
      // 先将去重缓存路径设为当前文件，确保后面写入剪贴板时不会被 checkClipboard 触发二次事件
      clipboardMonitor.setLastFilePaths(record.filepath);

      if (process.platform === 'win32') {
        await writeImageAndFileDropToClipboardWin32(record.filepath);
      } else {
        const { nativeImage } = require('electron');
        const img = nativeImage.createFromBuffer(buffer);
        clipboard.write({
          text: record.filepath,
          image: img,
          ...({
            'file-paths': [record.filepath]
          } as any)
        });
      }
      
      // 更新剪贴板去重缓存，防止自写入二次触发
      clipboardMonitor.ignoreCurrentClipboardContent();

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
      if (!record) return; // 过滤重复录入
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
            text: record.filepath,
            image: img,
            ...({
              'file-paths': [record.filepath]
            } as any)
          });
        }
      } else {
        // 非图片的多媒体文件（视频、音频等）只写入纯文本路径，保证在终端 and IDE 中均可正常粘贴物理路径
        clipboard.writeText(record.filepath);
      }

      // 更新剪贴板去重缓存，防止自写入二次触发
      clipboardMonitor.ignoreCurrentClipboardContent();

      windowManager.sendToMainWindow(IPC_CHANNELS.ON_NEW_IMAGE, record);
      windowManager.sendToFloatWindow(IPC_CHANNELS.ON_NEW_IMAGE, record);
    } catch (err) {
      console.error(`Failed to handle folder file capture: ${filePath}`, err);
    }
  });

  // 6. 启动监控与创建主窗口
  const config = configManager.getConfig();
  let isSilentStart = false;
  if (config.openAtLogin && config.silentStart) {
    if (process.argv.includes('--hidden')) {
      isSilentStart = true;
    } else {
      try {
        const loginSettings = app.getLoginItemSettings();
        if (loginSettings.wasOpenedAsHidden) {
          isSilentStart = true;
        }
      } catch (err) {
        console.error('Failed to get login settings on startup:', err);
      }
    }
  }

  // 注册微信式截图完成后的回调存储逻辑
  shortcutManager.onScreenshotCaptured(async (buffer, data) => {
    try {
      const record = await storageManager.saveImage(buffer);
      if (!record) return; // 自动去重过滤

      console.log(`New screenshot saved: ${record.filename}`);
      clipboardMonitor.setLastFilePaths(record.filepath);

      if (process.platform === 'win32') {
        await writeImageAndFileDropToClipboardWin32(record.filepath);
      } else {
        const { nativeImage } = require('electron');
        const img = nativeImage.createFromBuffer(buffer);
        clipboard.write({
          text: record.filepath,
          image: img,
          ...({
            'file-paths': [record.filepath]
          } as any)
        });
      }

      // 更新剪贴板去重缓存
      clipboardMonitor.ignoreCurrentClipboardContent();

      // 推送给所有窗口更新
      windowManager.sendToMainWindow(IPC_CHANNELS.ON_NEW_IMAGE, record);
      windowManager.sendToFloatWindow(IPC_CHANNELS.ON_NEW_IMAGE, record);

      // 截图保存成功后,在「该次截图所在屏」中央弹出独立成功提示浮窗(无论主面板是否打开都可见)。
      // data.display 为截图发生时的显示器信息,跟随它以保证副屏截图时浮窗也在副屏而非主屏。
      const targetDisplay = data && data.display ? data.display : undefined;
      windowManager.showScreenshotSuccessToast(targetDisplay);
    } catch (err) {
      console.error('Failed to handle screenshots event callback:', err);
    }
  });

  clipboardMonitor.start();
  
  // 无论是否静默启动，均确保系统托盘图标被创建，以便于后台挂载与交互
  windowManager.ensureTray();

  if (!isSilentStart) {
    windowManager.createMainWindow(true);
  }

  // 截图完成后，如果之前因为点击浮窗临时取消了 alwaysOnTop，则将其恢复为置顶
  shortcutManager.onScreenshotFinished(() => {
    const floatWin = windowManager.getFloatWindow();
    if (floatWin && !floatWin.isDestroyed()) {
      try {
        floatWin.setAlwaysOnTop(true);
      } catch (err) {
        console.error('[index] Failed to restore alwaysOnTop on floatWin:', err);
      }
    }
  });

  shortcutManager.registerShortcut();

  // 7. 记忆功能：若上次开启了悬浮窗且不是静默启动，在启动时自动拉起
  if (config.showFloatWindowOnStart && !isSilentStart) {
    setTimeout(() => {
      windowManager.createFloatWindow();
    }, 600);
  }

  // 8. 启动 5 秒后自动在后台检查更新
  setTimeout(() => {
    updateManager.checkForUpdates(false).catch(err => {
      console.error('Auto update check failed silently:', err);
    });
  }, 5000);
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
  // 保持后台运行，主面板关闭只销毁窗口释放内存，托盘仍旧保持运行监听
  // 只有当用户在托盘菜单中选择“退出程序”时，主进程才会真正退出。
});
