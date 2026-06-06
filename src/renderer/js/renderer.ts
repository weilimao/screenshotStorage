import { ImageRecord, AppConfig } from '../../shared/types';

// DOM 元素引用
const btnToggleFloat = document.getElementById('btn-toggle-float') as HTMLButtonElement;
const floatBtnText = document.getElementById('float-btn-text') as HTMLSpanElement;
const btnAddFolder = document.getElementById('btn-add-folder') as HTMLButtonElement;
const btnChangeStorage = document.getElementById('btn-change-storage') as HTMLButtonElement;
const storagePathText = document.getElementById('storage-path-text') as HTMLDivElement;
const btnClearAll = document.getElementById('btn-clear-all') as HTMLButtonElement;
const watchFolderList = document.getElementById('watch-folder-list') as HTMLDivElement;
const imageGrid = document.getElementById('image-grid') as HTMLDivElement;
const emptyState = document.getElementById('empty-state') as HTMLDivElement;
const toast = document.getElementById('toast') as HTMLDivElement;
const btnCheckUpdate = document.getElementById('btn-check-update') as HTMLButtonElement;
const appVersionText = document.getElementById('app-version-text') as HTMLSpanElement;

// 分类 Tabs 相关 DOM
const categoryTabs = document.getElementById('category-tabs') as HTMLDivElement;
const countAllEl = document.getElementById('count-all') as HTMLSpanElement;
const countImageEl = document.getElementById('count-image') as HTMLSpanElement;
const countVideoEl = document.getElementById('count-video') as HTMLSpanElement;

let currentTab: 'all' | 'image' | 'video' = 'all';

// 主题切换 DOM
const btnToggleTheme = document.getElementById('btn-toggle-theme') as HTMLButtonElement;
const themeIcon = document.getElementById('theme-icon') as HTMLSpanElement;
const themeText = document.getElementById('theme-text') as HTMLSpanElement;

// 开机自启 DOM
const switchAutostart = document.getElementById('switch-autostart') as HTMLInputElement;
const switchSilentstart = document.getElementById('switch-silentstart') as HTMLInputElement;
const containerSilentstart = document.getElementById('container-silentstart') as HTMLDivElement;

// 自启动与静默启动 UI 联动
function updateSilentStartUIState() {
  if (!switchAutostart || !switchSilentstart || !containerSilentstart) return;
  const autostartEnabled = switchAutostart.checked;
  if (autostartEnabled) {
    containerSilentstart.classList.remove('disabled');
    switchSilentstart.disabled = false;
  } else {
    containerSilentstart.classList.add('disabled');
    switchSilentstart.disabled = true;
  }
}

// 保留时长与分类清理 DOM
const selectRetention = document.getElementById('select-retention') as HTMLSelectElement;
const btnClearImages = document.getElementById('btn-clear-images') as HTMLButtonElement;
const btnClearVideos = document.getElementById('btn-clear-videos') as HTMLButtonElement;

// 大图预览相关 DOM
const previewModal = document.getElementById('preview-modal') as HTMLDivElement;
const previewImage = document.getElementById('preview-image') as HTMLImageElement;
const previewCloseBtn = document.getElementById('preview-close-btn') as HTMLButtonElement;

let appConfig: AppConfig = { maxImages: 100, retentionDays: 14, watchFolders: [] };

// 提示框控制
function showToast(message: string) {
  toast.innerText = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2000);
}

// 格式化时间戳
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const addZero = (n: number) => n < 10 ? '0' + n : n;
  return `${addZero(date.getHours())}:${addZero(date.getMinutes())}:${addZero(date.getSeconds())}`;
}

// 创建并渲染单张图片卡片
function createImageCard(record: ImageRecord): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'image-card';
  card.id = `card-${record.id}`;

  const ext = record.filename.split('.').pop()?.toLowerCase();
  const isVideo = ['mp4', 'mov', 'avi', 'mkv', 'flv', 'wmv'].includes(ext || '');
  const imageSrc = record.filepath;

  let mediaHtml = '';
  let formatBadge = 'shot';

  if (isVideo) {
    mediaHtml = `
      <video src="${imageSrc}" muted loop autoplay style="width: 100%; height: 100%; object-fit: cover; pointer-events: none;"></video>
      <div style="position: absolute; top: 8px; left: 8px; background: rgba(0,0,0,0.6); padding: 2px 6px; border-radius: 4px; font-size: 10px; color: #fff; font-weight: 600; display: flex; align-items: center; gap: 2px; z-index: 2;">
        <span>🎬</span> 视频
      </div>
    `;
    formatBadge = 'video';
  } else {
    mediaHtml = `<img src="${imageSrc}" alt="Screenshot">`;
  }

  const fileUrl = `path:${record.filepath.replace(/\\/g, '/')}`;
  card.innerHTML = `
    <a href="${fileUrl}" class="image-wrapper" draggable="true" style="display: block; text-decoration: none;">
      ${mediaHtml}
      <div class="drag-overlay">
        <span class="drag-icon-ui">🖱️</span>
        <span class="drag-text">拖动到终端</span>
      </div>
    </a>
    <div class="card-info">
      <div class="card-meta">
        <span class="card-time">⏰ ${formatTime(record.createdAt)}</span>
        <span class="card-size">${formatBadge}</span>
      </div>
      <div class="card-actions">
        <button class="btn-card btn-preview">
          <span>🔍</span> 预览
        </button>
        <button class="btn-card btn-copy-path" data-path="${record.filepath}">
          <span>📋</span> 复制
        </button>
        <button class="btn-card btn-delete btn-danger-hover" data-id="${record.id}">
          <span>🗑️</span>
        </button>
      </div>
    </div>
  `;

  // 绑定预览按钮点击
  const previewBtn = card.querySelector('.btn-preview') as HTMLButtonElement;
  previewBtn.addEventListener('click', () => {
    openPreview(record.filepath);
  });

  // 绑定原生拖动事件与双击预览
  const imageWrapper = card.querySelector('.image-wrapper') as HTMLAnchorElement;
  imageWrapper.addEventListener('click', (e) => {
    e.preventDefault(); // 阻止 a 标签点击跳转
  });
  imageWrapper.style.cursor = 'zoom-in';

  imageWrapper.addEventListener('dblclick', () => {
    openPreview(record.filepath);
  });

  imageWrapper.addEventListener('dragstart', (e) => {
    const ext = record.filename.split('.').pop()?.toLowerCase();
    const isVideo = ['mp4', 'mov', 'avi', 'mkv', 'flv', 'wmv'].includes(ext || '');

    if (isVideo) {
      e.preventDefault();
      // 复制绝对路径到剪贴板
      window.electronAPI.copyFileToClipboard(record.filepath);
      // 显示提示消息
      showToast('已复制视频路径，可以直接粘贴');
      // 启动原生拖拽以展示拖拽状态
      window.electronAPI.startDrag(record.filepath);
    } else {
      e.preventDefault(); // 阻止浏览器默认拖拽行为
      window.electronAPI.startDrag(record.filepath);
    }
  });

  // 绑定复制文件及路径事件
  const copyBtn = card.querySelector('.btn-copy-path') as HTMLButtonElement;
  copyBtn.addEventListener('click', async () => {
    try {
      const success = await window.electronAPI.copyFileToClipboard(record.filepath);
      if (success) {
        showToast('已复制文件及路径');
      } else {
        showToast('复制失败');
      }
    } catch (err) {
      console.error('Failed to copy file: ', err);
      showToast('复制失败');
    }
  });

  // 绑定单张删除事件
  const deleteBtn = card.querySelector('.btn-delete') as HTMLButtonElement;
  deleteBtn.addEventListener('click', async () => {
    await window.electronAPI.deleteImage(record.id);
  });

  return card;
}

// 判断文件是否为视频
function isRecordVideo(record: ImageRecord): boolean {
  const ext = record.filename.split('.').pop()?.toLowerCase();
  return ['mp4', 'mov', 'avi', 'mkv', 'flv', 'wmv'].includes(ext || '');
}

// 刷新图片展示网格
async function loadImages() {
  const images = await window.electronAPI.getImages();
  imageGrid.innerHTML = '';
  
  // 1. 统计数量
  let imageCount = 0;
  let videoCount = 0;
  images.forEach(img => {
    if (isRecordVideo(img)) {
      videoCount++;
    } else {
      imageCount++;
    }
  });

  // 更新气泡显示数量
  if (countAllEl) countAllEl.innerText = images.length.toString();
  if (countImageEl) countImageEl.innerText = imageCount.toString();
  if (countVideoEl) countVideoEl.innerText = videoCount.toString();

  // 2. 根据 Tab 过滤列表
  const filtered = images.filter(img => {
    if (currentTab === 'all') return true;
    const isVid = isRecordVideo(img);
    if (currentTab === 'video') return isVid;
    if (currentTab === 'image') return !isVid;
    return true;
  });
  
  if (filtered.length === 0) {
    emptyState.style.display = 'flex';
  } else {
    emptyState.style.display = 'none';
    filtered.forEach(img => {
      imageGrid.appendChild(createImageCard(img));
    });
  }
}

// 渲染监听文件夹列表
function renderWatchFolders(folders: string[]) {
  watchFolderList.innerHTML = '';
  if (folders.length === 0) {
    watchFolderList.innerHTML = '<div class="empty-folder-tip">暂无监听目录</div>';
    return;
  }

  folders.forEach(folder => {
    const item = document.createElement('div');
    item.className = 'folder-item';
    item.innerHTML = `
      <span class="folder-path-text" title="${folder}">${folder}</span>
      <button class="folder-delete-btn" data-folder="${folder}">❌</button>
    `;

    const delBtn = item.querySelector('.folder-delete-btn') as HTMLButtonElement;
    delBtn.addEventListener('click', async () => {
      const folderToRemove = delBtn.getAttribute('data-folder');
      if (folderToRemove) {
        const updatedFolders = appConfig.watchFolders.filter(f => f !== folderToRemove);
        await window.electronAPI.updateConfig({ watchFolders: updatedFolders });
      }
    });

    watchFolderList.appendChild(item);
  });
}

function updateStoragePathDisplay(path: string) {
  if (storagePathText) {
    storagePathText.innerText = path;
    storagePathText.title = path;
  }
}

// 刷新配置
async function loadConfig() {
  appConfig = await window.electronAPI.getConfig();
  applyTheme(appConfig.theme);
  renderWatchFolders(appConfig.watchFolders);
  if (switchAutostart) {
    switchAutostart.checked = appConfig.openAtLogin || false;
  }
  if (switchSilentstart) {
    switchSilentstart.checked = appConfig.silentStart || false;
  }
  updateSilentStartUIState();
  if (selectRetention) {
    selectRetention.value = (appConfig.retentionDays !== undefined ? appConfig.retentionDays : 14).toString();
  }
  updateStoragePathDisplay(appConfig.storagePath || '');
}

// 刷新浮窗按钮状态
async function updateFloatButtonState() {
  const isOpen = await window.electronAPI.getFloatWindowState();
  if (isOpen) {
    btnToggleFloat.classList.remove('btn-primary');
    btnToggleFloat.classList.add('btn-secondary');
    floatBtnText.innerText = '关闭悬浮窗';
  } else {
    btnToggleFloat.classList.remove('btn-secondary');
    btnToggleFloat.classList.add('btn-primary');
    floatBtnText.innerText = '开启悬浮窗';
  }
}

function applyTheme(theme?: 'dark' | 'light') {
  if (theme === 'light') {
    document.body.classList.add('light-theme');
    if (themeIcon) themeIcon.innerText = '🌙';
    if (themeText) themeText.innerText = '切换为深色';
  } else {
    document.body.classList.remove('light-theme');
    if (themeIcon) themeIcon.innerText = '☀️';
    if (themeText) themeText.innerText = '切换为浅色';
  }
}

function openPreview(filePath: string) {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const isVideo = ['mp4', 'mov', 'avi', 'mkv', 'flv', 'wmv'].includes(ext || '');

  const imgEl = document.getElementById('preview-image') as HTMLImageElement;
  let videoEl = document.getElementById('preview-video') as HTMLVideoElement;

  if (!videoEl) {
    videoEl = document.createElement('video');
    videoEl.id = 'preview-video';
    videoEl.style.maxWidth = '90%';
    videoEl.style.maxHeight = '85%';
    videoEl.style.borderRadius = '12px';
    videoEl.style.boxShadow = '0 20px 50px rgba(0, 0, 0, 0.6)';
    videoEl.style.outline = 'none';
    videoEl.style.border = '1px solid rgba(255, 255, 255, 0.08)';
    videoEl.controls = true;
    imgEl.parentNode?.appendChild(videoEl);
  }

  if (isVideo) {
    imgEl.style.display = 'none';
    videoEl.style.display = 'block';
    videoEl.src = filePath;
    videoEl.play().catch(err => console.log('Autoplay failed:', err));
  } else {
    videoEl.style.display = 'none';
    videoEl.pause();
    imgEl.style.display = 'block';
    imgEl.src = filePath;
  }

  previewModal.classList.add('show');
}

// 初始化绑定
async function init() {
  // 绑定界面主题切换
  btnToggleTheme.addEventListener('click', async () => {
    const nextTheme = appConfig.theme === 'light' ? 'dark' : 'light';
    await window.electronAPI.updateConfig({ theme: nextTheme });
  });

  // 绑定开机自启切换
  if (switchAutostart) {
    switchAutostart.addEventListener('change', async () => {
      const isChecked = switchAutostart.checked;
      await window.electronAPI.updateConfig({ openAtLogin: isChecked });
      updateSilentStartUIState();
    });
  }

  // 绑定静默启动切换
  if (switchSilentstart) {
    switchSilentstart.addEventListener('change', async () => {
      const isChecked = switchSilentstart.checked;
      await window.electronAPI.updateConfig({ silentStart: isChecked });
    });
  }

  // 监听来自小浮窗的预览请求
  window.electronAPI.onTriggerPreview((filePath) => {
    openPreview(filePath);
  });

  const closePreview = () => {
    previewModal.classList.remove('show');
    const videoEl = document.getElementById('preview-video') as HTMLVideoElement;
    if (videoEl) {
      videoEl.pause();
      videoEl.src = '';
    }
  };

  // 绑定预览模态框关闭事件
  previewCloseBtn.addEventListener('click', closePreview);
  previewModal.addEventListener('click', (e) => {
    if (e.target === previewModal) {
      closePreview();
    }
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePreview();
    }
  });

  // 1. 加载初始数据
  await loadImages();
  await loadConfig();
  await updateFloatButtonState();

  // 2. 绑定侧边栏按钮交互
  btnToggleFloat.addEventListener('click', async () => {
    await window.electronAPI.toggleFloatWindow();
    await updateFloatButtonState();
  });

  btnChangeStorage.addEventListener('click', async () => {
    const folder = await window.electronAPI.selectFolder('选择截图数据存放目录');
    if (folder) {
      if (folder === appConfig.storagePath) {
        showToast('该目录已是当前存放位置');
        return;
      }
      try {
        showToast('正在迁移物理文件，请稍候...');
        const success = await window.electronAPI.updateConfig({ customStoragePath: folder });
        if (success) {
          showToast('存放位置修改成功，数据已迁移！');
        } else {
          showToast('存放位置修改失败');
        }
      } catch (err) {
        console.error('Failed to change storage directory:', err);
        showToast('修改失败，发生未知错误');
      }
    }
  });

  btnAddFolder.addEventListener('click', async () => {
    const folder = await window.electronAPI.selectFolder();
    if (folder) {
      if (appConfig.watchFolders.includes(folder)) {
        showToast('该目录已在监听列表中');
        return;
      }
      const updatedFolders = [...appConfig.watchFolders, folder];
      await window.electronAPI.updateConfig({ watchFolders: updatedFolders });
      showToast('添加监听成功');
    }
  });

  if (selectRetention) {
    selectRetention.addEventListener('change', async () => {
      const val = parseInt(selectRetention.value, 10);
      await window.electronAPI.updateConfig({ retentionDays: val });
      showToast('保留时长已更新！');
    });
  }

  if (btnClearImages) {
    btnClearImages.addEventListener('click', async () => {
      if (confirm('确定要清空所有已保存的截图图片吗？此操作不可逆！')) {
        await window.electronAPI.clearAll('image');
        showToast('已清空所有图片');
      }
    });
  }

  if (btnClearVideos) {
    btnClearVideos.addEventListener('click', async () => {
      if (confirm('确定要清空所有已保存的暂存视频吗？此操作不可逆！')) {
        await window.electronAPI.clearAll('video');
        showToast('已清空所有视频');
      }
    });
  }

  btnClearAll.addEventListener('click', async () => {
    if (confirm('确定要一键清空暂存箱里的所有截图和视频吗？此操作不可逆！')) {
      await window.electronAPI.clearAll('all');
      showToast('暂存箱已全部清空');
    }
  });

  // 3. 注册主进程推送事件的监听
  window.electronAPI.onNewImage(async (record) => {
    await loadImages();
  });

  window.electronAPI.onImageDeleted(async (id) => {
    await loadImages();
  });

  // 4. 绑定多分类 Tab 点击事件
  if (categoryTabs) {
    const tabButtons = categoryTabs.querySelectorAll('.tab-btn');
    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        tabButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const type = btn.getAttribute('data-type') as 'all' | 'image' | 'video';
        currentTab = type || 'all';
        loadImages();
      });
    });
  }

  window.electronAPI.onConfigChanged(async (config) => {
    const storagePathChanged = config.storagePath !== appConfig.storagePath;
    appConfig = config;
    applyTheme(config.theme);
    renderWatchFolders(config.watchFolders);
    if (switchAutostart) {
      switchAutostart.checked = config.openAtLogin || false;
    }
    if (switchSilentstart) {
      switchSilentstart.checked = config.silentStart || false;
    }
    updateSilentStartUIState();
    updateStoragePathDisplay(config.storagePath || '');
    if (storagePathChanged) {
      await loadImages();
    }
  });

  window.electronAPI.onFloatWindowStateChanged((state) => {
    if (state) {
      btnToggleFloat.classList.remove('btn-primary');
      btnToggleFloat.classList.add('btn-secondary');
      floatBtnText.innerText = '关闭悬浮窗';
    } else {
      btnToggleFloat.classList.remove('btn-secondary');
      btnToggleFloat.classList.add('btn-primary');
      floatBtnText.innerText = '开启悬浮窗';
    }
  });

  // 5. 动态获取版本号并展示
  try {
    const version = await window.electronAPI.getAppVersion();
    if (appVersionText) {
      appVersionText.innerText = `v${version} · 智能中转器`;
    }
  } catch (err) {
    console.error('Failed to get app version: ', err);
  }

  // 6. 绑定手动检查更新事件
  if (btnCheckUpdate) {
    btnCheckUpdate.addEventListener('click', async () => {
      try {
        btnCheckUpdate.disabled = true;
        btnCheckUpdate.innerText = '检查中...';
        await window.electronAPI.checkForUpdates(true);
      } catch (err) {
        console.error('Check updates failed: ', err);
      } finally {
        btnCheckUpdate.disabled = false;
        btnCheckUpdate.innerText = '检查更新';
      }
    });
  }
}

// 启动
window.addEventListener('DOMContentLoaded', init);
