import type { AppConfig } from '../../shared/types';

declare const window: any;

class SettingsManager {
  private modal: HTMLDivElement;
  private btnOpen: HTMLButtonElement;
  private btnClose: HTMLButtonElement;

  private inputShortcut: HTMLInputElement;
  private btnSaveShortcut: HTMLButtonElement;
  private recordingStatus: HTMLDivElement;
  private recordingContainer: HTMLDivElement;

  private storagePathText: HTMLDivElement;
  private btnChangeStorage: HTMLButtonElement;

  private watchFolderList: HTMLDivElement;
  private btnAddFolder: HTMLButtonElement;

  private isRecording: boolean = false;
  private previousShortcut: string = '';
  private config: AppConfig | null = null;
  private onConfigSavedCallback: (() => void) | null = null;

  constructor() {
    this.modal = document.getElementById('settings-modal') as HTMLDivElement;
    this.btnOpen = document.getElementById('btn-open-settings') as HTMLButtonElement;
    this.btnClose = document.getElementById('btn-close-settings') as HTMLButtonElement;

    this.inputShortcut = document.getElementById('input-shortcut') as HTMLInputElement;
    this.btnSaveShortcut = document.getElementById('btn-save-shortcut') as HTMLButtonElement;
    this.recordingStatus = document.getElementById('shortcut-recording-status') as HTMLDivElement;
    this.recordingContainer = this.inputShortcut.parentElement as HTMLDivElement;

    this.storagePathText = document.getElementById('storage-path-text') as HTMLDivElement;
    this.btnChangeStorage = document.getElementById('btn-change-storage') as HTMLButtonElement;

    this.watchFolderList = document.getElementById('watch-folder-list') as HTMLDivElement;
    this.btnAddFolder = document.getElementById('btn-add-folder') as HTMLButtonElement;

    this.initEvents();
  }

  public registerOnConfigSaved(callback: () => void) {
    this.onConfigSavedCallback = callback;
  }

  private showToast(msg: string) {
    const toast = document.getElementById('toast') as HTMLDivElement;
    if (toast) {
      toast.innerText = msg;
      toast.classList.add('show');
      setTimeout(() => {
        toast.classList.remove('show');
      }, 2000);
    }
  }

  private async loadConfig() {
    this.config = await window.electronAPI.getConfig();
    if (!this.config) return;

    if (this.inputShortcut) {
      this.inputShortcut.value = this.config.screenshotShortcut || 'Ctrl+Alt+S';
      this.previousShortcut = this.inputShortcut.value;
    }
    if (this.storagePathText) {
      this.storagePathText.innerText = this.config.storagePath || '';
      this.storagePathText.title = this.config.storagePath || '';
    }
    this.renderWatchFolders(this.config.watchFolders || []);
  }

  private renderWatchFolders(folders: string[]) {
    if (!this.watchFolderList) return;
    this.watchFolderList.innerHTML = '';
    if (folders.length === 0) {
      this.watchFolderList.innerHTML = '<div class="empty-folder-tip" style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 12px;">暂无监听目录</div>';
      return;
    }

    folders.forEach(folder => {
      const item = document.createElement('div');
      item.className = 'folder-item';
      item.style.display = 'flex';
      item.style.justifyContent = 'space-between';
      item.style.alignItems = 'center';
      item.style.padding = '8px 10px';
      item.style.background = 'rgba(255, 255, 255, 0.03)';
      item.style.border = '1px solid rgba(255, 255, 255, 0.05)';
      item.style.borderRadius = '6px';
      item.style.marginBottom = '6px';
      item.style.fontSize = '12px';

      item.innerHTML = `
        <span class="folder-path-text" title="${folder}" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 85%; color: var(--text-main);">${folder}</span>
        <button class="folder-delete-btn" data-folder="${folder}" style="background: transparent; border: none; cursor: pointer; color: var(--danger-color); font-size: 11px; padding: 2px 4px;">❌</button>
      `;

      const delBtn = item.querySelector('.folder-delete-btn') as HTMLButtonElement;
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const folderToRemove = delBtn.getAttribute('data-folder');
        if (folderToRemove && this.config) {
          const updatedFolders = (this.config.watchFolders || []).filter(f => f !== folderToRemove);
          await window.electronAPI.updateConfig({ watchFolders: updatedFolders });
          this.showToast('已移除监听');
          await this.loadConfig();
          if (this.onConfigSavedCallback) this.onConfigSavedCallback();
        }
      });

      this.watchFolderList.appendChild(item);
    });
  }

  private initEvents() {
    // 打开/关闭设置
    this.btnOpen.addEventListener('click', async () => {
      await this.loadConfig();
      this.modal.classList.add('show');
    });

    this.btnClose.addEventListener('click', () => {
      this.exitRecording();
      this.modal.classList.remove('show');
    });

    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) {
        this.exitRecording();
        this.modal.classList.remove('show');
      }
    });

    // 更改数据存放位置
    this.btnChangeStorage.addEventListener('click', async () => {
      const folder = await window.electronAPI.selectFolder('选择截图数据存放目录');
      if (folder && this.config) {
        if (folder === this.config.storagePath) {
          this.showToast('该目录已是当前存放位置');
          return;
        }
        try {
          this.showToast('正在迁移物理文件，请稍候...');
          const success = await window.electronAPI.updateConfig({ customStoragePath: folder });
          if (success) {
            this.showToast('存放位置修改成功，数据已迁移！');
            await this.loadConfig();
            if (this.onConfigSavedCallback) this.onConfigSavedCallback();
          } else {
            this.showToast('存放位置修改失败');
          }
        } catch (err) {
          console.error(err);
          this.showToast('修改失败，发生未知错误');
        }
      }
    });

    // 添加监听文件夹
    this.btnAddFolder.addEventListener('click', async () => {
      const folder = await window.electronAPI.selectFolder();
      if (folder && this.config) {
        const currentFolders = this.config.watchFolders || [];
        if (currentFolders.includes(folder)) {
          this.showToast('该目录已在监听列表中');
          return;
        }
        const updatedFolders = [...currentFolders, folder];
        await window.electronAPI.updateConfig({ watchFolders: updatedFolders });
        this.showToast('添加监听成功');
        await this.loadConfig();
        if (this.onConfigSavedCallback) this.onConfigSavedCallback();
      }
    });

    // 快捷键输入框录制逻辑
    this.inputShortcut.addEventListener('focus', () => {
      this.startRecording();
    });

    this.inputShortcut.addEventListener('keydown', (e) => {
      if (!this.isRecording) return;
      e.preventDefault();
      e.stopPropagation();

      const key = e.key;

      // 1. 如果是 Escape 键，退出录制并恢复原值
      if (key === 'Escape') {
        this.exitRecording(true);
        return;
      }

      // 2. 收集修饰键
      const modifiers = [];
      if (e.ctrlKey) modifiers.push('Ctrl');
      if (e.altKey) modifiers.push('Alt');
      if (e.shiftKey) modifiers.push('Shift');
      if (e.metaKey) modifiers.push('Cmd');

      // 3. 忽略修饰键本身以及 CapsLock、Tab 等
      const ignoreKeys = ['Control', 'Alt', 'Shift', 'Meta', 'CapsLock', 'Tab'];
      if (ignoreKeys.includes(key)) {
        this.inputShortcut.value = modifiers.join('+');
        return;
      }

      // 4. 标准化主键
      let mainKey = key;
      if (key === ' ') {
        mainKey = 'Space';
      } else if (key === 'ArrowUp') {
        mainKey = 'Up';
      } else if (key === 'ArrowDown') {
        mainKey = 'Down';
      } else if (key === 'ArrowLeft') {
        mainKey = 'Left';
      } else if (key === 'ArrowRight') {
        mainKey = 'Right';
      } else if (key.length === 1) {
        mainKey = key.toUpperCase();
      }

      // 拼接快捷键
      const finalShortcut = [...modifiers, mainKey].join('+');
      this.inputShortcut.value = finalShortcut;

      // 5. 录制完成（按下普通按键即视为按下主键，自动完成）
      this.exitRecording();
    });

    // 保存快捷键
    this.btnSaveShortcut.addEventListener('click', async () => {
      const val = this.inputShortcut.value.trim();
      if (!val) {
        this.showToast('快捷键不能为空！');
        return;
      }
      try {
        const success = await window.electronAPI.updateConfig({ screenshotShortcut: val });
        if (success) {
          this.showToast('快捷键已成功更新！');
          this.previousShortcut = val;
          if (this.onConfigSavedCallback) this.onConfigSavedCallback();
        } else {
          this.showToast('保存失败，该快捷键已被占用或格式不支持');
          this.inputShortcut.value = this.previousShortcut;
        }
      } catch (err) {
        console.error(err);
        this.showToast('更新快捷键失败');
        this.inputShortcut.value = this.previousShortcut;
      }
    });
  }

  private startRecording() {
    if (this.isRecording) return;
    this.isRecording = true;
    this.previousShortcut = this.inputShortcut.value;
    this.inputShortcut.value = '';
    if (this.recordingContainer) {
      this.recordingContainer.classList.add('recording');
    }
    if (this.recordingStatus) {
      this.recordingStatus.innerText = '请在键盘上按下快捷键...';
    }
  }

  private exitRecording(rollback: boolean = false) {
    if (!this.isRecording) return;
    this.isRecording = false;
    if (rollback) {
      this.inputShortcut.value = this.previousShortcut;
    }
    if (this.recordingContainer) {
      this.recordingContainer.classList.remove('recording');
    }
    if (this.recordingStatus) {
      this.recordingStatus.innerText = '点击框内录制';
    }
    this.inputShortcut.blur();
  }
}
