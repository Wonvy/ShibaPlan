# 局域网同步 API 与本地数据模型

除 `18421` 信息推送服务外，ShibaPlan 还提供局域网工作区同步 HTTP 接口（默认端口 `18420`），并以开放透明的本地 JSON 文件存储全部状态，方便高级用户备份、编写外部自动化工具或进行二次开发。

---

## 一、局域网工作区同步 HTTP API（默认端口 `18420`）

在桌面端点击右上角二维码图标并启动局域网服务后，可通过以下 REST 端点读取或更新工作区数据：

### 1. 读取工作区数据 `GET /api/workspace`

读取当前生效数据目录下的 `shibaplan-data.json` 原文。

- **请求示例**：
  ```bash
  curl http://127.0.0.1:18420/api/workspace
  ```
- **响应（`200 OK`，`application/json; charset=utf-8`）**：
  - 若本地已有数据文件，直接返回完整的 `WorkspaceData` JSON 对象；
  - 若尚未生成数据文件，返回 `null`。

### 2. 保存并同步工作区数据 `POST /api/workspace`

将完整的工作区 JSON 写入磁盘 `shibaplan-data.json`，并立即向桌面端广播 `workspace-updated` 事件实现双向实时同步（单次请求上限 `20MB`）。

- **请求头**：`Content-Type: application/json; charset=utf-8`
- **成功响应（`200 OK`）**：
  ```json
  { "ok": true }
  ```
- **失败响应（`500 Internal Server Error`）**：纯文本 `save failed`。

::: warning 注意事项
`POST /api/workspace` 为**全量覆盖写入**接口。若外部脚本需增删单条任务或备忘，请先调用 `GET /api/workspace` 获取最新快照，在内存中合并修改后再 `POST` 回写，避免覆盖其他字段。如果只是向信息仪表盘推送状态，请优先使用轻量无状态的 [外部推送 Webhook API (`:18421`)](./push-webhook)。
:::

---

## 二、`shibaplan-data.json` 核心数据模型

本地工作区根文件遵循以下顶层结构（TypeScript 定义位于 `src/types.ts`）：

```json
{
  "columns": [
    { "id": "col_1", "title": "进行中", "color": "#38bdf8", "width": 300 }
  ],
  "projects": [],
  "tasks": [
    {
      "id": "task_1",
      "title": "完善双语接口文档",
      "columnId": "col_1",
      "importance": 3,
      "effort": "M",
      "estimatedMinutes": 90,
      "actualMinutes": 45,
      "status": "in_progress",
      "dueDate": "2026-11-27",
      "createdAt": "2026-11-27T10:00:00.000Z"
    }
  ],
  "ideas": [
    {
      "id": "idea_1",
      "content": "支持在离线文档窗口内直接调试本地 18421 Webhook",
      "tag": "开发",
      "createdAt": "2026-11-27T09:30:00.000Z"
    }
  ],
  "trashedIdeas": [],
  "memos": [
    {
      "id": "memo_1",
      "title": "主域名 SSL 证书",
      "tag": "运维",
      "expiresAt": "2027-03-15",
      "renewDays": 90,
      "pinned": true,
      "content": "使用 acme.sh 自动续签，部署于边缘网关。",
      "createdAt": "2026-11-01T08:00:00.000Z",
      "updatedAt": "2026-11-01T08:00:00.000Z"
    }
  ],
  "memoFolders": [],
  "focusLogs": [],
  "infoBoards": [],
  "infoWidgets": [],
  "settings": {
    "customDataDir": "",
    "locale": "zh-CN",
    "theme": "dark",
    "infoPush": {
      "enabled": true,
      "port": 18421,
      "allowLan": false,
      "autoCreate": true
    }
  }
}
```

---

## 三、自定义多语言包 JSON 格式

在 **设置 → 语言与数据** 中支持导入自定义翻译文件，结构如下：

```json
{
  "code": "ja-JP",
  "name": "日本語",
  "strings": {
    "nav.kanban": "ボード",
    "nav.calendar": "タイムライン",
    "nav.memos": "メモ",
    "nav.info": "ダッシュボード",
    "settings.title": "設定と言語"
  }
}
```
> 未覆盖的词条键会自动回退至内置简体中文或英文文案，不会出现空白界面。

---

## 四、桌面端 Tauri IPC 命令速查（面向二次开发）

前端通过 `@tauri-apps/api/core` 的 `invoke()` 与 Rust 后端交互，主要命令分类如下：

| 分类 | 命令名称（Command） | 功能摘要 |
| :--- | :--- | :--- |
| **工作区与快照** | `get_default_data_dir` / `load_workspace_data` / `save_workspace_data` | 获取默认目录、读写工作区 JSON 并自动维护 7 日每日快照 |
| **快照恢复** | `list_workspace_snapshots` / `restore_workspace_snapshot` | 列出 `backups/` 历史快照并按路径恢复 |
| **素材与导出** | `save_pasted_image` / `export_idea_markdown` | 将 Base64 截图落盘至 `assets/`、将灵感导出为 `.md` |
| **项目归档与预览** | `scan_project_archive_roots` / `load_project_archive_cache` / `list_project_explorer_entries` / `trigger_seer_preview` | 多线程增量扫描项目目录、读取资源管理器子项、触发 Seer 原生空格预览 |
| **信息看板执行器** | `run_info_source` / `cancel_info_run` / `load_info_cache` / `save_info_cache` | 执行脚本/命令/HTTP 数据源、中止运行、读写结果缓存 |
| **推送与局域网** | `start_info_push_server` / `stop_info_push_server` / `sync_info_push_rules` / `start_lan_server` / `stop_lan_server` | 控制 `18421` 推送服务与 `18420` 局域网同步服务 |
| **窗口与文档** | `open_capture_window` / `open_docs_window` / `open_external_url` | 唤起全局闪念窗、打开内置离线文档独立窗口、调用系统浏览器打开外链 |
| **诊断日志** | `append_app_log` / `read_app_logs` / `clear_app_logs` / `get_log_file_path` | 读写与清空自动轮转日志文件 `logs/shibaplan.log` |
