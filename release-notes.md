1. 修复静默自启无托盘图标：解耦系统托盘与主窗口初始化，解决在静默启动时后台运行但无托盘图标、无法交互的严重 Bug。
2. 优化 macOS 开机自启：区分平台配置 setLoginItemSettings 策略。针对 macOS 平台去除 path 和 args 环境变量设置，避免 macOS 错误唤起 Unix 底层二进制文件，全面提升 macOS 端自启稳定性。
