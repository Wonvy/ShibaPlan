import {
  InfoCardStatus,
  InfoScriptLang,
  InfoWidgetSchedule,
  InfoWidgetSource,
} from "../types";
import type { InfoRunResult } from "./infoRunner";

export interface InfoMetricItem {
  label: string;
  value: string | number;
  unit?: string;
  trend?: string;
  tone?: InfoCardStatus;
  sparkline?: number[];
}

export interface InfoListItem {
  title: string;
  subtitle?: string;
  tag?: string;
  time?: string;
  tone?: InfoCardStatus;
  url?: string;
  path?: string;
}

export interface InfoKvItem {
  key: string;
  value: string;
  tone?: InfoCardStatus;
  copyable?: boolean;
}

export interface InfoTableData {
  columns: string[];
  rows: (string | number | boolean | null)[][];
}

export interface InfoAction {
  label: string;
  openUrl?: string;
  openPath?: string;
  copyText?: string;
}

export type InfoBlock =
  | { type: "metrics"; title?: string; items: InfoMetricItem[] }
  | { type: "list"; title?: string; items: InfoListItem[] }
  | { type: "kv"; title?: string; items: InfoKvItem[] }
  | { type: "table"; title?: string; columns: string[]; rows: (string | number | boolean | null)[][] }
  | { type: "markdown"; title?: string; content: string }
  | { type: "text"; title?: string; text: string };

export interface ParsedInfoResult {
  status: InfoCardStatus;
  title?: string;
  subtitle?: string;
  badge?: string;
  updatedAt?: string;
  blocks: InfoBlock[];
  actions: InfoAction[];
  validation: {
    mode: "standard" | "json-fallback" | "text-fallback" | "error";
    message: string;
    warnings: string[];
  };
}

function normalizeTone(raw: unknown): InfoCardStatus | undefined {
  if (raw === "ok" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  if (raw === "success") return "ok";
  if (raw === "warning") return "warn";
  if (raw === "danger" || raw === "fail") return "error";
  return undefined;
}

export function extractJsonPath(data: unknown, rawPath?: string): unknown {
  const trimmed = (rawPath ?? "").trim();
  if (!trimmed) return data;
  const cleaned = trimmed.replace(/^\$\.?/, "");
  if (!cleaned) return data;

  const tokens: (string | number)[] = [];
  const partRe = /[^.[\]]+|\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = partRe.exec(cleaned)) !== null) {
    if (match[1] !== undefined) {
      tokens.push(Number(match[1]));
    } else {
      tokens.push(match[0]);
    }
  }

  let cur: unknown = data;
  for (const tk of tokens) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof tk === "number") {
      if (Array.isArray(cur)) cur = cur[tk];
      else return undefined;
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[tk];
    } else {
      return undefined;
    }
  }
  return cur;
}

function normalizeMetricItems(raw: unknown): InfoMetricItem[] {
  if (!Array.isArray(raw)) return [];
  const out: InfoMetricItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const label = String(rec.label ?? rec.name ?? rec.title ?? "");
    const value = rec.value ?? rec.val ?? "-";
    if (!label && value === "-") continue;
    out.push({
      label: label || "指标",
      value:
        typeof value === "number" || typeof value === "string"
          ? value
          : JSON.stringify(value),
      unit: typeof rec.unit === "string" ? rec.unit : undefined,
      trend: typeof rec.trend === "string" ? rec.trend : undefined,
      tone: normalizeTone(rec.tone ?? rec.status),
      sparkline: Array.isArray(rec.sparkline)
        ? rec.sparkline.filter((n): n is number => typeof n === "number" && Number.isFinite(n))
        : undefined,
    });
  }
  return out;
}

function normalizeListItems(raw: unknown): InfoListItem[] {
  if (!Array.isArray(raw)) return [];
  const out: InfoListItem[] = [];
  for (const item of raw) {
    if (typeof item === "string" || typeof item === "number") {
      out.push({ title: String(item) });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const title = String(rec.title ?? rec.name ?? rec.label ?? rec.text ?? "");
    if (!title) continue;
    out.push({
      title,
      subtitle: typeof rec.subtitle === "string" ? rec.subtitle : typeof rec.desc === "string" ? rec.desc : undefined,
      tag: typeof rec.tag === "string" ? rec.tag : undefined,
      time: typeof rec.time === "string" ? rec.time : undefined,
      tone: normalizeTone(rec.tone ?? rec.status),
      url: typeof rec.url === "string" ? rec.url : undefined,
      path: typeof rec.path === "string" ? rec.path : undefined,
    });
  }
  return out;
}

function normalizeKvItems(raw: unknown): InfoKvItem[] {
  if (Array.isArray(raw)) {
    const out: InfoKvItem[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const key = String(rec.key ?? rec.label ?? rec.name ?? "");
      if (!key) continue;
      const val = rec.value ?? "";
      out.push({
        key,
        value: typeof val === "string" ? val : JSON.stringify(val),
        tone: normalizeTone(rec.tone ?? rec.status),
        copyable: typeof rec.copyable === "boolean" ? rec.copyable : true,
      });
    }
    return out;
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>).map(([k, v]) => ({
      key: k,
      value:
        v === null || v === undefined
          ? "-"
          : typeof v === "string" || typeof v === "number" || typeof v === "boolean"
            ? String(v)
            : JSON.stringify(v),
      copyable: true,
    }));
  }
  return [];
}

function normalizeActions(raw: unknown): InfoAction[] {
  if (!Array.isArray(raw)) return [];
  const out: InfoAction[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const label = typeof rec.label === "string" ? rec.label.trim() : "";
    if (!label) continue;
    out.push({
      label,
      openUrl: typeof rec.openUrl === "string" ? rec.openUrl : undefined,
      openPath: typeof rec.openPath === "string" ? rec.openPath : undefined,
      copyText: typeof rec.copyText === "string" ? rec.copyText : undefined,
    });
  }
  return out;
}

function parseBlock(raw: unknown, warnings: string[]): InfoBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const type = String(rec.type ?? rec.view ?? "").toLowerCase();
  const title = typeof rec.title === "string" ? rec.title : undefined;

  switch (type) {
    case "metrics": {
      const items = normalizeMetricItems(rec.items ?? rec.metrics);
      if (items.length === 0) {
        warnings.push("metrics 块缺少有效 items");
        return null;
      }
      return { type: "metrics", title, items };
    }
    case "list": {
      const items = normalizeListItems(rec.items);
      return { type: "list", title, items };
    }
    case "kv": {
      const items = normalizeKvItems(rec.items ?? rec.data);
      return { type: "kv", title, items };
    }
    case "table": {
      const columns = Array.isArray(rec.columns)
        ? rec.columns.map((c) => String(c))
        : [];
      const rows = Array.isArray(rec.rows)
        ? rec.rows.map((r) =>
            Array.isArray(r)
              ? r.map((cell) =>
                  cell === null ||
                  typeof cell === "string" ||
                  typeof cell === "number" ||
                  typeof cell === "boolean"
                    ? cell
                    : JSON.stringify(cell)
                )
              : [String(r)]
          )
        : [];
      return { type: "table", title, columns, rows };
    }
    case "markdown": {
      const content = String(rec.content ?? rec.markdown ?? rec.text ?? "");
      return { type: "markdown", title, content };
    }
    case "text": {
      const text = String(rec.text ?? rec.content ?? "");
      return { type: "text", title, text };
    }
    default:
      warnings.push(`未识别的块类型: ${type || "unknown"}`);
      return null;
  }
}

function buildJsonFallbackBlock(data: unknown): InfoBlock {
  if (Array.isArray(data)) {
    if (
      data.length > 0 &&
      data.every((row) => row && typeof row === "object" && !Array.isArray(row))
    ) {
      const colSet = new Set<string>();
      for (const row of data.slice(0, 30)) {
        for (const key of Object.keys(row as Record<string, unknown>)) {
          colSet.add(key);
        }
      }
      const columns = Array.from(colSet).slice(0, 12);
      const rows = data.map((row) => {
        const rec = row as Record<string, unknown>;
        return columns.map((col) => {
          const val = rec[col];
          if (
            val === null ||
            val === undefined ||
            typeof val === "string" ||
            typeof val === "number" ||
            typeof val === "boolean"
          ) {
            return val ?? "-";
          }
          return JSON.stringify(val);
        });
      });
      return { type: "table", columns, rows };
    }
    return {
      type: "list",
      items: data.map((item) => ({
        title:
          typeof item === "string" || typeof item === "number"
            ? String(item)
            : JSON.stringify(item),
      })),
    };
  }

  if (data && typeof data === "object") {
    return { type: "kv", items: normalizeKvItems(data) };
  }

  return { type: "text", text: String(data ?? "") };
}

function looksLikeMarkdown(text: string): boolean {
  return (
    /^#{1,6}\s+/m.test(text) ||
    /^```/m.test(text) ||
    /^\s*[-*]\s+\[[ xX]\]/m.test(text) ||
    (/\n\|.+\|\n\|[\s:|-]+\|/m.test(text)) ||
    /\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(text)
  );
}

export function parseInfoOutput(
  run: InfoRunResult,
  jsonPath?: string
): ParsedInfoResult {
  if (!run.ok) {
    const errDetail = [
      run.error || "执行失败",
      run.stderr?.trim() ? `\n--- stderr ---\n${run.stderr.trim()}` : "",
      run.stdout?.trim() ? `\n--- stdout ---\n${run.stdout.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      status: "error",
      badge: run.timedOut
        ? "超时"
        : run.cancelled
          ? "已停止"
          : run.httpStatus
            ? `HTTP ${run.httpStatus}`
            : `Exit ${run.exitCode}`,
      blocks: [{ type: "text", text: errDetail }],
      actions: [],
      validation: {
        mode: "error",
        message: run.error || "执行异常",
        warnings: [],
      },
    };
  }

  const trimmed = run.stdout.trim();
  if (!trimmed) {
    return {
      status: "info",
      blocks: [{ type: "text", text: "(脚本执行成功，但标准输出为空)" }],
      actions: [],
      validation: {
        mode: "text-fallback",
        message: "输出为空",
        warnings: [],
      },
    };
  }

  try {
    const rawJson = JSON.parse(trimmed) as unknown;
    const target = extractJsonPath(rawJson, jsonPath);

    if (target && typeof target === "object" && !Array.isArray(target)) {
      const rec = target as Record<string, unknown>;
      const isStandardEnvelope =
        rec.schema === "shibaplan-info/v1" ||
        Array.isArray(rec.blocks) ||
        typeof rec.view === "string";

      if (isStandardEnvelope) {
        const warnings: string[] = [];
        const blocks: InfoBlock[] = [];

        if (Array.isArray(rec.blocks)) {
          for (const b of rec.blocks) {
            const parsed = parseBlock(b, warnings);
            if (parsed) blocks.push(parsed);
          }
        } else if (typeof rec.view === "string") {
          const single = parseBlock({ ...rec, type: rec.view }, warnings);
          if (single) blocks.push(single);
        }

        if (blocks.length === 0) {
          warnings.push("标准协议未包含可渲染的 blocks，已自动降级为键值展示");
          blocks.push(buildJsonFallbackBlock(rec));
        }

        return {
          status: normalizeTone(rec.status) ?? "ok",
          title: typeof rec.title === "string" ? rec.title : undefined,
          subtitle: typeof rec.subtitle === "string" ? rec.subtitle : undefined,
          badge: typeof rec.badge === "string" ? rec.badge : undefined,
          updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : undefined,
          blocks,
          actions: normalizeActions(rec.actions),
          validation: {
            mode: "standard",
            message:
              warnings.length > 0
                ? `标准协议 v1（含 ${warnings.length} 条提示）`
                : "符合 shibaplan-info/v1 标准协议",
            warnings,
          },
        };
      }
    }

    return {
      status: "ok",
      blocks: [buildJsonFallbackBlock(target)],
      actions: [],
      validation: {
        mode: "json-fallback",
        message: "普通 JSON 自动降级渲染（建议接入 shibaplan-info/v1 协议获得更佳展示）",
        warnings: [],
      },
    };
  } catch {
    const isMd = looksLikeMarkdown(trimmed);
    return {
      status: "ok",
      blocks: [
        isMd
          ? { type: "markdown", content: trimmed }
          : { type: "text", text: trimmed },
      ],
      actions: [],
      validation: {
        mode: "text-fallback",
        message: isMd ? "Markdown 文本降级渲染" : "纯文本输出降级渲染",
        warnings: [],
      },
    };
  }
}

export function extractPlainTextFromParsed(parsed: ParsedInfoResult): string {
  const parts: string[] = [];
  if (parsed.title) parts.push(parsed.title);
  if (parsed.subtitle) parts.push(parsed.subtitle);
  for (const b of parsed.blocks) {
    if (b.title) parts.push(b.title);
    switch (b.type) {
      case "metrics":
        parts.push(
          b.items
            .map(
              (m) =>
                `${m.label}: ${m.value}${m.unit ?? ""}${m.trend ? ` (${m.trend})` : ""}`
            )
            .join("\n")
        );
        break;
      case "list":
        parts.push(
          b.items
            .map((i) => `${i.title}${i.subtitle ? ` - ${i.subtitle}` : ""}`)
            .join("\n")
        );
        break;
      case "kv":
        parts.push(b.items.map((kv) => `${kv.key}: ${kv.value}`).join("\n"));
        break;
      case "table":
        parts.push(b.columns.join(" | "));
        parts.push(b.rows.map((r) => r.join(" | ")).join("\n"));
        break;
      case "markdown":
        parts.push(b.content);
        break;
      case "text":
        parts.push(b.text);
        break;
    }
  }
  return parts.join("\n");
}

// ============================================================================
// Cron Parser & Validator (standard 5-field: min hour dom month dow)
// ============================================================================

function parseCronField(
  field: string,
  min: number,
  max: number,
  allowSevenAsZero = false
): Set<number> | null {
  const out = new Set<number>();
  const parts = field.split(",");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) return null;
    const [rangePart, stepPart] = trimmed.split("/");
    if (trimmed.split("/").length > 2) return null;

    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart)) return null;
      step = Number(stepPart);
      if (step < 1) return null;
    }

    let start = min;
    let end = max;

    if (rangePart === "*") {
      // keep min..max
    } else if (rangePart.includes("-")) {
      const [aStr, bStr] = rangePart.split("-");
      if (!/^\d+$/.test(aStr) || !/^\d+$/.test(bStr)) return null;
      start = Number(aStr);
      end = Number(bStr);
      if (start > end || start < min || end > max) return null;
    } else {
      if (!/^\d+$/.test(rangePart)) return null;
      const single = Number(rangePart);
      if (single < min || single > max) return null;
      start = single;
      end = stepPart !== undefined ? max : single;
    }

    for (let v = start; v <= end; v += step) {
      out.add(allowSevenAsZero && v === 7 ? 0 : v);
    }
  }
  return out.size > 0 ? out : null;
}

export function validateCronExpr(expr: string): { valid: boolean; error?: string } {
  const parts = expr.trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 5) {
    return { valid: false, error: "需要标准 5 位 Cron（分 时 日 月 周），如 0 9 * * *" };
  }
  const [m, h, dom, mon, dow] = parts;
  if (!parseCronField(m, 0, 59)) return { valid: false, error: "「分钟」字段无效 (0-59)" };
  if (!parseCronField(h, 0, 23)) return { valid: false, error: "「小时」字段无效 (0-23)" };
  if (!parseCronField(dom, 1, 31)) return { valid: false, error: "「日期」字段无效 (1-31)" };
  if (!parseCronField(mon, 1, 12)) return { valid: false, error: "「月份」字段无效 (1-12)" };
  if (!parseCronField(dow, 0, 7, true)) return { valid: false, error: "「星期」字段无效 (0-7)" };
  return { valid: true };
}

export function matchesCronDate(expr: string, date: Date): boolean {
  const parts = expr.trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 5) return false;
  const mins = parseCronField(parts[0], 0, 59);
  const hours = parseCronField(parts[1], 0, 23);
  const doms = parseCronField(parts[2], 1, 31);
  const months = parseCronField(parts[3], 1, 12);
  const dows = parseCronField(parts[4], 0, 7, true);
  if (!mins || !hours || !doms || !months || !dows) return false;

  const min = date.getMinutes();
  const hour = date.getHours();
  const dom = date.getDate();
  const month = date.getMonth() + 1;
  const dow = date.getDay();

  if (!mins.has(min) || !hours.has(hour) || !months.has(month)) return false;

  const domStar = parts[2].trim() === "*";
  const dowStar = parts[4].trim() === "*";
  if (!domStar && !dowStar) {
    return doms.has(dom) || dows.has(dow);
  }
  return doms.has(dom) && dows.has(dow);
}

export function describeSchedule(
  schedule: InfoWidgetSchedule,
  kind?: InfoWidgetSource["kind"]
): string {
  if (kind === "push") return "外部推送接收";
  if (schedule.paused) return "已暂停";
  if (schedule.mode === "interval") {
    const sec = Math.max(5, schedule.intervalSeconds ?? 300);
    if (sec < 60) return `每 ${sec} 秒`;
    if (sec % 3600 === 0) return `每 ${sec / 3600} 小时`;
    if (sec % 60 === 0) return `每 ${sec / 60} 分钟`;
    return `每 ${sec} 秒`;
  }
  if (schedule.mode === "cron") {
    return `定时 ${schedule.cron || "0 9 * * *"}`;
  }
  return schedule.runOnStartup ? "启动时 + 手动" : "手动运行";
}

export const AI_INFO_PROTOCOL_PROMPT = `请帮我编写一个兼容 ShibaPlan「信息」仪表盘的自动化脚本，遵循以下标准接口规范（shibaplan-info/v1）：

1. 运行方式：
- 方式 A（主动执行模式）：通过 stdout 输出单个 UTF-8 JSON 对象（调试信息请输出到 stderr），退出码 0 表示正常。可读取环境变量 SHIBA_WIDGET_ID / SHIBA_WIDGET_TITLE / SHIBA_TRIGGER / SHIBA_DATA_DIR / SHIBA_LAST_RUN_AT / SHIBA_PARAM_* 或 stdin JSON。
- 方式 B（外部推送模式，零资源占用）：由外部脚本直接向 ShibaPlan 本地接收服务发送 POST 请求：
  POST http://127.0.0.1:18421/api/info/push/<卡片pushKey>
  Header: Content-Type: application/json（如配置令牌则附带 Authorization: Bearer <token>）
  Body: 下方标准 JSON（也兼容普通 JSON 或纯文本）。

2. 标准输出 JSON 格式：
{
  "schema": "shibaplan-info/v1",
  "status": "ok",            // "ok" | "info" | "warn" | "error"
  "title": "卡片标题（可选）",
  "subtitle": "副标题（可选）",
  "badge": "状态徽章（可选）",
  "view": "composite",       // "metrics" | "list" | "kv" | "table" | "markdown" | "text" | "composite"
  "blocks": [
    {
      "type": "metrics",
      "items": [
        { "label": "指标名", "value": "98.5", "unit": "%", "trend": "+2.1%", "tone": "ok", "sparkline": [10, 25, 18, 32] }
      ]
    },
    {
      "type": "list",
      "title": "列表标题",
      "items": [
        { "title": "条目标题", "subtitle": "描述", "tag": "标签", "time": "10:30", "tone": "info", "url": "https://...", "path": "本地路径(可选)" }
      ]
    }
  ],
  "actions": [
    { "label": "打开链接", "openUrl": "https://..." },
    { "label": "复制摘要", "copyText": "..." }
  ]
}

请使用 [Python / PowerShell / Node.js] 编写完整可直接运行的脚本，需求如下：
[在这里描述你要采集或处理的信息]`;

export interface InfoWidgetTemplate {
  id: string;
  name: string;
  description: string;
  defaultTitle: string;
  w: number;
  h: number;
  accentColor: string;
  source: InfoWidgetSource;
  schedule: InfoWidgetSchedule;
}

export const INFO_WIDGET_TEMPLATES: InfoWidgetTemplate[] = [
  {
    id: "tpl-sys-monitor",
    name: "本机系统状态监控 (PowerShell)",
    description: "无需安装任何依赖，实时读取 CPU、内存与磁盘占用及高耗时进程",
    defaultTitle: "本机性能监控",
    w: 4,
    h: 5,
    accentColor: "#38bdf8",
    source: {
      kind: "script",
      scriptLang: "powershell",
      timeoutSec: 15,
      inlineCode: `# ShibaPlan 系统监控模板 (shibaplan-info/v1)
$os = Get-CimInstance Win32_OperatingSystem
$cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
if ($null -eq $cpu) { $cpu = 0 }
$totalMem = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
$freeMem = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
$usedMem = [math]::Round($totalMem - $freeMem, 1)
$memPct = [math]::Round(($usedMem / $totalMem) * 100, 0)

$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
$diskFree = [math]::Round($disk.FreeSpace / 1GB, 1)
$diskTotal = [math]::Round($disk.Size / 1GB, 1)
$diskPct = [math]::Round((($diskTotal - $diskFree) / $diskTotal) * 100, 0)

$procs = Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 4
$listItems = @()
foreach ($p in $procs) {
  $mb = [math]::Round($p.WorkingSet64 / 1MB, 0)
  $listItems += @{
    title = $p.ProcessName
    subtitle = "PID: $($p.Id)"
    tag = "$mb MB"
    tone = if ($mb -gt 1024) { "warn" } else { "info" }
  }
}

$payload = @{
  schema = "shibaplan-info/v1"
  status = if ($memPct -gt 88 -or $cpu -gt 90) { "warn" } else { "ok" }
  badge = "实时"
  view = "composite"
  blocks = @(
    @{
      type = "metrics"
      items = @(
        @{ label = "CPU"; value = [math]::Round($cpu, 0); unit = "%"; tone = if ($cpu -gt 80) { "warn" } else { "ok" } },
        @{ label = "内存"; value = $memPct; unit = "%"; trend = "$usedMem/$totalMem GB"; tone = if ($memPct -gt 85) { "warn" } else { "info" } },
        @{ label = "C 盘"; value = $diskPct; unit = "%"; trend = "余 $diskFree GB"; tone = if ($diskPct -gt 90) { "error" } else { "ok" } }
      )
    },
    @{
      type = "list"
      title = "内存占用 Top 4"
      items = $listItems
    }
  )
}

$payload | ConvertTo-Json -Depth 6 -Compress
`,
    },
    schedule: {
      mode: "interval",
      intervalSeconds: 30,
      runOnStartup: true,
    },
  },
  {
    id: "tpl-python-composite",
    name: "Python 标准协议示例 (KPI + 列表)",
    description: "展示指标卡、趋势折线与可点击外部链接列表的标准写法",
    defaultTitle: "每日自动化简报",
    w: 4,
    h: 5,
    accentColor: "#a78bfa",
    source: {
      kind: "script",
      scriptLang: "python",
      timeoutSec: 20,
      params: { topic: "AI & Dev" },
      inlineCode: `import json
import os
from datetime import datetime

topic = os.environ.get("SHIBA_PARAM_TOPIC", "日常汇总")
trigger = os.environ.get("SHIBA_TRIGGER", "manual")

payload = {
    "schema": "shibaplan-info/v1",
    "status": "ok",
    "badge": f"{trigger} · {datetime.now().strftime('%H:%M')}",
    "view": "composite",
    "blocks": [
        {
            "type": "metrics",
            "items": [
                {
                    "label": "今日抓取",
                    "value": 18,
                    "unit": "条",
                    "trend": "+4",
                    "tone": "ok",
                    "sparkline": [8, 12, 10, 15, 14, 18],
                },
                {
                    "label": "关注主题",
                    "value": topic,
                    "tone": "info",
                },
            ],
        },
        {
            "type": "list",
            "title": "示例信息流（支持点击跳转）",
            "items": [
                {
                    "title": "支持自由读取本地脚本 / API 并展示",
                    "subtitle": "在编辑窗口右侧可直接测试并校验协议",
                    "tag": "指南",
                    "tone": "ok",
                },
                {
                    "title": "点击右侧参数可向脚本注入 SHIBA_PARAM_*",
                    "subtitle": "适合配置关键词、仓库路径或城市名",
                    "tag": "技巧",
                    "tone": "info",
                },
            ],
        },
    ],
}

print(json.dumps(payload, ensure_ascii=False))
`,
    },
    schedule: {
      mode: "manual",
      runOnStartup: true,
    },
  },
  {
    id: "tpl-git-status",
    name: "Git 仓库最近提交 (Node.js)",
    description: "读取指定仓库的当前分支与最近 5 次提交记录",
    defaultTitle: "Git 仓库动态",
    w: 5,
    h: 4,
    accentColor: "#34d399",
    source: {
      kind: "script",
      scriptLang: "node",
      timeoutSec: 15,
      params: { repo: "." },
      inlineCode: `const { execSync } = require("child_process");

const repo = process.env.SHIBA_PARAM_REPO || process.cwd();
try {
  const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: repo, encoding: "utf8" }).trim();
  const statusRaw = execSync("git status --short", { cwd: repo, encoding: "utf8" }).trim();
  const dirtyCount = statusRaw ? statusRaw.split(/\\r?\\n/).length : 0;
  const logRaw = execSync('git log -n 5 --pretty=format:"%h|%s|%cr"', { cwd: repo, encoding: "utf8" }).trim();
  const items = logRaw
    ? logRaw.split(/\\r?\\n/).map((line) => {
        const [hash, msg, time] = line.split("|");
        return { title: msg, subtitle: hash, time, tone: "info" };
      })
    : [];

  console.log(JSON.stringify({
    schema: "shibaplan-info/v1",
    status: dirtyCount > 0 ? "warn" : "ok",
    badge: branch,
    view: "composite",
    blocks: [
      {
        type: "metrics",
        items: [
          { label: "当前分支", value: branch, tone: "info" },
          { label: "未提交改动", value: dirtyCount, unit: "个文件", tone: dirtyCount > 0 ? "warn" : "ok" },
        ],
      },
      { type: "list", title: "最近提交", items },
    ],
  }));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
`,
    },
    schedule: {
      mode: "interval",
      intervalSeconds: 300,
      runOnStartup: false,
    },
  },
  {
    id: "tpl-http-json",
    name: "HTTP JSON 接口示例",
    description: "免 CORS 直接请求 REST API 并自动解析 JSON 展示",
    defaultTitle: "在线 API 状态",
    w: 4,
    h: 3,
    accentColor: "#f59e0b",
    source: {
      kind: "http",
      method: "GET",
      url: "https://api.github.com/zen",
      timeoutSec: 15,
    },
    schedule: {
      mode: "manual",
      runOnStartup: false,
    },
  },
  {
    id: "tpl-external-push",
    name: "外部脚本推送接收卡 (Webhook / Push)",
    description: "零后台占用，等待外部脚本或计划任务 POST 数据主动刷新",
    defaultTitle: "外部脚本推送",
    w: 4,
    h: 4,
    accentColor: "#fb7185",
    source: {
      kind: "push",
      pushKey: "custom-push",
    },
    schedule: {
      mode: "manual",
      runOnStartup: false,
    },
  },
];

export function buildPushUrl(
  baseUrl: string | undefined,
  pushKey: string
): string {
  const cleanBase = (baseUrl || "http://127.0.0.1:18421").replace(/\/+$/, "");
  const cleanKey = encodeURIComponent(pushKey.trim() || "my-widget");
  return `${cleanBase}/api/info/push/${cleanKey}`;
}

export function buildPushCodeSnippets(url: string, token?: string): {
  curl: string;
  python: string;
  powershell: string;
  node: string;
} {
  const cleanToken = token?.trim();
  const authHeaderCurl = cleanToken
    ? ` \\\n  -H "Authorization: Bearer ${cleanToken}"`
    : "";
  const curl = `curl -X POST "${url}" \\\n  -H "Content-Type: application/json"${authHeaderCurl} \\\n  -d '{"schema":"shibaplan-info/v1","status":"ok","badge":"已推送","view":"metrics","items":[{"label":"任务状态","value":"完成","tone":"ok"}]}'`;

  const python = `import json, urllib.request

url = "${url}"
payload = {
    "schema": "shibaplan-info/v1",
    "status": "ok",
    "badge": "Python 推送",
    "view": "metrics",
    "items": [
        {"label": "执行状态", "value": "成功", "tone": "ok"},
        {"label": "处理数量", "value": 42, "unit": "条", "tone": "info"},
    ],
}
headers = {"Content-Type": "application/json; charset=utf-8"}${
    cleanToken ? `\nheaders["Authorization"] = "Bearer ${cleanToken}"` : ""
  }
req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
with urllib.request.urlopen(req, timeout=10) as resp:
    print(resp.read().decode("utf-8"))`;

  const psHeaders = cleanToken
    ? `@{ "Authorization" = "Bearer ${cleanToken}" }`
    : "@{}";
  const powershell = `$body = @{
  schema = "shibaplan-info/v1"
  status = "ok"
  badge = "PS 推送"
  view = "metrics"
  items = @(
    @{ label = "状态"; value = "正常"; tone = "ok" }
  )
} | ConvertTo-Json -Depth 5 -Compress

Invoke-RestMethod -Uri "${url}" -Method Post -ContentType "application/json; charset=utf-8" -Headers ${psHeaders} -Body ([System.Text.Encoding]::UTF8.GetBytes($body))`;

  const node = `await fetch("${url}", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",${
      cleanToken ? `\n    "Authorization": "Bearer ${cleanToken}",` : ""
    }
  },
  body: JSON.stringify({
    schema: "shibaplan-info/v1",
    status: "ok",
    badge: "Node 推送",
    view: "metrics",
    items: [{ label: "状态", value: "在线", tone: "ok" }],
  }),
});`;

  return { curl, python, powershell, node };
}

export function getTemplateExt(lang: InfoScriptLang): string {
  switch (lang) {
    case "python":
      return "py";
    case "powershell":
      return "ps1";
    case "node":
      return "js";
    case "batch":
      return "bat";
    case "bash":
      return "sh";
    case "json":
      return "json";
  }
}
