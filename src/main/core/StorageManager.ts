import * as fs from 'fs';
import * as path from 'path';
import { IStorageManager, ImageRecord } from '../../shared/types';
import { ConfigManager } from '../config';

interface ImageFingerprint {
  width: number;
  height: number;
  time: number;
}

export class StorageManager implements IStorageManager {
  private metadataPath: string;
  private records: ImageRecord[] = [];
  private lastImageFingerprint: ImageFingerprint | null = null;

  constructor(
    private storageDir: string,
    private configManager: ConfigManager
  ) {
    this.metadataPath = path.join(this.storageDir, 'metadata.json');
  }

  public async init(): Promise<void> {
    // 确保存储目录存在
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    // 加载元数据
    if (fs.existsSync(this.metadataPath)) {
      try {
        const data = fs.readFileSync(this.metadataPath, 'utf-8');
        this.records = JSON.parse(data);
      } catch (err) {
        console.error('Failed to parse metadata.json, resetting records:', err);
        this.records = [];
      }
    }

    // 启动时执行一次自动清理
    await this.autoCleanup();
  }

  public getStoragePath(): string {
    return this.storageDir;
  }

  public async saveImage(imageBuffer: Buffer): Promise<ImageRecord | null> {
    const { nativeImage } = require('electron');
    const img = nativeImage.createFromBuffer(imageBuffer);
    const size = img.getSize();
    const now = Date.now();

    if (this.lastImageFingerprint && 
        now - this.lastImageFingerprint.time < 2000 && 
        this.lastImageFingerprint.width === size.width && 
        this.lastImageFingerprint.height === size.height) {
      console.log('Duplicate image capture detected (clipboard), skipping save.');
      return null;
    }

    this.lastImageFingerprint = {
      width: size.width,
      height: size.height,
      time: now
    };

    const id = Date.now().toString() + '_' + Math.random().toString(36).substring(2, 7);
    const filename = `shot_${Date.now()}.png`;
    const filepath = path.join(this.storageDir, filename);

    // 写入文件
    fs.writeFileSync(filepath, imageBuffer);

    const record: ImageRecord = {
      id,
      filename,
      filepath: path.resolve(filepath), // 转化为绝对路径，方便 CLI 拖拽
      createdAt: Date.now()
    };

    this.records.unshift(record); // 最新截取的放在最前

    await this.saveMetadata();
    await this.autoCleanup(); // 新增后触发清理

    return record;
  }

  public async saveImageFromFile(sourceFilePath: string): Promise<ImageRecord | null> {
    const ext = path.extname(sourceFilePath).toLowerCase();
    const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'].includes(ext);

    let width = 0;
    let height = 0;

    if (isImage) {
      try {
        const { nativeImage } = require('electron');
        const img = nativeImage.createFromPath(sourceFilePath);
        const size = img.getSize();
        width = size.width;
        height = size.height;
      } catch (err) {
        console.error('Failed to parse image dimensions from file:', err);
      }
    }

    const now = Date.now();
    if (isImage && width > 0 && height > 0 && this.lastImageFingerprint && 
        now - this.lastImageFingerprint.time < 2000 && 
        this.lastImageFingerprint.width === width && 
        this.lastImageFingerprint.height === height) {
      console.log('Duplicate image capture detected (folder watcher), skipping save.');
      return null;
    }

    if (isImage && width > 0 && height > 0) {
      this.lastImageFingerprint = {
        width,
        height,
        time: now
      };
    }

    const id = Date.now().toString() + '_' + Math.random().toString(36).substring(2, 7);
    const filename = `shot_${Date.now()}${ext}`;
    const filepath = path.join(this.storageDir, filename);

    // 拷贝文件
    fs.copyFileSync(sourceFilePath, filepath);

    const record: ImageRecord = {
      id,
      filename,
      filepath: path.resolve(filepath),
      createdAt: Date.now()
    };

    this.records.unshift(record);

    await this.saveMetadata();
    await this.autoCleanup();

    return record;
  }

  public async getImages(): Promise<ImageRecord[]> {
    // 过滤掉本地文件已经被手动删除的无效记录
    const validRecords: ImageRecord[] = [];
    let changed = false;

    for (const record of this.records) {
      if (fs.existsSync(record.filepath)) {
        validRecords.push(record);
      } else {
        changed = true;
      }
    }

    if (changed) {
      this.records = validRecords;
      await this.saveMetadata();
    }

    return this.records;
  }

  public async deleteImage(id: string): Promise<void> {
    const index = this.records.findIndex(r => r.id === id);
    if (index !== -1) {
      const record = this.records[index];
      try {
        if (fs.existsSync(record.filepath)) {
          fs.unlinkSync(record.filepath);
        }
      } catch (err) {
        console.error(`Failed to delete file ${record.filepath}:`, err);
      }
      this.records.splice(index, 1);
      await this.saveMetadata();
    }
  }

  private isRecordVideo(record: ImageRecord): boolean {
    const ext = record.filename.split('.').pop()?.toLowerCase();
    return ['mp4', 'mov', 'avi', 'mkv', 'flv', 'wmv'].includes(ext || '');
  }

  public async clearAll(type?: 'all' | 'image' | 'video'): Promise<void> {
    const toKeep: ImageRecord[] = [];
    for (const record of this.records) {
      const isVid = this.isRecordVideo(record);
      const shouldDelete = !type || type === 'all' || (type === 'video' && isVid) || (type === 'image' && !isVid);

      if (shouldDelete) {
        try {
          if (fs.existsSync(record.filepath)) {
            fs.unlinkSync(record.filepath);
          }
        } catch (err) {
          console.error(`Failed to delete file ${record.filepath}:`, err);
        }
      } else {
        toKeep.push(record);
      }
    }
    this.records = toKeep;
    await this.saveMetadata();
  }

  public async updateStorageDir(newDir: string): Promise<void> {
    if (newDir === this.storageDir) {
      return;
    }

    // 确保存储目录存在
    if (!fs.existsSync(newDir)) {
      fs.mkdirSync(newDir, { recursive: true });
    }

    const oldDir = this.storageDir;
    const oldMetadataPath = this.metadataPath;

    // 1. 迁移所有记录中的图片物理文件
    for (const record of this.records) {
      if (fs.existsSync(record.filepath)) {
        const newFilepath = path.join(newDir, record.filename);
        try {
          // 尝试重命名/移动物理文件
          try {
            fs.renameSync(record.filepath, newFilepath);
          } catch (renameErr) {
            // 降级处理跨磁盘分区移动
            fs.copyFileSync(record.filepath, newFilepath);
            fs.unlinkSync(record.filepath);
          }
          // 更新绝对路径
          record.filepath = path.resolve(newFilepath);
        } catch (err) {
          console.error(`Failed to migrate file from ${record.filepath} to ${newFilepath}:`, err);
        }
      }
    }

    // 2. 更新成员变量为新的目录
    this.storageDir = newDir;
    this.metadataPath = path.join(newDir, 'metadata.json');

    // 3. 写入新的元数据文件
    await this.saveMetadata();

    // 4. 清理旧目录下的元数据文件
    if (fs.existsSync(oldMetadataPath)) {
      try {
        fs.unlinkSync(oldMetadataPath);
      } catch (err) {
        console.error(`Failed to delete old metadata file ${oldMetadataPath}:`, err);
      }
    }

    console.log(`Successfully migrated storage directory from ${oldDir} to ${newDir}`);
  }

  private async saveMetadata(): Promise<void> {
    try {
      fs.writeFileSync(this.metadataPath, JSON.stringify(this.records, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to write metadata:', err);
    }
  }

  private async autoCleanup(): Promise<void> {
    const config = this.configManager.getConfig();
    const retentionDays = config.retentionDays !== undefined ? config.retentionDays : 14;
    const hasTimeLimit = retentionDays > 0; // 0 表示永久保存
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let changed = false;

    // 1. 过期清理
    const validTimeRecords: ImageRecord[] = [];
    for (const record of this.records) {
      if (hasTimeLimit && (now - record.createdAt > retentionMs)) {
        try {
          if (fs.existsSync(record.filepath)) {
            fs.unlinkSync(record.filepath);
          }
        } catch (err) {
          console.error('Failed to delete expired file:', err);
        }
        changed = true;
      } else {
        validTimeRecords.push(record);
      }
    }

    // 2. 超量清理：图片限制最近 100 张，视频限制最近 50 个
    const videos: ImageRecord[] = [];
    const images: ImageRecord[] = [];

    // validTimeRecords 已是最新在前 (unshift 写入)
    for (const record of validTimeRecords) {
      if (this.isRecordVideo(record)) {
        videos.push(record);
      } else {
        images.push(record);
      }
    }

    const keptVideos = videos.slice(0, 50);
    const toDeleteVideos = videos.slice(50);

    const keptImages = images.slice(0, 100);
    const toDeleteImages = images.slice(100);

    const toDelete = [...toDeleteVideos, ...toDeleteImages];
    if (toDelete.length > 0) {
      for (const record of toDelete) {
        try {
          if (fs.existsSync(record.filepath)) {
            fs.unlinkSync(record.filepath);
          }
        } catch (err) {
          console.error('Failed to delete excess file:', err);
        }
      }
      changed = true;
    }

    // 重新组合并按时间重新排序，确保全局最新在前
    this.records = [...keptVideos, ...keptImages].sort((a, b) => b.createdAt - a.createdAt);

    if (changed) {
      await this.saveMetadata();
    }
  }
}
