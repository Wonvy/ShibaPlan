<div align="center">

<img src="./app-icon.svg" alt="ShibaPlan" width="72" height="72" />

# ShibaPlan

**面向设计、开发与评测工作者的跨平台极简节奏工作台**  
自定义看板 · 自由画布 · 灵感流 · 时间月历 · AI 联动工作流

[English](./README.md) · [简体中文](./README.zh-CN.md)

![Tauri 2](https://img.shields.io/badge/Tauri-2.0-24C8DB?style=flat-square&logo=tauri&logoColor=white)
![React 18](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white)
![shadcn/ui](https://img.shields.io/badge/Design-shadcn%2Fui-18181B?style=flat-square)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-52525B?style=flat-square)

</div>

---

## 简介

**ShibaPlan** 专为同时兼顾设计、开发与评测的个人创作者打造。摒弃臃肿的传统项目管理界面，将**自定义看板**、**自由画布**、**月历时间视图**与底部缓缓流动的**灵感流**融为一体——帮你理清优先级与时间节奏，同时让随时冒出的灵感与截图能一键转化为 AI 可直接执行的开发规格。

## 核心特性

### 看板与自由画布
- **完全自定义看板列**：自由创建、重命名、选色、拖拽排序，支持单独拖拽调节每列宽度及列与列之间的间距；右键列标题可按列开关卡片显示字段（耗时、日期、备注、图片）。
- **文件夹式折叠**：双击任意看板列标题即可折成紧凑文件夹卡片，大号数字直观呈现待办、完成与预估耗时，折叠后同样支持拖拽调高与拖入卡片。
- **自由画布模式**：自由摆放所有看板列与文件夹，拖动时自动显示对齐参考线并磁吸吸附（按住 `Alt` 临时取消吸附）；支持画布空白处滚轮缩放、空格拖拽平移、一键整齐排列与适配全屏。
- **本地文件与文件夹快捷方式**：直接从系统拖入文件夹或文件生成快捷卡片，支持卡片内折叠展开查看文件列表，点击即可调用系统默认程序打开。
- **悬停即粘贴与双击新建**：鼠标悬停在任意看板列、灵感流或日历日期上直接按 `Ctrl + V`，自动插入剪贴板文字、截图或路径并进入编辑状态；空白处双击即可快速新建卡片。

### 灵感流与 AI 工作流
- **多行流动灵感河**：圆角矩形胶囊根据字数呈现自然长短变化，支持悬停阅读完整内容、鼠标滚轮左右滑动、拖拽调节高度、折叠底栏，以及支持滚轮快翻的自动分页列表视图。
- **双向拖放与回收站**：灵感卡片可直接拖入上方看板列或时间月历（用后自动归档至灵感回收站，随时可恢复）；看板卡片也可拖回灵感流（按住 `Alt` 为复制）。
- **全局快捷闪念**：系统托盘常驻，在任何软件中按 `Alt + Space`（冲突时自动切为 `Ctrl + Shift + Space`）秒速呼出悬浮窗记文字与贴图。
- **轻量 AI 直连**：支持一键生成结构化 Markdown Prompt 并导出 `.md`；可选配置 OpenAI 兼容 / DeepSeek / 本地 Ollama 接口，实现**灵感一键拆解为看板卡片**与**AI 今日排期建议**。

### 时间视图、极速检索与视觉质感
- **时间月历视图**：悬停日期浮现当天任务详情，支持任务跨天拖拽改期与灵感直接拖入排期。
- **全局命令面板与撤销栈**：`Ctrl + K` 全局模糊搜索任务、文件夹、灵感与回收站；`Ctrl + Z` / `Ctrl + Shift + Z` 支持 30 步历史撤销与重做。
- **shadcn/ui 主题与纸张质感**：内置**深色 / 浅色 / 纸张质感**三套语义主题，并提供独立的**细微纸张颗粒质感**开关，三套主题均可叠加柔和纤维质感。
- **多语言导入导出与本地同步**：内置中英文并支持导出/导入自定义语言 JSON；本地 JSON + Markdown 存储，搭配 OneDrive / iCloud / Git 即可实现 Win 与 macOS 无缝同步，支持整库备份与恢复。

---

## 常用快捷键

| 快捷键 | 功能说明 |
| :--- | :--- |
| `Alt + Space` / `Ctrl + Shift + Space` | 全局呼出 / 隐藏闪念悬浮窗（Win / macOS） |
| `Ctrl + K` / `Cmd + K` | 打开全局搜索与命令面板 |
| `Ctrl + Z` / `Ctrl + Shift + Z` | 撤销 / 重做操作历史 |
| `Ctrl + V`（悬停列 / 灵感流 / 日期） | 自动插入剪贴板文字、截图或文件夹路径 |
| `滚轮` / `Ctrl + 滚轮`（自由画布） | 以鼠标为中心平滑缩放画布 |
| `空格 + 拖动` / `中键拖动`（自由画布） | 平移自由画布 |
| `Ctrl + 0` / `Ctrl + +` / `Ctrl + -` | 重置画布视角 / 放大 / 缩小 |

---

## 快速开始

### 环境要求
- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://www.rust-lang.org/tools/install)（用于 Tauri 2.0 桌面端编译）

### 本地开发
```bash
# 安装依赖
npm install

# 启动桌面端（Windows / macOS）
npm run tauri dev

# 或仅启动前端浏览器预览
npm run dev
```

### 打包正式安装包
```bash
# 生成独立安装包（Windows: .msi / .exe，macOS: .dmg）
npm run tauri build
```

---

## 自定义语言包

1. 打开右上角 **设置** → **界面语言** → 点击 **导出语言文件**。
2. 翻译导出的 `shibaplan-lang-*.json` 中的词条，并修改 `code` 与 `name`。
3. 点击 **导入语言文件** 即可立即生效并自动保存。

---

## 技术栈

- **桌面端内核**：Tauri 2.0 (Rust) + `tauri-plugin-global-shortcut`
- **前端框架**：React 18、TypeScript、Vite 6
- **设计系统**：shadcn/ui、Radix UI、Tailwind CSS、Lucide Icons

## 开源协议

MIT
