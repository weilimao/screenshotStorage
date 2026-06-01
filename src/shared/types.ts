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
}

export interface IStorageManager {
  init(): Promise<void>;
  saveImage(imageBuffer: Buffer): Promise<ImageRecord>;
  saveImageFromFile(sourceFilePath: string): Promise<ImageRecord>;
  getImages(): Promise<ImageRecord[]>;
  deleteImage(id: string): Promise<void>;
  clearAll(): Promise<void>;
  getStoragePath(): string;
}

export interface IWindowManager {
  createMainWindow(): void;
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
}

export interface IElectronAPI {
  getImages(): Promise<ImageRecord[]>;
  deleteImage(id: string): Promise<boolean>;
  clearAll(): Promise<boolean>;
  getConfig(): Promise<AppConfig>;
  updateConfig(config: Partial<AppConfig>): Promise<boolean>;
  selectFolder(): Promise<string | null>;
  toggleFloatWindow(): Promise<boolean>;
  getFloatWindowState(): Promise<boolean>;
  startDrag(filePath: string): void;
  resizeFloatWindow(width: number, height: number): void;
  openFile(filePath: string): Promise<boolean>;
  triggerMainPreview(filePath: string): Promise<boolean>;
  onNewImage(callback: (record: ImageRecord) => void): () => void;
  onImageDeleted(callback: (id: string) => void): () => void;
  onConfigChanged(callback: (config: AppConfig) => void): () => void;
  onFloatWindowStateChanged(callback: (state: boolean) => void): () => void;
  onTriggerPreview(callback: (filePath: string) => void): () => void;
}
