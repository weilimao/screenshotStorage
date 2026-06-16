import { ipcMain, dialog, app, shell, clipboard } from 'electron';
import { exec } from 'child_process';
import { IPC_CHANNELS } from '../../shared/constants';
import { ConfigManager } from '../config';
import { StorageManager } from '../core/StorageManager';
import { WindowManager } from '../core/WindowManager';
import { ClipboardMonitor } from '../core/ClipboardMonitor';
import { UpdateManager } from '../core/UpdateManager';
import { ShortcutManager } from '../core/ShortcutManager';

function isImageFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'].includes(ext || '');
}

export function registerIpcHandlers(
  configManager: ConfigManager,
  storageManager: StorageManager,
  windowManager: WindowManager,
  clipboardMonitor: ClipboardMonitor,
  updateManager: UpdateManager,
  shortcutManager: ShortcutManager
): void {
  // 1. 获取所有图片
  ipcMain.handle(IPC_CHANNELS.GET_IMAGES, async () => {
    return await storageManager.getImages();
  });

  // 2. 删除单张图片
  ipcMain.handle(IPC_CHANNELS.DELETE_IMAGE, async (_, id: string) => {
    await storageManager.deleteImage(id);
    // 移除 clearCache()。如果删除时系统剪贴板中仍是此图片/文件，清空缓存会导致轮询器立刻重新捕获它，导致“删不掉”的 Bug。
    // 通知另一个窗口更新
    windowManager.sendToMainWindow(IPC_CHANNELS.ON_IMAGE_DELETED, id);
    windowManager.sendToFloatWindow(IPC_CHANNELS.ON_IMAGE_DELETED, id);
    return true;
  });

  // 3. 手动清空所有图片/视频或全部
  ipcMain.handle(IPC_CHANNELS.CLEAR_ALL, async (_, type?: 'all' | 'image' | 'video') => {
    await storageManager.clearAll(type);
    // 移除 clearCache()。防止清空后剪贴板中当前的内容被立刻重新捕获。
    // 通知其他窗口更新
    windowManager.sendToMainWindow(IPC_CHANNELS.ON_IMAGE_DELETED, type || 'all');
    windowManager.sendToFloatWindow(IPC_CHANNELS.ON_IMAGE_DELETED, type || 'all');
    return true;
  });

  // 4. 获取配置
  ipcMain.handle(IPC_CHANNELS.GET_CONFIG, () => {
    const config = configManager.getConfig();
    try {
      const silentStart = config.silentStart || false;
      config.openAtLogin = app.isPackaged
        ? app.getLoginItemSettings({
            path: process.execPath,
            args: silentStart ? ['--hidden'] : []
          }).openAtLogin
        : (config.openAtLogin || false);
    } catch (err) {
      console.error('Failed to get login item settings:', err);
      config.openAtLogin = config.openAtLogin || false;
    }
    config.storagePath = storageManager.getStoragePath();
    return config;
  });

  // 5. 更新配置
  ipcMain.handle(IPC_CHANNELS.UPDATE_CONFIG, async (_, newConfig) => {
    // 如果修改了自定义存储路径，触发存储文件夹迁移
    if (newConfig.customStoragePath && newConfig.customStoragePath !== storageManager.getStoragePath()) {
      try {
        await storageManager.updateStorageDir(newConfig.customStoragePath);
        clipboardMonitor.setStorageDir(newConfig.customStoragePath);
      } catch (err) {
        console.error('Failed to update storage directory:', err);
      }
    }

    const oldConfig = configManager.getConfig();
    configManager.updateConfig(newConfig);

    if (newConfig.screenshotShortcut !== undefined) {
      const success = shortcutManager.registerShortcut();
      if (!success) {
        // 注册失败，恢复原快捷键配置并返回失败
        configManager.updateConfig({ screenshotShortcut: oldConfig.screenshotShortcut });
        return false;
      }
    }

    // 处理开机自启
    if (newConfig.openAtLogin !== undefined || newConfig.silentStart !== undefined) {
      try {
        const currentConfig = configManager.getConfig();
        const openAtLogin = newConfig.openAtLogin !== undefined ? newConfig.openAtLogin : currentConfig.openAtLogin;
        const silentStart = newConfig.silentStart !== undefined ? newConfig.silentStart : currentConfig.silentStart;

        if (app.isPackaged) {
          app.setLoginItemSettings({
            openAtLogin: openAtLogin,
            path: process.execPath,
            args: openAtLogin && silentStart ? ['--hidden'] : [],
            openAsHidden: silentStart,
          });
        } else {
          console.log(`[Dev] Mock setLoginItemSettings to openAtLogin=${openAtLogin}, silentStart=${silentStart}`);
        }
      } catch (err) {
        console.error('Failed to set login item settings:', err);
      }
    }

    // 如果微信监听目录发生变更，重启目录监听器
    if (newConfig.watchFolders) {
      clipboardMonitor.restartFolderWatchers();
    }

    // 获取最新的配置并合并开机自启状态推送
    const config = configManager.getConfig();
    try {
      const silentStart = config.silentStart || false;
      config.openAtLogin = app.isPackaged
        ? app.getLoginItemSettings({
            path: process.execPath,
            args: silentStart ? ['--hidden'] : []
          }).openAtLogin
        : (config.openAtLogin || false);
    } catch (err) {
      config.openAtLogin = newConfig.openAtLogin !== undefined ? newConfig.openAtLogin : (config.openAtLogin || false);
    }

    // 合并实际存储路径推送给前端
    config.storagePath = storageManager.getStoragePath();

    // 推送配置变更通知
    windowManager.sendToMainWindow(IPC_CHANNELS.ON_CONFIG_CHANGED, config);
    windowManager.sendToFloatWindow(IPC_CHANNELS.ON_CONFIG_CHANGED, config);
    return true;
  });

  // 6. 选择文件夹目录
  ipcMain.handle(IPC_CHANNELS.SELECT_FOLDER, async (_, title?: string) => {
    const mainWindow = windowManager.getMainWindow();
    if (!mainWindow) return null;

    const result = await dialog.showOpenDialog(mainWindow, {
      title: title || '选择微信截图保存目录或其它监听目录',
      properties: ['openDirectory']
    });

    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  // 7. 控制浮窗开关
  ipcMain.handle(IPC_CHANNELS.TOGGLE_FLOAT_WINDOW, () => {
    const floatWindow = windowManager.getFloatWindow();
    let newState = false;
    if (floatWindow) {
      windowManager.closeFloatWindow();
      newState = false;
    } else {
      windowManager.createFloatWindow();
      newState = true;
    }
    // 自动记忆浮窗状态到配置文件
    configManager.updateConfig({ showFloatWindowOnStart: newState });
    return newState;
  });

  // 8. 获取浮窗当前状态
  ipcMain.handle(IPC_CHANNELS.FLOAT_WINDOW_STATE, () => {
    return windowManager.getFloatWindow() !== null;
  });

  // 9. 处理原生图片/视频拖动到外部 (如终端)
  ipcMain.on(IPC_CHANNELS.START_DRAG, (event, filePath: string) => {
    try {
      const ext = filePath.split('.').pop()?.toLowerCase();
      const isVideo = ['mp4', 'mov', 'avi', 'mkv', 'flv', 'wmv'].includes(ext || '');

      let iconImage = filePath;
      if (isVideo) {
        // 核心改进：Electron 的 startDrag 必须在 IPC 事件回调中同步执行。
        // 任何 await (如异步获取图标) 都会使该调用排入下一次微任务队列，从而错过系统原生的拖拽响应时机，导致拖拽失效。
        // 为保证同步性，这里直接使用本地已有的静态 PNG 图片作为视频拖拽时的悬浮图标。
        const path = require('path');
        const fs = require('fs');
        let fallbackPath = path.join(app.getAppPath(), 'assets/tray_small.png');
        if (!fs.existsSync(fallbackPath)) {
          fallbackPath = path.join(app.getAppPath(), '../../assets/tray_small.png');
        }
        if (!fs.existsSync(fallbackPath)) {
          fallbackPath = path.join(__dirname, '../../assets/tray_small.png');
        }
        iconImage = fallbackPath;
      }

      event.sender.startDrag({
        file: filePath,
        icon: iconImage
      });
    } catch (err) {
      console.error('Failed to start drag:', err);
    }
  });

  // 10. 处理悬浮窗大小调整
  ipcMain.on('window:resize-float', (_, width: number, height: number) => {
    console.log(`Received float window resize request: width=${width}, height=${height}`);
    const floatWindow = windowManager.getFloatWindow();
    if (floatWindow && !floatWindow.isDestroyed()) {
      try {
        floatWindow.setResizable(true);
        floatWindow.setSize(Math.round(width), Math.round(height));
      } catch (err) {
        console.error('Failed to resize float window:', err);
      }
    }
  });

  // 11. 调用系统默认程序打开文件
  ipcMain.handle('file:open', async (_, filePath: string) => {
    try {
      await shell.openPath(filePath);
      return true;
      } catch (err) {
        console.error('Failed to open path:', err);
        return false;
      }
    });

  // 12. 路由浮窗的预览请求给主窗口显示
  ipcMain.handle('window:trigger-preview', (_, filePath: string) => {
    let mainWindow = windowManager.getMainWindow();
    // 如果主窗口不存在，先强制拉起它
    if (!mainWindow || mainWindow.isDestroyed()) {
      windowManager.createMainWindow();
      mainWindow = windowManager.getMainWindow();
    }

    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();

      // 通知主窗口打开内置大图预览 Lightbox
      windowManager.sendToMainWindow('event:open-preview-in-main', filePath);
    }
    return true;
  });

  // 13. 将物理文件作为“真实文件复制”动作写入系统剪贴板（供微信聊天框粘贴文件，且编辑器粘贴路径文本）
  ipcMain.handle('file:copy-to-clipboard', async (_, filePath: string) => {
    try {
      clipboardMonitor.setLastFilePaths(filePath); // 设置去重缓存为当前复制路径，避免重复监听到自身

      if (!isImageFile(filePath)) {
        // 如果是非图片文件（如视频、音频等），只写入纯文本绝对路径到剪贴板，防止编辑器拦截而无法粘贴路径
        clipboard.writeText(filePath);
        clipboardMonitor.ignoreCurrentClipboardContent();
        return true;
      }

      if (process.platform === 'win32') {
        return new Promise<boolean>((resolve) => {
          const escapedPath = filePath.replace(/'/g, "''");
          // Windows 平台下，利用 PowerShell 混合写入 FileDropList (文件物理路径)、Image (DIB图片格式) 与 Text (物理路径文本)
          // 以保证在终端中能正常粘贴为物理路径文本。
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
              console.error('Failed to copy file via PowerShell:', error);
              resolve(false);
            } else {
              clipboardMonitor.ignoreCurrentClipboardContent();
              resolve(true);
            }
          });
        });
      } else {
        // 其他平台使用 Electron clipboard 写入混合图片、文件和文本格式
        const { nativeImage } = require('electron');
        const img = nativeImage.createFromPath(filePath);
        clipboard.write({
          text: filePath,
          image: img,
          ...({
            'text/uri-list': Buffer.from(`file:///${filePath.replace(/\\/g, '/')}`),
            'file-paths': [filePath]
          } as any)
        });
        clipboardMonitor.ignoreCurrentClipboardContent();
        return true;
      }
    } catch (err) {
      console.error('Failed to copy file to clipboard:', err);
      return false;
    }
  });

  // 14. 检查更新
  ipcMain.handle('app:check-for-updates', async (_, manual: boolean) => {
    return await updateManager.checkForUpdates(manual);
  });

  // 15. 获取版本号
  ipcMain.handle('app:get-version', () => {
    return updateManager.getAppVersion();
  });

  // 16. 开始在应用内下载新版安装包
  ipcMain.handle('app:start-download-update', async (_, assets: any[]) => {
    return await updateManager.startDownload(assets);
  });

  // 17. 立即重启安装并应用更新
  ipcMain.on('app:install-update', (_, filePath: string) => {
    updateManager.installUpdate(filePath);
  });

  // 18. 手动触发截图
  ipcMain.handle('app:trigger-screenshot', () => {
    const floatWin = windowManager.getFloatWindow();
    if (floatWin && !floatWin.isDestroyed()) {
      try {
        floatWin.setAlwaysOnTop(false);
        floatWin.blur();
      } catch (err) {
        console.error('[ipcHandlers] Failed to blur and reset alwaysOnTop on floatWin:', err);
      }
    }
    shortcutManager.triggerScreenshot();
    return true;
  });
}

