import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  CornerDownLeft,
  ExternalLink,
  FileText,
  Folder,
  Kanban,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  StickyNote,
  Trash2,
  Waves,
} from "lucide-react";
import { WorkspaceData } from "../types";
import { openOfflineDocs, openOnlineDocs } from "../lib/docs";
import { useI18n } from "../lib/i18n";
import { isTauriRuntime, openPathInOs } from "../lib/storage";
import {
  formatExpiryLabel,
  getDaysUntilExpiry,
  getExpiryUrgency,
} from "../lib/memo";
import { describeSchedule } from "../lib/infoProtocol";
import { Dialog, DialogContent } from "./ui/dialog";

interface CommandItem {
  id: string;
  group: "task" | "memo" | "info" | "idea" | "trash" | "action";
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
  onSwitchView: (view: "projects" | "kanban" | "calendar" | "memos" | "info") => void;
  onOpenMemo?: (memoId: string) => void;
  onRunAllInfoWidgets?: () => void;
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
  onOpenMemo,
  onRunAllInfoWidgets,
  onOpenAiPlan,
  onOpenSettings,
  onNotify,
}) => {
  const { locale } = useI18n();
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

    // 2. Memos (software summaries, certs, memberships, server notes)
    const memoFolderMap = new Map(
      (workspace.memoFolders ?? []).map((f) => [f.id, f.name])
    );
    (workspace.memos ?? []).forEach((memo) => {
      const folderName = memo.folderId
        ? memoFolderMap.get(memo.folderId)
        : undefined;
      const hay = `${memo.title} ${memo.tag} ${folderName ?? ""} ${
        memo.content
      } ${memo.expiresAt ?? ""}`.toLowerCase();
      if (q && !hay.includes(q)) return;

      const daysLeft = getDaysUntilExpiry(memo.expiresAt);
      const urgency = getExpiryUrgency(daysLeft);
      const iconClass =
        urgency === "expired" || urgency === "urgent"
          ? "h-3.5 w-3.5 text-rose-500"
          : urgency === "soon"
          ? "h-3.5 w-3.5 text-amber-500"
          : "h-3.5 w-3.5 text-primary";

      list.push({
        id: `memo-${memo.id}`,
        group: "memo",
        title: memo.title.trim() || "未命名笔记",
        subtitle: [
          "笔记",
          folderName || null,
          memo.tag.trim() || null,
          memo.expiresAt && daysLeft !== null
            ? `${memo.expiresAt} (${formatExpiryLabel(daysLeft)})`
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
        icon: <StickyNote className={iconClass} />,
        onSelect: () => {
          onOpenChange(false);
          if (onOpenMemo) {
            onOpenMemo(memo.id);
          } else {
            onSwitchView("memos");
          }
        },
      });
    });

    // 3. Info Dashboard widgets
    (workspace.infoWidgets ?? []).forEach((w) => {
      const hay = `${w.title} ${w.description ?? ""} ${w.source.scriptPath ?? ""} ${w.source.command ?? ""} ${w.source.url ?? ""}`.toLowerCase();
      if (q && !hay.includes(q)) return;
      list.push({
        id: `info-${w.id}`,
        group: "info",
        title: w.title,
        subtitle: `信息卡片 · ${describeSchedule(w.schedule, w.source.kind)}`,
        icon: <Activity className="h-3.5 w-3.5 text-primary" />,
        onSelect: () => {
          onOpenChange(false);
          onSwitchView("info");
        },
      });
    });

    // 4. Idea River items
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

    // 3. Trashed ideas & memos (when searching)
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

      (workspace.trashedMemos ?? []).forEach((item) => {
        const hay = `${item.title} ${item.tag} ${item.content}`.toLowerCase();
        if (!hay.includes(q)) return;
        list.push({
          id: `trash-memo-${item.id}`,
          group: "trash",
          title: item.title.trim() || "未命名笔记",
          subtitle: "笔记回收站 · 回车恢复并打开",
          icon: <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />,
          onSelect: () => {
            const { deletedAt: _d, ...restored } = item;
            const folderValid =
              restored.folderId &&
              (workspace.memoFolders ?? []).some((f) => f.id === restored.folderId);
            const cleanMemo = folderValid
              ? restored
              : { ...restored, folderId: undefined };
            onUpdate({
              ...workspace,
              memos: [cleanMemo, ...(workspace.memos ?? [])],
              trashedMemos: (workspace.trashedMemos ?? []).filter(
                (t) => t.id !== item.id
              ),
            });
            onOpenChange(false);
            onSwitchView("memos");
            onOpenMemo?.(cleanMemo.id);
            onNotify("已从回收站恢复笔记");
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
        id: "act-memos",
        group: "action",
        title: "切换到笔记视图",
        subtitle: "软件摘要、证书/会员到期与服务器记录",
        icon: <StickyNote className="h-3.5 w-3.5 text-muted-foreground" />,
        onSelect: () => {
          onSwitchView("memos");
          onOpenChange(false);
        },
      },
      {
        id: "act-info",
        group: "action",
        title: "切换到信息仪表盘",
        subtitle: "自定义脚本、命令行与 HTTP 自动化卡片",
        icon: <Activity className="h-3.5 w-3.5 text-muted-foreground" />,
        onSelect: () => {
          onSwitchView("info");
          onOpenChange(false);
        },
      },
      ...(onRunAllInfoWidgets
        ? [
            {
              id: "act-info-refresh",
              group: "action" as const,
              title: "刷新全部信息卡片",
              subtitle: "立即运行所有已配置的脚本与数据源",
              icon: <RefreshCw className="h-3.5 w-3.5 text-primary" />,
              onSelect: () => {
                onOpenChange(false);
                onRunAllInfoWidgets();
              },
            },
          ]
        : []),
      {
        id: "act-docs-offline",
        group: "action",
        title: "离线查阅使用说明与文档 (Offline Docs / User Guide)",
        subtitle: "内置中英双语手册，无需联网即可全文检索",
        icon: <BookOpen className="h-3.5 w-3.5 text-primary" />,
        onSelect: () => {
          onOpenChange(false);
          openOfflineDocs("home", locale).catch(() => {});
        },
      },
      {
        id: "act-docs-api",
        group: "action",
        title: "离线查阅接口与协议文档 (API & Webhook Reference)",
        subtitle: "18421 推送 Webhook、shibaplan-info/v1 协议与在线调试器",
        icon: <BookOpen className="h-3.5 w-3.5 text-primary" />,
        onSelect: () => {
          onOpenChange(false);
          openOfflineDocs("api-webhook", locale).catch(() => {});
        },
      },
      {
        id: "act-docs-online",
        group: "action",
        title: "在浏览器打开在线文档站 (Online Documentation)",
        subtitle: "访问 GitHub Pages 最新中英文公开文档与 OpenAPI 规范",
        icon: <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />,
        onSelect: () => {
          onOpenChange(false);
          openOnlineDocs("home", locale).catch(() => {});
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
  }, [query, locale, workspace, colMap, onOpenChange, onSwitchView, onOpenMemo, onRunAllInfoWidgets, onOpenAiPlan, onOpenSettings, onNotify, onUpdate]);

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
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索看板任务、笔记、文件夹、灵感、回收站或快捷命令..."
            className="flex-1 bg-transparent text-[13.5px] text-foreground placeholder:text-muted-foreground/65 focus:outline-none"
          />
          <kbd className="rounded border border-border bg-muted/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-[360px] overflow-y-auto p-1.5">
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
                  className={`flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left transition-colors ${
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
                        <div className="truncate text-xs text-muted-foreground">
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
