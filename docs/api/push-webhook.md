# 外部推送 Webhook API（端口 `18421`）

通过信息看板内置的**外部脚本推送接收服务（Info Push Receiver）**，系统计划任务（Task Scheduler / Cron）、服务器监控脚本、GitHub Actions 自托管 Runner 或本地构建脚本都可以直接用一次 HTTP `POST` 将最新结果推送到 ShibaPlan 桌面卡片，**ShibaPlan 本身无需轮询或常驻子进程**。

---

## 开启与配置服务

1. 进入顶部导航 **信息（Info）** 视图，点击右上角工具栏中的 **推送服务（天线图标）**。
2. 勾选 **启用本地 HTTP 推送接收服务**，确认端口（默认 `18421`，范围 `1024 ~ 65535`）。
3. 可选开关：
   - **允许局域网设备推送**：开启后监听 `0.0.0.0:18421`，允许同一局域网下的 NAS、树莓派或测试机推送数据；关闭时仅监听 `127.0.0.1`。
   - **收到未知 `pushKey` 时自动创建卡片（`autoCreate`）**：开启后（默认开启），外部脚本首次向一个新标识推送数据时，画布会自动生成一张对应的推送卡片，实现零配置接入。

---

## 接口列表

### 1. 健康检查 `GET /api/info/health`

检测推送接收服务是否在线（同样支持简写别名 `GET /health`）。

- **请求示例**：
  ```bash
  curl http://127.0.0.1:18421/api/info/health
  ```
- **成功响应（`200 OK`）**：
  ```json
  {
    "ok": true,
    "service": "shibaplan-info-push"
  }
  ```

---

### 2. 推送卡片数据 `POST /api/info/push/<key>`

向指定 `pushKey` 标识的信息卡片推送最新内容。

#### 支持的端点写法（三选一，推荐方式一）
1. **路径参数（推荐）**：`POST /api/info/push/<key>`（支持 URL 百分号编码，如 `/api/info/push/build-main`）
2. **Query 参数**：`POST /api/info/push?key=<key>`
3. **请求头指定**：`POST /api/info/push` 并附带请求头 `X-Shiba-Key: <key>`

#### 请求参数与请求头

| 位置 | 名称 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| Path / Query / Header | `key` / `X-Shiba-Key` | **是** | 目标卡片的推送唯一标识（`pushKey`） |
| Query / Header | `title` / `X-Shiba-Title` | 否 | 当触发 `autoCreate` 自动新建卡片时使用的卡片标题（`?title=` 优先于请求头） |
| Header | `Authorization` | 条件必填 | 若目标卡片设置了 `pushToken`，传入 `Bearer <token>` |
| Header | `X-Shiba-Token` | 条件必填 | 等价鉴权请求头，直接传入 `<token>` |
| Query | `token` | 条件必填 | 等价鉴权 Query 参数 `?token=<token>`（不便设置 Header 时使用） |
| Header | `Content-Type` | 推荐 | JSON 协议建议设为 `application/json; charset=utf-8`；纯文本或 Markdown 设为 `text/plain; charset=utf-8` |

> **体积上限**：单次推送请求体最大为 **`1 MB`（`1,048,576` 字节）**，超出将直接返回 `413 Payload Too Large`；同时原生支持 `Expect: 100-continue` 握手。

#### 请求体（Body）支持格式
1. **标准协议 JSON（推荐）**：包含 `"schema": "shibaplan-info/v1"`，详见 [标准数据源协议](./info-protocol)。
2. **任意普通 JSON**：JSON 对象自动渲染为键值面板（`kv`），对象数组自动提取列名渲染为数据表格（`table`）。
3. **Markdown 或纯文本**：直接传多行 Markdown 或日志文本即可自动排版展示。

#### 响应状态码与返回体

| HTTP 状态码 | 含义 | 响应 JSON 示例 |
| :--- | :--- | :--- |
| `200 OK` | 推送成功并已实时刷新卡片 | `{"ok":true,"key":"my-task","matched":true,"receivedAt":"2026-11-27T18:30:00+08:00"}` |
| `400 Bad Request` | 未提供 `pushKey` | `{"ok":false,"error":"missing push key in URL path or ?key="}` |
| `401 Unauthorized` | 卡片已设令牌，但请求令牌缺失或不匹配 | `{"ok":false,"error":"invalid push token"}` |
| `404 Not Found` | 未知的 `pushKey` 且服务端已关闭 `autoCreate`，或路径错误 | `{"ok":false,"error":"unknown push key and autoCreate is disabled"}` |
| `413 Payload Too Large` | 请求体超过 1MB 上限 | `{"ok":false,"error":"payload exceeds 1MB limit"}` |

---

## 在线交互调试器（直连本机）

只要你的电脑正在运行 ShibaPlan 且开启了推送接收服务，可在下方直接点击 **发送测试推送** 实时在信息看板中生成或更新卡片：

<WebhookPlayground lang="zh" />

---

## 多语言接入代码示例

::: code-group

```bash [cURL]
curl -X POST "http://127.0.0.1:18421/api/info/push/my-task?title=服务巡检" \
  -H "Content-Type: application/json; charset=utf-8" \
  -H "Authorization: Bearer YOUR_OPTIONAL_TOKEN" \
  -d '{
    "schema": "shibaplan-info/v1",
    "status": "ok",
    "badge": "正常",
    "blocks": [
      {
        "type": "metrics",
        "items": [
          { "label": "延迟", "value": 18, "unit": "ms", "tone": "ok" },
          { "label": "队列", "value": 0, "tone": "info" }
        ]
      }
    ]
  }'
```

```python [Python 3 (零第三方依赖)]
import json
import urllib.request

url = "http://127.0.0.1:18421/api/info/push/my-task"
payload = {
    "schema": "shibaplan-info/v1",
    "status": "ok",
    "badge": "在线",
    "blocks": [
        {
            "type": "kv",
            "items": [
                {"key": "节点", "value": "worker-01", "tone": "ok"},
                {"key": "GPU 显存", "value": "9.2 / 24 GB"},
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
  badge  = "已同步"
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
        items: [{ title: "打包产物校验通过", subtitle: "dist/ · 刚刚", tag: "OK", tone: "ok" }],
      },
    ],
  }),
});

console.log(await res.json());
```

:::
