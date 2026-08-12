@echo off
setlocal enabledelayedexpansion

title 截图智能暂存箱 - Windows 一键打包构建
cd /d "%~dp0"

echo ===================================================
echo        截图智能暂存箱 - Windows 一键打包工具
echo ===================================================
echo.

:: 1. 检查 Node.js 与 npm 环境
echo [1/4] 正在检查构建环境...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js ^(https://nodejs.org/^) 并配置系统环境变量！
    goto FAILED
)

where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 npm 命令，请检查 Node.js 安装完整性！
    goto FAILED
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
for /f "tokens=*" %%i in ('npm -v') do set NPM_VER=%%i
echo   - Node.js 版本: %NODE_VER%
echo   - npm 版本:     %NPM_VER%
echo.

:: 2. 检查依赖
echo [2/4] 正在检查项目依赖...
if not exist "node_modules\" (
    echo   - 检测到未安装依赖，正在自动执行 npm install ...
    call npm install
    if %errorlevel% neq 0 (
        echo [错误] 依赖安装失败，请检查网络或 npm 源设置！
        goto FAILED
    )
) else (
    echo   - 项目依赖 ^(node_modules^) 已就绪。
)
echo.

:: 3. 编译 TypeScript
echo [3/4] 正在编译 TypeScript 源码 (npm run build)...
call npm run build
if %errorlevel% neq 0 (
    echo [错误] TypeScript 源码编译失败，请检查上方代码报错！
    goto FAILED
)
echo   - TypeScript 编译成功！
echo.

:: 4. 打包 Windows 应用程序
echo [4/4] 正在打包 Windows 应用程序与安装包 (electron-builder --win)...
call npx electron-builder --win
if %errorlevel% neq 0 (
    echo [错误] Electron 构建打包失败，请检查上方构建日志！
    goto FAILED
)
echo.

:: 构建成功提示
echo ===================================================
echo                 构建打包成功完成！
echo ===================================================
echo.
echo 构建产物输出目录:
echo   %~dp0dist-package\
echo.
echo 生成的产物包括:
echo   1. 安装包 (Setup exe):   dist-package\screenshot-storage-*-win-x64.exe
echo   2. 免安装运行程序:       dist-package\win-unpacked\截图智能暂存箱.exe
echo   3. 绿色免安装压缩包:     dist-package\screenshot-storage-*-win-x64.zip
echo.
echo ---------------------------------------------------
set /p OPEN_DIR="是否立即打开产物输出目录？(Y/N, 默认Y): "
if "!OPEN_DIR!"=="" set OPEN_DIR=Y
if /i "!OPEN_DIR!"=="Y" (
    explorer "%~dp0dist-package"
)
goto END

:FAILED
echo.
echo ===================================================
echo                    构建失败！
echo ===================================================
echo 请根据上方错误提示排查问题后重试。
pause
exit /b 1

:END
echo.
echo 构建结束，按任意键退出...
pause >nul
exit /b 0
