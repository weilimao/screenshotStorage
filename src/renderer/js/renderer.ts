import { ImageRecord, AppConfig } from '../../shared/types';

// DOM 元素引用
const btnToggleFloat = document.getElementById('btn-toggle-float') as HTMLButtonElement;
const floatBtnText = document.getElementById('float-btn-text') as HTMLSpanElement;
const btnAddFolder = document.getElementById('btn-add-folder') as HTMLButtonElement;
const btnClearAll = document.getElementById('btn-clear-all') as HTMLButtonElement;
const watchFolderList = document.getElementById('watch-folder-list') as HTMLDivElement;
const imageGrid = document.getElementById('image-grid') as HTMLDivElement;
const emptyState = document.getElementById('empty-state') as HTMLDivElement;
const toast = document.getElementById('toast') as HTMLDivElement;

// 主题切换 DOM
const btnToggleTheme = document.getElementById('btn-toggle-theme') as HTMLButtonElement;
const themeIcon = document.getElementById('theme-icon') as HTMLSpanElement;
const themeText = document.getElementById('theme-text') as HTMLSpanElement;

// 开机自启 DOM
const switchAutostart = document.getElementById('switch-autostart') as HTMLInputElement;

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

  // 由于 Electron 会拦截并允许本地文件直接读取（如果没有特殊安全限制），
  // 在 Electron 预加载安全环境中，可以直接将 src 设为绝对路径。
  // 注意：在 Electron 中，直接读取本地文件可能需要 `file://` 协议，
  // 为了安全，Electron 在 9+ 限制了从非 file:// 页面读取 file:// 协议，
  // 但由于我们就是本地的 HTML 文件，所以直接用 `record.filepath` 是完全被允许的。
  const imageSrc = record.filepath;

  card.innerHTML = `
    <div class="image-wrapper" draggable="true">
      <img src="${imageSrc}" alt="Screenshot">
      <div class="drag-overlay">
        <span class="drag-icon-ui">🖱️</span>
        <span class="drag-text">拖动到终端</span>
      </div>
    </div>
    <div class="card-info">
      <div class="card-meta">
        <span class="card-time">⏰ ${formatTime(record.createdAt)}</span>
        <span class="card-size">${record.filename.split('_')[0]}</span>
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

  // 绑定双击预览图片
  const cardImg = card.querySelector('img') as HTMLImageElement;
  cardImg.style.cursor = 'zoom-in';
  cardImg.addEventListener('dblclick', () => {
    openPreview(record.filepath);
  });

  // 绑定预览按钮点击
  const previewBtn = card.querySelector('.btn-preview') as HTMLButtonElement;
  previewBtn.addEventListener('click', () => {
    openPreview(record.filepath);
  });

  // 绑定原生拖动事件
  const imageWrapper = card.querySelector('.image-wrapper') as HTMLDivElement;
  imageWrapper.addEventListener('dragstart', (e) => {
    e.preventDefault(); // 阻止浏览器默认拖拽行为
    window.electronAPI.startDrag(record.filepath);
  });

  // 绑定复制路径事件
  const copyBtn = card.querySelector('.btn-copy-path') as HTMLButtonElement;
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(record.filepath);
      showToast('路径已复制到剪贴板！');
    } catch (err) {
      console.error('Failed to copy text: ', err);
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

// 刷新图片展示网格
async function loadImages() {
  const images = await window.electronAPI.getImages();
  imageGrid.innerHTML = '';
  
  if (images.length === 0) {
    emptyState.style.display = 'flex';
  } else {
    emptyState.style.display = 'none';
    images.forEach(img => {
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

// 刷新配置
async function loadConfig() {
  appConfig = await window.electronAPI.getConfig();
  applyTheme(appConfig.theme);
  renderWatchFolders(appConfig.watchFolders);
  if (switchAutostart) {
    switchAutostart.checked = appConfig.openAtLogin || false;
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

function openPreview(filePath: string) {
  previewImage.src = filePath;
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
    });
  }

  // 监听来自小浮窗的预览请求
  window.electronAPI.onTriggerPreview((filePath) => {
    openPreview(filePath);
  });

  // 绑定预览模态框关闭事件
  previewCloseBtn.addEventListener('click', () => {
    previewModal.classList.remove('show');
  });
  previewModal.addEventListener('click', (e) => {
    if (e.target === previewModal) {
      previewModal.classList.remove('show');
    }
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      previewModal.classList.remove('show');
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

  btnClearAll.addEventListener('click', async () => {
    if (confirm('确定要清空所有已保存的截图吗？此操作不可逆！')) {
      await window.electronAPI.clearAll();
      showToast('暂存箱已清空');
    }
  });

  // 3. 注册主进程推送事件的监听
  window.electronAPI.onNewImage((record) => {
    // 隐藏空状态，并在网格头部插入卡片
    emptyState.style.display = 'none';
    const card = createImageCard(record);
    
    // 如果有旧的，先将其在 UI 里移至首位，若不存在则创建
    const existingCard = document.getElementById(`card-${record.id}`);
    if (existingCard) {
      existingCard.remove();
    }
    imageGrid.insertBefore(card, imageGrid.firstChild);
  });

  window.electronAPI.onImageDeleted((id) => {
    if (id === 'all') {
      imageGrid.innerHTML = '';
      emptyState.style.display = 'flex';
    } else {
      const card = document.getElementById(`card-${id}`);
      if (card) {
        card.remove();
      }
      if (imageGrid.children.length === 0) {
        emptyState.style.display = 'flex';
      }
    }
  });

  window.electronAPI.onConfigChanged((config) => {
    appConfig = config;
    applyTheme(config.theme);
    renderWatchFolders(config.watchFolders);
    if (switchAutostart) {
      switchAutostart.checked = config.openAtLogin || false;
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
}

// 启动
window.addEventListener('DOMContentLoaded', init);
