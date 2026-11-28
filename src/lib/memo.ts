import type { MemoItem } from "../types";

export const PRESET_MEMO_TAGS = ["笔记", "软件", "证书", "会员", "服务器"] as const;

export const DAILY_NOTE_TEMPLATE = `## 今日重点
- [ ] 

## 随手记录
- 

## 总结 / 备忘
- 
`;

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

export const RENEW_DAY_PRESETS = [
  { label: "1 个月 (30天)", days: 30 },
  { label: "3 个月 (90天)", days: 90 },
  { label: "1 年 (365天)", days: 365 },
] as const;

export const EXPIRY_SOON_DAYS = 30;
export const EXPIRY_URGENT_DAYS = 7;

export type ExpiryUrgency = "expired" | "urgent" | "soon" | "ok" | "none";

function parseLocalDate(dateStr?: string): Date | null {
  if (!dateStr) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(year, month - 1, day);
  if (
    dt.getFullYear() !== year ||
    dt.getMonth() !== month - 1 ||
    dt.getDate() !== day
  ) {
    return null;
  }
  return dt;
}

function formatLocalDate(dt: Date): string {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getDaysUntilExpiry(expiresAt?: string): number | null {
  const target = parseLocalDate(expiresAt);
  if (!target) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function getExpiryUrgency(daysLeft: number | null): ExpiryUrgency {
  if (daysLeft === null) return "none";
  if (daysLeft < 0) return "expired";
  if (daysLeft <= EXPIRY_URGENT_DAYS) return "urgent";
  if (daysLeft <= EXPIRY_SOON_DAYS) return "soon";
  return "ok";
}

export function formatExpiryLabel(daysLeft: number): string {
  if (daysLeft < 0) return `已过期 ${Math.abs(daysLeft)} 天`;
  if (daysLeft === 0) return "今天到期";
  if (daysLeft === 1) return "明天到期";
  return `剩 ${daysLeft} 天`;
}

export function getExpiryBadgeClass(urgency: ExpiryUrgency): string {
  switch (urgency) {
    case "expired":
    case "urgent":
      return "border-rose-500/30 bg-rose-500/15 text-rose-500";
    case "soon":
      return "border-amber-500/30 bg-amber-500/15 text-amber-500";
    case "ok":
      return "border-emerald-500/25 bg-emerald-500/12 text-emerald-500";
    case "none":
      return "";
  }
}

export function computeRenewedDate(expiresAt: string, renewDays: number): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const parsed = parseLocalDate(expiresAt);
  const base = parsed && parsed.getTime() >= today.getTime() ? parsed : today;
  const next = new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() + renewDays
  );
  return formatLocalDate(next);
}

export function sortMemos(memos: MemoItem[]): MemoItem[] {
  return [...memos].sort((a, b) => {
    const pinA = a.pinned ? 1 : 0;
    const pinB = b.pinned ? 1 : 0;
    if (pinA !== pinB) return pinB - pinA;

    const daysA = getDaysUntilExpiry(a.expiresAt);
    const daysB = getDaysUntilExpiry(b.expiresAt);
    const urgentA = daysA !== null && daysA <= EXPIRY_SOON_DAYS;
    const urgentB = daysB !== null && daysB <= EXPIRY_SOON_DAYS;

    if (urgentA && urgentB) {
      if (daysA !== daysB) return daysA - daysB;
    } else if (urgentA !== urgentB) {
      return urgentA ? -1 : 1;
    }

    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export function getTodayDateKey(): string {
  return formatLocalDate(new Date());
}

export function formatDailyNoteTitle(dateKey: string): string {
  const dt = parseLocalDate(dateKey);
  if (!dt) return `${dateKey} 日常笔记`;
  const weekday = WEEKDAY_LABELS[dt.getDay()];
  return `${dateKey} ${weekday} 日常笔记`;
}

export function toggleMarkdownCheckbox(
  markdown: string,
  lineIndex: number
): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  if (lineIndex < 0 || lineIndex >= lines.length) return markdown;
  const line = lines[lineIndex];
  const match = /^(\s*[-*+]\s+\[)([ xX])(\](?:\s+.*)?)$/.exec(line);
  if (!match) return markdown;
  const nextMark = match[2].toLowerCase() === "x" ? " " : "x";
  lines[lineIndex] = `${match[1]}${nextMark}${match[3]}`;
  return lines.join("\n");
}

export function stripMarkdownPreview(content: string): string {
  return content
    .replace(/\r/g, "")
    .split("\n")
    .filter(
      (line) => !/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line)
    )
    .map((line) =>
      line
        .replace(/^\s*<\/?details[^>]*>\s*$/gi, "")
        .replace(/^\s*<summary>(.*?)<\/summary>\s*$/gi, "$1")
        .replace(/^\s*#{1,6}\s+/, "")
        .replace(/^\s*>\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i, "")
        .replace(/^\s*>\s?/, "")
        .replace(/^\s*[-*+]\s+\[[ xX]\]\s*/, "")
        .replace(/^\s*[-*+]\s+/, "")
        .replace(/^\s*\d+\.\s+/, "")
        .replace(/^\s*(?:\*{3,}|-{3,}|_{3,})\s*$/, "")
        .replace(/^\s*\|(.*)\|\s*$/, "$1")
        .replace(/\s*\|\s*/g, " ")
        .replace(/```[a-zA-Z0-9_-]*/g, "")
        .replace(/`([^`]*)`/g, "$1")
        .replace(/\*\*\*([^*]+)\*\*\*/g, "$1")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/__([^_]+)__/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/~~([^~]+)~~/g, "$1")
        .replace(/==([^=]+)==/g, "$1")
        .replace(/<(?:u|kbd|sup|sub)>([^<]*)<\/(?:u|kbd|sup|sub)>/gi, "$1")
        .replace(
          /!\[([^\]]*)\]\((?:<[^>\n]+>|[^)\n]+)\)/g,
          (_, alt: string) => {
            const cleanAlt = alt.trim();
            return cleanAlt && cleanAlt !== "图片"
              ? `[图片: ${cleanAlt}]`
              : "[图片]";
          }
        )
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .trim()
    )
    .filter(Boolean)
    .join(" · ")
    .slice(0, 80);
}
