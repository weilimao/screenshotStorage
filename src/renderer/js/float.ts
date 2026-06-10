import { ImageRecord } from '../../shared/types';

const floatImageList = document.getElementById('float-image-list') as HTMLDivElement;
const floatEmptyState = document.getElementById('float-empty-state') as HTMLDivElement;
const btnCloseFloat = document.getElementById('btn-close-float') as HTMLButtonElement;
const btnExpandFloat = document.getElementById('btn-expand-float') as HTMLButtonElement;
const btnScreenshotFloat = document.getElementById('btn-screenshot-float') as HTMLButtonElement;
const toast = document.getElementById('toast') as HTMLDivElement;

let isExpanded = false; // 默认收起

function showToast(message: string) {
  toast.innerText = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 1500);
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const addZero = (n: number) => n < 10 ? '0' + n : n;
  return `${addZero(date.getHours())}:${addZero(date.getMinutes())}`;
}

function renderCard(record: ImageRecord): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'float-card';
  card.id = `float-card-${record.id}`;
  
  const ext = record.filename.split('.').pop()?.toLowerCase();
  const isVideo = ['mp4', 'mov', 'avi', 'mkv', 'flv', 'wmv'].includes(ext || '');
  
  let mediaHtml = '';
  if (isVideo) {
    mediaHtml = `<video src="${record.filepath}" muted loop autoplay style="width: 100%; height: 100%; object-fit: contain; pointer-events: none;"></video>`;
  } else {
    mediaHtml = `<img src="${record.filepath}" alt="Screenshot">`;
  }
  
  const badgeClass = isVideo ? 'badge-video' : 'badge-image';
  const badgeText = isVideo ? '视频' : '图片';
  const badgeHtml = `<div class="float-diagonal-badge ${badgeClass}">${badgeText}</div>`;
  
  const fileUrl = `https://${record.filepath.replace(/\\/g, '/')}`;
  card.innerHTML = `
    <a href="${fileUrl}" class="float-img-wrapper" draggable="true" style="cursor: zoom-in; display: block; text-decoration: none;">
      ${mediaHtml}
      ${badgeHtml}
      <div class="float-overlay">
        <span class="float-drag-txt">拖动路径</span>
      </div>
    </a>
    <div class="float-card-info">
      <span class="float-time">⏰ ${formatTime(record.createdAt)}</span>
      <div class="float-action-buttons" style="display: flex; gap: 4px; width: 100%;">
        <button class="float-btn-action btn-preview-float" style="flex: 1; font-size: 10px; padding: 4px 2px;">
          🔍 预览
        </button>
        <button class="float-btn-action btn-copy-path" data-path="${record.filepath}" style="flex: 1; font-size: 10px; padding: 4px 2px;">
          📋 复制
        </button>
      </div>
    </div>
  `;

  // 绑定拖动事件与双击预览
  const imgWrapper = card.querySelector('.float-img-wrapper') as HTMLAnchorElement;
  imgWrapper.addEventListener('click', (e) => {
    e.preventDefault(); // 阻止 a 标签点击跳转
  });
  imgWrapper.addEventListener('dragstart', (e) => {
    const ext = record.filename.split('.').pop()?.toLowerCase();
    const isVideo = ['mp4', 'mov', 'avi', 'mkv', 'flv', 'wmv'].includes(ext || '');

    if (isVideo) {
      e.preventDefault();
      // 复制绝对路径到剪贴板
      window.electronAPI.copyFileToClipboard(record.filepath);
      // 显示提示消息
      showToast('已复制视频路径，可以直接粘贴');
      // 启动原生拖拽以穿透悬浮窗边界并展示拖拽状态
      window.electronAPI.startDrag(record.filepath);
    } else {
      // 图片文件：继续使用 Electron 原生拖动，支持发送物理文件
      e.preventDefault();
      window.electronAPI.startDrag(record.filepath);
    }
  });
  imgWrapper.addEventListener('dblclick', () => {
    window.electronAPI.triggerMainPreview(record.filepath);
  });

  // 绑定预览按钮点击
  const previewBtn = card.querySelector('.btn-preview-float') as HTMLButtonElement;
  previewBtn.addEventListener('click', async () => {
    await window.electronAPI.triggerMainPreview(record.filepath);
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
      console.error(err);
      showToast('复制失败');
    }
  });

  return card;
}

function applyTheme(theme?: 'dark' | 'light') {
  if (theme === 'light') {
    document.body.classList.add('light-theme');
  } else {
    document.body.classList.remove('light-theme');
  }
}

async function loadFloatImages() {
  const images = await window.electronAPI.getImages();
  
  // 核心逻辑：折叠时仅展示 1 张，展开时展示 3 张
  const countToDisplay = isExpanded ? 3 : 1;
  const targetHeight = isExpanded ? 345 : 145;
  
  // 1. 调整 Electron 窗口大小
  window.electronAPI.resizeFloatWindow(240, targetHeight);
  
  // 2. 更新展开按钮的箭头
  btnExpandFloat.innerText = isExpanded ? '▲' : '▼';
  btnExpandFloat.title = isExpanded ? '收起列表' : '展开列表';

  const recordsList = images.slice(0, countToDisplay);
  
  floatImageList.innerHTML = '';
  if (recordsList.length === 0) {
    floatEmptyState.style.display = 'flex';
  } else {
    floatEmptyState.style.display = 'none';
    recordsList.forEach(rec => {
      floatImageList.appendChild(renderCard(rec));
    });
  }
}

async function init() {
  // 加载初始图片与主题
  await loadFloatImages();
  
  const config = await window.electronAPI.getConfig();
  applyTheme(config.theme);

  btnCloseFloat.addEventListener('click', () => {
    window.electronAPI.toggleFloatWindow();
  });

  if (btnScreenshotFloat) {
    btnScreenshotFloat.addEventListener('click', () => {
      window.electronAPI.triggerScreenshot();
    });
  }

  // 绑定收起展开事件
  btnExpandFloat.addEventListener('click', async () => {
    isExpanded = !isExpanded;
    await loadFloatImages();
  });

  // 监听新图片捕获：重新加载显示
  window.electronAPI.onNewImage(async () => {
    await loadFloatImages();
  });

  // 监听图片删除
  window.electronAPI.onImageDeleted(async () => {
    await loadFloatImages();
  });

  // 监听配置主题广播并应用
  window.electronAPI.onConfigChanged((updatedConfig) => {
    applyTheme(updatedConfig.theme);
  });
}

window.addEventListener('DOMContentLoaded', init);
