import {
  InfoCardStatus,
  InfoDisplayView,
  InfoScriptLang,
  InfoWidgetSchedule,
  InfoWidgetSource,
} from "../types";
import type { InfoRunResult } from "./infoRunner";

export interface InfoTooltipItem {
  label: string;
  value: string;
}

export interface InfoTooltip {
  title?: string;
  text?: string;
  items?: InfoTooltipItem[];
}

export interface InfoMetricItem {
  label: string;
  value: string | number;
  unit?: string;
  trend?: string;
  tone?: InfoCardStatus;
  sparkline?: number[];
  tooltip?: InfoTooltip;
}

export interface InfoListItem {
  title: string;
  subtitle?: string;
  tag?: string;
  time?: string;
  tone?: InfoCardStatus;
  url?: string;
  path?: string;
  tooltip?: InfoTooltip;
}

export interface InfoKvItem {
  key: string;
  value: string;
  tone?: InfoCardStatus;
  copyable?: boolean;
  tooltip?: InfoTooltip;
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

function formatTooltipScalar(val: unknown): string {
  if (val === null || val === undefined) return "-";
  if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
    return String(val);
  }
  return JSON.stringify(val);
}

function normalizeTooltip(raw: unknown): InfoTooltip | undefined {
  if (raw === null || raw === undefined) return undefined;

  if (typeof raw === "string") {
    const text = raw.trim();
    return text ? { text } : undefined;
  }

  if (Array.isArray(raw)) {
    const items: InfoTooltipItem[] = [];
    const lines: string[] = [];
    for (const entry of raw) {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const rec = entry as Record<string, unknown>;
        const label = String(rec.label ?? rec.key ?? "").trim();
        if (label) {
          items.push({ label, value: formatTooltipScalar(rec.value) });
        }
      } else if (
        typeof entry === "string" ||
        typeof entry === "number" ||
        typeof entry === "boolean"
      ) {
        const line = String(entry).trim();
        if (line) lines.push(line);
      }
    }
    if (items.length > 0) return { items };
    if (lines.length > 0) return { text: lines.join("\n") };
    return undefined;
  }

  if (typeof raw === "object") {
    const rec = raw as Record<string, unknown>;
    const hasStructuredKeys =
      "title" in rec || "text" in rec || "lines" in rec || "items" in rec;

    if (hasStructuredKeys) {
      const title =
        typeof rec.title === "string" && rec.title.trim()
          ? rec.title.trim()
          : undefined;

      let text: string | undefined;
      if (typeof rec.text === "string" && rec.text.trim()) {
        text = rec.text.trim();
      } else if (Array.isArray(rec.lines)) {
        const joined = rec.lines
          .filter(
            (l) =>
              typeof l === "string" ||
              typeof l === "number" ||
              typeof l === "boolean"
          )
          .map((l) => String(l).trim())
          .filter(Boolean)
          .join("\n");
        if (joined) text = joined;
      }

      let items: InfoTooltipItem[] | undefined;
      if (Array.isArray(rec.items)) {
        const parsed = rec.items
          .filter((i): i is Record<string, unknown> => Boolean(i && typeof i === "object"))
          .map((i) => ({
            label: String(i.label ?? i.key ?? "").trim(),
            value: formatTooltipScalar(i.value),
          }))
          .filter((i) => Boolean(i.label));
        if (parsed.length > 0) items = parsed;
      } else if (rec.items && typeof rec.items === "object") {
        const parsed = Object.entries(rec.items as Record<string, unknown>)
          .map(([k, v]) => ({
            label: k.trim(),
            value: formatTooltipScalar(v),
          }))
          .filter((i) => Boolean(i.label));
        if (parsed.length > 0) items = parsed;
      }

      if (title || text || (items && items.length > 0)) {
        return { title, text, items };
      }
      return undefined;
    }

    const dictItems = Object.entries(rec)
      .map(([k, v]) => ({
        label: k.trim(),
        value: formatTooltipScalar(v),
      }))
      .filter((i) => Boolean(i.label));
    return dictItems.length > 0 ? { items: dictItems } : undefined;
  }

  return undefined;
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
      tooltip: normalizeTooltip(rec.tooltip ?? rec.detail ?? rec.details ?? rec.hover),
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
      tooltip: normalizeTooltip(rec.tooltip ?? rec.detail ?? rec.details ?? rec.hover),
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
        tooltip: normalizeTooltip(rec.tooltip ?? rec.detail ?? rec.details ?? rec.hover),
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

export const INFO_DISPLAY_VIEW_OPTIONS: {
  id: InfoDisplayView;
  label: string;
  shortLabel: string;
  desc: string;
}[] = [
  {
    id: "auto",
    label: "自动识别",
    shortLabel: "自动",
    desc: "优先按脚本输出的 shibaplan-info/v1 协议排版，普通输出自动降级",
  },
  {
    id: "metrics",
    label: "KPI 指标卡",
    shortLabel: "指标",
    desc: "突出展示大字号数字指标与状态色",
  },
  {
    id: "list",
    label: "列表视图",
    shortLabel: "列表",
    desc: "按行展示条目、标签与链接，适合资讯/告警/日志流",
  },
  {
    id: "kv",
    label: "键值面板",
    shortLabel: "键值",
    desc: "左右对照展示属性，点击值可快速复制",
  },
  {
    id: "table",
    label: "数据表格",
    shortLabel: "表格",
    desc: "结构化行列对比展示",
  },
  {
    id: "markdown",
    label: "Markdown",
    shortLabel: "MD",
    desc: "支持标题、表格、代码块与链接的富文本排版",
  },
  {
    id: "text",
    label: "终端纯文本",
    shortLabel: "文本",
    desc: "等宽字体原样展示原始输出",
  },
];

function coerceBlocksToView(
  blocks: InfoBlock[],
  rawStdout: string,
  displayView: Exclude<InfoDisplayView, "auto">
): InfoBlock[] {
  if (displayView === "text") {
    return [{ type: "text", text: rawStdout.trim() }];
  }

  if (displayView === "markdown") {
    const existingMd = blocks.filter((b) => b.type === "markdown");
    if (existingMd.length > 0) return existingMd;
    const trimmed = rawStdout.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return [{ type: "markdown", content: trimmed }];
    }
    const mdLines: string[] = [];
    for (const b of blocks) {
      if (b.title) mdLines.push(`### ${b.title}`);
      if (b.type === "metrics") {
        for (const m of b.items) {
          mdLines.push(
            `- **${m.label}**: \`${m.value}${m.unit ?? ""}\`${m.trend ? ` (${m.trend})` : ""}`
          );
        }
      } else if (b.type === "kv") {
        mdLines.push("| 字段 | 值 |", "| --- | --- |");
        for (const kv of b.items) {
          mdLines.push(`| ${kv.key} | ${kv.value} |`);
        }
      } else if (b.type === "list") {
        for (const it of b.items) {
          mdLines.push(
            `- **${it.title}**${it.tag ? ` \`${it.tag}\`` : ""}${it.subtitle ? ` — ${it.subtitle}` : ""}`
          );
        }
      } else if (b.type === "table" && b.columns.length > 0) {
        mdLines.push(
          `| ${b.columns.join(" | ")} |`,
          `| ${b.columns.map(() => "---").join(" | ")} |`,
          ...b.rows.map((r) => `| ${r.map((c) => String(c ?? "")).join(" | ")} |`)
        );
      } else if (b.type === "text") {
        mdLines.push(b.text);
      }
    }
    return [{ type: "markdown", content: mdLines.join("\n\n") || trimmed }];
  }

  if (displayView === "metrics") {
    const items: InfoMetricItem[] = [];
    for (const b of blocks) {
      if (b.type === "metrics") {
        items.push(...b.items);
      } else if (b.type === "kv") {
        for (const kv of b.items) {
          items.push({
            label: kv.key,
            value: kv.value,
            tone: kv.tone,
            tooltip: kv.tooltip,
          });
        }
      } else if (b.type === "list") {
        for (const it of b.items) {
          items.push({
            label: it.title,
            value: it.tag || it.time || "-",
            trend: it.subtitle,
            tone: it.tone,
            tooltip: it.tooltip,
          });
        }
      } else if (b.type === "table") {
        for (const row of b.rows) {
          items.push({
            label: String(row[0] ?? "-"),
            value: String(row[1] ?? "-"),
            trend: row.slice(2).filter(Boolean).join(" · ") || undefined,
          });
        }
      } else {
        const txt = b.type === "markdown" ? b.content : b.text;
        const lines = txt
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        if (lines.length === 1 && !/[:：=]/.test(lines[0])) {
          items.push({ label: "输出值", value: lines[0], tone: "info" });
        } else {
          for (const line of lines.slice(0, 12)) {
            const m = /^([^:：=]+?)\s*[:：=]\s*(.+)$/.exec(line);
            if (m) {
              items.push({ label: m[1].trim(), value: m[2].trim() });
            } else {
              items.push({ label: "条目", value: line });
            }
          }
        }
      }
    }
    return [{ type: "metrics", items: items.slice(0, 24) }];
  }

  if (displayView === "list") {
    const items: InfoListItem[] = [];
    for (const b of blocks) {
      if (b.type === "list") {
        items.push(...b.items);
      } else if (b.type === "metrics") {
        for (const m of b.items) {
          items.push({
            title: m.label,
            subtitle: m.trend,
            tag: `${m.value}${m.unit ?? ""}`,
            tone: m.tone,
            tooltip: m.tooltip,
          });
        }
      } else if (b.type === "kv") {
        for (const kv of b.items) {
          items.push({
            title: kv.key,
            subtitle: kv.value,
            tone: kv.tone,
            tooltip: kv.tooltip,
          });
        }
      } else if (b.type === "table") {
        for (const row of b.rows) {
          items.push({
            title: String(row[0] ?? "-"),
            subtitle: row.slice(1).map((c) => String(c ?? "")).join(" · ") || undefined,
          });
        }
      } else {
        const txt = b.type === "markdown" ? b.content : b.text;
        for (const line of txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
          items.push({ title: line });
        }
      }
    }
    return [{ type: "list", items }];
  }

  if (displayView === "kv") {
    const items: InfoKvItem[] = [];
    for (const b of blocks) {
      if (b.type === "kv") {
        items.push(...b.items);
      } else if (b.type === "metrics") {
        for (const m of b.items) {
          items.push({
            key: m.label,
            value: `${m.value}${m.unit ?? ""}${m.trend ? ` (${m.trend})` : ""}`,
            tone: m.tone,
            copyable: true,
            tooltip: m.tooltip,
          });
        }
      } else if (b.type === "list") {
        for (const it of b.items) {
          items.push({
            key: it.title,
            value: [it.tag, it.subtitle, it.time].filter(Boolean).join(" · ") || "-",
            tone: it.tone,
            copyable: true,
            tooltip: it.tooltip,
          });
        }
      } else if (b.type === "table") {
        for (const row of b.rows) {
          items.push({
            key: String(row[0] ?? "-"),
            value: row.slice(1).map((c) => String(c ?? "")).join(" | ") || "-",
            copyable: true,
          });
        }
      } else {
        const txt = b.type === "markdown" ? b.content : b.text;
        const lines = txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        lines.forEach((line, idx) => {
          const m = /^([^:：=]+?)\s*[:：=]\s*(.+)$/.exec(line);
          if (m) {
            items.push({ key: m[1].trim(), value: m[2].trim(), copyable: true });
          } else {
            items.push({ key: `#${idx + 1}`, value: line, copyable: true });
          }
        });
      }
    }
    return [{ type: "kv", items }];
  }

  // displayView === "table"
  const existingTables = blocks.filter((b) => b.type === "table");
  if (existingTables.length > 0) return existingTables;

  for (const b of blocks) {
    if (b.type === "kv") {
      return [
        {
          type: "table",
          columns: ["字段", "值"],
          rows: b.items.map((kv) => [kv.key, kv.value]),
        },
      ];
    }
    if (b.type === "metrics") {
      return [
        {
          type: "table",
          columns: ["指标", "数值", "趋势"],
          rows: b.items.map((m) => [
            m.label,
            `${m.value}${m.unit ?? ""}`,
            m.trend ?? "-",
          ]),
        },
      ];
    }
    if (b.type === "list") {
      return [
        {
          type: "table",
          columns: ["标题", "说明", "标签", "时间"],
          rows: b.items.map((it) => [
            it.title,
            it.subtitle ?? "",
            it.tag ?? "",
            it.time ?? "",
          ]),
        },
      ];
    }
  }

  const lines = rawStdout
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return [{ type: "table", columns: ["内容"], rows: [] }];
  }
  const delim = lines[0].includes("\t")
    ? "\t"
    : lines[0].includes("|")
      ? "|"
      : lines[0].includes(",")
        ? ","
        : null;
  if (delim) {
    const splitLine = (l: string) =>
      l
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split(delim)
        .map((c) => c.trim());
    const first = splitLine(lines[0]);
    const rest = lines.slice(1).map(splitLine);
    return [{ type: "table", columns: first, rows: rest }];
  }
  return [{ type: "table", columns: ["内容"], rows: lines.map((l) => [l]) }];
}

export function parseInfoOutput(
  run: InfoRunResult,
  jsonPath?: string,
  displayView: InfoDisplayView = "auto"
): ParsedInfoResult {
  const applyDisplayView = (parsed: ParsedInfoResult): ParsedInfoResult => {
    if (displayView === "auto" || !run.ok) return parsed;
    const label =
      INFO_DISPLAY_VIEW_OPTIONS.find((o) => o.id === displayView)?.label ??
      displayView;
    return {
      ...parsed,
      blocks: coerceBlocksToView(parsed.blocks, run.stdout, displayView),
      validation: {
        ...parsed.validation,
        message: `已按指定版式「${label}」渲染`,
      },
    };
  };

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

        return applyDisplayView({
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
        });
      }
    }

    return applyDisplayView({
      status: "ok",
      blocks: [buildJsonFallbackBlock(target)],
      actions: [],
      validation: {
        mode: "json-fallback",
        message: "普通 JSON 自动降级渲染（建议接入 shibaplan-info/v1 协议获得更佳展示）",
        warnings: [],
      },
    });
  } catch {
    const isMd = looksLikeMarkdown(trimmed);
    return applyDisplayView({
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
    });
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
  if (kind === "container") return "空白容器";
  if (kind === "control") return "交互元素";
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
        { "label": "指标名", "value": "98.5", "unit": "%", "trend": "+2.1%", "tone": "ok", "sparkline": [10, 25, 18, 32], "tooltip": { "title": "详情", "items": [{ "label": "说明", "value": "悬停时展示" }] } }
      ]
    },
    {
      "type": "list",
      "title": "列表标题",
      "items": [
        { "title": "条目标题", "subtitle": "描述", "tag": "标签", "time": "10:30", "tone": "info", "url": "https://...", "path": "本地路径(可选)", "tooltip": "可选悬停详情文本或 { title, items }" }
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

function buildSamplePayloadObj(view: InfoDisplayView): Record<string, unknown> {
  switch (view) {
    case "metrics":
      return {
        schema: "shibaplan-info/v1",
        status: "ok",
        badge: "实时",
        view: "metrics",
        items: [
          {
            label: "核心指标",
            value: 98.5,
            unit: "%",
            trend: "+1.2%",
            tone: "ok",
            sparkline: [91, 94, 93, 96, 98.5],
          },
          { label: "待处理", value: 2, unit: "项", tone: "warn" },
        ],
      };
    case "list":
      return {
        schema: "shibaplan-info/v1",
        status: "ok",
        badge: "最新",
        view: "list",
        items: [
          {
            title: "示例条目一",
            subtitle: "附带副标题与跳转链接",
            tag: "正常",
            time: "刚刚",
            tone: "ok",
          },
          {
            title: "示例告警条目",
            subtitle: "需要留意的状态",
            tag: "告警",
            time: "5m 前",
            tone: "warn",
          },
        ],
      };
    case "kv":
      return {
        schema: "shibaplan-info/v1",
        status: "ok",
        badge: "状态",
        view: "kv",
        items: [
          { key: "服务状态", value: "运行中", tone: "ok" },
          { key: "节点地址", value: "127.0.0.1:8080" },
          { key: "最近检查", value: "刚刚" },
        ],
      };
    case "table":
      return {
        schema: "shibaplan-info/v1",
        status: "ok",
        badge: "报表",
        view: "table",
        columns: ["项目", "状态", "耗时"],
        rows: [
          ["任务 A", "完成", "120ms"],
          ["任务 B", "运行中", "45ms"],
        ],
      };
    case "markdown":
      return {
        schema: "shibaplan-info/v1",
        status: "ok",
        view: "markdown",
        content:
          "### 今日摘要\n- **状态**：正常\n- **说明**：支持标准 Markdown 语法与表格",
      };
    case "text":
      return {
        schema: "shibaplan-info/v1",
        status: "ok",
        view: "text",
        text: "Line 1: 服务启动成功\nLine 2: 所有检查项通过",
      };
    case "auto":
    default:
      return {
        schema: "shibaplan-info/v1",
        status: "ok",
        badge: "正常",
        view: "composite",
        blocks: [
          {
            type: "metrics",
            items: [
              { label: "指标 A", value: 100, unit: "%", tone: "ok" },
              { label: "待处理", value: 2, tone: "warn" },
            ],
          },
          {
            type: "list",
            title: "明细列表",
            items: [{ title: "任务已完成", subtitle: "一切正常", tone: "ok" }],
          },
        ],
      };
  }
}

export function buildStarterScriptForView(
  view: InfoDisplayView,
  lang: InfoScriptLang
): string {
  const payload = buildSamplePayloadObj(view);
  const prettyJson = JSON.stringify(payload, null, 2);

  switch (lang) {
    case "python":
      return `import json\n\npayload = ${prettyJson
        .replace(/\btrue\b/g, "True")
        .replace(/\bfalse\b/g, "False")
        .replace(/\bnull\b/g, "None")}\n\nprint(json.dumps(payload, ensure_ascii=False))\n`;
    case "powershell":
      if (view === "text") {
        return `Write-Output "服务运行正常"\nWrite-Output "检查时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"\n`;
      }
      return `$json = @'\n${prettyJson}\n'@\nWrite-Output $json\n`;
    case "node":
      return `const payload = ${prettyJson};\nconsole.log(JSON.stringify(payload));\n`;
    case "bash":
      return `cat <<'EOF'\n${prettyJson}\nEOF\n`;
    case "batch":
      return `@echo off\nchcp 65001 >nul\necho ${JSON.stringify(payload)}\n`;
    case "json":
      return prettyJson + "\n";
  }
}

const SCRIPT_EXT_TO_LANG: Record<string, InfoScriptLang> = {
  py: "python",
  ps1: "powershell",
  js: "node",
  mjs: "node",
  cjs: "node",
  bat: "batch",
  cmd: "batch",
  sh: "bash",
  bash: "bash",
};

/**
 * Infers script language and default card title from a filename or OS file path.
 * Returns null for unsupported file extensions.
 */
export function inferScriptFromFilename(
  fileNameOrPath: string
): { lang: InfoScriptLang; title: string; ext: string } | null {
  const trimmed = fileNameOrPath.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/[/\\]/);
  const baseName = parts[parts.length - 1] ?? "";
  const dotIdx = baseName.lastIndexOf(".");
  if (dotIdx <= 0 || dotIdx === baseName.length - 1) return null;
  const ext = baseName.slice(dotIdx + 1).toLowerCase();
  const lang = SCRIPT_EXT_TO_LANG[ext];
  if (!lang) return null;
  const title = baseName.slice(0, dotIdx).trim() || baseName;
  return { lang, title, ext };
}

/**
 * Builds realistic sample ParsedInfoResult data for each InfoDisplayView
 * so the editor live-preview panel illustrates the chosen layout before running a script.
 */
export function buildSampleParsedForView(
  view: InfoDisplayView
): ParsedInfoResult {
  switch (view) {
    case "metrics":
      return {
        status: "ok",
        badge: "实时",
        blocks: [
          {
            type: "metrics",
            items: [
              {
                label: "CPU 负载",
                value: "34.2",
                unit: "%",
                trend: "-2.1%",
                tone: "ok",
                sparkline: [42, 38, 45, 36, 39, 34],
              },
              {
                label: "内存占用",
                value: "11.4",
                unit: "GB",
                trend: "+0.3G",
                tone: "info",
                sparkline: [10.6, 10.9, 11.0, 11.2, 11.3, 11.4],
              },
              {
                label: "接口耗时",
                value: "48",
                unit: "ms",
                tone: "ok",
                sparkline: [62, 55, 50, 52, 49, 48],
              },
            ],
          },
        ],
        actions: [],
        validation: { mode: "standard", message: "版式示例", warnings: [] },
      };

    case "list":
      return {
        status: "info",
        badge: "3 项",
        blocks: [
          {
            type: "list",
            items: [
              {
                title: "生产环境构建通过",
                subtitle: "main · v0.2.6 发布流水线",
                tag: "CI",
                time: "刚刚",
                tone: "ok",
              },
              {
                title: "SSL 证书将于 14 天后过期",
                subtitle: "api.example.com:443",
                tag: "告警",
                time: "5m 前",
                tone: "warn",
              },
              {
                title: "每日数据备份完成",
                subtitle: "已同步 428 条记录至本地归档",
                tag: "任务",
                time: "09:00",
                tone: "info",
              },
            ],
          },
        ],
        actions: [],
        validation: { mode: "standard", message: "版式示例", warnings: [] },
      };

    case "kv":
      return {
        status: "ok",
        badge: "在线",
        blocks: [
          {
            type: "kv",
            items: [
              { key: "主机状态", value: "运行中 (Healthy)", tone: "ok" },
              { key: "运行环境", value: "Python 3.12 · Windows 11" },
              { key: "响应耗时", value: "36 ms", tone: "info" },
              { key: "最近同步", value: "2026-11-27 14:00" },
            ],
          },
        ],
        actions: [],
        validation: { mode: "standard", message: "版式示例", warnings: [] },
      };

    case "table":
      return {
        status: "ok",
        badge: "3 行",
        blocks: [
          {
            type: "table",
            columns: ["服务", "状态", "耗时"],
            rows: [
              ["API 网关", "正常", "18 ms"],
              ["推送接收器", "监听中", "2 ms"],
              ["定时调度器", "就绪", "12 ms"],
            ],
          },
        ],
        actions: [],
        validation: { mode: "standard", message: "版式示例", warnings: [] },
      };

    case "markdown":
      return {
        status: "info",
        blocks: [
          {
            type: "markdown",
            content:
              "### 巡检摘要\n- **服务状态**：全部核心节点正常\n- **配置目录**：`~/Documents/ShibaPlan/scripts`\n- 支持标题、加粗、列表与行内代码高亮",
          },
        ],
        actions: [],
        validation: { mode: "standard", message: "版式示例", warnings: [] },
      };

    case "text":
      return {
        status: "ok",
        blocks: [
          {
            type: "text",
            text: "[14:00:01] 初始化脚本运行环境...\n[14:00:02] 检查本地端口 18421: 正常监听\n[14:00:02] 已完成全部 3 项检测 (exit=0)",
          },
        ],
        actions: [],
        validation: { mode: "standard", message: "版式示例", warnings: [] },
      };

    case "auto":
    default:
      return {
        status: "ok",
        badge: "自动排版",
        blocks: [
          {
            type: "metrics",
            items: [
              {
                label: "可用率",
                value: "99.9",
                unit: "%",
                tone: "ok",
                sparkline: [99.2, 99.5, 99.8, 99.9],
              },
              {
                label: "待关注",
                value: "2",
                unit: "项",
                tone: "warn",
                sparkline: [4, 3, 3, 2],
              },
            ],
          },
          {
            type: "list",
            items: [
              {
                title: "自动识别输出结构",
                subtitle: "根据 JSON 字段智能组合指标卡、列表或表格",
                tag: "推荐",
                tone: "info",
              },
              {
                title: "支持纯文本与 Markdown 自动降级",
                tone: "ok",
              },
            ],
          },
        ],
        actions: [],
        validation: { mode: "standard", message: "版式示例", warnings: [] },
      };
  }
}
