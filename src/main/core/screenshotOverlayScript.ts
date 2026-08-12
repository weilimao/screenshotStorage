/**
 * 注入到 electron-screenshots 选区 view 主世界的「智能窗口框选」交互脚本。
 *
 * 设计思想(微信式 + 复用原生编辑能力):
 *   react-screenshots 本身就提供「按住左键拖拽建选区 + 编辑工具栏(箭头/马赛克/文本/
 *   撤销/保存/确认)+ 双击确认保存」的完整能力。我们不再自己造一套「选中层/遮罩/裁剪/
 *   保存」链路(那是上一版的方案,会导致工具栏永远不出现),而是:
 *     - 悬停:overlay 画跟随鼠标的蓝色描边框(pointer-events:none,纯展示)
 *     - 单击窗口(位移 < DRAG_THRESHOLD):判定为「选中该窗口」→ 由 overlay 单独向
 *       .screenshots-background 合成一次完整拖拽(pointerdown→pointermove×N→pointerup),
 *       起点终点对齐该窗口 bounds,从而驱动 react-screenshots 写入选区并弹出编辑工具栏
 *       (与手动拖拽逐像素一致,工具栏全部 13 个按钮可见可用)。
 *       合成开始前置 driving=true(屏蔽合成期间的 onMove/onUp 自我干扰)、清 hoverBounds;
 *       合成结束后置 selectionActive=true 并清 driving,随之 surrenderTimer 短暂屏蔽自动高亮。
 *       selectionActive 期间,overlay 不再拦截任何左键事件(见 onDown 守卫),改由 react-screenshots
 *       原生接管:用户可拖动选区、调整 8 个手柄、点工具栏确认/取消/撤销/绘图 —— 完全复刻微信
 *       「点窗口自动框上 → 直接可编辑」的体感,而非重入一段空选拖拽。
 *     - 任意时刻按住左键拖拽(位移 ≥ DRAG_THRESHOLD):判定为手动框选 → 进入 manualMode,
 *       隐藏悬停层,并把被 overlay 拦截的那次物理 pointerdown 以合成事件补发给原生,
 *       让 react-screenshots 从「按下点」正确建立原生拖拽 + 工具栏 + 双击确认。
 *
 *   保存链路因此完全复用原生:
 *     react-screenshots 双击/点工具栏按钮 → window.screenshots.ok/save(arrayBuffer,{bounds,display})
 *     → ShortcutManager.initGlobalIpcInterceptor 拦截 → handleScreenshotOk →
 *     onScreenshotCapturedCallback → 存盘 + 写混合剪贴板 + 推窗 + toast。
 *   (上一版的 window.screenshots.ok 自定义调用与 self-cropped buffer 已全部删除,
 *    它正是「编辑工具栏消失」的根因。)
 *
 *
 * A2 拦截修复(根治「点窗口框变小」):
 *   react-screenshots 建-select 的 onPointerDown `m` 内有短路灯卫:若内部 `s.current`
 *   已为真值,则后续 pointerdown 不会重置起点。上一版 overlay 的 `onDown` 只读不拦,
 *   物理按下会先冒泡到 .screenshots-background 把 s.current 钉在「物理点击点」,随后
 *   再合成 pointerdown(x1,y1) 时被短路,最终选区被写成 {物理点 → 窗口右下角} 的一小块。
 *   本版在 hoverBounds 存在时,由 capture 阶段 `onDown` 先 `stopImmediatePropagation`
 *   挡住物理按下,使 react-screenshots 的 s.current 在合成序列开始时为空;然后合成一次
 *   「干净」的 pointerdown→pointermove×N→pointerup,起点即窗口左上、终点即窗口右下,
 *   选区精确等于整窗。若用户随后拖拽(已切到 manualMode),则补发一次合成 pointerdown
 *   到 background,把拖拽交还给原生。
 *
 * 跨次截图残留重置:
 *   overlay 脚本只在每次触发截图时执行一次外层 IIFE(install),但 `startCapture` -
 *   触发的 'SCREENSHOTS:capture' 会重新加载/重置 react-screenshots 内部 store;若上一次
 *   截图用户切过 manualMode 但未确认/取消就再次触发截图,`manualMode` 会停在 true 导致
 *   本次自动点选完全失效。故监听 'capture' 事件,每次新截图开始时把 manualMode、
 *   hoverBounds、currentDown、selectionActive、driving 一并复位。
 *   此外订阅 'reset' 通道:electron-screenshots 在 endCapture()/createWindow() 中都会向
 *   选区 view 发送 'SCREENSHOTS:reset'(见 app.js onReset 与 Screenshots.reset())。取消截图
 *   走 endCapture→reset 路径,故据此监听可在「取消」当下即复位 overlay 全部内部状态,
 *   而非只能等到下一次 'capture' —— 这正是「取消后再触发黏在上次拖动态」回归的根治点:
 *   取消时 manualMode/selectionActive 仍残留着,而新截图注入已完成、overlay 复位只在下一次
 *   capture 才发生,造成视觉上黏附上一次 dragging 选区。现在 reset 通道与 capture 通道共用
 *   onResetState 复位函数,取消当下即清状态。
 *
 * 坐标系:与上一版一致,探测器推送的 bounds 是 display 内 dip 相对坐标(起点对齐 display
 * 物理原点 ÷ scaleFactor),1 CSS px == 1 dip。合成派发时用 e.clientX=windowLeftBound.x,
 * 视觉与 bounds 一致。
 *
 * 本文件只导出一个字符串常量,经 webContents.executeJavaScript 注入到选区 view 主世界。
 * 内部用 __SHOT_OVERLAY_INSTALLED__ 幂等保护,多路径注入安全。
 */
export const SCREENSHOT_OVERLAY_SCRIPT = `
(function () {
  if (window.__SHOT_OVERLAY_INSTALLED__) {
    return;
  }
  window.__SHOT_OVERLAY_INSTALLED__ = true;

  const DRAG_THRESHOLD = 8; // mousedown→mousemove 位移超过此值则视为手动拖拽,交还原生

  // overlay DOM:悬停蓝框层,pointer-events:none,绝不拦截 react-screenshots 事件。
  // 挂载点优先 body,页面尚未就绪时退回 documentElement。
  const mountRoot = document.body || document.documentElement;
  const hoverLayer = createFloatLayer('shot-hover-layer', mountRoot);
  hideHover();

  // 状态
  let hoverBounds = null;        // 光标下方窗口(dip),由主进程探测器推送
  let currentDown = null;        // 本次按下:{ x, y, stopped }
  let manualMode = false;        // 已切到手动框选模式,后续不再叠加自动高亮
  let selectionActive = false;   // 已完成一次自动/手工选区,此后左键全数放行给 react-screenshots
  let driving = false;           // 正在合成 pointerdown/move/up 驱动原生选区,期间屏蔽自身的 onMove/onUp
  let surrenderTimer = null;     // 驱动原生选区后短暂「放弃」自动高亮的定时器

  // 主进程推送光标下方窗口 bounds(每个 display 的 view 各收各屏的)
  window.screenshots.on('windowUnderCursor', onWindowUnderCursor);
  // 截图开始 / 内部 reset 时,复位跨次残留状态;'capture' 与 'reset' 共用 onResetState
  window.screenshots.on('capture', onResetState);
  window.screenshots.on('reset', onResetState);

  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointermove', onMove, true);
  // 不在 capture 监听 pointerup:保存行为完全交由 react-screenshots(双击确认 / 工具栏按钮)

  function onResetState() {
    // 截图开始(或 react-screenshots 内部 reset)时:清掉上一次未完成的 manualMode / 选区态,
    // 确保自动点选可用;同时清掉 selectionActive,使下次左键可被 overlay 正常拦截参与自动点选
    manualMode = false;
    selectionActive = false;
    driving = false;
    hoverBounds = null;
    currentDown = null;
    if (surrenderTimer) {
      clearTimeout(surrenderTimer);
      surrenderTimer = null;
    }
    hideHover();
  }

  function onWindowUnderCursor(bounds) {
    try {
      // 已进入「选区活跃」或手动模式或刚驱动原生选区后短暂期,不更新悬停高亮:
      // 选区活跃期间 react-screenshots 正在原生接管交互(拖选区/调手柄/点工具栏),蓝框追逐毫无意义;
      // driving 期间是 overlay 自己在合成事件,严禁高亮叠加。
      if (selectionActive || manualMode || driving || surrenderTimer) {
        hideHover();
        return;
      }
      hoverBounds = bounds;
      if (bounds) {
        showHover(bounds);
      } else {
        hideHover();
      }
    } catch (e) {
      console.error('[shotOverlay] onWindowUnderCursor error', e);
    }
  }

  function onDown(e) {
    try {
      // 只认主键(左键,button===0 与 buttons&1 双判,兼容 pointerdown 两种取值口径)
      if (e.button !== undefined && e.button !== 0) return;
      // 手动模式已完成一次框选,后续左键全数放行给原生平移/调整/工具栏交互 —— 不拦截、不记录、不补发
      if (manualMode) return;
      // 选区活跃期间:react-screenshots 已建立选区并接管交互(拖选区、8 手柄缩放、工具栏按钮、双击确认)。
      // 此时若仍由 overlay 拦截左键并 re-drive,会出现「点击选区内 → 弹出第二段可拖动选框」的 WeChat 反体感回归。
      // 故此分支直接放行,让原生 onPointerDown 按其自身规则处理(命中手柄则缩放,命中选区则平移,空地则建新选区)。
      if (selectionActive) return;
      // 正在合成驱动事件期间不接纳任何真实输入,避免自身派发被自身监听二次处理
      if (driving) return;

      // 关键(A2):若当前光标下方有可点选窗口,则在 capture 阶段拦下物理 pointerdown,
      // 阻止它冒泡到 .screenshots-background 否则 react-screenshots 的 m() 会把内部
      // s.current 钉在物理点击点,使随后合成的 pointerdown(x1,y1) 被 m() 的
      // 「s.current||」短路灯卫忽略,最终选区被画成 {物理点 → 窗口右下角} 的一小块。
      if (hoverBounds) {
        e.stopImmediatePropagation();
        // 阻止 react-screenshots 把物理按下记为指针捕获起点;仍允许其默认行为(避免影响其它监听)
        e.preventDefault();
        // 记录按下点并标记「已被拦截」,随后拖拽时需补发一次合成 pointerdown 还给原生
        currentDown = { x: e.clientX, y: e.clientY, stopped: true };
      } else {
        // 点空地:不拦,让 react-screenshots 原生建立手动拖拽;但同样记录按下点,
        // 以便用户从空地起拖时能切到 manualMode 关掉自动悬停高亮,避免蓝框追逐光标。
        currentDown = { x: e.clientX, y: e.clientY, stopped: false };
      }
    } catch (err) {
      console.error('[shotOverlay] onDown error', err);
    }
  }

  function onMove(e) {
    try {
      // driving:此时派发的合成 pointermove 来自 overlay 自身,严禁再触发切自动模式逻辑
      if (driving) return;
      // selectionActive/manualMode:已交还原生,overlay 不再介入 pointermove
      if (selectionActive || manualMode) return;
      if (!currentDown) return;
      const dx = e.clientX - currentDown.x;
      const dy = e.clientY - currentDown.y;
      if (Math.abs(dx) >= DRAG_THRESHOLD || Math.abs(dy) >= DRAG_THRESHOLD) {
        // 用户开始手动拖拽 → 切手动模式,隐藏悬停层。
        // 仅当物理 pointerdown 被我们拦下(stopped=true)时,才需补发一次合成 pointerdown
        // 到 .screenshots-background,让 react-screenshots 从「按下点」正确接管原生拖拽;
        // 若按下点在空地(stopped=false),原生 m() 已收到物理 pointerdown,无需补发。
        const down = currentDown;
        const wasStopped = down.stopped;
        enterManualMode();
        if (wasStopped) {
          handBackPhysicalDown(down);
        }
      }
    } catch (err) {
      console.error('[shotOverlay] onMove error', err);
    }
  }

  // pointerup 由 react-screenshots 自身处理;但我们需要在「单击(未拖拽)放开」时识别
  // 「选中窗口」并合成驱动原生选区。用 capture 阶段 pointerup 监听,不 preventDefault。
  document.addEventListener('pointerup', onUp, true);

  function onUp(e) {
    try {
      if (e.button !== undefined && e.button !== 0) return;
      // driving:user pointerup 不在驱动期内参与(frame 期合成 pointerup 才收尾);selectionActive/manualMode 已交还原生
      if (driving || selectionActive || manualMode || !currentDown) return;

      const dx = e.clientX - currentDown.x;
      const dy = e.clientY - currentDown.y;
      currentDown = null;
      // 位移超过阈值属于手动拖拽,已在 onMove 切入 manualMode 并补发 pointerdown,这里不再处理
      if (Math.abs(dx) >= DRAG_THRESHOLD || Math.abs(dy) >= DRAG_THRESHOLD) return;

      // === 单击(位移 < 阈值)===
      const target = hoverBounds;
      if (!target) return; // 点空地:不动,让 react-screenshots 原生无选区状态保持

      // 选中该窗口:合成驱动 react-screenshots 原生选区 + 工具栏。
      // 之后置 selectionActive,本截图后续左键全数放行给原生,实现「点选窗 → 可直接编辑」的微信体感。
      driveNativeSelection(target);
    } catch (err) {
      console.error('[shotOverlay] onUp error', err);
    }
  }

  function enterManualMode() {
    manualMode = true;
    selectionActive = true; // 手工框选一旦建立,同样视为选区活跃,后续左键交还原生
    driving = false;
    hoverBounds = null;
    currentDown = null;
    hideHover();
  }

  /**
   * 把被 overlay 拦截的那次物理 pointerdown,以合成 PointerEvent 补发给
   * .screenshots-background,使 react-screenshots 的 m() 从真实按下点建立原生拖拽。
   * 随后的物理 pointermove/up 会自然冒泡到 background(此时 overlay 已在 manualMode,
   * onMove/onUp 均因 currentDown=null 而提前返回,不再拦截),由原生完成框选与工具栏。
   * @param down 拦截时记录的按下点 { x, y, button }
   */
  function handBackPhysicalDown(down) {
    try {
      const bg = document.querySelector('.screenshots-background');
      if (!bg) {
        console.error('[shotOverlay] no .screenshots-background to hand back manual down');
        return;
      }
      const mk = (x, y) => ({
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 0,
        buttons: 1,
        clientX: x,
        clientY: y,
        pointerType: 'mouse',
        isPrimary: true,
        pointerId: 1,
        width: 1,
        height: 1,
        pressure: 0.5,
      });
      bg.dispatchEvent(new PointerEvent('pointerdown', mk(down.x, down.y)));
    } catch (err) {
      console.error('[shotOverlay] handBackPhysicalDown error', err);
    }
  }

  /**
   * 向 .screenshots-background 合成一次完整拖拽(pointerdown→pointermove×N→pointerup),
   * 起点对齐 (target.x, target.y)、终点对齐 (target.x+target.width, target.y+target.height),
   * 驱动 react-screenshots 写入选区 bounds 并弹出编辑工具栏(与手动拖拽逐像素一致)。
   * 派发成功后短暂(600ms)隐藏自动悬停高亮 + 放弃单击重入,给原生交互完全主导权。
   *
   * 关键前提:调用前必须保证 react-screenshots 内部 s.current 为空(onDown 已通过
   * stopImmediatePropagation 挡住物理 pointerdown),否则 m() 灯卫会短路,选区起点不会
   * 被设为窗口左上角。
   */
  function driveNativeSelection(target) {
    try {
      const bg = document.querySelector('.screenshots-background');
      if (!bg) {
        console.error('[shotOverlay] no .screenshots-background to drive');
        return;
      }
      const x1 = Math.round(target.x);
      const y1 = Math.round(target.y);
      const x2 = Math.round(target.x + target.width);
      const y2 = Math.round(target.y + target.height);

      const mk = (x, y) => ({
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 0,
        buttons: 1,
        clientX: x,
        clientY: y,
        pointerType: 'mouse',
        isPrimary: true,
        pointerId: 1,
        width: 1,
        height: 1,
        pressure: 0.5,
      });

      // 合成驱动期内置 driving=true,屏蔽自身 onMove/onUp 的二次介入:
      // 这批派发到 window/bg 的合成 pointermove/pointerup 会冒泡回 document,被本 overlay
      // 的 capture 监听捕获;若无 driving 守卫,onMove 会因 currentDown 残留而误判为「手动拖拽」。
      driving = true;
      // 同步清空 hoverBounds:驱动完成后 selectionActive 会长期置位,若 hoverBounds 仍非空,
      // 不仅视觉上出现陈旧蓝框,更会让 onDown 早退条件失真 —— selectionActive 守卫虽已兜底,
      // 但清理 hoverBounds 仍是消除任何「陈旧窗口仍可点选」假象的稳妥做法(回归一根因之一)。
      hoverBounds = null;

      bg.dispatchEvent(new PointerEvent('pointerdown', mk(x1, y1)));
      const steps = 20;
      for (let i = 1; i <= steps; i++) {
        const x = x1 + (x2 - x1) * i / steps;
        const y = y1 + (y2 - y1) * i / steps;
        window.dispatchEvent(new PointerEvent('pointermove', mk(x, y)));
      }
      window.dispatchEvent(new PointerEvent('pointerup', mk(x2, y2)));

      driving = false;
      // 立即隐藏自动悬停层(原生选区有自己的蓝框 + 遮罩,视觉一致)
      hideHover();
      // 选区已建立:后续左键全数放行给 react-screenshots(拖选区/调手柄/点工具栏/双击确认),
      // 直至下一次 onResetState(capture 或 reset 通道)清除 selectionActive。此即「微信式」体感:
      // 点一下窗口自动框上 → 随即就绪可编辑,而不是再点一下又弹出一段空选拖拽框。
      selectionActive = true;
      currentDown = null;
      // 短暂「放弃」自动高亮(此处 selectionActive 已接管长期屏蔽,surrenderTimer 为冗余兜底,
      // 双保险确保 react-screenshots 完成渲染前的 Render 帧 hover 层不闪现)
      if (surrenderTimer) clearTimeout(surrenderTimer);
      surrenderTimer = setTimeout(function () {
        surrenderTimer = null;
      }, 600);
    } catch (err) {
      // 异常路径务必复位 driving,否则一次抛错会把整个本次截图永久锁死在「驱动中」
      driving = false;
      console.error('[shotOverlay] driveNativeSelection error', err);
    }
  }

  // ===== overlay DOM helpers =====

  function createFloatLayer(id, root) {
    let el = document.getElementById(id);
    if (el) return el;
    el = document.createElement('div');
    el.id = id;
    el.style.position = 'fixed';
    el.style.left = '0';
    el.style.top = '0';
    el.style.width = '0';
    el.style.height = '0';
    el.style.zIndex = '2147483646';
    el.style.pointerEvents = 'none';
    el.style.display = 'none';
    (root || document.body || document.documentElement).appendChild(el);
    return el;
  }

  function showHover(b) {
    hoverLayer.style.left = b.x + 'px';
    hoverLayer.style.top = b.y + 'px';
    hoverLayer.style.width = b.width + 'px';
    hoverLayer.style.height = b.height + 'px';
    hoverLayer.style.border = '2px solid #2ec1ff';
    hoverLayer.style.boxShadow = '0 0 0 1px rgba(46,193,255,0.4), 0 0 14px rgba(46,193,255,0.35)';
    hoverLayer.style.background = 'rgba(46,193,255,0.08)';
    hoverLayer.style.display = 'block';
  }

  function hideHover() {
    hoverLayer.style.display = 'none';
  }
})();
`;
