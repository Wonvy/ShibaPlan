import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileText,
  Folder,
  Globe,
  Image as ImageIcon,
  Pencil,
  Play,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { TaskAttachment, TaskItem } from "../../types";
import { FolderEntry, isTauriRuntime, openPathInOs } from "../../lib/storage";
import {
  AreaMenuRequest,
  InsertPosition,
  TASK_PRIORITY_CARD_CLASS,
  TranslateFn,
  formatShortDate,
} from "./constants";
import {
  getTaskAttachments,
  isOsFileDrag,
  stripLegacyFolderTokens,
} from "./dropUtils";
import { AttachmentIcon } from "./AttachmentIcon";

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
  toggleFolderExpand: (folderPath: string, cachedFiles?: FolderEntry[]) => void;
  toggleCardCollapse: (taskId: string) => void;
  loadFolder: (folderPath: string) => void;
  removeTaskAttachment: (taskId: string, path: string) => void;
  onImageHover: (src: string, e: React.MouseEvent<HTMLElement>) => void;
  onImageLeave: () => void;
  cycleEffort: (task: TaskItem) => void;
  setEstimatedMinutes: (task: TaskItem, minutes: number) => void;
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
  expandedFolders: Record<string, boolean>;
  folderFiles: Record<string, FolderEntry[]>;
  loadingFolders: Record<string, boolean>;
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

const PortalTooltip: React.FC<{
  anchor: { left: number; bottom: number };
  text: string;
}> = ({ anchor, text }) =>
  createPortal(
    <div
      style={{
        left: anchor.left,
        bottom: anchor.bottom,
      }}
      className="pointer-events-none fixed z-[9999] max-w-[320px] break-all rounded-md border border-border bg-popover px-2.5 py-1 text-[11px] leading-snug text-popover-foreground shadow-popover-soft"
    >
      {text}
    </div>,
    document.body
  );

function computeTooltipAnchor(el: HTMLElement, maxW = 320): {
  left: number;
  bottom: number;
} {
  const rect = el.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - maxW - 12));
  const bottom = window.innerHeight - rect.top + 6;
  return { left, bottom };
}

const SingleAttachmentButton: React.FC<{
  att: TaskAttachment;
}> = ({ att }) => {
  const [tooltipPos, setTooltipPos] = useState<{
    left: number;
    bottom: number;
  } | null>(null);

  return (
    <>
      <button
        type="button"
        draggable={false}
        onMouseEnter={(e) =>
          setTooltipPos(computeTooltipAnchor(e.currentTarget))
        }
        onMouseLeave={() => setTooltipPos(null)}
        onClick={(e) => {
          e.stopPropagation();
          setTooltipPos(null);
          openPathInOs(att.path).catch(() => {});
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        className="relative flex items-center justify-center rounded border border-border/60 bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent hover:text-foreground"
      >
        <AttachmentIcon path={att.path} isDir={att.is_dir} className="h-3.5 w-3.5" />
      </button>
      {tooltipPos && <PortalTooltip anchor={tooltipPos} text={att.name} />}
    </>
  );
};

const AttachmentMenuButton: React.FC<{
  taskId: string;
  items: TaskAttachment[];
  kind: "mixed" | "files";
  onRemove: (taskId: string, path: string) => void;
}> = ({ taskId, items, kind, onRemove }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [tooltipPos, setTooltipPos] = useState<{
    left: number;
    bottom: number;
  } | null>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; bottom: number }>({
    left: 0,
    bottom: 0,
  });
  const btnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const allDirs = items.every((a) => a.is_dir);
  const allFiles = kind === "files" || items.every((a) => !a.is_dir);
  const tooltipText = allFiles
    ? `${items.length} 个文件：${items.map((a) => a.name).join("、")}`
    : allDirs
    ? `${items.length} 个文件夹：${items.map((a) => a.name).join("、")}`
    : `${items.length} 个文件/文件夹：${items.map((a) => a.name).join("、")}`;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setTooltipPos(null);
    if (!menuOpen && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const menuW = 224;
      setMenuPos({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - menuW - 12)),
        bottom: window.innerHeight - rect.top + 6,
      });
    }
    setMenuOpen((v) => !v);
  };

  return (
    <div className="relative inline-flex items-center">
      <button
        ref={btnRef}
        type="button"
        draggable={false}
        onMouseEnter={(e) => {
          if (!menuOpen) setTooltipPos(computeTooltipAnchor(e.currentTarget));
        }}
        onMouseLeave={() => setTooltipPos(null)}
        onClick={handleToggle}
        onDoubleClick={(e) => e.stopPropagation()}
        className={`relative flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] transition-colors ${
          menuOpen
            ? "border-primary/45 bg-primary/15 text-primary"
            : "border-border/60 bg-muted/50 text-muted-foreground hover:border-primary/40 hover:bg-accent hover:text-foreground"
        }`}
      >
        {allFiles ? (
          <FileText className="h-3 w-3 shrink-0 text-shiba-400" />
        ) : (
          <Folder className="h-3 w-3 shrink-0 text-shiba-400" />
        )}
        <span className="font-mono text-[10px] leading-none">
          {items.length}
        </span>
        <ChevronUp className="h-2.5 w-2.5 shrink-0 opacity-70" />
      </button>

      {!menuOpen && tooltipPos && (
        <PortalTooltip anchor={tooltipPos} text={tooltipText} />
      )}

      {menuOpen &&
        createPortal(
          <div
            style={{ left: menuPos.left, bottom: menuPos.bottom }}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            className="fixed z-[9999] w-56 rounded-lg border border-border bg-popover p-1 shadow-popover-soft"
          >
            <div className="max-h-52 space-y-0.5 overflow-y-auto">
              {items.map((att) => (
                <div
                  key={att.path}
                  className="group/item flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors hover:bg-accent"
                >
                  <button
                    type="button"
                    onClick={() => {
                      openPathInOs(att.path).catch(() => {});
                      setMenuOpen(false);
                    }}
                    title={att.path}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs text-popover-foreground"
                  >
                    <AttachmentIcon
                      path={att.path}
                      isDir={att.is_dir}
                      className="h-3.5 w-3.5"
                    />
                    <span className="truncate">{att.name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(taskId, att.path);
                      if (items.length <= 2) setMenuOpen(false);
                    }}
                    title="移除快捷方式"
                    className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition hover:bg-destructive/15 hover:text-destructive group-hover/item:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

const CardAttachmentsTrigger: React.FC<{
  taskId: string;
  attachments: TaskAttachment[];
  onRemove: (taskId: string, path: string) => void;
}> = ({ taskId, attachments, onRemove }) => {
  if (attachments.length === 0) return null;

  const dirs = attachments.filter((a) => a.is_dir);
  const files = attachments.filter((a) => !a.is_dir);

  // Over 3 total items OR 2+ folders -> single combined upward pop-up menu
  if (attachments.length > 3 || dirs.length >= 2) {
    return (
      <AttachmentMenuButton
        taskId={taskId}
        items={attachments}
        kind="mixed"
        onRemove={onRemove}
      />
    );
  }

  return (
    <div className="inline-flex items-center gap-1">
      {dirs.length === 1 && <SingleAttachmentButton att={dirs[0]} />}
      {files.length === 1 && <SingleAttachmentButton att={files[0]} />}
      {files.length >= 2 && (
        <AttachmentMenuButton
          taskId={taskId}
          items={files}
          kind="files"
          onRemove={onRemove}
        />
      )}
    </div>
  );
};

const EFFORT_SLIDER_STEPS = [
  15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480,
];

function formatEstimatedMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

const EffortScrubBadge: React.FC<{
  task: TaskItem;
  onCycle: (task: TaskItem) => void;
  onCommitMinutes: (task: TaskItem, minutes: number) => void;
  onPressChange: (pressed: boolean) => void;
}> = ({ task, onCycle, onCommitMinutes, onPressChange }) => {
  const [scrubbing, setScrubbing] = useState<{
    minutes: number;
    progress: number;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const currentMinutes = task.estimatedMinutes || 30;
  const displayLabel = formatEstimatedMinutes(
    scrubbing ? scrubbing.minutes : currentMinutes
  );

  const handleMouseDown = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    // Prevent parent draggable card from capturing drag
    e.preventDefault();
    e.stopPropagation();
    onPressChange(true);
    suppressClickRef.current = false;

    const startX = e.clientX;
    let startIdx = 0;
    let bestDist = Infinity;
    EFFORT_SLIDER_STEPS.forEach((m, i) => {
      const d = Math.abs(m - currentMinutes);
      if (d < bestDist) {
        bestDist = d;
        startIdx = i;
      }
    });

    let active = false;
    let latestMinutes = EFFORT_SLIDER_STEPS[startIdx];

    const updateFromClientX = (clientX: number) => {
      const deltaSteps = Math.round((clientX - startX) / 12);
      const nextIdx = Math.max(
        0,
        Math.min(EFFORT_SLIDER_STEPS.length - 1, startIdx + deltaSteps)
      );
      latestMinutes = EFFORT_SLIDER_STEPS[nextIdx];
      const progress = nextIdx / (EFFORT_SLIDER_STEPS.length - 1);
      setScrubbing({ minutes: latestMinutes, progress });
    };

    const activate = (clientX: number) => {
      active = true;
      suppressClickRef.current = true;
      updateFromClientX(clientX);
    };

    const holdTimer = window.setTimeout(() => {
      activate(startX);
    }, 150);

    const onMove = (ev: MouseEvent) => {
      if (!active && Math.abs(ev.clientX - startX) >= 4) {
        window.clearTimeout(holdTimer);
        activate(ev.clientX);
        return;
      }
      if (active) {
        ev.preventDefault();
        updateFromClientX(ev.clientX);
      }
    };

    const onUp = () => {
      window.clearTimeout(holdTimer);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      onPressChange(false);
      if (active) {
        setScrubbing(null);
        if (latestMinutes !== currentMinutes) {
          onCommitMinutes(task, latestMinutes);
        }
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <button
      type="button"
      draggable={false}
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onMouseDown={handleMouseDown}
      onClick={(e) => {
        e.stopPropagation();
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        onCycle(task);
      }}
      className={`relative overflow-hidden rounded border font-mono text-[11px] select-none transition-[width,background-color,border-color,color] duration-150 ${
        scrubbing
          ? "w-[96px] cursor-ew-resize border-primary/65 bg-muted/80 px-2 py-0.5 text-primary shadow-sm"
          : "w-auto cursor-pointer border-border/60 bg-muted/50 px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
      title="点击切换预估耗时，长按左右拖动滑动调整"
    >
      {scrubbing && (
        <span
          className="pointer-events-none absolute inset-y-0 left-0 bg-primary/25 transition-[width] duration-75"
          style={{ width: `${Math.max(8, Math.round(scrubbing.progress * 100))}%` }}
        />
      )}
      <span className="relative z-10 flex items-center justify-center">
        {displayLabel}
      </span>
    </button>
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
  t,
  actions,
}) => {
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const [isEffortPressed, setIsEffortPressed] = useState(false);
  const isDone = task.status === "done";
  const showInsertBefore = insertPosition === "before";
  const showInsertAfter = insertPosition === "after";
  const attachments = getTaskAttachments(task);
  const displayTitle = stripLegacyFolderTokens(task.title) || task.title;
  const taskUrl =
    attachments.length === 0 ? parseTaskUrl(displayTitle) : null;

  // Hide redundant raw path notes on legacy folder/file tasks where notes === path
  const rawNotes = task.notes ? stripLegacyFolderTokens(task.notes) : undefined;
  const isRedundantPathNote =
    task.notes &&
    attachments.some(
      (a) =>
        task.notes!.trim() === a.path.trim() ||
        task.notes!.trim() === `[[${a.path.trim()}]]`
    );
  const effectiveNotes =
    rawNotes && !isRedundantPathNote ? rawNotes : undefined;

  const canCollapseCard =
    (showNotes && Boolean(effectiveNotes)) ||
    (showImage && Boolean(task.imagePreview)) ||
    displayTitle.includes("\n") ||
    displayTitle.length > 26 ||
    isCollapsed;

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
        draggable={!isRenaming && !isEffortPressed}
        onDragStart={(e) => {
          if (isRenaming || isEffortPressed) {
            e.preventDefault();
            return;
          }
          actions.onImageLeave();
          actions.onDragStart(e, task.id);
        }}
        onDragEnd={actions.onDragEnd}
        onDragOver={(e) => {
          if (isOsFileDrag(e.dataTransfer)) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "copy";
            if (!isFileDragOver) setIsFileDragOver(true);
            return;
          }
          actions.onDragOver(e, colId, task.id);
        }}
        onDragLeave={() => {
          if (isFileDragOver) setIsFileDragOver(false);
        }}
        onDrop={(e) => {
          if (isFileDragOver) setIsFileDragOver(false);
          actions.onDrop(e, colId, task.id);
        }}
        className={`group ${
          isRenaming ? "cursor-default" : "cursor-grab active:cursor-grabbing"
        } rounded-md border px-2.5 py-2 transition-colors duration-150 ${
          isFileDragOver
            ? "border-primary/70 bg-primary/[0.1] ring-2 ring-primary/35 shadow-card-hover"
            : isBeingDragged
            ? "opacity-35 scale-[0.98] border-border bg-card shadow-none"
            : isFocusing
            ? "border-primary/50 bg-primary/[0.07] shadow-card-rest"
            : isDone
            ? task.priorityColor
              ? `${TASK_PRIORITY_CARD_CLASS[task.priorityColor]} opacity-55 shadow-none`
              : "border-border/45 bg-card/55 opacity-55 shadow-none"
            : task.priorityColor
            ? TASK_PRIORITY_CARD_CLASS[task.priorityColor]
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
            <div className="flex items-start justify-between gap-1">
              <div className="flex min-w-0 flex-1 items-start gap-1.5">
                {taskUrl ? (
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
                    initialTitle={displayTitle}
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
                    className={`min-w-0 flex-1 break-words text-[13px] leading-snug ${
                      isCollapsed ? "truncate" : ""
                    } ${
                      isDone ? "text-zinc-500 line-through" : "text-foreground"
                    }`}
                  >
                    {displayTitle}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-0.5">
                {canCollapseCard && (
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

            {!isCollapsed && showNotes && effectiveNotes && (
              <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-xs leading-snug text-muted-foreground">
                {effectiveNotes}
              </p>
            )}
          </div>
        </div>

        {!isCollapsed && (
          <div className="mt-1.5 flex items-center justify-between pl-5.5">
            <div className="flex flex-wrap items-center gap-1">
              {showEffort && (
                <EffortScrubBadge
                  task={task}
                  onCycle={actions.cycleEffort}
                  onCommitMinutes={actions.setEstimatedMinutes}
                  onPressChange={setIsEffortPressed}
                />
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
              {showImage && task.imagePreview && (
                <button
                  type="button"
                  draggable={false}
                  onMouseEnter={(e) => {
                    if (!isBeingDragged) {
                      actions.onImageHover(task.imagePreview!, e);
                    }
                  }}
                  onMouseLeave={actions.onImageLeave}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.onImageLeave();
                    if (task.imagePath && isTauriRuntime()) {
                      openPathInOs(task.imagePath).catch(() => {});
                    } else {
                      actions.openTaskEditor(task);
                    }
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                  className="flex items-center justify-center rounded border border-border/60 bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent hover:text-foreground"
                >
                  <ImageIcon className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                </button>
              )}
              {attachments.length > 0 && (
                <CardAttachmentsTrigger
                  taskId={task.id}
                  attachments={attachments}
                  onRemove={actions.removeTaskAttachment}
                />
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
