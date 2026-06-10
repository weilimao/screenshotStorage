import { clipboard } from 'electron';
import * as chokidar from 'chokidar';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { IClipboardMonitor } from '../../shared/types';
import { ConfigManager } from '../config';

export class ClipboardMonitor implements IClipboardMonitor {
  private intervalId: NodeJS.Timeout | null = null;
  private lastImageBuffer: Buffer | null = null;
  private lastFilePaths: string = '';
  private lastDiagFormats: string = '';
  private storageDir: string = '';
  
  private imageCapturedCallback: ((buf: Buffer) => void) | null = null;
  private fileCapturedCallback: ((filePath: string) => void) | null = null;
  
  private watcher: chokidar.FSWatcher | null = null;

  constructor(private configManager: ConfigManager) {}

  public setStorageDir(dir: string): void {
    try {
      this.storageDir = path.resolve(dir);
    } catch (err) {
      console.error('Failed to resolve storage directory path in ClipboardMonitor:', err);
    }
  }

  private filterStorageDirPaths(paths: string[]): string[] {
    if (!this.storageDir || paths.length === 0) {
      return paths;
    }
    return paths.filter(p => {
      try {
        let absPath = path.resolve(p);
        let compareDir = this.storageDir;
        if (process.platform === 'win32') {
          absPath = absPath.toLowerCase();
          compareDir = compareDir.toLowerCase();
        }
        return !absPath.startsWith(compareDir);
      } catch {
        return true;
      }
    });
  }

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

  private handleClipboardFiles(filePaths: string[]): void {
    for (const filePath of filePaths) {
      if (!fs.existsSync(filePath)) continue;

      const ext = path.extname(filePath).toLowerCase();
      // 支持图片以及视频格式
      const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'].includes(ext);
      const isVideo = ['.mp4', '.mov', '.avi', '.mkv', '.flv', '.wmv'].includes(ext);

      if (isImage || isVideo) {
        if (this.fileCapturedCallback) {
          this.fileCapturedCallback(filePath);
        }

        if (isVideo) {
          // 当在后台捕获到用户在微信等应用中复制了视频文件时，自动将系统剪贴板内容简化重写为纯文本绝对路径。
          // 这样能避开 IDE 等编辑器对 file-paths/text/uri-list 视频格式的拦截，从而保证能正常粘贴路径文本。
          try {
            setTimeout(() => {
              clipboard.writeText(filePath);
            }, 100);
          } catch (err) {
            console.error('Failed to rewrite video path to clipboard:', err);
          }
        }
      }
    }
  }

  public clearCache(): void {
    this.lastImageBuffer = null;
    this.lastFilePaths = '';
  }

  public setLastFilePaths(paths: string): void {
    this.lastFilePaths = paths;
  }

  private getFilePathsFromClipboard(formats: string[]): string[] {
    try {
      // 快速判断 formats 中是否包含文件相关格式，若没有则直接返回空，避免任何进程开销
      const hasFileFormat = formats.some(f => {
        const lf = f.toLowerCase();
        return lf === 'filenamew' || lf === 'filename' || lf === 'file-paths' || lf === 'text/uri-list';
      });

      if (!hasFileFormat) {
        return [];
      }

      // 1. Windows 平台特化提取：通过 PowerShell 解决延迟渲染与原生文件路径的 100% 捕获
      if (process.platform === 'win32') {
        try {
          const cmd = `powershell -NoProfile -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; (Get-Clipboard -Format FileDropList).FullName"`;
          const stdout = require('child_process').execSync(cmd, { encoding: 'utf8', timeout: 1500 });
          if (stdout) {
            const paths = stdout.split('\n')
              .map((p: string) => p.trim())
              .filter((p: string) => p !== '' && fs.existsSync(p));
            if (paths.length > 0) return paths;
          }
        } catch (err) {
          console.error('Failed to get clipboard files via powershell:', err);
        }
      }

      // 2. FileNameW (跨平台或 Windows PowerShell 异常降级 fallback)
      const fileNameWFormat = formats.find(f => f.toLowerCase() === 'filenamew');
      if (fileNameWFormat) {
        const buffer = clipboard.readBuffer(fileNameWFormat);
        if (buffer && buffer.length > 0) {
          const str = buffer.toString('utf16le');
          // Windows CF_HDROP (FileNameW) 缓冲区头部有 DROPFILES 结构体（20字节），但 split '\0' 后能过滤出部分有效路径，降级容错
          const paths = str.split('\0').filter(p => p.trim() !== '' && fs.existsSync(p));
          if (paths.length > 0) return paths;
        }
      }
      
      // 3. file-paths (Electron 提供的备用格式)
      if (formats.includes('file-paths')) {
        try {
          const pathsStr = clipboard.read('file-paths');
          if (pathsStr) {
            const paths = JSON.parse(pathsStr);
            if (Array.isArray(paths) && paths.length > 0) {
              const validPaths = paths.filter(p => fs.existsSync(p));
              if (validPaths.length > 0) return validPaths;
            }
          }
        } catch {}
      }

      // 4. text/uri-list (URI 协议列表，需解码)
      if (formats.includes('text/uri-list')) {
        const uriList = clipboard.read('text/uri-list');
        if (uriList) {
          const paths = uriList.split('\n')
            .map(line => line.trim())
            .filter(line => line.startsWith('file://'))
            .map(line => {
              try { return fileURLToPath(line); } catch { return ''; }
            })
            .filter(p => p !== '' && fs.existsSync(p));
          if (paths.length > 0) return paths;
        }
      }

      // 5. text/plain (如果纯文本是一条合法的本地存在文件路径)
      const plainText = clipboard.readText();
      if (plainText) {
        const lines = plainText.split('\n')
          .map(line => line.trim())
          .filter(line => {
            try {
              return fs.existsSync(line) && fs.statSync(line).isFile();
            } catch { return false; }
          });
        if (lines.length > 0) return lines;
      }
    } catch (err) {
      console.error('Failed to parse file paths from clipboard:', err);
    }
    return [];
  }

  private checkClipboard(): void {
    try {
      const formats = clipboard.availableFormats();
      const formatsStr = formats.join(',');
      if (formatsStr !== this.lastDiagFormats) {
        this.lastDiagFormats = formatsStr;
        
        let logStr = `\n[${new Date().toISOString()}] === CLIPBOARD DIAGNOSIS ===\n`;
        logStr += `Available Formats: ${formatsStr}\n`;
        try { logStr += `  Read Text: ${JSON.stringify(clipboard.readText())}\n`; } catch {}
        logStr += `=== END DIAGNOSIS ===\n`;
        
        try {
          fs.appendFileSync('d:\\testCode\\screenshotStorage\\clipboard_diagnosis.log', logStr);
        } catch (err) {
          console.error('Failed to write diagnosis log:', err);
        }
      }

      // 1. 优先处理复制的物理文件路径（包含视频与普通图片文件）
      const filePaths = this.getFilePathsFromClipboard(formats);
      if (filePaths.length > 0) {
        const pathsJoined = filePaths.join(';');
        if (pathsJoined !== this.lastFilePaths) {
          this.lastFilePaths = pathsJoined;
          this.handleClipboardFiles(filePaths);
        }
        return; // 拦截成功后，不再走下面的直接截图检测，防止重复
      }

      // 2. 原有的截图（内存 Image）逻辑
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
        stabilityThreshold: 1000, // 微信与录屏写盘均需要稳定期，等待1000ms无写入才触发
        pollInterval: 100
      }
    });

    this.watcher.on('add', (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];
      const videoExts = ['.mp4', '.mov', '.avi', '.mkv', '.flv', '.wmv'];

      // 忽略常见临时后缀（防止录屏临时写入占位文件被提前捕获）
      if (
        filePath.endsWith('.tmp') ||
        filePath.endsWith('.temp') ||
        filePath.endsWith('.part') ||
        filePath.endsWith('.crdownload') ||
        filePath.endsWith('.download')
      ) {
        return;
      }

      if ([...imageExts, ...videoExts].includes(ext)) {
        try {
          if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
            return; // 忽略大小为0或已经被删掉的空文件
          }
        } catch (err) {
          console.error('Failed to stat captured file:', err);
          return;
        }

        if (this.fileCapturedCallback) {
          this.fileCapturedCallback(filePath);
        }
      }
    });

    console.log(`Watching folders for screenshots: ${validFolders.join(', ')}`);
  }

  public ignoreCurrentClipboardContent(): void {
    try {
      const formats = clipboard.availableFormats();
      const filePaths = this.getFilePathsFromClipboard(formats);
      this.lastFilePaths = filePaths.join(';');
      
      const image = clipboard.readImage();
      this.lastImageBuffer = image.isEmpty() ? null : image.toPNG();
    } catch (err) {
      console.error('Failed to ignore current clipboard content:', err);
    }
  }
}
