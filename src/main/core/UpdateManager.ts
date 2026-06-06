import { app, dialog, shell } from 'electron';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { IUpdateManager } from '../../shared/types';
import { WindowManager } from './WindowManager';

function cleanVersion(ver: string): string {
  return ver.trim().replace(/^v/i, '');
}

function isNewerVersion(current: string, latest: string): boolean {
  try {
    const parse = (v: string) => v.split('.').map(Number);
    const [cMajor, cMinor, cPatch] = parse(cleanVersion(current));
    const [lMajor, lMinor, lPatch] = parse(cleanVersion(latest));
    
    if (lMajor > cMajor) return true;
    if (lMajor < cMajor) return false;
    
    if (lMinor > cMinor) return true;
    if (lMinor < cMinor) return false;
    
    return lPatch > cPatch;
  } catch (err) {
    console.error('Failed to parse version strings:', err);
    return false;
  }
}

function fetchLatestRelease(): Promise<any> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: '/repos/weilimao/screenshotStorage/releases/latest',
      headers: {
        'User-Agent': 'ScreenshotStorage-Updater'
      },
      timeout: 6000
    };

    https.get(options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`GitHub API returned status code ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// 自动匹配当前平台及架构的二进制安装包
function findPlatformAsset(assets: any[]): any {
  if (!assets || !Array.isArray(assets)) return null;
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'win32') {
    // Windows: 寻找 .exe 结尾但排除 .blockmap 的文件
    return assets.find(asset => {
      const name = asset.name.toLowerCase();
      return name.endsWith('.exe') && !name.endsWith('.blockmap');
    });
  } else if (platform === 'darwin') {
    // macOS: 优先寻找带有当前架构的 .dmg，其次是通用 .dmg，然后是 .zip
    const dmgAsset = assets.find(asset => {
      const name = asset.name.toLowerCase();
      return name.endsWith('.dmg') && name.includes(arch);
    }) || assets.find(asset => asset.name.toLowerCase().endsWith('.dmg'));

    if (dmgAsset) return dmgAsset;

    return assets.find(asset => {
      const name = asset.name.toLowerCase();
      return name.endsWith('.zip') && name.includes(arch);
    }) || assets.find(asset => asset.name.toLowerCase().endsWith('.zip'));
  }
  return null;
}

// 支持重定向的 HTTPS 下载器
function downloadFileWithProgress(
  url: string,
  destPath: string,
  onProgress: (percent: number, downloaded: number, total: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': 'ScreenshotStorage-Updater-Downloader'
    };

    https.get(url, { headers }, (res) => {
      // 处理 301/302 重定向
      if (res.statusCode === 301 || res.statusCode === 302) {
        if (res.headers.location) {
          downloadFileWithProgress(res.headers.location, destPath, onProgress)
            .then(resolve)
            .catch(reject);
        } else {
          reject(new Error(`Redirect status ${res.statusCode} without location header.`));
        }
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download file. Status code: ${res.statusCode}`));
        return;
      }

      const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      let downloadedBytes = 0;
      const fileStream = fs.createWriteStream(destPath);

      res.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        fileStream.write(chunk);

        if (totalBytes > 0) {
          const percent = Math.round((downloadedBytes / totalBytes) * 100);
          onProgress(percent, downloadedBytes, totalBytes);
        }
      });

      res.on('end', () => {
        fileStream.end();
        resolve();
      });

      res.on('error', (err) => {
        fileStream.destroy();
        fs.unlink(destPath, () => {});
        reject(err);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

export class UpdateManager implements IUpdateManager {
  private isDownloading = false;

  constructor(private windowManager: WindowManager) {}

  public getAppVersion(): string {
    return app.getVersion();
  }

  public async checkForUpdates(manual: boolean): Promise<boolean> {
    try {
      const currentVersion = this.getAppVersion();
      const release = await fetchLatestRelease();
      const latestVersion = release.tag_name; // 例如 "v1.0.2"
      const downloadUrl = release.html_url; 
      const releaseNotes = release.body || '无更新日志';

      if (isNewerVersion(currentVersion, latestVersion)) {
        // 发现新版本！唤起/展示主窗口，并在前端弹出自定义的毛玻璃更新弹窗
        let mainWindow = this.windowManager.getMainWindow();
        if (!mainWindow || mainWindow.isDestroyed()) {
          this.windowManager.createMainWindow(true);
          mainWindow = this.windowManager.getMainWindow();
        }

        if (mainWindow) {
          if (mainWindow.isMinimized()) {
            mainWindow.restore();
          }
          mainWindow.show();
          mainWindow.focus();

          // 向渲染进程推送发现新版本的事件和数据
          mainWindow.webContents.send('app:update-available', {
            currentVersion,
            latestVersion,
            releaseNotes,
            downloadUrl,
            assets: release.assets
          });
        }
        return true;
      } else {
        return false;
      }
    } catch (err: any) {
      console.error('Failed to check for updates:', err);
      throw err;
    }
  }

  // 开始在应用内下载安装包
  public async startDownload(assets: any[]): Promise<boolean> {
    if (this.isDownloading) {
      console.warn('Download is already in progress.');
      return false;
    }

    const asset = findPlatformAsset(assets);
    if (!asset) {
      console.error('No matching installer asset found for the current platform.');
      return false;
    }

    this.isDownloading = true;
    const destPath = path.join(app.getPath('temp'), asset.name);
    console.log(`Starting in-app download. URL: ${asset.browser_download_url}, Dest: ${destPath}`);

    try {
      await downloadFileWithProgress(
        asset.browser_download_url,
        destPath,
        (percent, downloaded, total) => {
          this.windowManager.sendToMainWindow('app:download-progress', {
            percent,
            downloaded,
            total
          });
        }
      );

      this.isDownloading = false;
      // 下载完成，推送文件路径给前端
      this.windowManager.sendToMainWindow('app:download-complete', destPath);
      return true;
    } catch (err) {
      this.isDownloading = false;
      console.error('Failed to download update file:', err);
      return false;
    }
  }

  // 立即重启以执行覆盖安装
  public installUpdate(filePath: string): void {
    try {
      if (!fs.existsSync(filePath)) {
        console.error(`Installer file not found at: ${filePath}`);
        return;
      }

      console.log(`Installing update and quitting. File: ${filePath}`);
      const platform = process.platform;

      if (platform === 'win32') {
        // Windows: 后台静默执行 NSIS 安装包，传入 /S 参数
        const child = spawn(filePath, ['/S'], {
          detached: true,
          stdio: 'ignore'
        });
        child.unref();
        
        // 延时关闭主程序以避开文件锁定冲突，让安装程序顺利覆盖
        setTimeout(() => {
          app.quit();
        }, 500);
      } else {
        // macOS / Linux: 调用系统默认方式打开安装包挂载/解压，并退出当前程序
        shell.openPath(filePath).then(() => {
          setTimeout(() => {
            app.quit();
          }, 500);
        });
      }
    } catch (err) {
      console.error('Failed to run installer and restart:', err);
    }
  }
}
