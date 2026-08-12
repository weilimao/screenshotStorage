import { screen, BrowserView } from 'electron';

/**
 * 截图时智能识别「光标下方最顶层窗口」并节流推送给选区 view 的探测器。
 *
 * 设计动机:electron-screenshots 默认仅支持「按住左键拖拽框选任意区域」,
 * 无法像微信那样「鼠标点一下窗口就自动框上整个窗口内容」。本探测器周期性枚举
 * 系统所有窗口,找到光标下方最顶层、未被最小化且非截图窗自身的窗口,按 display
 * 的 scaleFactor 将物理像素换算为 dip,推送给对应屏幕的选区 view,由注入脚本绘制
 * 跟随高亮蓝框。
 *
 * 坐标系约定(混合 DPI 多屏的关键):
 *  - node-screenshots Window.x()/y()/width()/height() 返回 OS 虚拟桌面物理像素坐标。
 *  - Electron display.bounds 用虚拟桌面 dip 坐标表示。
 *  - 直接 `origin * sf` 推算某 display 的物理原点在「跨屏共享边界」时会错(左屏 sf=1、
 *    右屏 sf=1.75 时右屏物理 X 原点等于左屏右沿,而非 dip 原点 × 1.75)。
 *  - 稳健做法:对 display **中心点**调用 `screen.dipToScreenPoint`,因中心点必落在该
 *    display 内部,Electron 必然用该 display 自身的 sf 换算,由此反推 display 物理矩形。
 *  - 光标命中判定在 dip 空间完成(Electron 原生),避免物理坐标转换误差。
 *  - 选区 view 内部坐标系起点对齐 display 物理原点,dip 表示,故最终把窗口物理矩形
 *    减去 display 物理原点再除以 sf 得到 view 内 dip 相对坐标。
 */
export class ScreenshotWindowDetector {
  private timer: NodeJS.Timeout | null = null;
  private targets: Array<{
    view: BrowserView;
    display: DisplayInfo;
    phys: { x: number; y: number; width: number; height: number };
  }> = [];
  /** 每个 display 上一次推送的 bounds 签名,边界不变则跳过,避免无效 IPC */
  private lastSignature: Map<number, string> = new Map();

  /**
   * 启动周期性探测。
   * @param displays 所有参与截图的 display 列表(来自 electron screen.getAllDisplays)
   * @param viewOfDisplay 从 display 取对应选区 BrowserView 的函数
   */
  public start(
    displays: DisplayInfo[],
    viewOfDisplay: (display: DisplayInfo) => BrowserView | null
  ): void {
    this.stop();
    this.lastSignature.clear();

    this.targets = [];
    displays.forEach((display) => {
      const view = viewOfDisplay(display);
      if (view && !view.webContents.isDestroyed()) {
        const phys = this.computeDisplayPhysicalBounds(display);
        this.targets.push({ view, display, phys });
        // 进入截图前先清一次高亮,防止上一次残留
        this.sendBounds(view, display, null);
      }
    });

    this.timer = setInterval(() => this.tick(), 50);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.targets = [];
    this.lastSignature.clear();
  }

  /**
   * 利用 display 中心点反推其物理像素矩形(稳健的混合 DPI 换算)。
   * 若 `screen.dipToScreenPoint` 不可用(旧版 Electron),退化为按原点 × sf 的简易算法
   * (单屏或等比多屏仍正确,混合 DPI 多屏会有偏差但不阻塞)。
   */
  private computeDisplayPhysicalBounds(display: DisplayInfo): { x: number; y: number; width: number; height: number } {
    const sf = display.scaleFactor || 1;
    const physW = display.width * sf;
    const physH = display.height * sf;

    const centerDip = {
      x: display.x + display.width / 2,
      y: display.y + display.height / 2,
    };
    try {
      const centerPhys = screen.dipToScreenPoint(centerDip);
      return {
        x: centerPhys.x - physW / 2,
        y: centerPhys.y - physH / 2,
        width: physW,
        height: physH,
      };
    } catch {
      return { x: display.x * sf, y: display.y * sf, width: physW, height: physH };
    }
  }

  private tick(): void {
    if (this.targets.length === 0) return;

    let cursorDip: { x: number; y: number };
    try {
      cursorDip = screen.getCursorScreenPoint();
    } catch (err) {
      console.error('[ScreenshotWindowDetector] getCursorScreenPoint failed:', err);
      return;
    }

    // 仅光标所在 display 推送窗口 bounds,其余 display 推 null(鼠标移出该屏应清高亮)
    const activeTarget = this.findTargetContainingDip(cursorDip);
    const activeBounds = activeTarget ? this.detectTopWindowAt(cursorDip, activeTarget) : null;

    this.targets.forEach(({ view, display }) => {
      if (activeTarget && display.id === activeTarget.display.id) {
        this.sendBounds(view, display, activeBounds);
      } else {
        this.sendBounds(view, display, null);
      }
    });
  }

  /** 找到包含光标(全局 dip)的 display(Electron display 区间用 dip 表示,无歧义)。 */
  private findTargetContainingDip(point: { x: number; y: number }): typeof this.targets[number] | null {
    for (const target of this.targets) {
      const { display } = target;
      const inX = point.x >= display.x && point.x < display.x + display.width;
      const inY = point.y >= display.y && point.y < display.y + display.height;
      if (inX && inY) return target;
    }
    return null;
  }

  /**
   * 枚举系统所有窗口,筛选出位于目标 display 上、未最小化、非截图窗及本应用自身、
   * 且物理矩形与 display 物理矩形有重叠且包含光标(物理坐标)的最顶层(z 最大)窗口,
   * 返回其在选区 view 内的 dip 相对坐标。
   */
  private detectTopWindowAt(cursorDip: { x: number; y: number }, target: { display: DisplayInfo; phys: { x: number; y: number; width: number; height: number } }): BoundsInUI | null {
    let WindowNS: any;
    try {
      WindowNS = require('node-screenshots').Window;
    } catch (err) {
      console.error('[ScreenshotWindowDetector] require node-screenshots.Window failed:', err);
      return null;
    }

    let allWindows: any[];
    try {
      allWindows = WindowNS.all();
    } catch {
      return null;
    }
    if (!Array.isArray(allWindows) || allWindows.length === 0) return null;

    const sf = target.display.scaleFactor || 1;
    const phys = target.phys;

    // 光标落在该 display 物理矩形内的物理坐标(与 Window 坐标同系)
    let cx = (cursorDip.x - target.display.x) * sf + phys.x;
    let cy = (cursorDip.y - target.display.y) * sf + phys.y;

    let best: any = null;
    let bestZ = -Infinity;
    let bestArea = Infinity; // z 相同时,面积更小者更可能是「最顶层可交互窗口」(容器 vs 被包含子窗)
    let focused: any = null; // 候选中拥有焦点者:若存在则直接定为目标,消除高 z 幻影窗干扰

    for (const win of allWindows) {
      try {
        if (typeof win.isMinimized === 'function' && win.isMinimized()) continue;
        // 排除截图窗自身(electron-screenshots 创建的窗口 title 固定为 'screenshots')
        const title = (typeof win.title === 'function' ? win.title() : '') || '';
        if (title === 'screenshots') continue;
        // 排除本应用自身所有窗口(主面板/浮窗均与本进程同 pid)
        const pid = typeof win.pid === 'function' ? win.pid() : 0;
        if (pid && pid === process.pid) continue;

        const wx = win.x();
        const wy = win.y();
        const ww = win.width();
        const wh = win.height();
        if (ww <= 0 || wh <= 0) continue;

        // 光标物理坐标必须落在窗口物理矩形内
        const insideWindow = cx >= wx && cx < wx + ww && cy >= wy && cy < wy + wh;
        if (!insideWindow) continue;

        // 窗口必须与目标 display 物理矩形有重叠(过滤跨屏但实属其他 display 的窗口)
        const overlapX = Math.min(wx + ww, phys.x + phys.width) - Math.max(wx, phys.x);
        const overlapY = Math.min(wy + wh, phys.y + phys.height) - Math.max(wy, phys.y);
        if (overlapX <= 0 || overlapY <= 0) continue;

        // 拥有焦点的候选(若存在)即为用户实际活动窗口,优先定为目标,避免被高 z 的隐身/
        // 工具提示类幻影窗口抢位。截图窗自身已按 title 剔除,故此命中必为真实目标。
        try {
          if (typeof win.isFocused === 'function' && win.isFocused()) {
            focused = win;
          }
        } catch {
          // isFocused 查询失败忽略,不影响后续 z 比较
        }

        let z = 0;
        try {
          z = typeof win.z === 'function' ? win.z() : 0;
        } catch {
          z = 0;
        }
        const area = ww * wh;
        // z 严格更高者胜;z 相同时取面积更小者(顶层可交互子窗通常小于其容器)
        if (z > bestZ || (z === bestZ && area < bestArea)) {
          bestZ = z;
          bestArea = area;
          best = win;
        }
      } catch {
        // 单个窗口枚举失败跳过,不影响整体
      }
    }

    // 拥有焦点的候选优先(若存在),它在语义上就是用户当前活动窗口
    if (focused) best = focused;

    if (!best) return null;

    const physX = best.x();
    const physY = best.y();
    const physW = best.width();
    const physH = best.height();

    // 用该窗口自身所在 display 的 scaleFactor 换算(B4),消除混合 DPI 跨屏边界 off-by-one。
    // 每窗 currentMonitor() 必落在某 display 内,scaleFactor 取其值;查询失败则退回 target sf。
    let winSf = sf;
    try {
      const mon = typeof best.currentMonitor === 'function' ? best.currentMonitor() : null;
      if (mon && typeof mon.scaleFactor === 'function') {
        winSf = mon.scaleFactor() || sf;
      }
    } catch {
      winSf = sf;
    }

    // 物理像素 → view 内 dip 相对坐标(view 起点对齐 display 物理原点)
    const uiX = Math.round((physX - phys.x) / winSf);
    const uiY = Math.round((physY - phys.y) / winSf);
    const uiW = Math.round(physW / winSf);
    const uiH = Math.round(physH / winSf);

    // 裁剪到 display dip 可见范围内,防止窗口跨屏导致越界
    const clampedX = Math.max(0, uiX);
    const clampedY = Math.max(0, uiY);
    const clampedRight = Math.min(target.display.width, uiX + uiW);
    const clampedBottom = Math.min(target.display.height, uiY + uiH);
    const clampedW = clampedRight - clampedX;
    const clampedH = clampedBottom - clampedY;

    if (clampedW <= 0 || clampedH <= 0) return null;

    return { x: clampedX, y: clampedY, width: clampedW, height: clampedH };
  }

  /** 向指定 view 的 webContents 推送 bounds(null 表示清除高亮),带去重。 */
  private sendBounds(view: BrowserView, display: DisplayInfo, bounds: BoundsInUI | null): void {
    try {
      if (view.webContents.isDestroyed()) return;
      const signature = bounds
        ? `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`
        : 'null';
      const last = this.lastSignature.get(display.id);
      if (last === signature) return;
      this.lastSignature.set(display.id, signature);
      view.webContents.send('SCREENSHOTS:windowUnderCursor', bounds);
    } catch {
      // webContents 可能已销毁,吞掉
    }
  }
}

export interface DisplayInfo {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}

export interface BoundsInUI {
  x: number;
  y: number;
  width: number;
  height: number;
}
