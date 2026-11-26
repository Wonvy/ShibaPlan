import React, { useEffect, useRef, useState } from "react";
import {
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  Globe,
  Pencil,
  Play,
  RefreshCw,
  Star,
  Trash2,
} from "lucide-react";
import { TaskItem } from "../../types";
import { FolderEntry, isTauriRuntime, openPathInOs } from "../../lib/storage";
import {
  AreaMenuRequest,
  EFFORT_LABEL,
  InsertPosition,
  TranslateFn,
  formatShortDate,
} from "./constants";

/** Referentially stable callbacks shared by every card. */
export interface TaskCardActions {
  openAreaContextMenu: (e: React.MouseEvent, menu: AreaMenuRequest) => void;
  onDragStart: (e: React.DragEvent, taskId: string) => void;
  onDragEnd: () => void;
  onDragOver: (
    e: React.DragEvent<HTMLDivElement>,
    colId: string,
    taskId: string
  ) => void;
  onDrop: (
    e: React.DragEvent<HTMLDivElement>,
    colId: string,
    taskId: string
  ) => void;
  toggleDone: (task: TaskItem) => void;
  toggleFolderExpand: (task: TaskItem) => void;
  toggleCardCollapse: (taskId: string) => void;
  loadFolder: (taskId: string, folderPath: string) => void;
  onImageHover: (src: string, e: React.MouseEvent<HTMLImageElement>) => void;
  onImageLeave: () => void;
  cycleEffort: (task: TaskItem) => void;
  openTaskEditor: (task: TaskItem) => void;
  startRename: (task: TaskItem) => void;
  commitRename: (taskId: string, title: string) => void;
  cancelRename: () => void;
  startFocus: (task: TaskItem) => void;
  toggleStar: (task: TaskItem) => void;
  requestDelete: (task: TaskItem) => void;
}

export interface TaskCardProps {
  task: TaskItem;
  colId: string;
  showNotes: boolean;
  showImage: boolean;
  showEffort: boolean;
  showDate: boolean;
  isFocusing: boolean;
  isRenaming: boolean;
  isBeingDragged: boolean;
  /** Drop-insert indicator position (already null when this card is dragged). */
  insertPosition: InsertPosition | null;
  isCollapsed: boolean;
  isFolderExpanded: boolean;
  folderEntries: FolderEntry[] | undefined;
  isFolderLoading: boolean;
  /** Current locale; only used to re-render when the language changes. */
  locale: string;
  t: TranslateFn;
  actions: TaskCardActions;
}

function parseTaskUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return null;
  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

function formatMiddleEllipsisUrl(url: URL, maxLen = 32): string {
  const host = url.hostname.replace(/^www\./i, "");
  const rest = `${url.pathname === "/" ? "" : url.pathname}${url.search}${url.hash}`;
  const display = `${host}${rest}`;
  if (display.length <= maxLen) return display;

  const tailLen = Math.max(8, Math.min(12, Math.floor((maxLen - 1) * 0.36)));
  const headLen = Math.max(host.length, maxLen - 1 - tailLen);
  if (headLen + tailLen + 1 >= display.length) return display;
  return `${display.slice(0, headLen)}…${display.slice(-tailLen)}`;
}

const SiteFavicon: React.FC<{ url: URL }> = ({ url }) => {
  const sources = [
    `${url.origin}/favicon.ico`,
    `https://icons.duckduckgo.com/ip3/${url.hostname}.ico`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.hostname)}&sz=32`,
  ];
  const [srcIdx, setSrcIdx] = useState(0);

  useEffect(() => {
    setSrcIdx(0);
  }, [url.origin, url.hostname]);

  if (srcIdx >= sources.length) {
    return <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />;
  }

  return (
    <img
      src={sources[srcIdx]}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setSrcIdx((i) => i + 1)}
      className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-[3px] object-contain"
    />
  );
};

const InlineTitleInput: React.FC<{
  initialTitle: string;
  placeholder: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
}> = ({ initialTitle, placeholder, onCommit, onCancel }) => {
  const [value, setValue] = useState(initialTitle);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const composingRef = useRef(false);
  const finishedRef = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const commit = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onCommit(value);
  };

  const cancel = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onCancel();
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={() => {
        composingRef.current = false;
      }}
      onBlur={commit}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          if (composingRef.current || e.nativeEvent.isComposing) return;
          e.preventDefault();
          e.stopPropagation();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          cancel();
        }
      }}
      placeholder={placeholder}
      className="w-full min-w-0 rounded border border-primary/60 bg-background px-1.5 py-0.5 text-[13px] leading-snug text-foreground focus:outline-none"
    />
  );
};

const TaskCardImpl: React.FC<TaskCardProps> = ({
  task,
  colId,
  showNotes,
  showImage,
  showEffort,
  showDate,
  isFocusing,
  isRenaming,
  isBeingDragged,
  insertPosition,
  isCollapsed,
  isFolderExpanded,
  folderEntries,
  isFolderLoading,
  t,
  actions,
}) => {
  const isDone = task.status === "done";
  const showInsertBefore = insertPosition === "before";
  const showInsertAfter = insertPosition === "after";
  const entries = folderEntries ?? task.cachedFiles ?? [];
  const taskUrl = !task.folderPath && !task.filePath ? parseTaskUrl(task.title) : null;

  return (
    <div
      data-kanban-card="true"
      onContextMenu={(e) =>
        actions.openAreaContextMenu(e, {
          kind: "card",
          taskId: task.id,
          colId,
        })
      }
      className="relative"
    >
      {showInsertBefore && (
        <div className="mb-1.5 h-0.5 w-full rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.55)]" />
      )}
      <div
        draggable={!isRenaming}
        onDragStart={(e) => {
          if (isRenaming) {
            e.preventDefault();
            return;
          }
          actions.onDragStart(e, task.id);
        }}
        onDragEnd={actions.onDragEnd}
        onDragOver={(e) => actions.onDragOver(e, colId, task.id)}
        onDrop={(e) => actions.onDrop(e, colId, task.id)}
        className={`group ${
          isRenaming ? "cursor-default" : "cursor-grab active:cursor-grabbing"
        } rounded-md border px-2.5 py-2 transition-colors duration-150 ${
          isBeingDragged
            ? "opacity-35 scale-[0.98] border-border bg-card shadow-none"
            : isFocusing
            ? "border-primary/50 bg-primary/[0.07] shadow-card-rest"
            : isDone
            ? "border-border/45 bg-card/55 opacity-55 shadow-none"
            : "border-border/75 bg-card shadow-card-rest hover:border-foreground/15 hover:bg-surface-elevated"
        }`}
      >
        <div className="flex items-start gap-2">
          {/* Minimalist Hairline Checkbox */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              actions.toggleDone(task);
            }}
            className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
              isDone
                ? "border-primary/70 bg-primary/15 text-primary"
                : "border-muted-foreground/50 hover:border-primary"
            }`}
            title={isDone ? t("kanban.restoreTodo") : t("kanban.markDone")}
          >
            {isDone && <Check className="h-2.5 w-2.5 stroke-[2.5]" />}
          </button>

          <div className="flex-1 min-w-0">
            {task.folderPath ? (
              /* Compact Expandable Folder Shortcut Card */
              <div>
                <div className="flex items-center justify-between gap-1">
                  {isRenaming ? (
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                      {isFolderExpanded ? (
                        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-shiba-400" />
                      ) : (
                        <Folder className="h-3.5 w-3.5 shrink-0 text-shiba-400" />
                      )}
                      <InlineTitleInput
                        initialTitle={task.title}
                        placeholder={t("kanban.taskTitlePlaceholder")}
                        onCommit={(title) =>
                          actions.commitRename(task.id, title)
                        }
                        onCancel={actions.cancelRename}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => actions.toggleFolderExpand(task)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        actions.startRename(task);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                      title={
                        isFolderExpanded
                          ? t("kanban.collapseFolder")
                          : t("kanban.expandFolder")
                      }
                    >
                      {isFolderExpanded ? (
                        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-shiba-400" />
                      ) : (
                        <Folder className="h-3.5 w-3.5 shrink-0 text-shiba-400" />
                      )}
                      <span
                        className={`truncate text-[13px] font-medium ${
                          isDone
                            ? "text-zinc-500 line-through"
                            : "text-zinc-100"
                        }`}
                      >
                        {task.title}
                      </span>
                    </button>
                  )}

                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => openPathInOs(task.folderPath!)}
                      className="rounded p-0.5 text-zinc-400 transition hover:bg-white/[0.08] hover:text-shiba-400"
                      title={t("kanban.openFolder")}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => actions.toggleCardCollapse(task.id)}
                      className="rounded p-0.5 text-zinc-500 transition hover:bg-white/[0.08] hover:text-zinc-200"
                      title={
                        isCollapsed
                          ? t("kanban.expandFolder")
                          : t("kanban.collapseFolder")
                      }
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                {!isCollapsed && (
                  <>
                    <p className="mt-0.5 truncate font-mono text-xs text-zinc-500">
                      {task.folderPath}
                    </p>

                    {isFolderExpanded && (
                      <div className="mt-2 rounded-lg bg-[#111113] p-1.5 ring-1 ring-white/[0.06]">
                        <div className="mb-1 flex items-center justify-between px-1">
                          <span className="text-xs text-zinc-500">
                            {`${entries.length} ${t("common.items")}`}
                          </span>
                          {isTauriRuntime() && (
                            <button
                              type="button"
                              onClick={() =>
                                actions.loadFolder(task.id, task.folderPath!)
                              }
                              className="rounded p-0.5 text-zinc-500 hover:text-zinc-200"
                              title={t("kanban.refreshFolder")}
                            >
                              <RefreshCw
                                className={`h-3 w-3 ${
                                  isFolderLoading ? "animate-spin" : ""
                                }`}
                              />
                            </button>
                          )}
                        </div>

                        {isFolderLoading ? (
                          <p className="px-1 py-1.5 text-xs text-zinc-500">
                            {t("kanban.folderLoading")}
                          </p>
                        ) : entries.length === 0 ? (
                          <p className="px-1 py-1.5 text-xs text-zinc-500">
                            {t("kanban.folderEmpty")}
                          </p>
                        ) : (
                          <div className="max-h-36 space-y-0.5 overflow-y-auto">
                            {entries.map((entry) => (
                              <button
                                key={entry.path}
                                type="button"
                                onClick={() => openPathInOs(entry.path)}
                                className="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-xs text-zinc-300 transition hover:bg-white/[0.06] hover:text-zinc-100"
                              >
                                {entry.is_dir ? (
                                  <Folder className="h-3 w-3 shrink-0 text-shiba-400/80" />
                                ) : (
                                  <FileText className="h-3 w-3 shrink-0 text-zinc-500" />
                                )}
                                <span className="truncate">{entry.name}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              /* Compact Collapsible Standard / File Shortcut Card */
              <>
                <div className="flex items-start justify-between gap-1">
                  <div className="flex min-w-0 flex-1 items-start gap-1.5">
                    {task.filePath ? (
                      <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-shiba-400" />
                    ) : taskUrl ? (
                      <SiteFavicon url={taskUrl} />
                    ) : (
                      task.importance === 3 &&
                      !isDone && (
                        <Star
                          className="mt-0.5 h-3 w-3 shrink-0 text-shiba-400"
                          fill="currentColor"
                        />
                      )
                    )}
                    {isRenaming ? (
                      <InlineTitleInput
                        initialTitle={task.title}
                        placeholder={t("kanban.taskTitlePlaceholder")}
                        onCommit={(title) =>
                          actions.commitRename(task.id, title)
                        }
                        onCancel={actions.cancelRename}
                      />
                    ) : taskUrl ? (
                      <a
                        href={taskUrl.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        draggable={false}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isTauriRuntime()) {
                            e.preventDefault();
                            openPathInOs(taskUrl.href).catch(() => {});
                          }
                        }}
                        onDoubleClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          actions.startRename(task);
                        }}
                        title={taskUrl.href}
                        className={`min-w-0 flex-1 truncate text-[13px] leading-snug underline decoration-primary/40 underline-offset-2 transition-colors hover:decoration-primary ${
                          isDone
                            ? "text-muted-foreground line-through"
                            : "text-primary hover:brightness-110"
                        }`}
                      >
                        {formatMiddleEllipsisUrl(taskUrl)}
                      </a>
                    ) : (
                      <p
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          actions.startRename(task);
                        }}
                        title={t("kanban.renameTip")}
                        className={`text-[13px] leading-snug ${
                          isCollapsed ? "truncate" : ""
                        } ${
                          isDone ? "text-zinc-500 line-through" : "text-zinc-100"
                        }`}
                      >
                        {task.title}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-0.5">
                    {task.filePath && isTauriRuntime() && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openPathInOs(task.filePath!);
                        }}
                        className="rounded p-0.5 text-zinc-400 transition hover:bg-white/[0.08] hover:text-shiba-400"
                        title={t("kanban.openFolder")}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    )}
                    {((showNotes && Boolean(task.notes)) ||
                      (showImage && Boolean(task.imagePreview)) ||
                      task.title.includes("\n") ||
                      task.title.length > 26 ||
                      isCollapsed) && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          actions.toggleCardCollapse(task.id);
                        }}
                        className="shrink-0 rounded p-0.5 text-zinc-500 opacity-60 transition hover:bg-white/[0.08] hover:text-zinc-200 group-hover:opacity-100"
                        title={
                          isCollapsed
                            ? t("kanban.expandFolder")
                            : t("kanban.collapseFolder")
                        }
                      >
                        {isCollapsed ? (
                          <ChevronRight className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {!isCollapsed && (
                  <>
                    {showNotes && task.notes && (
                      <p className="mt-1 line-clamp-2 text-xs leading-snug text-zinc-500">
                        {task.notes}
                      </p>
                    )}
                    {showImage && task.imagePreview && (
                      <img
                        src={task.imagePreview}
                        alt="task attachment"
                        onMouseEnter={(e) =>
                          actions.onImageHover(task.imagePreview!, e)
                        }
                        onMouseLeave={actions.onImageLeave}
                        className="mt-1.5 h-14 w-full cursor-zoom-in rounded-md object-cover ring-1 ring-white/[0.08]"
                      />
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {!isCollapsed && (
          <div className="mt-1.5 flex items-center justify-between pl-5.5">
            <div className="flex flex-wrap items-center gap-1">
              {showEffort && (
                <button
                  onClick={() => actions.cycleEffort(task)}
                  className="rounded border border-border/60 bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  title="点击切换预估耗时"
                >
                  {EFFORT_LABEL[task.effort]}
                </button>
              )}
              {showDate && task.dueDate && (
                <button
                  onClick={() => actions.openTaskEditor(task)}
                  className="flex items-center gap-1 rounded border border-primary/25 bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] text-primary transition-colors hover:bg-primary/15"
                  title={t("kanban.schedule")}
                >
                  <Calendar className="h-2.5 w-2.5" />
                  <span>
                    {formatShortDate(task.dueDate)}
                    {task.startTime ? ` ${task.startTime}` : ""}
                  </span>
                </button>
              )}
              {showEffort && task.actualMinutes > 0 && (
                <span className="font-mono text-[11px] text-muted-foreground">
                  {task.actualMinutes}m
                </span>
              )}
            </div>

            <div className="flex items-center gap-0.5 opacity-100 sm:opacity-0 transition sm:group-hover:opacity-100">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  actions.startRename(task);
                }}
                className="rounded p-1 text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-100"
                title={t("kanban.renameCard")}
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                onClick={() => actions.openTaskEditor(task)}
                className="rounded p-1 text-zinc-400 hover:bg-white/[0.08] hover:text-shiba-300"
                title={t("kanban.schedule")}
              >
                <Calendar className="h-3 w-3" />
              </button>
              {!isDone && (
                <button
                  onClick={() => actions.startFocus(task)}
                  className="rounded p-1 text-zinc-400 hover:bg-white/[0.08] hover:text-shiba-400"
                  title={t("kanban.focus")}
                >
                  <Play className="h-3 w-3" />
                </button>
              )}
              <button
                onClick={() => actions.toggleStar(task)}
                className={`rounded p-1 hover:bg-white/[0.08] ${
                  task.importance === 3
                    ? "text-shiba-400"
                    : "text-zinc-500 hover:text-zinc-200"
                }`}
                title={t("kanban.star")}
              >
                <Star
                  className="h-3 w-3"
                  fill={task.importance === 3 ? "currentColor" : "none"}
                />
              </button>
              <button
                onClick={() => actions.requestDelete(task)}
                className="rounded p-1 text-zinc-500 hover:bg-white/[0.08] hover:text-rose-400"
                title={t("common.delete")}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}
      </div>
      {showInsertAfter && (
        <div className="mt-1.5 h-0.5 w-full rounded-full bg-shiba-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]" />
      )}
    </div>
  );
};

export const TaskCard = React.memo(TaskCardImpl);
TaskCard.displayName = "TaskCard";
