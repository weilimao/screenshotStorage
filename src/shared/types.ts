export interface ImageRecord {
  id: string;
  filename: string;
  filepath: string;
  createdAt: number;
}

export interface IClipboardMonitor {
  start(): void;
  stop(): void;
  onImageCaptured(callback: (imageBuffer: Buffer) => void): void;
  onFileCaptured(callback: (filePath: string) => void): void;
  setStorageDir(dir: string): void;
}

export interface IUpdateManager {
  checkForUpdates(manual: boolean): Promise<boolean>;
  getAppVersion(): string;
}

export interface IStorageManager {
  init(): Promise<void>;
  saveImage(imageBuffer: Buffer): Promise<ImageRecord>;
  saveImageFromFile(sourceFilePath: string): Promise<ImageRecord>;
  getImages(): Promise<ImageRecord[]>;
  deleteImage(id: string): Promise<void>;
  clearAll(type?: 'all' | 'image' | 'video'): Promise<void>;
  getStoragePath(): string;
  updateStorageDir(newDir: string): Promise<void>;
}

export interface IWindowManager {
  createMainWindow(showInitially?: boolean): void;
  createFloatWindow(): void;
  closeFloatWindow(): void;
  sendToMainWindow(channel: string, ...args: any[]): void;
  sendToFloatWindow(channel: string, ...args: any[]): void;
  getMainWindow(): any;
  getFloatWindow(): any;
}

export interface AppConfig {
  maxImages: number;
  retentionDays: number;
  watchFolders: string[];
  showFloatWindowOnStart?: boolean;
  theme?: 'dark' | 'light';
  openAtLogin?: boolean;
  silentStart?: boolean;
  customStoragePath?: string;
  storagePath?: string;
}

export interface IElectronAPI {
  getImages(): Promise<ImageRecord[]>;
  deleteImage(id: string): Promise<boolean>;
  clearAll(type?: 'all' | 'image' | 'video'): Promise<boolean>;
  getConfig(): Promise<AppConfig>;
  updateConfig(config: Partial<AppConfig>): Promise<boolean>;
  selectFolder(title?: string): Promise<string | null>;
  toggleFloatWindow(): Promise<boolean>;
  getFloatWindowState(): Promise<boolean>;
  startDrag(filePath: string): void;
  resizeFloatWindow(width: number, height: number): void;
  openFile(filePath: string): Promise<boolean>;
  triggerMainPreview(filePath: string): Promise<boolean>;
  copyFileToClipboard(filePath: string): Promise<boolean>;
  checkForUpdates(manual: boolean): Promise<boolean>;
  getAppVersion(): Promise<string>;
  onNewImage(callback: (record: ImageRecord) => void): () => void;
  onImageDeleted(callback: (id: string) => void): () => void;
  onConfigChanged(callback: (config: AppConfig) => void): () => void;
  onFloatWindowStateChanged(callback: (state: boolean) => void): () => void;
  onTriggerPreview(callback: (filePath: string) => void): () => void;
}
