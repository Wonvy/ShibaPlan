import { EffortSize } from "../../types";

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
