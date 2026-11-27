# LAN Sync API & Data Schema

Alongside the `18421` Info Push server, ShibaPlan includes a LAN Workspace Sync HTTP server (default port `18420`) and stores all application state in human-readable JSON files for straightforward backups, scripting, and extension.

---

## 1. LAN Workspace Sync HTTP API (Default Port `18420`)

Once started via the top-bar QR Code dialog, the LAN server exposes the following endpoints:

### Read Workspace `GET /api/workspace`

Returns the raw `shibaplan-data.json` payload from the active data directory.

- **Example Request**:
  ```bash
  curl http://127.0.0.1:18420/api/workspace
  ```
- **Response (`200 OK`, `application/json; charset=utf-8`)**:
  - Full `WorkspaceData` JSON object if initialized, or `null` otherwise.

### Save & Broadcast Workspace `POST /api/workspace`

Writes the full workspace JSON to `shibaplan-data.json` and emits a `workspace-updated` Tauri event so the desktop UI updates immediately (max payload `20MB`).

- **Headers**: `Content-Type: application/json; charset=utf-8`
- **Success Response (`200 OK`)**:
  ```json
  { "ok": true }
  ```
- **Error Response (`500 Internal Server Error`)**: `save failed`

::: warning Full-Snapshot Semantics
`POST /api/workspace` overwrites `shibaplan-data.json` as a complete snapshot. Always `GET /api/workspace` first, apply your changes to the parsed object, and `POST` the merged document back. For pushing telemetry or status cards, prefer the stateless [External Push Webhook API (`:18421`)](./push-webhook).
:::

---

## 2. `shibaplan-data.json` Root Schema

Defined in `src/types.ts`:

```json
{
  "columns": [
    { "id": "col_1", "title": "In Progress", "color": "#38bdf8", "width": 300 }
  ],
  "projects": [],
  "tasks": [
    {
      "id": "task_1",
      "title": "Ship bilingual API documentation",
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
      "content": "Embed interactive local webhook tester inside offline docs",
      "tag": "Dev",
      "createdAt": "2026-11-27T09:30:00.000Z"
    }
  ],
  "trashedIdeas": [],
  "memos": [
    {
      "id": "memo_1",
      "title": "Production TLS Certificate",
      "tag": "Ops",
      "expiresAt": "2027-03-15",
      "renewDays": 90,
      "pinned": true,
      "content": "Managed via acme.sh on edge gateway.",
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
    "locale": "en-US",
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

## 3. Custom Locale Pack JSON Schema

Importable via **Settings → Language & Data → Import Language JSON**:

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
> Any omitted keys automatically fall back to the built-in Chinese / English dictionary.

---

## 4. Desktop Tauri IPC Commands Reference (For Contributors)

Invoked from TypeScript via `@tauri-apps/api/core` `invoke()`:

| Category | Commands | Summary |
| :--- | :--- | :--- |
| **Workspace & Snapshots** | `get_default_data_dir` / `load_workspace_data` / `save_workspace_data` | Resolve data path, load/save JSON, and maintain rolling 7-day daily backups |
| **Backup Restore** | `list_workspace_snapshots` / `restore_workspace_snapshot` | List and restore daily snapshots from `backups/` |
| **Assets & Markdown** | `save_pasted_image` / `export_idea_markdown` | Save Base64 clipboard screenshots to `assets/` and export `.md` prompts |
| **Project Archive** | `scan_project_archive_roots` / `load_project_archive_cache` / `list_project_explorer_entries` / `trigger_seer_preview` | Multi-threaded incremental indexing, explorer directory listing, and native Seer `Space` preview |
| **Info Runner** | `run_info_source` / `cancel_info_run` / `load_info_cache` / `save_info_cache` | Execute script/command/HTTP sources with timeout & tree-kill, manage cached outputs |
| **Push & LAN Servers** | `start_info_push_server` / `stop_info_push_server` / `sync_info_push_rules` / `start_lan_server` / `stop_lan_server` | Manage port `18421` Webhook server and port `18420` LAN sync server |
| **Windows & Docs** | `open_capture_window` / `open_docs_window` / `open_external_url` | Toggle Quick Capture, open bundled offline documentation window, launch external URLs |
| **Diagnostics** | `append_app_log` / `read_app_logs` / `clear_app_logs` / `get_log_file_path` | Read/write/clear rotating `logs/shibaplan.log` |
