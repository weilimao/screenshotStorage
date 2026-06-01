import { clipboard } from 'electron';
import * as chokidar from 'chokidar';
import * as path from 'path';
import * as fs from 'fs';
import { IClipboardMonitor } from '../../shared/types';
import { ConfigManager } from '../config';

export class ClipboardMonitor implements IClipboardMonitor {
  private intervalId: NodeJS.Timeout | null = null;
  private lastImageBuffer: Buffer | null = null;
  
  private imageCapturedCallback: ((buf: Buffer) => void) | null = null;
  private fileCapturedCallback: ((filePath: string) => void) | null = null;
  
  private watcher: chokidar.FSWatcher | null = null;

  constructor(private configManager: ConfigManager) {}

  public onImageCaptured(callback: (imageBuffer: Buffer) => void): void {
    this.imageCapturedCallback = callback;
  }

  public onFileCaptured(callback: (filePath: string) => void): void {
    this.fileCapturedCallback = callback;
  }

  public start(): void {
    this.stop();

    // 1. 启动剪贴板轮询
    this.intervalId = setInterval(() => {
      this.checkClipboard();
    }, 800);

    // 2. 启动文件夹监听
    this.setupFolderWatchers();
  }

  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  // 暴露一个方法供 config 发生改变时重新配置监听文件夹
  public restartFolderWatchers(): void {
    this.setupFolderWatchers();
  }

  private checkClipboard(): void {
    try {
      const image = clipboard.readImage();
      if (image.isEmpty()) {
        return;
      }

      const pngBuffer = image.toPNG();
      
      // 比对是否与上一次图片相同
      if (this.lastImageBuffer && this.lastImageBuffer.equals(pngBuffer)) {
        return;
      }

      this.lastImageBuffer = pngBuffer;

      if (this.imageCapturedCallback) {
        this.imageCapturedCallback(pngBuffer);
      }
    } catch (err) {
      console.error('Error reading clipboard:', err);
    }
  }

  private setupFolderWatchers(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    const config = this.configManager.getConfig();
    const foldersToWatch = config.watchFolders || [];
    
    // 过滤出存在且有效的文件夹目录
    const validFolders = foldersToWatch.filter(folder => {
      try {
        return fs.existsSync(folder) && fs.statSync(folder).isDirectory();
      } catch {
        return false;
      }
    });

    if (validFolders.length === 0) {
      return;
    }

    // 初始化 chokidar
    this.watcher = chokidar.watch(validFolders, {
      ignored: /(^|[\/\\])\../, // 忽略隐藏文件
      persistent: true,
      ignoreInitial: true, // 忽略初始存在的历史文件
      awaitWriteFinish: {
        stabilityThreshold: 500, // 微信写入文件需要一段时间，等待500ms无写入才触发
        pollInterval: 100
      }
    });

    this.watcher.on('add', (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      // 只处理常见图片格式
      if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'].includes(ext)) {
        if (this.fileCapturedCallback) {
          this.fileCapturedCallback(filePath);
        }
      }
    });

    console.log(`Watching folders for screenshots: ${validFolders.join(', ')}`);
  }
}
