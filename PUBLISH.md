# 📦 GitHub Releases 自动构建与发布指南

本项目已集成 `electron-builder`，支持一键将打包好的 Windows 安装包 (`.exe`) 和压缩包 (`.zip`) 自动推送到 GitHub Releases。

---

## 🛠️ 前置准备

### 1. 生成 GitHub 个人访问令牌 (Personal Access Token)

为了让 `electron-builder` 有权将包上传到您的 GitHub 仓库，您需要生成一个具有写入权限的 GitHub Token：

1. 登录 GitHub，点击右上角头像，进入 **Settings**。
2. 在左侧菜单最下方点击 **Developer settings**。
3. 选择 **Personal access tokens** -> **Tokens (classic)**。
4. 点击右上角 **Generate new token** -> 选择 **Generate new token (classic)**。
5. **填写配置：**
   - **Note:** 建议填写用途，如 `screenshot-storage-publish`。
   - **Select scopes:** 必须勾选 **`repo`**（勾选后将自动开启该项下的全部读写权限，包括写入 Release）。
6. 点击最下方的 **Generate token**。
7. **复制并保存生成的 Token**（格式通常为 `ghp_xxxxxxxxxxxx`，该 Token 离开页面后将无法再次查看）。

---

## 🚀 发布步骤

在终端中设置 Token 环境变量并执行发布命令：

### 1. Windows 环境

#### 选项 A：使用 PowerShell (Windows 默认，推荐)
打开 PowerShell 终端，执行以下命令：
```powershell
# 1. 设置临时 Token 环境变量
$env:GH_TOKEN="您的GitHub_Token"

# 2. 执行打包并发布
npm run publish
```

#### 选项 B：使用 CMD
打开 CMD 命令行窗口，执行以下命令：
```cmd
:: 1. 设置临时 Token 环境变量
set GH_TOKEN=您的GitHub_Token

:: 2. 执行打包并发布
npm run publish
```

### 2. macOS / Linux / Git Bash 环境
打开终端，执行以下命令：
```bash
# 1. 设置临时 Token 环境变量
export GH_TOKEN="您的GitHub_Token"

# 2. 执行打包并发布
npm run publish
```

---

## 📢 关键细节说明

### 1. 为什么在 GitHub 仓库主页看不到刚才推送的包？
`electron-builder` 上传的 Release 默认状态为 **Draft (草稿)**。
- 只有仓库管理员（您自己）登录 GitHub 后才能在 Releases 页面看到它。
- **发布公开步骤：**
  1. 打开仓库的 [Releases](https://github.com/weilimao/screenshotStorage/releases) 页面。
  2. 找到最上方的 `v1.0.0` Draft Release，点击右上角的 **Edit**。
  3. 确认底部的构建产物上传无误后，滚动到最下方，点击 **Publish release** 按钮发布。

### 2. 版本号管理
- 每次发布新版本时，请先在 `package.json` 中修改 `"version"` 字段（如从 `"1.0.0"` 改为 `"1.0.1"`）。
- 再次运行 `npm run publish`，它会自动以新的版本号创建对应的 GitHub Release 草稿。

---

## 🔒 安全性建议

> [!WARNING]
> **绝对不要**将带有您真实 `GH_TOKEN` 的打包脚本提交到 Git 仓库，也不要在公共代码中写死 Token。请始终采用在命令行中临时设置环境变量（如上述指令）的方式，以保护您的 GitHub 账户安全。
