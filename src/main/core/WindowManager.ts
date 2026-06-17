import { BrowserWindow, shell, Tray, Menu, nativeImage, app, NativeImage } from 'electron';
import { IWindowManager } from '../../shared/types';
import * as path from 'path';
import * as fs from 'fs';

// 经典的 Electron 蓝色原子 (Atom Logo) 32x32 PNG 格式 Base64 编码
const TRAY_ICON_BASE64 = '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';

export class WindowManager implements IWindowManager {
  private mainWindow: BrowserWindow | null = null;
  private floatWindow: BrowserWindow | null = null;
  private tray: Tray | null = null;
  private trayIcon: NativeImage | null = null; // 强引用托盘图标防止GC垃圾回收
  private isQuitting = false;

  constructor(
    private preloadPath: string,
    private mainHtmlPath: string,
    private floatHtmlPath: string
  ) {
    // 挂载全局退出钩子，保证 Cmd+Q 或托盘菜单的退出选项能顺利结束进程
    app.on('before-quit', () => {
      this.isQuitting = true;
    });
  }

  private getTrayIconPath(): string {
    let iconPath = path.join(app.getAppPath(), 'assets/tray_small.png');
    if (!fs.existsSync(iconPath)) {
      iconPath = path.join(app.getAppPath(), '../../assets/tray_small.png');
    }
    if (!fs.existsSync(iconPath)) {
      iconPath = path.join(__dirname, '../../assets/tray_small.png');
    }
    return iconPath;
  }

  private getWindowIconPath(): string {
    let iconPath = path.join(app.getAppPath(), 'assets/tray.png');
    if (!fs.existsSync(iconPath)) {
      iconPath = path.join(app.getAppPath(), '../../assets/tray.png');
    }
    if (!fs.existsSync(iconPath)) {
      iconPath = path.join(__dirname, '../../assets/tray.png');
    }
    return iconPath;
  }

  private createTray(): void {
    try {
      const trayIconPath = this.getTrayIconPath();

      if (fs.existsSync(trayIconPath)) {
        console.log(`Loading system tray icon from file path: ${trayIconPath}`);
        this.tray = new Tray(trayIconPath);
      } else {
        console.warn(`Tray icon not found at ${trayIconPath}, falling back to base64 buffer`);
        this.trayIcon = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_BASE64, 'base64'));
        this.tray = new Tray(this.trayIcon);
      }

      this.tray.setToolTip('截图智能暂存箱');

      const contextMenu = Menu.buildFromTemplate([
        {
          label: '显示主面板',
          click: () => {
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.setSkipTaskbar(false); // 恢复在任务栏中显示
              this.mainWindow.show();
              this.mainWindow.focus();
            } else {
              this.createMainWindow(true);
            }
          }
        },
        {
          label: '开启/关闭小浮窗',
          click: () => {
            const floatWindow = this.getFloatWindow();
            if (floatWindow) {
              this.closeFloatWindow();
            } else {
              this.createFloatWindow();
            }
          }
        },
        { type: 'separator' },
        {
          label: '退出程序',
          click: () => {
            this.isQuitting = true;
            app.quit();
          }
        }
      ]);

      this.tray.setContextMenu(contextMenu);

      // 双击托盘图标显示主窗口
      this.tray.on('double-click', () => {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.setSkipTaskbar(false); // 恢复在任务栏中显示
          this.mainWindow.show();
          this.mainWindow.focus();
        } else {
          this.createMainWindow(true);
        }
      });
    } catch (err) {
      console.error('Failed to create system tray:', err);
    }
  }

  public ensureTray(): void {
    if (!this.tray) {
      this.createTray();
    }
  }

  public createMainWindow(showInitially = true): void {
    if (this.mainWindow) {
      if (showInitially) {
        this.mainWindow.setSkipTaskbar(false);
        this.mainWindow.show();
        this.mainWindow.focus();
      }
      return;
    }

    // 首次创建主窗口时确保托盘已创建
    this.ensureTray();

    const iconPath = this.getWindowIconPath();
    this.mainWindow = new BrowserWindow({
      width: 950,
      height: 680,
      title: "截图智能暂存箱",
      show: false,
      skipTaskbar: !showInitially,
      icon: fs.existsSync(iconPath) ? iconPath : undefined,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false // 允许预加载脚本进行 require 本地文件
      }
    });

    this.mainWindow.setMenu(null);

    this.mainWindow.loadFile(this.mainHtmlPath);

    this.mainWindow.once('ready-to-show', () => {
      if (this.mainWindow && showInitially) {
        this.mainWindow.show();
      }
    });

    // 拦截关闭按钮事件，将主面板直接销毁释放内存，而不是隐藏到后台占用资源
    this.mainWindow.on('close', (e) => {
      if (!this.isQuitting) {
        e.preventDefault();
        if (this.mainWindow) {
          this.mainWindow.destroy(); // 直接销毁主窗口释放内存
        }
      }
    });

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
      // 如果不是正在退出，不要关闭悬浮窗，实现后台独立可用
      if (this.isQuitting) {
        this.closeFloatWindow();
      }
    });

    // 默认使用系统浏览器打开链接
    this.mainWindow.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url);
      return { action: 'deny' };
    });
  }

  public createFloatWindow(): void {
    if (this.floatWindow) {
      this.floatWindow.focus();
      return;
    }

    this.floatWindow = new BrowserWindow({
      width: 240,
      height: 145,
      frame: false, // 无边框
      resizable: true, // 在 Windows 上必须为 true 才能通过程序 setSize 改变大小
      alwaysOnTop: true, // 始终置顶
      transparent: true, // 背景透明
      skipTaskbar: true, // 任务栏不显示
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false // 允许 preload 进行 require 本地文件
      }
    });

    this.floatWindow.loadFile(this.floatHtmlPath);

    this.floatWindow.on('closed', () => {
      this.floatWindow = null;
      this.sendToMainWindow('window:float-state-changed', false);
    });

    // 强行设定 skipTaskbar，双重保险在普通任务栏绝不显示
    this.floatWindow.setSkipTaskbar(true);

    // 在 Windows 上将其设置为屏幕保护程序级别的顶层
    this.floatWindow.setAlwaysOnTop(true, 'screen-saver');

    // 新增：通知主窗口悬浮窗状态变更为已开启，确保 UI 状态一致
    this.sendToMainWindow('window:float-state-changed', true);
  }

  public closeFloatWindow(): void {
    if (this.floatWindow) {
      this.floatWindow.close();
      this.floatWindow = null;
    }
  }

  public sendToMainWindow(channel: string, ...args: any[]): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, ...args);
    }
  }

  public sendToFloatWindow(channel: string, ...args: any[]): void {
    if (this.floatWindow && !this.floatWindow.isDestroyed()) {
      this.floatWindow.webContents.send(channel, ...args);
    }
  }

  public getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }

  public getFloatWindow(): BrowserWindow | null {
    return this.floatWindow;
  }
}
