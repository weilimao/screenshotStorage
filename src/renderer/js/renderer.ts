import { ImageRecord, AppConfig } from '../../shared/types';

declare class SettingsManager {
  constructor();
  registerOnConfigSaved(callback: () => void): void;
}

// DOM 元素引用
const btnToggleFloat = document.getElementById('btn-toggle-float') as HTMLButtonElement;
const floatBtnText = document.getElementById('float-btn-text') as HTMLSpanElement;
const imageGrid = document.getElementById('image-grid') as HTMLDivElement;
const emptyState = document.getElementById('empty-state') as HTMLDivElement;
const toast = document.getElementById('toast') as HTMLDivElement;
const btnCheckUpdate = document.getElementById('btn-check-update') as HTMLButtonElement;
const appVersionText = document.getElementById('app-version-text') as HTMLSpanElement;
const btnOpenSettings = document.getElementById('btn-open-settings') as HTMLButtonElement;
const selectRetention = document.getElementById('select-retention') as HTMLSelectElement;
const btnClearImages = document.getElementById('btn-clear-images') as HTMLButtonElement;
const btnClearVideos = document.getElementById('btn-clear-videos') as HTMLButtonElement;
const btnClearAll = document.getElementById('btn-clear-all') as HTMLButtonElement;

// 更新弹窗相关 DOM
const updateModal = document.getElementById('update-modal') as HTMLDivElement | null;
const updateLatestVer = document.getElementById('update-latest-ver') as HTMLSpanElement | null;
const updateCurrentVer = document.getElementById('update-current-ver') as HTMLSpanElement | null;
const updateNotesContent = document.getElementById('update-notes-content') as HTMLDivElement | null;
const updateProgressContainer = document.getElementById('update-progress-container') as HTMLDivElement | null;
const updateProgressStatus = document.getElementById('update-progress-status') as HTMLSpanElement | null;
const updateProgressPercent = document.getElementById('update-progress-percent') as HTMLSpanElement | null;
const updateProgressBarFill = document.getElementById('update-progress-bar-fill') as HTMLDivElement | null;
const updateActions = document.getElementById('update-actions') as HTMLDivElement | null;

// 更新状态变量
let latestUpdateData: any = null;
let downloadedFilePath: string | null = null;

function cleanVersion(ver: string): string {
  return ver.trim().replace(/^v/i, '');
}

async function showNoUpdateModal() {
  if (!updateModal) return;

  try {
    const version = await window.electronAPI.getAppVersion();
    
    const iconEl = updateModal.querySelector('.update-icon') as HTMLDivElement | null;
    const titleGroupEl = updateModal.querySelector('.update-title-group') as HTMLDivElement | null;
    const bodyEl = updateModal.querySelector('.update-body') as HTMLDivElement | null;
    const progressEl = updateModal.querySelector('.update-progress-container') as HTMLDivElement | null;

    if (iconEl) {
      iconEl.innerText = '🎉';
    }
    if (titleGroupEl) {
      titleGroupEl.innerHTML = `
        <h2>您的软件已是最新版本！</h2>
        <p class="update-subtitle">当前版本: v${cleanVersion(version)}</p>
      `;
    }
    
    if (bodyEl) {
      bodyEl.style.display = 'none';
    }
    if (progressEl) {
      progressEl.style.display = 'none';
    }

    if (updateActions) {
      updateActions.innerHTML = `
        <button id="btn-update-ok" class="btn btn-primary">确定</button>
      `;
      const btnOk = document.getElementById('btn-update-ok') as HTMLButtonElement | null;
      if (btnOk) {
        btnOk.addEventListener('click', () => {
          updateModal.classList.remove('show');
        });
      }
    }

    updateModal.classList.add('show');

  } catch (err) {
    console.error('Failed to show no-update modal:', err);
    showToast('当前已是最新版本');
  }
}

function renderUpdateActions(state: 'initial' | 'downloading' | 'complete') {
  if (!updateActions) return;

  if (state === 'initial') {
    updateActions.innerHTML = `
      <button id="btn-update-now" class="btn btn-primary">立即在应用内更新</button>
      <button id="btn-update-browser" class="btn btn-secondary">浏览器下载</button>
      <button id="btn-update-cancel" class="btn btn-secondary-text">暂不更新</button>
    `;

    const btnNow = document.getElementById('btn-update-now') as HTMLButtonElement | null;
    const btnBrowser = document.getElementById('btn-update-browser') as HTMLButtonElement | null;
    const btnCancel = document.getElementById('btn-update-cancel') as HTMLButtonElement | null;

    if (btnNow) {
      btnNow.addEventListener('click', async () => {
        if (latestUpdateData && latestUpdateData.assets) {
          renderUpdateActions('downloading');
          if (updateProgressContainer) {
            updateProgressContainer.style.display = 'flex';
          }
          if (updateProgressStatus) {
            updateProgressStatus.innerText = '正在准备下载...';
          }
          if (updateProgressPercent) {
            updateProgressPercent.innerText = '0%';
          }
          if (updateProgressBarFill) {
            updateProgressBarFill.style.width = '0%';
          }

          try {
            const success = await window.electronAPI.startDownloadUpdate(latestUpdateData.assets);
            if (!success) {
              if (updateProgressStatus) {
                updateProgressStatus.innerText = '下载失败，请重试或使用浏览器下载';
              }
              renderUpdateActions('initial');
            }
          } catch (err) {
            console.error('Failed to start download:', err);
            if (updateProgressStatus) {
              updateProgressStatus.innerText = '下载启动失败，发生错误';
            }
            renderUpdateActions('initial');
          }
        } else {
          showToast('无法获取更新包信息');
        }
      });
    }

    if (btnBrowser) {
      btnBrowser.addEventListener('click', () => {
        if (latestUpdateData && latestUpdateData.downloadUrl) {
          window.open(latestUpdateData.downloadUrl);
        } else {
          showToast('无法打开下载链接');
        }
      });
    }

    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        if (updateModal) {
          updateModal.classList.remove('show');
        }
      });
    }

  } else if (state === 'downloading') {
    updateActions.innerHTML = `
      <button id="btn-update-cancel" class="btn btn-secondary-text">暂不更新 (后台下载)</button>
    `;

    const btnCancel = document.getElementById('btn-update-cancel') as HTMLButtonElement | null;
    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        if (updateModal) {
          updateModal.classList.remove('show');
        }
      });
    }

  } else if (state === 'complete') {
    updateActions.innerHTML = `
      <button id="btn-update-restart" class="btn btn-primary">立即重启</button>
      <button id="btn-update-later" class="btn btn-secondary-text">稍后重启</button>
    `;

    const btnRestart = document.getElementById('btn-update-restart') as HTMLButtonElement | null;
    const btnLater = document.getElementById('btn-update-later') as HTMLButtonElement | null;

    if (btnRestart) {
      btnRestart.addEventListener('click', () => {
        if (downloadedFilePath) {
          window.electronAPI.installUpdate(downloadedFilePath);
        } else {
          showToast('安装文件丢失，请重新下载');
          renderUpdateActions('initial');
        }
      });
    }

    if (btnLater) {
      btnLater.addEventListener('click', () => {
        if (updateModal) {
          updateModal.classList.remove('show');
        }
      });
    }
  }
}

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

// 大图预览相关 DOM
const previewModal = document.getElementById('preview-modal') as HTMLDivElement;
const previewImage = document.getElementById('preview-image') as HTMLImageElement;
const previewCloseBtn = document.getElementById('preview-close-btn') as HTMLButtonElement;
const previewPrevBtn = document.getElementById('preview-prev-btn') as HTMLButtonElement;
const previewNextBtn = document.getElementById('preview-next-btn') as HTMLButtonElement;

let allRecords: ImageRecord[] = [];
let currentFilteredRecords: ImageRecord[] = [];
let currentPreviewIndex: number = -1;

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
      <video src="${imageSrc}" muted loop style="width: 100%; height: 100%; object-fit: cover; pointer-events: none;"></video>
    `;
    formatBadge = 'video';
  } else {
    mediaHtml = `<img src="${imageSrc}" alt="Screenshot">`;
  }

  const badgeClass = isVideo ? 'badge-video' : 'badge-image';
  const badgeText = isVideo ? '视频' : '图片';
  const badgeHtml = `<div class="diagonal-badge ${badgeClass}">${badgeText}</div>`;

  const fileUrl = `path:${record.filepath.replace(/\\/g, '/')}`;
  card.innerHTML = `
    <a href="${fileUrl}" class="image-wrapper" draggable="true" style="display: block; text-decoration: none;">
      ${mediaHtml}
      ${badgeHtml}
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
  allRecords = images;
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
  currentFilteredRecords = filtered;
  
  if (filtered.length === 0) {
    emptyState.style.display = 'flex';
  } else {
    emptyState.style.display = 'none';
    filtered.forEach(img => {
      imageGrid.appendChild(createImageCard(img));
    });
  }

  // 刷新预览界面的按钮可见度（如果预览已经打开）
  updatePreviewNavButtons();
}

// 刷新配置
async function loadConfig() {
  appConfig = await window.electronAPI.getConfig();
  applyTheme(appConfig.theme);
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

function updatePreviewNavButtons() {
  if (!previewPrevBtn || !previewNextBtn) return;
  if (currentFilteredRecords.length <= 1) {
    previewPrevBtn.classList.add('disabled');
    previewNextBtn.classList.add('disabled');
  } else {
    previewPrevBtn.classList.remove('disabled');
    previewNextBtn.classList.remove('disabled');
  }
}

function loadPreviewByIndex() {
  if (currentPreviewIndex < 0 || currentPreviewIndex >= currentFilteredRecords.length) return;
  const record = currentFilteredRecords[currentPreviewIndex];
  const filePath = record.filepath;
  
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

  updatePreviewNavButtons();
}

function openPreview(filePath: string) {
  let index = currentFilteredRecords.findIndex(r => r.filepath === filePath);
  if (index === -1) {
    // If not found in currentFilteredRecords, fall back to search in allRecords
    index = allRecords.findIndex(r => r.filepath === filePath);
    if (index !== -1) {
      currentFilteredRecords = [...allRecords];
    } else {
      // Fallback
      currentFilteredRecords = [{ id: '', filename: '', filepath: filePath, createdAt: Date.now() }];
      index = 0;
    }
  }

  currentPreviewIndex = index;
  loadPreviewByIndex();
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

  const navigatePreview = (direction: 'prev' | 'next') => {
    if (currentFilteredRecords.length <= 1) return;
    if (direction === 'prev') {
      currentPreviewIndex = (currentPreviewIndex - 1 + currentFilteredRecords.length) % currentFilteredRecords.length;
    } else {
      currentPreviewIndex = (currentPreviewIndex + 1) % currentFilteredRecords.length;
    }
    loadPreviewByIndex();
  };

  previewPrevBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // 避免触发点击 modal 背景关闭
    navigatePreview('prev');
  });

  previewNextBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // 避免触发点击 modal 背景关闭
    navigatePreview('next');
  });

  // 绑定预览模态框关闭事件
  previewCloseBtn.addEventListener('click', closePreview);
  previewModal.addEventListener('click', (e) => {
    if (e.target === previewModal) {
      closePreview();
    }
  });
  window.addEventListener('keydown', (e) => {
    if (!previewModal.classList.contains('show')) return;
    if (e.key === 'Escape') {
      closePreview();
    } else if (e.key === 'ArrowLeft') {
      navigatePreview('prev');
    } else if (e.key === 'ArrowRight') {
      navigatePreview('next');
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

  // 实例化设置管理器并注册配置保存后的回调事件
  const settingsManager = new SettingsManager();
  settingsManager.registerOnConfigSaved(async () => {
    await loadConfig();
    await loadImages();
  });

  // 3. 注册主进程推送事件的监听
  window.electronAPI.onNewImage(async (record) => {
    await loadImages();
  });

  window.electronAPI.onImageDeleted(async (id) => {
    await loadImages();
  });

  // 注册更新相关 IPC 推送事件监听
  window.electronAPI.onUpdateAvailable((data) => {
    latestUpdateData = data;
    downloadedFilePath = null; // 重置已下载的文件路径

    // 恢复图标与主体元素的展示状态（可能被“已是最新版本”所更改）
    if (updateModal) {
      const iconEl = updateModal.querySelector('.update-icon') as HTMLDivElement | null;
      const titleGroupEl = updateModal.querySelector('.update-title-group') as HTMLDivElement | null;
      const bodyEl = updateModal.querySelector('.update-body') as HTMLDivElement | null;

      if (iconEl) iconEl.innerText = '🚀';
      if (titleGroupEl) {
        titleGroupEl.innerHTML = `
          <h2>发现新版本 <span id="update-latest-ver">v${cleanVersion(data.latestVersion)}</span> 可用！</h2>
          <p class="update-subtitle">当前版本: <span id="update-current-ver">v${cleanVersion(data.currentVersion)}</span></p>
        `;
      }
      if (bodyEl) {
        bodyEl.style.display = 'flex';
      }
    }

    // 重新获取 DOM 节点引用
    const newLatestVer = document.getElementById('update-latest-ver') as HTMLSpanElement | null;
    const newCurrentVer = document.getElementById('update-current-ver') as HTMLSpanElement | null;

    if (newLatestVer) newLatestVer.innerText = `v${cleanVersion(data.latestVersion)}`;
    if (newCurrentVer) newCurrentVer.innerText = `v${cleanVersion(data.currentVersion)}`;
    if (updateNotesContent) updateNotesContent.innerText = data.releaseNotes || '无更新日志';

    // 默认隐藏进度条容器，显示按钮组
    if (updateProgressContainer) updateProgressContainer.style.display = 'none';
    if (updateProgressBarFill) updateProgressBarFill.style.width = '0%';
    if (updateProgressPercent) updateProgressPercent.innerText = '0%';

    // 激活/显示更新模态框
    if (updateModal) {
      updateModal.classList.add('show');
    }

    // 渲染初始按钮状态
    renderUpdateActions('initial');
  });

  window.electronAPI.onDownloadProgress((progress) => {
    if (updateProgressContainer) updateProgressContainer.style.display = 'flex';
    if (updateProgressStatus) updateProgressStatus.innerText = '正在下载更新包...';
    if (updateProgressPercent) updateProgressPercent.innerText = `${progress.percent}%`;
    if (updateProgressBarFill) updateProgressBarFill.style.width = `${progress.percent}%`;
  });

  window.electronAPI.onDownloadComplete((filePath) => {
    downloadedFilePath = filePath;
    if (updateProgressStatus) updateProgressStatus.innerText = '下载完成，重启后生效';
    if (updateProgressPercent) updateProgressPercent.innerText = '100%';
    if (updateProgressBarFill) updateProgressBarFill.style.width = '100%';

    // 切换按钮组为重启状态
    renderUpdateActions('complete');
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
    if (switchAutostart) {
      switchAutostart.checked = config.openAtLogin || false;
    }
    if (switchSilentstart) {
      switchSilentstart.checked = config.silentStart || false;
    }
    updateSilentStartUIState();
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
        const hasUpdate = await window.electronAPI.checkForUpdates(true);
        if (!hasUpdate) {
          await showNoUpdateModal();
        }
      } catch (err) {
        console.error('Check updates failed: ', err);
        showToast('检查更新失败，请检查网络连接');
      } finally {
        btnCheckUpdate.disabled = false;
        btnCheckUpdate.innerText = '检查更新';
      }
    });
  }
}

// 启动
window.addEventListener('DOMContentLoaded', init);
