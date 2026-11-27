# Info Source Protocol (`shibaplan-info/v1`) & Script Contract

All Info Dashboard sources—**local scripts (`script`)**, **CLI commands (`command`)**, **HTTP requests (`http`)**, and **external Webhook pushes (`push`)**—share the exact same parser and layout engine.

---

## 3-Tier Progressive Compatibility

1. **Tier 1 · Standard Protocol (`shibaplan-info/v1`)**: Output JSON with `"schema": "shibaplan-info/v1"` (or a `blocks` array) to unlock semantic status tones, sparklines, composite multi-block layouts, rich hover tooltips, and footer action buttons.
2. **Tier 2 · Arbitrary JSON Auto-Fallback (with JSONPath)**:
   - Optional `jsonPath` extraction (e.g., `$.data.list` or `items[0].stats`);
   - **Array of objects `[ {...}, {...} ]`** → auto-rendered as a **Data Table (`table`)** (up to 12 columns);
   - **Plain object `{ "host": "srv-1", "ok": true }`** → auto-rendered as a copyable **Key-Value Panel (`kv`)**;
   - **Scalar array `["item1", "item2"]`** → auto-rendered as a **List (`list`)**.
3. **Tier 3 · Markdown / Plain Text Fallback**: Output containing Markdown headings, fenced code blocks, tables, or links renders as formatted Markdown; everything else renders in clean monospace text.

---

## Top-Level Envelope Schema

```json
{
  "schema": "shibaplan-info/v1",
  "status": "ok",
  "title": "Optional dynamic card title",
  "subtitle": "Optional subtitle",
  "badge": "Healthy",
  "updatedAt": "2026-11-27T18:30:00+08:00",
  "blocks": [],
  "actions": []
}
```

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `schema` | `string` | Recommended | Constant `"shibaplan-info/v1"` |
| `status` | `"ok" \| "info" \| "warn" \| "error"` | No | Card status tone (aliases `success`→`ok`, `warning`→`warn`, `danger`/`fail`→`error`). `warn` and `error` surface indicator dots on the top **Info** nav tab |
| `title` | `string` | No | Overrides the widget's configured title |
| `subtitle` | `string` | No | Secondary caption in the card header |
| `badge` | `string` | No | Compact status pill in the top-right header (`"Online"`, `"3 Open"`, `"v0.2.7"`) |
| `updatedAt` | `string` | No | ISO 8601 timestamp |
| `blocks` | `InfoBlock[]` | Recommended | Ordered list of visual blocks rendered inside the card |
| `actions` | `InfoAction[]` | No | Interactive footer buttons |

> **Single-Block Shorthand**: For simple single-view outputs, you can omit `blocks` and specify `"view": "kv", "items": [...]` directly at the top level (`metrics`, `list`, `kv`, `table`, `markdown`, or `text`).

---

## Block Types Reference (`blocks`)

### 1. KPI Metrics (`type: "metrics"`)
```json
{
  "type": "metrics",
  "title": "System Resources",
  "items": [
    {
      "label": "CPU Load",
      "value": 28,
      "unit": "%",
      "trend": "-5%",
      "tone": "ok",
      "sparkline": [42, 39, 35, 31, 28],
      "tooltip": {
        "title": "CPU Details",
        "items": [
          { "label": "Cores", "value": "16 Cores" },
          { "label": "Temp", "value": "54 °C" }
        ]
      }
    }
  ]
}
```

### 2. Event / Feed List (`type: "list"`)
Clicking an item with `url` or `path` opens the web URL or local OS path:
```json
{
  "type": "list",
  "title": "Recent Builds",
  "items": [
    {
      "title": "Windows NSIS installer built",
      "subtitle": "main #142",
      "tag": "PASS",
      "time": "2m ago",
      "tone": "ok",
      "url": "https://github.com/Wonvy/ShibaPlan/actions"
    }
  ]
}
```

### 3. Key-Value Panel (`type: "kv"`)
Values default to `copyable: true` (one-click copy to clipboard):
```json
{
  "type": "kv",
  "title": "Node Properties",
  "items": [
    { "key": "Endpoint", "value": "192.168.1.20:8080", "copyable": true },
    { "key": "TLS Expiry", "value": "68 days", "tone": "ok" }
  ]
}
```
*(Shorthand object maps like `{"Endpoint": "192.168.1.20:8080"}` are also accepted for `items`.)*

### 4. Data Table (`type: "table"`)
```json
{
  "type": "table",
  "title": "Active Listeners",
  "columns": ["Service", "Port", "State"],
  "rows": [
    ["LAN Sync", 18420, "Running"],
    ["Info Push", 18421, "Running"]
  ]
}
```

### 5. Markdown (`type: "markdown"`) & Plain Text (`type: "text"`)
```json
{
  "type": "markdown",
  "title": "Release Checklist",
  "content": "- [x] TypeScript build passed\n- [x] Cargo check passed"
}
```

---

## Hover Tooltips (`tooltip`) & Footer Actions (`actions`)

### `tooltip` Formats (supported on `metrics`, `list`, and `kv` items)
1. **String**: `"tooltip": "Click to copy endpoint"`
2. **Dictionary**: `"tooltip": { "PID": 4820, "Uptime": "14d" }`
3. **Structured Object**: `"tooltip": { "title": "Node Info", "text": "Primary worker", "items": [{ "label": "Region", "value": "ap-east" }] }`

### `actions` Footer Buttons
```json
"actions": [
  { "label": "Open Console", "openUrl": "https://example.com/dashboard" },
  { "label": "Open Log Dir", "openPath": "D:\\Logs\\service" },
  { "label": "Copy Version", "copyText": "v0.2.7" }
]
```

---

## Script Execution Context Contract

When running `script` or `command` widgets, ShibaPlan injects runtime context via both **environment variables** and **`stdin` JSON**, with `PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8` enabled automatically.

### 1. Injected Environment Variables

| Variable | Example | Description |
| :--- | :--- | :--- |
| `SHIBA_WIDGET_ID` | `info_w_9f8a2c` | Unique ID of the executing widget |
| `SHIBA_WIDGET_TITLE` | `Service Health` | Display title of the widget |
| `SHIBA_TRIGGER` | `manual` / `schedule` / `startup` / `test` | Trigger source for this run |
| `SHIBA_DATA_DIR` | `C:\Users\...\Documents\ShibaPlan` | Active local ShibaPlan data directory |
| `SHIBA_LAST_RUN_AT` | `2026-11-27T18:00:00+08:00` | Previous execution timestamp (omitted on first run) |
| `SHIBA_PARAM_<KEY>` | Custom string | Custom widget parameters normalized to uppercase snake_case (e.g., `repo_name=ShibaPlan` → `SHIBA_PARAM_REPO_NAME`) |

### 2. `stdin` JSON Payload

```json
{
  "widgetId": "info_w_9f8a2c",
  "widgetTitle": "Service Health",
  "trigger": "schedule",
  "dataDir": "C:\\Users\\Wonvy\\Documents\\ShibaPlan",
  "lastRunAt": "2026-11-27T18:00:00+08:00",
  "params": {
    "topic": "AI",
    "limit": "5"
  }
}
```

### 3. Minimal Python Script Template

```python
import json
import os
import sys

ctx = json.loads(sys.stdin.read() or "{}")
params = ctx.get("params", {})
limit = int(params.get("limit", os.environ.get("SHIBA_PARAM_LIMIT", "3")))

output = {
    "schema": "shibaplan-info/v1",
    "status": "ok",
    "badge": f"Top {limit}",
    "blocks": [
        {
            "type": "metrics",
            "items": [
                {"label": "Trigger", "value": ctx.get("trigger", "manual"), "tone": "info"},
                {"label": "Health", "value": "OK", "tone": "ok"},
            ],
        }
    ],
}

print(json.dumps(output, ensure_ascii=False))
```
