import { globalShortcut, screen, ipcMain, BrowserWindow } from 'electron';
import Screenshots from 'electron-screenshots';
import { ConfigManager } from '../config';
import { ScreenshotWindowDetector, DisplayInfo } from './ScreenshotWindowDetector';
import { SCREENSHOT_OVERLAY_SCRIPT } from './screenshotOverlayScript';

export class ShortcutManager {
  private currentShortcut: string = '';
  private screenshotInstances: Screenshots[] = [];
  private isCapturing: boolean = false;
  private onScreenshotCapturedCallback: ((buffer: Buffer, data?: any) => void) | null = null;
  private onScreenshotFinishedCallback: (() => void) | null = null;
  private lastCaptureTime: number = 0;

  // 智能窗口框选探测器:截图期间周期性把光标下方最顶层窗口 bounds 推给选区 view
  private windowDetector: ScreenshotWindowDetector | null = null;

  // 全局 IPC 劫持与窗口隔离 Map
  private static winToListenersMap = new Map<any, { ok: Function, cancel: Function, save: Function }>();
  private static isGlobalIpcIntercepted = false;

  constructor(private configManager: ConfigManager) {
    // 实例池与拦截器将在 triggerScreenshot 中动态按需配置
  }

  public onScreenshotCaptured(callback: (buffer: Buffer, data?: any) => void): void {
    this.onScreenshotCapturedCallback = callback;
  }

  public onScreenshotFinished(callback: () => void): void {
    this.onScreenshotFinishedCallback = callback;
  }

  /**
   * 统一处理截图保存或确认的回调（防重去重，联动关闭所有窗口，解绑快捷键）
   * @param buffer 裁剪后的图片数据
   * @param data react-screenshots 回传的 { bounds, display },display 用于 toast 跟随截图所在屏
   */
  private handleScreenshotOk(buffer: Buffer, data?: any): void {
    if (!this.isCapturing) return;
    this.isCapturing = false;
    this.unregisterEscapeShortcut();
    this.stopWindowDetector();

    console.log('[ShortcutManager] Capturing completed successfully, closing all screens');

    // 关闭所有截图窗口
    this.screenshotInstances.forEach(instance => {
      try {
        if (instance.$win && !instance.$win.isDestroyed()) {
          instance.endCapture();
        }
      } catch (err) {
        console.error('[ShortcutManager] Failed to endCapture during ok:', err);
      }
    });

    if (this.onScreenshotCapturedCallback) {
      this.onScreenshotCapturedCallback(buffer, data);
    }

    if (this.onScreenshotFinishedCallback) {
      setTimeout(() => {
        if (this.onScreenshotFinishedCallback) {
          this.onScreenshotFinishedCallback();
        }
      }, 50);
    }
  }

  /**
   * 统一处理取消截图逻辑
   */
  private handleScreenshotCancel(): void {
    if (!this.isCapturing) return;
    this.isCapturing = false;
    this.unregisterEscapeShortcut();
    this.stopWindowDetector();

    console.log('[ShortcutManager] Capturing cancelled, closing all screens');

    // 关闭所有截图窗口
    this.screenshotInstances.forEach(instance => {
      try {
        if (instance.$win && !instance.$win.isDestroyed()) {
          instance.endCapture();
        }
      } catch (err) {
        console.error('[ShortcutManager] Failed to endCapture during cancel:', err);
      }
    });

    if (this.onScreenshotFinishedCallback) {
      setTimeout(() => {
        if (this.onScreenshotFinishedCallback) {
          this.onScreenshotFinishedCallback();
        }
      }, 50);
    }
  }

  /**
   * 注册全局 Escape 快捷键用于强行取消截图
   */
  private registerEscapeShortcut(): void {
    try {
      this.unregisterEscapeShortcut(); // 先确保注销
      const success = globalShortcut.register('Escape', () => {
        console.log('[ShortcutManager] Global Escape pressed, cancelling screenshot');
        this.handleScreenshotCancel();
      });
      if (success) {
        console.log('[ShortcutManager] Global Escape shortcut registered successfully');
      } else {
        console.warn('[ShortcutManager] Failed to register global Escape shortcut');
      }
    } catch (err) {
      console.error('[ShortcutManager] Error registering global Escape shortcut:', err);
    }
  }

  /**
   * 注销全局 Escape 快捷键
   */
  private unregisterEscapeShortcut(): void {
    try {
      if (globalShortcut.isRegistered('Escape')) {
        globalShortcut.unregister('Escape');
        console.log('[ShortcutManager] Global Escape shortcut unregistered successfully');
      }
    } catch (err) {
      console.error('[ShortcutManager] Error unregistering global Escape shortcut:', err);
    }
  }

  public registerShortcut(): boolean {
    if (this.currentShortcut) {
      try {
        globalShortcut.unregister(this.currentShortcut);
      } catch (err) {
        console.error(`Failed to unregister shortcut: ${this.currentShortcut}`, err);
      }
      this.currentShortcut = '';
    }

    const config = this.configManager.getConfig();
    const shortcut = config.screenshotShortcut || 'Ctrl+Alt+S';

    try {
      const success = globalShortcut.register(shortcut, () => {
        this.triggerScreenshot();
      });
      if (success) {
        this.currentShortcut = shortcut;
        console.log(`Screenshot shortcut registered successfully: ${shortcut}`);
        return true;
      } else {
        console.error(`Failed to register screenshot shortcut: ${shortcut}`);
        if (this.currentShortcut) {
          globalShortcut.register(this.currentShortcut, () => {
            this.triggerScreenshot();
          });
        }
        return false;
      }
    } catch (err) {
      console.error(`Error registering screenshot shortcut ${shortcut}:`, err);
      if (this.currentShortcut) {
        try {
          globalShortcut.register(this.currentShortcut, () => {
            this.triggerScreenshot();
          });
        } catch {}
      }
      return false;
    }
  }

  public unregisterShortcut(): void {
    if (this.currentShortcut) {
      try {
        globalShortcut.unregister(this.currentShortcut);
      } catch (err) {
        console.error(`Failed to unregister shortcut on cleanup: ${this.currentShortcut}`, err);
      }
      this.currentShortcut = '';
    }
    // 退出时也确保注销 Escape
    this.unregisterEscapeShortcut();
  }

  /**
   * 初始化全局统一的 IPC 拦截路由与过滤器
   */
  private initGlobalIpcInterceptor(): void {
    if (ShortcutManager.isGlobalIpcIntercepted) return;
    ShortcutManager.isGlobalIpcIntercepted = true;

    ipcMain.on('SCREENSHOTS:ok', (event, buffer, data) => {
      const senderWin = BrowserWindow.fromWebContents(event.sender);
      if (!senderWin) return;

      console.log(`[ShortcutManager] Intercepted SCREENSHOTS:ok for window ${senderWin.id}`);
      
      // 路由到对应窗口绑定的原始 ok 监听器中
      for (const [win, listeners] of ShortcutManager.winToListenersMap.entries()) {
        if (win === senderWin || (win && win.id === senderWin.id)) {
          if (listeners.ok) {
            listeners.ok(event, buffer, data);
          }
          break;
        }
      }
    });

    ipcMain.on('SCREENSHOTS:cancel', (event) => {
      const senderWin = BrowserWindow.fromWebContents(event.sender);
      if (!senderWin) return;

      const now = Date.now();
      if (now - this.lastCaptureTime < 1500) {
        console.log(`[ShortcutManager] Ignored SCREENSHOTS:cancel during initialization protection period (${now - this.lastCaptureTime}ms) from window ${senderWin.id}`);
        return;
      }

      // 核心焦点过滤器：只有当前拥有焦点的窗口主动发起取消（如按右键、点红叉），我们才执行取消；
      // 若是由于失去焦点（blur）导致的被动 cancel，直接忽略。
      if (senderWin.isFocused()) {
        console.log(`[ShortcutManager] Intercepted SCREENSHOTS:cancel from active window ${senderWin.id}, performing cancel.`);
        for (const [win, listeners] of ShortcutManager.winToListenersMap.entries()) {
          if (win === senderWin || (win && win.id === senderWin.id)) {
            if (listeners.cancel) {
              listeners.cancel(event);
            }
            break;
          }
        }
      } else {
        console.log(`[ShortcutManager] Ignored SCREENSHOTS:cancel from blurred window ${senderWin.id}`);
      }
    });

    ipcMain.on('SCREENSHOTS:save', (event, buffer, data) => {
      const senderWin = BrowserWindow.fromWebContents(event.sender);
      if (!senderWin) return;

      console.log(`[ShortcutManager] Intercepted SCREENSHOTS:save for window ${senderWin.id}`);
      
      for (const [win, listeners] of ShortcutManager.winToListenersMap.entries()) {
        if (win === senderWin || (win && win.id === senderWin.id)) {
          if (listeners.save) {
            listeners.save(event, buffer, data);
          }
          break;
        }
      }
    });
  }

  public triggerScreenshot(): void {
    this.lastCaptureTime = Date.now();
    const displays = screen.getAllDisplays().map((d: any) => ({
      id: d.id,
      x: Math.floor(d.bounds.x),
      y: Math.floor(d.bounds.y),
      width: Math.floor(d.bounds.width),
      height: Math.floor(d.bounds.height),
      scaleFactor: d.scaleFactor,
    }));
    console.log(`[ShortcutManager] Triggering screenshots. Displays detected: ${displays.length}`);

    // 初始化全局 IPC 拦截路由
    this.initGlobalIpcInterceptor();

    // 如果实例池中的实例不足，则补充创建新实例
    while (this.screenshotInstances.length < displays.length) {
      const index = this.screenshotInstances.length;
      try {
        // 在创建新实例之前，记录已有的全局 IPC 监听器
        const okListenersBefore = ipcMain.listeners('SCREENSHOTS:ok');
        const cancelListenersBefore = ipcMain.listeners('SCREENSHOTS:cancel');
        const saveListenersBefore = ipcMain.listeners('SCREENSHOTS:save');
        console.log(`[ShortcutManager] ipcMain before new: ok=${okListenersBefore.length}, cancel=${cancelListenersBefore.length}, save=${saveListenersBefore.length}`);

        const screenshots = new Screenshots();

        // 此时，构造函数 listenIpc() 已执行，将新实例的监听器 push 进了监听队列末尾
        const okListenersAfter = ipcMain.listeners('SCREENSHOTS:ok');
        const cancelListenersAfter = ipcMain.listeners('SCREENSHOTS:cancel');
        const saveListenersAfter = ipcMain.listeners('SCREENSHOTS:save');

        console.log(`[ShortcutManager] ipcMain after new: ok=${okListenersAfter.length}, cancel=${cancelListenersAfter.length}, save=${saveListenersAfter.length}`);

        const newOk = okListenersAfter.find(l => !okListenersBefore.includes(l));
        const newCancel = cancelListenersAfter.find(l => !cancelListenersBefore.includes(l));
        const newSave = saveListenersAfter.find(l => !saveListenersBefore.includes(l));

        console.log(`[ShortcutManager] Found new listeners: ok=${!!newOk}, cancel=${!!newCancel}, save=${!!newSave}`);

        // 从全局 ipcMain 中移除刚被 push 进去 of 原始监听器，以防其被全局直接响应
        if (newOk) ipcMain.removeListener('SCREENSHOTS:ok', newOk as any);
        if (newCancel) ipcMain.removeListener('SCREENSHOTS:cancel', newCancel as any);
        if (newSave) ipcMain.removeListener('SCREENSHOTS:save', newSave as any);

        console.log(`[ShortcutManager] ipcMain after remove: ok=${ipcMain.listenerCount('SCREENSHOTS:ok')}, cancel=${ipcMain.listenerCount('SCREENSHOTS:cancel')}`);

        // 1. Monkey-Patch 重写 startCapture
        const managerRef = this;
        screenshots.startCapture = async function() {
          const targetDisplay = (this as any).customDisplay;
          if (!targetDisplay) {
            console.error('[ShortcutManager] No customDisplay bound to this instance');
            return;
          }
          const self = this as any;
          const [imageUrl] = await Promise.all([self.capture(targetDisplay), self.isReady]);
          await self.createWindow(targetDisplay);
          self.$view.webContents.send('SCREENSHOTS:capture', targetDisplay, imageUrl);

          // 核心修复: 在选区视图就绪并收到 capture 后,立即清除签名缓存并触发即刻探测,
          // 确保光标下方的当前窗口在截图开始瞬间即被高亮框选,无需移动鼠标
          if (managerRef.windowDetector) {
            managerRef.windowDetector.resetSignatures();
            managerRef.windowDetector.tickNow();
          }
        };

        // 2. Monkey-Patch 重写 capture
        (screenshots as any).capture = async (display: any) => {
          try {
            const { Monitor } = await import('node-screenshots');
            let point = {
              x: display.x + display.width / 2,
              y: display.y + display.height / 2,
            };
            if (process.platform === 'win32') {
              const { screen: electronScreen } = require('electron');
              point = electronScreen.dipToScreenPoint(point);
            }
            const monitor = Monitor.fromPoint(point.x, point.y);
            if (!monitor) {
              throw new Error(`Monitor.fromPoint(${point.x}, ${point.y}) returned null`);
            }
            const image = await monitor.captureImage();
            const buffer = await image.toPng(true);
            return `data:image/png;base64,${buffer.toString('base64')}`;
          } catch (err) {
            console.error('[ShortcutManager] Overridden capture failed, falling back to desktopCapturer:', err);
            const { desktopCapturer, screen: electronScreen } = require('electron');
            const sources = await desktopCapturer.getSources({
              types: ['screen'],
              thumbnailSize: {
                width: display.width * (display.scaleFactor || 1),
                height: display.height * (display.scaleFactor || 1),
              },
            });
            
            let source = sources.find((item: any) =>
              item.display_id === display.id.toString() ||
              item.id.startsWith(`screen:${display.id}:`)
            );
            
            if (!source) {
              const displaysList = electronScreen.getAllDisplays();
              const idx = displaysList.findIndex((d: any) => d.id === display.id);
              if (idx !== -1 && sources[idx]) {
                source = sources[idx];
                console.log(`[ShortcutManager] Fallback matched source by display index: ${idx}`);
              }
            }
            
            if (!source && sources.length > 0) {
              source = sources[0];
              console.log('[ShortcutManager] Fallback to first desktopCapturer source');
            }
            
            if (!source) {
              throw new Error("Can't find screen source");
            }
            
            return source.thumbnail.toDataURL();
          }
        };

        // 3. 绑定窗口创建事件，存储窗口与该实例原始监听器的映射关系
        screenshots.on('windowCreated', (win: BrowserWindow) => {
          console.log(`[ShortcutManager] Bind windowCreated mapping for window ${win.id} (index: ${index})`);
          
          try {
            win.setVisibleOnAllWorkspaces(true);
            win.setAlwaysOnTop(true, 'screen-saver');
            win.show();
            win.focus();
          } catch (err) {
            console.error('[ShortcutManager] Failed to set window properties on windowCreated:', err);
          }

          // 延迟 10ms 强行再次置顶与聚焦，确保绕过操作系统的 Foreground Lock
          setTimeout(() => {
            try {
              if (win && !win.isDestroyed()) {
                win.setAlwaysOnTop(true, 'screen-saver');
                win.show();
                win.focus();
              }
            } catch (err) {
              console.error('[ShortcutManager] Failed to set window properties in timeout:', err);
            }
          }, 10);

          // 注入智能窗口框选 overlay 脚本:在选区 view 的 DOM 就绪后注入主世界,
          // 拦截左键实现「悬停高亮 / 单击选窗口 / 1s 内再点保存」,拖拽则交还原生交互。
          // 脚本内部用 __SHOT_OVERLAY_INSTALLED__ 幂等保护,故多路径注入安全。
          try {
            const view = screenshots.$view;
            if (view && view.webContents && !view.webContents.isDestroyed()) {
              const inject = () => {
                try {
                  if (!view.webContents.isDestroyed()) {
                    view.webContents.executeJavaScript(SCREENSHOT_OVERLAY_SCRIPT, true)
                      .catch((e: any) => console.error('[ShortcutManager] overlay inject rejected:', e));
                  }
                } catch (injectErr) {
                  console.error('[ShortcutManager] overlay inject throw:', injectErr);
                }
              };
              // 立即尝试一次(若 DOM 已就绪则直接成功;未就绪会被 __SHOT_OVERLAY_INSTALLED__ 之外
              // 的执行时机拦下,但 executeJavaScript 会自动排队到导航完成,通常也能成功)
              inject();
              // dom-ready 为主路径(React 应用挂载完成,document.body 必然存在)
              view.webContents.once('dom-ready', inject);
              // did-finish-load 兜底(内部幂等保护,重复注入无副作用)
              view.webContents.once('did-finish-load', inject);
            }
          } catch (injectErr) {
            console.error('[ShortcutManager] Failed to set up overlay injection:', injectErr);
          }

          ShortcutManager.winToListenersMap.set(win, {
            ok: newOk as Function,
            cancel: newCancel as Function,
            save: newSave as Function
          });
        });

        // 4. 监听事件以联动其他窗口并触发 finished 回调。
        // electron-screenshots 在 emit('ok'/'save') 时会携带第三方参 data(含 bounds 与 display),
        // 透传给上层以让成功提示浮窗跟随实际截图所在屏。
        screenshots.on('ok', (e: any, buffer: Buffer, data?: any) => {
          console.log(`[ShortcutManager] ok triggered, index: ${index}`);
          this.handleScreenshotOk(buffer, data);
        });

        screenshots.on('save', (e: any, buffer: Buffer, data?: any) => {
          console.log(`[ShortcutManager] save triggered, index: ${index}`);
          this.handleScreenshotOk(buffer, data);
        });

        screenshots.on('cancel', () => {
          console.log(`[ShortcutManager] cancel triggered, index: ${index}`);
          this.handleScreenshotCancel();
        });

        screenshots.on('windowClosed', (win: BrowserWindow) => {
          console.log(`[ShortcutManager] windowClosed triggered, index: ${index}`);
          if (win) {
            ShortcutManager.winToListenersMap.delete(win);
          }
          // 兜底处理：若所有活跃窗口都被销毁，则确保注销全局 Escape 键
          const anyActive = this.screenshotInstances.some(inst => inst.$win && !inst.$win.isDestroyed());
          if (!anyActive) {
            this.isCapturing = false;
            this.unregisterEscapeShortcut();
          }
        });

        this.screenshotInstances.push(screenshots);
        console.log(`[ShortcutManager] Created and added screenshots instance ${index} to pool (pool size: ${this.screenshotInstances.length})`);
      } catch (err) {
        console.error(`[ShortcutManager] Failed to create screenshots instance ${index}:`, err);
      }
    }

    // 激活状态
    this.isCapturing = true;
    this.registerEscapeShortcut();

    // 启动智能窗口框选探测器:周期性把光标下方最顶层窗口 bounds 推给对应 display 的选区 view
    this.startWindowDetector(displays);

    // 让每个 display 的 screenshots 实例开始截图
    displays.forEach((display, index) => {
      const instance = this.screenshotInstances[index];
      if (instance) {
        (instance as any).customDisplay = display;
        try {
          console.log(`[ShortcutManager] Activating capture for display ${display.id} (index: ${index})`);
          instance.startCapture().then(() => {
            if (this.windowDetector) {
              this.windowDetector.resetSignatures();
              this.windowDetector.tickNow();
            }
          }).catch(err => {
            console.error(`[ShortcutManager] Failed during startCapture async on display ${display.id}:`, err);
          });
        } catch (err) {
          console.error(`[ShortcutManager] Failed to start capture on display ${display.id}:`, err);
        }
      }
    });
  }

  /**
   * 启动窗口探测器,把光标下方最顶层窗口 bounds 推送给对应选区 view。
   */
  private startWindowDetector(displays: any[]): void {
    try {
      // 探测器已在运行则先收尾
      this.stopWindowDetector();
      const displayInfos: DisplayInfo[] = displays.map((d) => ({
        id: d.id,
        x: d.x,
        y: d.y,
        width: d.width,
        height: d.height,
        scaleFactor: d.scaleFactor,
      }));
      this.windowDetector = new ScreenshotWindowDetector();
      this.windowDetector.start(displayInfos, (display) => {
        // 按 display 维度从已建实例池中找回该 display 对应的选区 BrowserView
        const idx = displayInfos.findIndex((info) => info.id === display.id);
        const inst = this.screenshotInstances[idx];
        if (inst && (inst as any).$view && !(inst as any).$view.webContents.isDestroyed()) {
          return (inst as any).$view;
        }
        try {
          // 兜底:用 screen.getDisplayNearestPoint 找光标所在实例
          const cursor = screen.getCursorScreenPoint();
          const matched = screen.getAllDisplays().find((d) => {
            const b = d.bounds;
            return cursor.x >= b.x && cursor.x < b.x + b.width && cursor.y >= b.y && cursor.y < b.y + b.height;
          });
          if (matched) {
            const fallbackIdx = displayInfos.findIndex((info) => info.id === matched.id);
            const fallbackInst = this.screenshotInstances[fallbackIdx];
            if (fallbackInst && (fallbackInst as any).$view) {
              return (fallbackInst as any).$view;
            }
          }
        } catch {
          // 忽略兜底失败
        }
        return null;
      });
    } catch (err) {
      console.error('[ShortcutManager] Failed to start window detector:', err);
    }
  }

  /**
   * 停止窗口探测器(截图结束/取消时调用)。
   */
  private stopWindowDetector(): void {
    if (this.windowDetector) {
      try {
        this.windowDetector.stop();
      } catch {
        // 忽略
      }
      this.windowDetector = null;
    }
  }
}
