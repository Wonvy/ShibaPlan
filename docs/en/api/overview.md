<script setup>
import { withBase } from "vitepress";
</script>

# API & Protocol Overview

ShibaPlan provides **open local HTTP endpoints, a structured JSON rendering schema, and a clean subprocess execution contract** so external scripts, cron jobs, CI/CD runners, and mobile browsers can integrate directly with your desktop workspace.

---

## Integration Surface at a Glance

| Module | Default Endpoint / Transport | Primary Purpose | Reference |
| :--- | :--- | :--- | :--- |
| **External Push Webhook API** | `http://127.0.0.1:18421` | Push structured cards or plain text to the Info Dashboard via `POST` with zero polling, optional Bearer auth, and `autoCreate` | [External Push Webhook API](./push-webhook) |
| **Info Source Protocol (`v1`)** | `stdout` / HTTP Body / Webhook Body | Unified JSON schema for KPI metrics, sparklines, lists, key-value panels, tables, Markdown, hover tooltips, and action buttons | [Info Source Protocol (`shibaplan-info/v1`)](./info-protocol) |
| **Subprocess Context Contract** | `stdin` JSON + `SHIBA_*` env vars | Passes widget metadata, custom parameters, trigger reason, and data directory path to Python / PowerShell / Node.js / Shell scripts | [Script Env & `stdin`](./info-protocol#script-execution-context-contract) |
| **LAN Workspace Sync API** | `http://<LAN_IP>:18420` | Read or write full `shibaplan-data.json` workspace state and broadcast live updates to the desktop app | [LAN Sync & Data Schema](./lan-workspace-api) |

---

## Architecture Diagram

```txt
┌───────────────────────────┐     POST /api/info/push/<key>      ┌──────────────────────────────────┐
│ External Script / CI Job  │ ─────────────────────────────────▶ │ Info Push HTTP Server (:18421)   │
└───────────────────────────┘     (shibaplan-info/v1 / Text)     └────────────────┬─────────────────┘
                                                                                  │ Tauri Event
┌───────────────────────────┐     stdin JSON + SHIBA_* Env       ┌────────────────▼─────────────────┐
│ Managed Script / CLI/HTTP │ ◀────────────────────────────────▶ │ ShibaPlan Desktop Host & UI      │
└───────────────────────────┘     stdout (JSON / Markdown)       └────────────────▲─────────────────┘
                                                                                  │ workspace-updated
┌───────────────────────────┐     GET / POST /api/workspace      ┌────────────────┴─────────────────┐
│ Mobile Browser / LAN Tool │ ─────────────────────────────────▶ │ LAN Sync & Static Server (:18420)│
└───────────────────────────┘                                    └──────────────────────────────────┘
```

---

## Download OpenAPI 3.1 Specifications

Import ShibaPlan's OpenAPI 3.1.0 YAML definitions directly into **Postman, Insomnia, Hoppscotch, Apifox**, or SDK generators:

- <a :href="withBase('/openapi/shibaplan-openapi.en.yaml')" target="_blank" download>Download English OpenAPI 3.1 Spec (`shibaplan-openapi.en.yaml`)</a>
- <a :href="withBase('/openapi/shibaplan-openapi.zh.yaml')" target="_blank" download>下载中文版 OpenAPI 3.1 规范 (`shibaplan-openapi.zh.yaml`)</a>

---

## Network Binding & Security Model

1. **Localhost-First Defaults**:
   - The Info Push Receiver (`:18421`) binds strictly to **`127.0.0.1`** unless **Allow LAN Push (`0.0.0.0`)** is explicitly enabled in the Push Server dialog.
   - The LAN Sync Server (`:18420`) is **stopped by default** and listens only while manually started by the user.
2. **Per-Widget Token Authentication**:
   - Configure a `pushToken` on sensitive push widgets (especially when LAN push is enabled). Requests with missing or mismatched tokens are rejected with `401 Unauthorized`.
3. **Permissive Local CORS**:
   - Local HTTP responses include `Access-Control-Allow-Origin: *`, allowing browser userscripts and the interactive debugger in these docs to call your local instance directly.
