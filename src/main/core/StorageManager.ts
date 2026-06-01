import * as fs from 'fs';
import * as path from 'path';
import { IStorageManager, ImageRecord } from '../../shared/types';
import { ConfigManager } from '../config';

export class StorageManager implements IStorageManager {
  private metadataPath: string;
  private records: ImageRecord[] = [];

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

  public async saveImage(imageBuffer: Buffer): Promise<ImageRecord> {
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

  public async saveImageFromFile(sourceFilePath: string): Promise<ImageRecord> {
    const id = Date.now().toString() + '_' + Math.random().toString(36).substring(2, 7);
    const ext = path.extname(sourceFilePath) || '.png';
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

  public async clearAll(): Promise<void> {
    for (const record of this.records) {
      try {
        if (fs.existsSync(record.filepath)) {
          fs.unlinkSync(record.filepath);
        }
      } catch (err) {
        console.error(`Failed to delete file ${record.filepath}:`, err);
      }
    }
    this.records = [];
    await this.saveMetadata();
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
    const maxImages = config.maxImages || 100;
    const retentionMs = (config.retentionDays || 14) * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let changed = false;

    // 1. 过期清理
    const validTimeRecords: ImageRecord[] = [];
    for (const record of this.records) {
      if (now - record.createdAt > retentionMs) {
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
    this.records = validTimeRecords;

    // 2. 超量清理
    if (this.records.length > maxImages) {
      const toDelete = this.records.slice(maxImages);
      this.records = this.records.slice(0, maxImages);

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

    if (changed) {
      await this.saveMetadata();
    }
  }
}
