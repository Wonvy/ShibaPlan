import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar as CalendarIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  Star,
  X,
} from "lucide-react";
import {
  BoardColumn,
  COLUMN_COLORS,
  EFFORT_MINUTES,
  TaskItem,
  WorkspaceData,
} from "../types";
import { savePastedImage, uid } from "../lib/storage";
import { useI18n } from "../lib/i18n";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Separator } from "./ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

interface CalendarViewProps {
  workspace: WorkspaceData;
  onUpdate: (next: WorkspaceData) => void;
}

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export const CalendarView: React.FC<CalendarViewProps> = ({
  workspace,
  onUpdate,
}) => {
  const { t } = useI18n();
  const weekdays = useMemo(() => t("calendar.weekdays").split(","), [t]);
  const todayKey = useMemo(() => formatDateKey(new Date()), []);
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  // Hover preview & Drag-over state
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });

  // Selected date modal for quick add / manage
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickTime, setQuickTime] = useState("");
  const [quickColId, setQuickColId] = useState(
    workspace.columns[0]?.id ?? ""
  );

  // Hover-to-paste on any calendar date cell
  useEffect(() => {
    const onWindowPaste = async (e: ClipboardEvent) => {
      if (!hoveredDate || selectedDate || workspace.columns.length === 0) {
        return;
      }
      const active = document.activeElement;
      if (
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          (active as HTMLElement).isContentEditable)
      ) {
        return;
      }

      const colId = quickColId || workspace.columns[0]?.id;
      if (!colId) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const file = items[i].getAsFile();
          if (!file) continue;
          e.preventDefault();
          const ext = items[i].type.split("/")[1] || "png";
          const reader = new FileReader();
          reader.onload = async () => {
            if (typeof reader.result !== "string") return;
            const savedPath = await savePastedImage(
              reader.result,
              ext,
              workspace.settings.customDataDir
            );
            const newTask: TaskItem = {
              id: uid("task"),
              title: "截图任务",
              columnId: colId,
              dueDate: hoveredDate,
              importance: 2,
              effort: "S",
              estimatedMinutes: EFFORT_MINUTES.S,
              actualMinutes: 0,
              status: "todo",
              imagePreview: reader.result,
              imagePath: savedPath || undefined,
              createdAt: new Date().toISOString(),
            };
            onUpdate({
              ...workspace,
              tasks: [newTask, ...workspace.tasks],
            });
            setSelectedDate(hoveredDate);
          };
          reader.readAsDataURL(file);
          return;
        }
      }

      const text = e.clipboardData?.getData("text/plain")?.trim();
      if (!text) return;
      e.preventDefault();

      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const newTask: TaskItem = {
        id: uid("task"),
        title: (lines[0] ?? text).slice(0, 80),
        notes: lines.length > 1 ? text : undefined,
        columnId: colId,
        dueDate: hoveredDate,
        importance: 2,
        effort: "S",
        estimatedMinutes: EFFORT_MINUTES.S,
        actualMinutes: 0,
        status: "todo",
        createdAt: new Date().toISOString(),
      };
      onUpdate({
        ...workspace,
        tasks: [newTask, ...workspace.tasks],
      });
      setSelectedDate(hoveredDate);
    };

    window.addEventListener("paste", onWindowPaste);
    return () => window.removeEventListener("paste", onWindowPaste);
  }, [hoveredDate, selectedDate, quickColId, workspace, onUpdate]);

  const columnMap = useMemo(() => {
    const map = new Map<string, BoardColumn>();
    workspace.columns.forEach((c) => map.set(c.id, c));
    return map;
  }, [workspace.columns]);

  const tasksByDate = useMemo(() => {
    const map = new Map<string, TaskItem[]>();
    workspace.tasks.forEach((task) => {
      if (!task.dueDate) return;
      const list = map.get(task.dueDate) ?? [];
      list.push(task);
      map.set(task.dueDate, list);
    });
    // Sort each day's tasks by startTime then importance
    map.forEach((list) => {
      list.sort((a, b) => {
        if (a.startTime && b.startTime) {
          return a.startTime.localeCompare(b.startTime);
        }
        if (a.startTime) return -1;
        if (b.startTime) return 1;
        return b.importance - a.importance;
      });
    });
    return map;
  }, [workspace.tasks]);

  const unscheduledCount = useMemo(
    () => workspace.tasks.filter((t) => !t.dueDate && t.status !== "done").length,
    [workspace.tasks]
  );

  const calendarDays = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    // Monday-first offset (0 = Mon ... 6 = Sun)
    const startOffset = (firstDay.getDay() + 6) % 7;
    const days: { date: Date; key: string; inMonth: boolean }[] = [];

    for (let i = startOffset - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      days.push({ date: d, key: formatDateKey(d), inMonth: false });
    }

    for (let dNum = 1; dNum <= lastDay.getDate(); dNum++) {
      const d = new Date(year, month, dNum);
      days.push({ date: d, key: formatDateKey(d), inMonth: true });
    }

    while (days.length % 7 !== 0 || days.length < 35) {
      const nextIdx = days.length - startOffset - lastDay.getDate() + 1;
      const d = new Date(year, month + 1, nextIdx);
      days.push({ date: d, key: formatDateKey(d), inMonth: false });
    }

    return days;
  }, [cursor]);

  const wheelCooldownRef = useRef(0);

  const shiftMonth = (delta: number) => {
    setHoveredDate(null);
    setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  const handleCalendarWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (selectedDate || e.ctrlKey || e.metaKey) return;
    const dominant =
      Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (Math.abs(dominant) < 12) return;

    const now = Date.now();
    if (now < wheelCooldownRef.current) return;
    wheelCooldownRef.current = now + 220;
    shiftMonth(dominant > 0 ? 1 : -1);
  };

  const jumpToday = () => {
    const now = new Date();
    setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
  };

  const handleCellMouseEnter = (
    dateKey: string,
    e: React.MouseEvent<HTMLDivElement>
  ) => {
    setHoveredDate(dateKey);
    const rect = e.currentTarget.getBoundingClientRect();
    const tooltipW = 280;
    const tooltipH = 220;
    let x = rect.right + 10;
    if (x + tooltipW > window.innerWidth - 16) {
      x = Math.max(16, rect.left - tooltipW - 10);
    }
    let y = rect.top;
    if (y + tooltipH > window.innerHeight - 20) {
      y = Math.max(56, window.innerHeight - tooltipH - 20);
    }
    setHoverPos({ x, y });
  };

  const handleQuickAddOnDate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDate || !quickTitle.trim()) return;
    const colId = quickColId || workspace.columns[0]?.id;
    if (!colId) return;

    const newTask: TaskItem = {
      id: uid("task"),
      title: quickTitle.trim(),
      columnId: colId,
      dueDate: selectedDate,
      startTime: quickTime || undefined,
      importance: 2,
      effort: "S",
      estimatedMinutes: EFFORT_MINUTES.S,
      actualMinutes: 0,
      status: "todo",
      createdAt: new Date().toISOString(),
    };
    onUpdate({
      ...workspace,
      tasks: [newTask, ...workspace.tasks],
    });
    setQuickTitle("");
    setQuickTime("");
  };

  const handleDropOnDate = (e: React.DragEvent, dateKey: string) => {
    e.preventDefault();
    setDragOverDate(null);

    // 1. Idea card dragged from bottom IdeaRiver
    const ideaId = e.dataTransfer.getData("application/x-shibaplan-idea");
    if (ideaId) {
      const idea = workspace.ideas.find((i) => i.id === ideaId);
      if (!idea) return;

      const now = new Date().toISOString();
      let nextColumns = workspace.columns;
      let colId = workspace.columns[0]?.id;
      if (!colId) {
        const autoCol: BoardColumn = {
          id: uid("col"),
          title: t("nav.calendar"),
          color: COLUMN_COLORS[0],
        };
        nextColumns = [autoCol];
        colId = autoCol.id;
      }

      const lines = idea.content
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0);
      const newTask: TaskItem = {
        id: uid("task"),
        title: (lines[0] ?? idea.content).slice(0, 80) || t("kanban.screenshotTask"),
        notes: lines.length > 1 ? idea.content : undefined,
        columnId: colId,
        dueDate: dateKey,
        importance: 2,
        effort: "S",
        estimatedMinutes: EFFORT_MINUTES.S,
        actualMinutes: 0,
        status: "todo",
        imagePreview: idea.imagePreview,
        imagePath: idea.imagePath,
        createdAt: now,
        sourceIdeaId: idea.id,
      };

      onUpdate({
        ...workspace,
        columns: nextColumns,
        tasks: [newTask, ...workspace.tasks],
        ideas: workspace.ideas.filter((i) => i.id !== idea.id),
        trashedIdeas: [
          {
            ...idea,
            convertedTaskId: newTask.id,
            deletedAt: now,
            reason: "used",
          },
          ...workspace.trashedIdeas,
        ],
      });
      return;
    }

    // 2. Existing task pill dragged between dates to reschedule
    const calTaskId = e.dataTransfer.getData("application/x-shibaplan-cal-task");
    if (calTaskId) {
      onUpdate({
        ...workspace,
        tasks: workspace.tasks.map((task) =>
          task.id === calTaskId ? { ...task, dueDate: dateKey } : task
        ),
      });
    }
  };

  const toggleDone = (taskId: string) => {
    onUpdate({
      ...workspace,
      tasks: workspace.tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              status: t.status === "done" ? "todo" : "done",
              completedAt:
                t.status === "done" ? undefined : new Date().toISOString(),
            }
          : t
      ),
    });
  };

  const hoveredTasks = hoveredDate ? tasksByDate.get(hoveredDate) ?? [] : [];
  const selectedTasks = selectedDate ? tasksByDate.get(selectedDate) ?? [] : [];

  return (
    <div
      onWheel={handleCalendarWheel}
      className="flex h-full flex-col overflow-hidden px-3 sm:px-6 py-3 sm:py-4"
    >
      {/* Minimal Calendar Header */}
      <div className="mb-2.5 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-zinc-100">
            {t("calendar.yearMonth", {
              year: cursor.getFullYear(),
              month: cursor.getMonth() + 1,
            })}
          </h2>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => shiftMonth(-1)}
            className="rounded-lg p-1 text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-100"
            title={t("calendar.prevMonth")}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={jumpToday}
            className="rounded-lg px-2 py-1 text-xs text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-100"
          >
            {t("common.today")}
          </button>
          <button
            onClick={() => shiftMonth(1)}
            className="rounded-lg p-1 text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-100"
            title={t("calendar.nextMonth")}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Weekday Header */}
      <div className="mb-1.5 grid grid-cols-7 gap-1 sm:gap-2 shrink-0">
        {weekdays.map((day) => (
          <div
            key={day}
            className="px-1 text-center text-[11px] font-medium text-zinc-500"
          >
            {t("calendar.weekdayPrefix")}
            {day}
          </div>
        ))}
      </div>

      {/* Month Grid */}
      <div className="grid flex-1 grid-cols-7 gap-1 sm:gap-2 overflow-y-auto">
        {calendarDays.map(({ date, key, inMonth }) => {
          const dayTasks = tasksByDate.get(key) ?? [];
          const isToday = key === todayKey;
          const pendingDayCount = dayTasks.filter(
            (tItem) => tItem.status !== "done"
          ).length;

          const isDropTarget = dragOverDate === key;

          return (
            <div
              key={key}
              onMouseEnter={(e) => handleCellMouseEnter(key, e)}
              onMouseLeave={() => setHoveredDate(null)}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverDate(key);
              }}
              onDragLeave={() => {
                if (dragOverDate === key) setDragOverDate(null);
              }}
              onDrop={(e) => handleDropOnDate(e, key)}
              onClick={() => {
                setSelectedDate(key);
                if (!quickColId && workspace.columns.length > 0) {
                  setQuickColId(workspace.columns[0].id);
                }
              }}
              className={`group flex min-h-[58px] sm:min-h-[82px] cursor-pointer flex-col rounded-lg sm:rounded-xl p-1.5 sm:p-2 transition-all duration-150 ${
                isDropTarget
                  ? "bg-[#25221a] shadow-[0_6px_18px_rgba(245,158,11,0.14)]"
                  : isToday
                  ? "bg-[#1f1d18] shadow-[0_2px_10px_rgba(245,158,11,0.1)]"
                  : inMonth
                  ? "bg-[#16161a] shadow-[0_1px_3px_rgba(0,0,0,0.18)] hover:bg-[#1f1f25] hover:shadow-[0_4px_12px_rgba(0,0,0,0.28)]"
                  : "bg-[#131316]/60 opacity-45 hover:opacity-75"
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-md text-[11px] sm:text-xs font-medium ${
                    isToday
                      ? "bg-shiba-500 text-zinc-950 font-semibold"
                      : "text-zinc-300"
                  }`}
                >
                  {date.getDate()}
                </span>

                {pendingDayCount > 0 && (
                  <span className="hidden sm:inline text-[10px] text-zinc-500">
                    {pendingDayCount}
                  </span>
                )}
              </div>

              {/* Mobile compact dots */}
              {dayTasks.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1 sm:hidden">
                  {dayTasks.slice(0, 4).map((task) => {
                    const col = columnMap.get(task.columnId);
                    return (
                      <span
                        key={task.id}
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: col?.color ?? "#94a3b8" }}
                      />
                    );
                  })}
                </div>
              )}

              {/* Desktop Compact Task Pills inside Cell */}
              <div className="mt-1.5 hidden sm:block space-y-1 overflow-hidden">
                {dayTasks.slice(0, 3).map((task) => {
                  const col = columnMap.get(task.columnId);
                  return (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={(e) => {
                        e.stopPropagation();
                        e.dataTransfer.setData(
                          "application/x-shibaplan-cal-task",
                          task.id
                        );
                        e.dataTransfer.effectAllowed = "move";
                        setHoveredDate(null);
                      }}
                      className={`flex cursor-grab active:cursor-grabbing items-center gap-1.5 rounded bg-white/[0.04] px-1.5 py-0.5 text-[11px] ${
                        task.status === "done"
                          ? "text-zinc-500 line-through opacity-60"
                          : "text-zinc-200"
                      }`}
                    >
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: col?.color ?? "#94a3b8" }}
                      />
                      {task.startTime && (
                        <span className="shrink-0 font-mono text-[10px] text-zinc-400">
                          {task.startTime}
                        </span>
                      )}
                      <span className="truncate">{task.title}</span>
                    </div>
                  );
                })}
                {dayTasks.length > 3 && (
                  <div className="px-1 text-[10px] text-zinc-500">
                    +{dayTasks.length - 3} 更多
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Floating Hover Tooltip Card */}
      {hoveredDate && !selectedDate && (
        <div
          style={{ left: hoverPos.x, top: hoverPos.y }}
          className="pointer-events-none fixed z-40 w-[280px] rounded-2xl bg-[#1b1b20]/95 p-3.5 ring-1 ring-white/[0.12] shadow-2xl backdrop-blur-md"
        >
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
            <span className="text-xs font-semibold text-zinc-100">
              {hoveredDate}
              {hoveredDate === todayKey ? " · 今天" : ""}
            </span>
            <span className="text-[11px] text-zinc-500">
              {hoveredTasks.length} 项任务
            </span>
          </div>

          {hoveredTasks.length === 0 ? (
            <p className="py-3 text-xs text-zinc-500">
              当天暂无排期任务，点击可快速添加
            </p>
          ) : (
            <div className="mt-2.5 space-y-2">
              {hoveredTasks.map((task) => {
                const col = columnMap.get(task.columnId);
                return (
                  <div key={task.id} className="space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: col?.color ?? "#94a3b8" }}
                      />
                      {task.importance === 3 && task.status !== "done" && (
                        <Star
                          className="h-3 w-3 shrink-0 text-shiba-400"
                          fill="currentColor"
                        />
                      )}
                      <span
                        className={`truncate text-xs ${
                          task.status === "done"
                            ? "text-zinc-500 line-through"
                            : "text-zinc-100"
                        }`}
                      >
                        {task.title}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 pl-3 text-[10px] text-zinc-500">
                      <span>{col?.title ?? "看板"}</span>
                      {task.startTime && (
                        <span className="flex items-center gap-0.5 font-mono text-shiba-400/90">
                          <Clock className="h-2.5 w-2.5" />
                          {task.startTime}
                        </span>
                      )}
                      <span>预估 {task.estimatedMinutes}m</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Day Detail & Quick Add Modal (shadcn/ui Dialog) */}
      <Dialog
        open={Boolean(selectedDate)}
        onOpenChange={(open) => {
          if (!open) setSelectedDate(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarIcon className="h-4 w-4 text-primary" />
              <span>
                {selectedDate}
                {selectedDate === todayKey ? ` · ${t("common.today")}` : ""}
              </span>
            </DialogTitle>
          </DialogHeader>

          <Separator className="my-3" />

          <div className="max-h-60 space-y-2 overflow-y-auto">
            {selectedTasks.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                {t("calendar.noTasksDay")}
              </p>
            ) : (
              selectedTasks.map((task) => {
                const col = columnMap.get(task.columnId);
                const isDone = task.status === "done";
                return (
                  <div
                    key={task.id}
                    className="flex items-center justify-between gap-2 rounded-xl bg-background px-3 py-2.5 shadow-card-rest"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <button
                        onClick={() => toggleDone(task.id)}
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition ${
                          isDone
                            ? "border-muted-foreground/60 text-muted-foreground"
                            : "border-muted-foreground/50 hover:border-primary"
                        }`}
                      >
                        {isDone && <Check className="h-2.5 w-2.5 stroke-[2.5]" />}
                      </button>
                      <div className="min-w-0">
                        <div
                          className={`truncate text-xs ${
                            isDone
                              ? "text-muted-foreground line-through"
                              : "text-foreground"
                          }`}
                        >
                          {task.title}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{
                                backgroundColor: col?.color ?? "#94a3b8",
                              }}
                            />
                            {col?.title ?? t("nav.kanban")}
                          </span>
                          {task.startTime && (
                            <span className="font-mono text-primary">
                              {task.startTime}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {workspace.columns.length > 0 ? (
            <form
              onSubmit={handleQuickAddOnDate}
              className="mt-4 space-y-2.5 border-t border-border/60 pt-3.5"
            >
              <Input
                type="text"
                value={quickTitle}
                onChange={(e) => setQuickTitle(e.target.value)}
                placeholder={t("calendar.addForDayPlaceholder")}
              />
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <select
                    value={quickColId}
                    onChange={(e) => setQuickColId(e.target.value)}
                    className="h-8 rounded-lg bg-background px-2.5 text-xs text-foreground focus:outline-none"
                  >
                    {workspace.columns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                  <Input
                    type="time"
                    value={quickTime}
                    onChange={(e) => setQuickTime(e.target.value)}
                    className="w-28"
                  />
                </div>
                <Button type="submit" disabled={!quickTitle.trim()}>
                  <Plus className="h-3.5 w-3.5" />
                  {t("calendar.add")}
                </Button>
              </div>
            </form>
          ) : (
            <p className="mt-4 border-t border-border/60 pt-3 text-center text-[11px] text-muted-foreground">
              {t("calendar.needColumnHint")}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
