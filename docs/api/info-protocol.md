# 标准数据源协议 (`shibaplan-info/v1`) 与脚本契约

无论是**内置定时脚本（`script`）**、**命令行（`command`）**、**远程 HTTP 接口（`http`）** 还是 **外部推送（`push`）**，ShibaPlan 信息看板都采用同一套解析与渲染引擎。

---

## 三级渐进兼容机制

你不需要为了接入 ShibaPlan 重写已有工具：

1. **Level 1 · 标准协议模式（`shibaplan-info/v1`）**：输出包含 `"schema": "shibaplan-info/v1"`（或包含 `blocks` 数组）的 JSON，解锁完整的状态色标、微折线图（Sparkline）、多块混排、悬停详情浮窗（Tooltip）与底部快捷动作按钮。
2. **Level 2 · 任意 JSON 自动降级（支持 JSONPath）**：
   - 若数据源配置了 `jsonPath`（如 `$.data.list` 或 `items[0].stats`），先提取对应节点；
   - **对象数组 `[ {...}, {...} ]`** → 自动提取前 12 列渲染为**数据表格（`table`）**；
   - **普通对象 `{ "a": 1, "b": "ok" }`** → 自动渲染为可点击复制的**键值面板（`kv`）**；
   - **纯值数组 `["a", "b"]`** → 自动渲染为**列表（`list`）**。
3. **Level 3 · Markdown / 纯文本降级**：若输出包含 Markdown 标题、代码块、表格或链接语法，自动以富文本 Markdown 渲染；否则以等宽终端文本展示。

---

## 顶层 JSON 结构定义

```json
{
  "schema": "shibaplan-info/v1",
  "status": "ok",
  "title": "可选覆盖卡片主标题",
  "subtitle": "可选副标题说明",
  "badge": "正常",
  "updatedAt": "2026-11-27T18:30:00+08:00",
  "blocks": [],
  "actions": []
}
```

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `schema` | `string` | 推荐 | 固定值 `"shibaplan-info/v1"` |
| `status` | `"ok" \| "info" \| "warn" \| "error"` | 否 | 卡片整体状态语义色（兼容别名 `success`→`ok`、`warning`→`warn`、`danger`/`fail`→`error`）。设为 `warn` 或 `error` 时顶栏「信息」标签会亮起告警圆点 |
| `title` | `string` | 否 | 动态覆盖卡片显示的标题 |
| `subtitle` | `string` | 否 | 标题栏辅助说明文字 |
| `badge` | `string` | 否 | 右上角状态徽章短文本（如 `"在线"`、`"3 待办"`、`"v0.2.7"`） |
| `updatedAt` | `string` | 否 | 数据更新时间（ISO 8601 字符串） |
| `blocks` | `InfoBlock[]` | 推荐 | 卡片主体内容块数组，可在同一卡片内自由组合多种块（见下节） |
| `actions` | `InfoAction[]` | 否 | 卡片底部快捷操作按钮组 |

> **单块简写语法**：当整张卡片只需要一种视图时，也可省略 `blocks` 数组，直接在顶层写 `"view": "kv", "items": [...]`（支持 `metrics` / `list` / `kv` / `table` / `markdown` / `text`）。

---

## 六种内容块（`blocks`）详细规范

### 1. KPI 指标卡（`type: "metrics"`）
适合展示核心数值、单位、涨跌趋势与迷你折线图（`sparkline`）：

```json
{
  "type": "metrics",
  "title": "核心资源",
  "items": [
    {
      "label": "CPU 负载",
      "value": 28,
      "unit": "%",
      "trend": "-5%",
      "tone": "ok",
      "sparkline": [42, 39, 35, 31, 28],
      "tooltip": {
        "title": "CPU 详情",
        "items": [
          { "label": "核心数", "value": "16 Cores" },
          { "label": "温度", "value": "54 °C" }
        ]
      }
    }
  ]
}
```

### 2. 条目列表（`type: "list"`）
适合展示构建记录、告警流、RSS 资讯或待办动态；配置 `url` 或 `path` 后点击行可直接打开网页或本地文件：

```json
{
  "type": "list",
  "title": "近期构建",
  "items": [
    {
      "title": "Windows 安装包构建成功",
      "subtitle": "main #142",
      "tag": "PASS",
      "time": "2m ago",
      "tone": "ok",
      "url": "https://github.com/Wonvy/ShibaPlan/actions"
    }
  ]
}
```

### 3. 键值对面板（`type: "kv"`）
适合展示环境属性、版本号、IP 地址；默认 `copyable: true`（点击值一键复制）：

```json
{
  "type": "kv",
  "title": "服务节点信息",
  "items": [
    { "key": "内网地址", "value": "192.168.1.20:8080", "copyable": true },
    { "key": "证书剩余", "value": "68 天", "tone": "ok" }
  ]
}
```
*(注：`items` 也支持直接传简写字典对象 `{"内网地址": "192.168.1.20:8080"}`)*

### 4. 结构化数据表格（`type: "table"`）
```json
{
  "type": "table",
  "title": "端口监听",
  "columns": ["服务", "端口", "状态"],
  "rows": [
    ["LAN Sync", 18420, "Running"],
    ["Info Push", 18421, "Running"]
  ]
}
```

### 5. Markdown 富文本（`type: "markdown"`）与终端文本（`type: "text"`）
```json
{
  "type": "markdown",
  "title": "发布检查单",
  "content": "- [x] 前端类型检查通过\n- [x] Rust Cargo 编译通过"
}
```

---

## 悬停详情（`tooltip`）与底部按钮（`actions`）

### `tooltip` 支持三种写法（可用于 `metrics`、`list`、`kv` 的任意条目）
1. **纯字符串**：`"tooltip": "点击复制详细配置"`
2. **键值字典**：`"tooltip": { "PID": 4820, "启动耗时": "120ms" }`
3. **完整结构**：`"tooltip": { "title": "节点详情", "text": "补充说明", "items": [{ "label": "区域", "value": "ap-east" }] }`

### `actions` 快捷交互按钮
每项按钮可绑定打开外部链接、打开本地文件/目录或复制文本：
```json
"actions": [
  { "label": "打开控制台", "openUrl": "https://example.com/dashboard" },
  { "label": "打开日志目录", "openPath": "D:\\Logs\\service" },
  { "label": "复制版本号", "copyText": "v0.2.7" }
]
```

---

## 脚本运行上下文契约

当 ShibaPlan 运行本地脚本（`kind: "script"`）或系统命令（`kind: "command"`）时，会自动通过**环境变量**与**标准输入 `stdin`** 注入上下文信息，并默认设置 `PYTHONUTF8=1` 与 `PYTHONIOENCODING=utf-8` 彻底避免中文乱码。

### 1. 自动注入的环境变量

| 环境变量名 | 示例值 | 说明 |
| :--- | :--- | :--- |
| `SHIBA_WIDGET_ID` | `info_w_9f8a2c` | 当前信息卡片唯一 ID |
| `SHIBA_WIDGET_TITLE` | `服务健康巡检` | 当前卡片标题 |
| `SHIBA_TRIGGER` | `manual` / `schedule` / `startup` / `test` | 本次运行触发来源 |
| `SHIBA_DATA_DIR` | `C:\Users\...\Documents\ShibaPlan` | 当前工作区本地数据根目录（适合脚本读写持久化状态文件） |
| `SHIBA_LAST_RUN_AT` | `2026-11-27T18:00:00+08:00` | 上一次运行时间（首次运行时未设置） |
| `SHIBA_PARAM_<KEY>` | 自定义字符串 | 卡片编辑器中配置的自定义参数自动转为大写下划线环境变量（例如参数 `repo_name=ShibaPlan` → `SHIBA_PARAM_REPO_NAME`） |

### 2. 标准输入 `stdin` JSON

脚本也可以从 `sys.stdin` 读取一段完整的单行 JSON：

```json
{
  "widgetId": "info_w_9f8a2c",
  "widgetTitle": "服务健康巡检",
  "trigger": "schedule",
  "dataDir": "C:\\Users\\Wonvy\\Documents\\ShibaPlan",
  "lastRunAt": "2026-11-27T18:00:00+08:00",
  "params": {
    "topic": "AI",
    "limit": "5"
  }
}
```

### 3. Python 标准脚本完整模板

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
                {"label": "触发方式", "value": ctx.get("trigger", "manual"), "tone": "info"},
                {"label": "状态", "value": "OK", "tone": "ok"},
            ],
        }
    ],
}

print(json.dumps(output, ensure_ascii=False))
```
