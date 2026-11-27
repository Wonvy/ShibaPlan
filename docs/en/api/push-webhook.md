# External Push Webhook API (Port `18421`)

With ShibaPlan's built-in **Info Push Receiver**, external cron jobs, Task Scheduler scripts, server monitors, or CI/CD runners can update Info Dashboard cards via a single HTTP `POST`—**without ShibaPlan spawning background processes or polling**.

---

## Enabling the Push Server

1. Open the **Info** view from the top navigation bar and click the **Push Server (radio icon)** button in the toolbar.
2. Check **Enable Local HTTP Push Receiver** and confirm the port (`18421` by default, valid range `1024 ~ 65535`).
3. Optional toggles:
   - **Allow LAN Devices (`0.0.0.0`)**: Binds to `0.0.0.0:18421` so NAS boxes, Raspberry Pis, or test rigs on your LAN can push updates; when unchecked, binds to `127.0.0.1` only.
   - **Auto-Create Card on Unknown `pushKey` (`autoCreate`)**: Enabled by default—pushing to a new key automatically creates a matching card on your active board.

---

## Endpoints

### 1. Health Check `GET /api/info/health`

Verifies that the Push Receiver is online (alias `GET /health` is also supported).

- **Example Request**:
  ```bash
  curl http://127.0.0.1:18421/api/info/health
  ```
- **Response (`200 OK`)**:
  ```json
  {
    "ok": true,
    "service": "shibaplan-info-push"
  }
  ```

---

### 2. Push Card Payload `POST /api/info/push/<key>`

Pushes fresh data to the Info card identified by `pushKey`.

#### Supported Key Addressing Styles
1. **Path Parameter (Recommended)**: `POST /api/info/push/<key>` (percent-encoded keys supported, e.g., `/api/info/push/build-main`)
2. **Query Parameter**: `POST /api/info/push?key=<key>`
3. **Request Header**: `POST /api/info/push` with `X-Shiba-Key: <key>`

#### Parameters & Headers

| Location | Name | Required | Description |
| :--- | :--- | :--- | :--- |
| Path / Query / Header | `key` / `X-Shiba-Key` | **Yes** | Unique `pushKey` of the target Info widget |
| Query / Header | `title` / `X-Shiba-Title` | No | Display title used if `autoCreate` creates a new card (`?title=` takes precedence) |
| Header | `Authorization` | Conditional | `Bearer <token>` when the target widget has `pushToken` configured |
| Header | `X-Shiba-Token` | Conditional | Equivalent token header (`<token>`) |
| Query | `token` | Conditional | Equivalent query token (`?token=<token>`) |
| Header | `Content-Type` | Recommended | `application/json; charset=utf-8` for JSON payloads, or `text/plain; charset=utf-8` for Markdown / raw text |

> **Payload Limit**: Maximum body size is **`1 MB` (`1,048,576` bytes)**. Larger payloads receive `413 Payload Too Large`. `Expect: 100-continue` is handled natively.

#### Accepted Body Formats
1. **Standard `shibaplan-info/v1` JSON (Recommended)**: Full multi-block layout, badges, sparklines, tooltips, and actions—see [Info Source Protocol](./info-protocol).
2. **Arbitrary JSON**: Objects render as copyable Key-Value panels (`kv`); arrays of objects automatically render as Data Tables (`table`).
3. **Markdown or Plain Text**: Rendered directly with zero wrapper boilerplate.

#### HTTP Status Codes

| Status Code | Meaning | Example Response Body |
| :--- | :--- | :--- |
| `200 OK` | Accepted and broadcast to desktop UI | `{"ok":true,"key":"my-task","matched":true,"receivedAt":"2026-11-27T18:30:00+08:00"}` |
| `400 Bad Request` | Missing `pushKey` | `{"ok":false,"error":"missing push key in URL path or ?key="}` |
| `401 Unauthorized` | Missing or invalid token for protected widget | `{"ok":false,"error":"invalid push token"}` |
| `404 Not Found` | Unknown `pushKey` with `autoCreate` disabled, or invalid route | `{"ok":false,"error":"unknown push key and autoCreate is disabled"}` |
| `413 Payload Too Large` | Request body exceeds 1MB | `{"ok":false,"error":"payload exceeds 1MB limit"}` |

---

## Interactive Local Webhook Debugger

When ShibaPlan Desktop is running on this machine with Push Receiver enabled, click **Send Live Push** below to create or update a live card immediately:

<WebhookPlayground lang="en" />

---

## Multi-Language Code Examples

::: code-group

```bash [cURL]
curl -X POST "http://127.0.0.1:18421/api/info/push/my-task?title=Service%20Monitor" \
  -H "Content-Type: application/json; charset=utf-8" \
  -H "Authorization: Bearer YOUR_OPTIONAL_TOKEN" \
  -d '{
    "schema": "shibaplan-info/v1",
    "status": "ok",
    "badge": "Healthy",
    "blocks": [
      {
        "type": "metrics",
        "items": [
          { "label": "Latency", "value": 18, "unit": "ms", "tone": "ok" },
          { "label": "Queue", "value": 0, "tone": "info" }
        ]
      }
    ]
  }'
```

```python [Python 3 (Stdlib Only)]
import json
import urllib.request

url = "http://127.0.0.1:18421/api/info/push/my-task"
payload = {
    "schema": "shibaplan-info/v1",
    "status": "ok",
    "badge": "Online",
    "blocks": [
        {
            "type": "kv",
            "items": [
                {"key": "Node", "value": "worker-01", "tone": "ok"},
                {"key": "VRAM", "value": "9.2 / 24 GB"},
            ],
        }
    ],
}

req = urllib.request.Request(
    url,
    data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
    headers={
        "Content-Type": "application/json; charset=utf-8",
        # "Authorization": "Bearer YOUR_OPTIONAL_TOKEN",
    },
    method="POST",
)
with urllib.request.urlopen(req, timeout=5) as resp:
    print(resp.status, resp.read().decode("utf-8"))
```

```powershell [PowerShell]
$body = @{
  schema = "shibaplan-info/v1"
  status = "ok"
  badge  = "Synced"
  blocks = @(
    @{
      type  = "metrics"
      items = @(
        @{ label = "CPU"; value = 16; unit = "%"; tone = "ok" }
      )
    }
  )
} | ConvertTo-Json -Depth 6

Invoke-RestMethod `
  -Uri "http://127.0.0.1:18421/api/info/push/my-task" `
  -Method Post `
  -ContentType "application/json; charset=utf-8" `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

```javascript [Node.js 18+]
const res = await fetch("http://127.0.0.1:18421/api/info/push/my-task", {
  method: "POST",
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    // Authorization: "Bearer YOUR_OPTIONAL_TOKEN",
  },
  body: JSON.stringify({
    schema: "shibaplan-info/v1",
    status: "ok",
    badge: "Ready",
    blocks: [
      {
        type: "list",
        items: [{ title: "Release artifacts verified", subtitle: "dist/ · just now", tag: "OK", tone: "ok" }],
      },
    ],
  }),
});

console.log(await res.json());
```

:::
