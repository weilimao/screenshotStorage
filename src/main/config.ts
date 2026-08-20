import * as fs from 'fs';
import { AppConfig } from '../shared/types';

export class ConfigManager {
  private currentConfig: AppConfig;

  constructor(private configPath: string) {
    this.currentConfig = this.loadConfig();
  }

  private loadConfig(): AppConfig {
    const defaultConfig: AppConfig = {
      maxImages: 100,
      retentionDays: 14,
      watchFolders: [],
      showFloatWindowOnStart: false,
      theme: 'light',
      silentStart: false,
      openAtLogin: false
    };

    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = JSON.parse(data);
        return { ...defaultConfig, ...parsed };
      }
    } catch (err) {
      console.error('Failed to load config, using default:', err);
    }
    return defaultConfig;
  }

  public getConfig(): AppConfig {
    return { ...this.currentConfig };
  }

  public updateConfig(newConfig: Partial<AppConfig>): void {
    this.currentConfig = { ...this.currentConfig, ...newConfig };
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.currentConfig, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save config:', err);
    }
  }
}
