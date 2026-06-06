import { app, dialog, shell } from 'electron';
import * as https from 'https';
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

export class UpdateManager implements IUpdateManager {
  constructor(private windowManager: WindowManager) {}

  public getAppVersion(): string {
    return app.getVersion();
  }

  public async checkForUpdates(manual: boolean): Promise<boolean> {
    try {
      const currentVersion = this.getAppVersion();
      const release = await fetchLatestRelease();
      const latestVersion = release.tag_name; // 例如 "v1.0.2"
      const downloadUrl = release.html_url; // 例如 GitHub 网页链接
      const releaseNotes = release.body || '无更新日志';

      if (isNewerVersion(currentVersion, latestVersion)) {
        // 发现新版本！
        const parentWindow = this.windowManager.getMainWindow();
        const dialogOpts = {
          type: 'info' as const,
          title: '发现新版本',
          message: `检测到新版本 ${latestVersion} 可用！`,
          detail: `当前版本: v${currentVersion}\n最新版本: ${latestVersion}\n\n更新日志:\n${releaseNotes}\n\n是否立即前往 GitHub 下载更新？`,
          buttons: ['立即前往更新', '暂不更新'],
          defaultId: 0,
          cancelId: 1,
          noLink: true
        };

        const { response } = await (parentWindow && !parentWindow.isDestroyed()
          ? dialog.showMessageBox(parentWindow, dialogOpts)
          : dialog.showMessageBox(dialogOpts));

        if (response === 0) {
          await shell.openExternal(downloadUrl);
        }
        return true;
      } else {
        if (manual) {
          // 手动检查时发现已是最新版本
          const parentWindow = this.windowManager.getMainWindow();
          const dialogOpts = {
            type: 'info' as const,
            title: '检查更新',
            message: '当前已是最新版本',
            detail: `当前版本: v${currentVersion}\n最新版本: ${latestVersion}\n\n无需更新，感谢您的使用！`,
            buttons: ['确定'],
            defaultId: 0
          };
          if (parentWindow && !parentWindow.isDestroyed()) {
            await dialog.showMessageBox(parentWindow, dialogOpts);
          } else {
            await dialog.showMessageBox(dialogOpts);
          }
        }
        return false;
      }
    } catch (err: any) {
      console.error('Failed to check for updates:', err);
      if (manual) {
        // 手动检查失败，弹出对话框提示
        const parentWindow = this.windowManager.getMainWindow();
        const dialogOpts = {
          type: 'error' as const,
          title: '检查更新失败',
          message: '无法获取更新信息',
          detail: `错误详情: ${err.message || err}\n请确认网络已连接，或稍后再试。`,
          buttons: ['确定'],
          defaultId: 0
        };
        if (parentWindow && !parentWindow.isDestroyed()) {
          await dialog.showMessageBox(parentWindow, dialogOpts);
        } else {
          await dialog.showMessageBox(dialogOpts);
        }
      }
      return false;
    }
  }
}
