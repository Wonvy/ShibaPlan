<script setup>
import { withBase } from "vitepress";
</script>

# 接口与协议总览

ShibaPlan 不仅是一款本地个人效率工具，还内置了**开放的本地 HTTP 接口、标准 JSON 渲染协议与脚本上下文契约**，方便你的外部自动化脚本、服务器巡检、CI/CD 构建任务、快捷指令或手机浏览器直接与桌面工作台联动。

---

## 核心开放能力一览

| 模块 | 默认地址 / 载体 | 主要用途 | 详情文档 |
| :--- | :--- | :--- | :--- |
| **外部推送 Webhook API** | `http://127.0.0.1:18421` | 外部脚本/定时任务主动 `POST` 数据到信息仪表盘卡片，零轮询开销，支持 Token 鉴权与自动建卡 | [外部推送 Webhook API](./push-webhook) |
| **标准数据源协议 (`v1`)** | `stdout` / HTTP 响应 / Webhook Body | 统一定义 KPI 指标、趋势折线、列表、键值对、表格、Markdown、悬停详情与底部交互动作按钮 | [标准数据源协议 (`shibaplan-info/v1`)](./info-protocol) |
| **脚本运行上下文契约** | 子进程 `stdin` + `SHIBA_*` 环境变量 | 向 Python / PowerShell / Node.js / Shell 脚本传递卡片参数、触发来源、上次运行时间与数据目录 | [脚本环境变量与 stdin](./info-protocol#脚本运行上下文契约) |
| **局域网工作区同步 API** | `http://<LAN_IP>:18420` | 读取或更新 `shibaplan-data.json` 完整工作区数据，并实时广播刷新桌面客户端 | [局域网同步与数据模型](./lan-workspace-api) |

---

## 交互架构简图

```txt
┌───────────────────────────┐     POST /api/info/push/<key>      ┌──────────────────────────────────┐
│ 外部 Python / PS1 / CI任务 │ ─────────────────────────────────▶ │ Info Push HTTP 服务 (:18421)      │
└───────────────────────────┘     (shibaplan-info/v1 / 纯文本)    └────────────────┬─────────────────┘
                                                                                  │ Tauri Event
┌───────────────────────────┐     stdin JSON + SHIBA_* Env       ┌────────────────▼─────────────────┐
│ 内置定时脚本 / CLI / HTTP   │ ◀────────────────────────────────▶ │ ShibaPlan 桌面主进程 & 渲染工作台 │
└───────────────────────────┘     stdout (JSON / Markdown)       └────────────────▲─────────────────┘
                                                                                  │ workspace-updated
┌───────────────────────────┐     GET / POST /api/workspace      ┌────────────────┴─────────────────┐
│ 同一 Wi-Fi 手机端 / 外部端  │ ─────────────────────────────────▶ │ 局域网同步与静态服务 (:18420)      │
└───────────────────────────┘                                    └──────────────────────────────────┘
```

---

## 下载标准 OpenAPI 3.1 规范文件

如果你使用 **Postman、Apifox、Insomnia、Hoppscotch** 或代码生成工具，可直接下载导入本项目的标准 OpenAPI 3.1.0 定义文件：

- <a :href="withBase('/openapi/shibaplan-openapi.zh.yaml')" target="_blank" download>下载中文版 OpenAPI 3.1 规范 (`shibaplan-openapi.zh.yaml`)</a>
- <a :href="withBase('/openapi/shibaplan-openapi.en.yaml')" target="_blank" download>Download English OpenAPI 3.1 Spec (`shibaplan-openapi.en.yaml`)</a>

---

## 网络绑定与安全说明

1. **最小暴露原则**：
   - 信息推送服务（`:18421`）默认仅绑定本机回环地址 **`127.0.0.1`**，局域网其他设备无法访问；仅当你在推送服务设置中显式勾选「允许局域网设备推送（绑定 `0.0.0.0`）」时才对局域网开放。
   - 局域网扫码服务（`:18420`）默认**关闭**，仅在你主动点击开启期间监听。
2. **令牌鉴权（Token Auth）**：
   - 在局域网开启推送接收时，建议为关键卡片配置访问令牌（`pushToken`），未携带正确令牌的请求将被直接拦截并返回 `401 Unauthorized`。
3. **CORS 跨域友好**：
   - 本地服务内置 `Access-Control-Allow-Origin: *` 响应头，支持浏览器脚本、油猴插件（Tampermonkey）或本文档内的在线调试器直接调用。
