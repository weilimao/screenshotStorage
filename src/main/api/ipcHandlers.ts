import { ipcMain, dialog, app, shell } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { ConfigManager } from '../config';
import { StorageManager } from '../core/StorageManager';
import { WindowManager } from '../core/WindowManager';
import { ClipboardMonitor } from '../core/ClipboardMonitor';

export function registerIpcHandlers(
  configManager: ConfigManager,
  storageManager: StorageManager,
  windowManager: WindowManager,
  clipboardMonitor: ClipboardMonitor
): void {
  // 1. 获取所有图片
  ipcMain.handle(IPC_CHANNELS.GET_IMAGES, async () => {
    return await storageManager.getImages();
  });

  // 2. 删除单张图片
  ipcMain.handle(IPC_CHANNELS.DELETE_IMAGE, async (_, id: string) => {
    await storageManager.deleteImage(id);
    // 通知另一个窗口更新
    windowManager.sendToMainWindow(IPC_CHANNELS.ON_IMAGE_DELETED, id);
    windowManager.sendToFloatWindow(IPC_CHANNELS.ON_IMAGE_DELETED, id);
    return true;
  });

  // 3. 手动清空所有图片
  ipcMain.handle(IPC_CHANNELS.CLEAR_ALL, async () => {
    await storageManager.clearAll();
    windowManager.sendToMainWindow(IPC_CHANNELS.ON_IMAGE_DELETED, 'all');
    windowManager.sendToFloatWindow(IPC_CHANNELS.ON_IMAGE_DELETED, 'all');
    return true;
  });

  // 4. 获取配置
  ipcMain.handle(IPC_CHANNELS.GET_CONFIG, () => {
    const config = configManager.getConfig();
    try {
      config.openAtLogin = app.getLoginItemSettings().openAtLogin;
    } catch (err) {
      console.error('Failed to get login item settings:', err);
      config.openAtLogin = false;
    }
    return config;
  });

  // 5. 更新配置
  ipcMain.handle(IPC_CHANNELS.UPDATE_CONFIG, (_, newConfig) => {
    configManager.updateConfig(newConfig);

    // 处理开机自启
    if (newConfig.openAtLogin !== undefined) {
      try {
        if (app.isPackaged) {
          app.setLoginItemSettings({
            openAtLogin: newConfig.openAtLogin,
            path: process.execPath,
          });
        } else {
          console.log(`[Dev] Mock setLoginItemSettings to ${newConfig.openAtLogin}`);
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
      config.openAtLogin = app.getLoginItemSettings().openAtLogin;
    } catch (err) {
      config.openAtLogin = newConfig.openAtLogin;
    }

    // 推送配置变更通知
    windowManager.sendToMainWindow(IPC_CHANNELS.ON_CONFIG_CHANGED, config);
    windowManager.sendToFloatWindow(IPC_CHANNELS.ON_CONFIG_CHANGED, config);
    return true;
  });

  // 6. 选择微信监听目录
  ipcMain.handle(IPC_CHANNELS.SELECT_FOLDER, async () => {
    const mainWindow = windowManager.getMainWindow();
    if (!mainWindow) return null;

    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择微信截图保存目录或其它监听目录',
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

  // 9. 处理原生图片拖动到外部 (如终端)
  ipcMain.on(IPC_CHANNELS.START_DRAG, (event, filePath: string) => {
    // 触发 Electron 原生拖动
    event.sender.startDrag({
      file: filePath,
      icon: filePath // 拖拽时以原图作为图标展示
    });
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
}
