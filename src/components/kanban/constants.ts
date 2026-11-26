import { EffortSize, TaskPriorityColor } from "../../types";

export const TASK_PRIORITY_COLORS: {
  id: TaskPriorityColor;
  label: string;
  dotClass: string;
  cardClass: string;
  pillActiveClass: string;
}[] = [
  {
    id: "urgent",
    label: "紧急",
    dotClass: "bg-rose-400",
    cardClass:
      "border-rose-500/30 bg-rose-500/[0.08] shadow-card-rest hover:border-rose-400/45 hover:bg-rose-500/[0.12]",
    pillActiveClass:
      "border-rose-400/50 bg-rose-500/15 text-rose-400",
  },
  {
    id: "important",
    label: "重要",
    dotClass: "bg-amber-400",
    cardClass:
      "border-amber-500/30 bg-amber-500/[0.08] shadow-card-rest hover:border-amber-400/45 hover:bg-amber-500/[0.12]",
    pillActiveClass:
      "border-amber-400/50 bg-amber-500/15 text-amber-400",
  },
  {
    id: "normal",
    label: "关注",
    dotClass: "bg-sky-400",
    cardClass:
      "border-sky-500/30 bg-sky-500/[0.08] shadow-card-rest hover:border-sky-400/45 hover:bg-sky-500/[0.12]",
    pillActiveClass:
      "border-sky-400/50 bg-sky-500/15 text-sky-400",
  },
];

export const TASK_PRIORITY_CARD_CLASS: Record<TaskPriorityColor, string> = {
  urgent: TASK_PRIORITY_COLORS[0].cardClass,
  important: TASK_PRIORITY_COLORS[1].cardClass,
  normal: TASK_PRIORITY_COLORS[2].cardClass,
};

export type TranslateFn = (
  key: string,
  params?: Record<string, string | number>
) => string;

export type InsertPosition = "before" | "after";

export type AreaMenuRequest =
  | { kind: "card"; taskId: string; colId: string }
  | { kind: "column"; colId: string }
  | { kind: "board" };

export type AreaMenuState =
  | { kind: "card"; taskId: string; colId: string; x: number; y: number }
  | { kind: "column"; colId: string; x: number; y: number }
  | { kind: "board"; x: number; y: number };

export const EFFORT_LABEL: Record<EffortSize, string> = {
  S: "30m",
  M: "1.5h",
  L: "3h",
};

export const formatShortDate = (dateStr: string) => {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (dateStr === todayStr) return "今天";
  return dateStr.slice(5).replace("-", "/");
};

export const formatClock = (sec: number) => {
  const m = Math.floor(sec / 60)
    .toString()
    .padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
};

/** Returns YYYY-MM-DD for today + `days`. */
export const dateWithOffset = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
