1. 删除冗余内存缓存：清理 ClipboardMonitor 中不必要的 lastImageBuffer、lastDiagFormats 及诊断日志写入逻辑，减少截图时的 PNG 转换与磁盘 IO。
2. 本地存储缓存优化：引入 isDirty 标记机制，避免频繁读取/扫描物理磁盘，优化后可直接使用内存缓存。
3. 悬浮窗视频懒加载：将主面板和悬浮窗中隐藏的视频标签改为 preload="metadata"，鼠标悬停时才开始加载和播放，大幅降低 Chromium 后台显存与 GPU 占用。
4. 渲染进程增量更新：图片列表展示由“每次重新渲染全部 DOM”改为“新图入库增量插入头部卡片”，消除高频截图时的内存抖动和 CPU 瓶颈。
