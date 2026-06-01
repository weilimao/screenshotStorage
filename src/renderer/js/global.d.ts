import { IElectronAPI, ImageRecord, AppConfig } from '../../shared/types';

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
  type UI_ImageRecord = ImageRecord;
  type UI_AppConfig = AppConfig;
}
