import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  CornerDownLeft,
  FileText,
  Folder,
  Kanban,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Waves,
} from "lucide-react";
import { WorkspaceData } from "../types";
import { isTauriRuntime, openPathInOs } from "../lib/storage";
import { Dialog, DialogContent } from "./ui/dialog";

interface CommandItem {
  id: string;
  group: "task" | "idea" | "trash" | "action";
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  onSelect: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: WorkspaceData;
  onUpdate: (next: WorkspaceData) => void;
  onSwitchView: (view: "kanban" | "calendar") => void;
  onOpenAiPlan: () => void;
  onOpenSettings: () => void;
  onNotify: (msg: string) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onOpenChange,
  workspace,
  onUpdate,
  onSwitchView,
  onOpenAiPlan,
  onOpenSettings,
  onNotify,
}) => {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const colMap = useMemo(
    () => new Map(workspace.columns.map((c) => [c.id, c])),
    [workspace.columns]
  );

  const items = useMemo<CommandItem[]>(() => {
    const q = query.trim().toLowerCase();
    const list: CommandItem[] = [];

    // 1. Kanban tasks & folder/file shortcuts
    workspace.tasks.forEach((task) => {
      const col = colMap.get(task.columnId);
      const hay = `${task.title} ${task.notes ?? ""} ${col?.title ?? ""} ${
        task.folderPath ?? ""
      } ${task.filePath ?? ""}`.toLowerCase();
      if (q && !hay.includes(q)) return;

      list.push({
        id: `task-${task.id}`,
        group: "task",
        title: task.title,
        subtitle: [
          col?.title,
          task.dueDate
            ? `${task.dueDate}${task.startTime ? ` ${task.startTime}` : ""}`
            : null,
          task.status === "done" ? "已完成" : `${task.estimatedMinutes}m`,
        ]
          .filter(Boolean)
          .join(" · "),
        icon: task.folderPath ? (
          <Folder className="h-3.5 w-3.5 text-primary" />
        ) : task.filePath ? (
          <FileText className="h-3.5 w-3.5 text-primary" />
        ) : task.status === "done" ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <Kanban className="h-3.5 w-3.5 text-muted-foreground" />
        ),
        onSelect: () => {
          onOpenChange(false);
          if ((task.folderPath || task.filePath) && isTauriRuntime()) {
            openPathInOs(task.folderPath || task.filePath!);
            onNotify(`已打开 ${task.title}`);
          } else {
            onSwitchView("kanban");
            onNotify(`已定位到「${col?.title ?? "看板"}」: ${task.title}`);
          }
        },
      });
    });

    // 2. Idea River items
    workspace.ideas.forEach((idea) => {
      const hay = `${idea.content} ${idea.tag ?? ""}`.toLowerCase();
      if (q && !hay.includes(q)) return;
      list.push({
        id: `idea-${idea.id}`,
        group: "idea",
        title: idea.content.split("\n")[0].slice(0, 72),
        subtitle: `灵感流 · ${idea.tag || "灵感"}`,
        icon: <Waves className="h-3.5 w-3.5 text-primary" />,
        onSelect: () => {
          navigator.clipboard.writeText(idea.content).catch(() => {});
          onOpenChange(false);
          onNotify("已复制该灵感内容到剪贴板");
        },
      });
    });

    // 3. Trashed ideas (when searching)
    if (q) {
      workspace.trashedIdeas.forEach((item) => {
        const hay = `${item.content} ${item.tag ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return;
        list.push({
          id: `trash-${item.id}`,
          group: "trash",
          title: item.content.split("\n")[0].slice(0, 72),
          subtitle: "回收站 · 回车恢复到灵感流",
          icon: <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />,
          onSelect: () => {
            const { deletedAt: _d, reason: _r, ...restored } = item;
            onUpdate({
              ...workspace,
              ideas: [restored, ...workspace.ideas],
              trashedIdeas: workspace.trashedIdeas.filter(
                (t) => t.id !== item.id
              ),
            });
            onOpenChange(false);
            onNotify("已从回收站恢复灵感");
          },
        });
      });
    }

    // 4. Quick Actions
    const actions: CommandItem[] = [
      {
        id: "act-ai-plan",
        group: "action",
        title: "AI 今日排期建议",
        subtitle: "结合任务耗时与截止时间自动给出优先顺序",
        icon: <Sparkles className="h-3.5 w-3.5 text-primary" />,
        onSelect: () => {
          onOpenChange(false);
          onOpenAiPlan();
        },
      },
      {
        id: "act-kanban",
        group: "action",
        title: "切换到看板视图",
        subtitle: "管理自定义列与自由画布",
        icon: <Kanban className="h-3.5 w-3.5 text-muted-foreground" />,
        onSelect: () => {
          onSwitchView("kanban");
          onOpenChange(false);
        },
      },
      {
        id: "act-calendar",
        group: "action",
        title: "切换到时间月历视图",
        subtitle: "按日期排期与悬停预览",
        icon: <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />,
        onSelect: () => {
          onSwitchView("calendar");
          onOpenChange(false);
        },
      },
      {
        id: "act-settings",
        group: "action",
        title: "打开设置（主题 / 多语言 / AI 接口 / 数据备份）",
        icon: <Trash2 className="h-3.5 w-3.5 text-muted-foreground opacity-0" />,
        onSelect: () => {
          onOpenChange(false);
          onOpenSettings();
        },
      },
    ];

    actions.forEach((act) => {
      if (
        !q ||
        `${act.title} ${act.subtitle ?? ""}`.toLowerCase().includes(q)
      ) {
        list.push(act);
      }
    });

    return list.slice(0, 24);
  }, [query, workspace, colMap, onOpenChange, onSwitchView, onOpenAiPlan, onOpenSettings, onNotify, onUpdate]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (items.length ? (i + 1) % items.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) =>
        items.length ? (i - 1 + items.length) % items.length : 0
      );
    } else if (e.key === "Enter" && items[activeIndex]) {
      e.preventDefault();
      items[activeIndex].onSelect();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        className="max-w-xl overflow-hidden p-0"
        onKeyDown={handleKeyDown}
      >
        {/* Search Input Header */}
        <div className="flex items-center gap-2.5 border-b border-border/70 px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索看板任务、文件夹、灵感、回收站或快捷命令..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
          />
          <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-[360px] overflow-y-auto p-2">
          {items.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground">
              没有找到匹配的任务、灵感或命令
            </div>
          ) : (
            items.map((item, idx) => {
              const active = idx === activeIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={item.onSelect}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition ${
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground/90 hover:bg-accent/50"
                  }`}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <span className="shrink-0">{item.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">
                        {item.title}
                      </div>
                      {item.subtitle && (
                        <div className="truncate text-[10px] text-muted-foreground">
                          {item.subtitle}
                        </div>
                      )}
                    </div>
                  </div>

                  {active && (
                    <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
