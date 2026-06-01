export const IPC_CHANNELS = {
  // 从渲染进程获取/操作数据
  GET_IMAGES: 'images:get',
  DELETE_IMAGE: 'images:delete',
  CLEAR_ALL: 'images:clear-all',
  
  // 拖动操作
  START_DRAG: 'drag:start',
  
  // 窗口控制
  TOGGLE_FLOAT_WINDOW: 'window:toggle-float',
  FLOAT_WINDOW_STATE: 'window:float-state', // 获取当前浮窗是否开启
  
  // 配置相关
  GET_CONFIG: 'config:get',
  UPDATE_CONFIG: 'config:update',
  SELECT_FOLDER: 'config:select-folder', // 选择微信截图监听目录
  
  // 主进程主动推送给渲染进程的事件
  ON_NEW_IMAGE: 'event:new-image',
  ON_IMAGE_DELETED: 'event:image-deleted',
  ON_CONFIG_CHANGED: 'event:config-changed',
};
