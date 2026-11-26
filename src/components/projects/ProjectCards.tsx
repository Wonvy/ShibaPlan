import React, { memo, RefObject, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ExternalLink,
  FolderOpen,
  Star,
} from "lucide-react";
import { IndexedArchiveItem, openArchivePath } from "../../lib/archive";
import { AttachmentIcon } from "../kanban/AttachmentIcon";
import { ProjectThumbnail } from "./ProjectThumbnail";
import { formatFileSize, renderHighlightedText } from "./utils";

/** Lets the browser skip layout/paint for off-screen cards. */
const offscreenSkip = (intrinsicHeight: number): React.CSSProperties => ({
  contentVisibility: "auto",
  containIntrinsicSize: `auto ${intrinsicHeight}px`,
});

// ---------------------------------------------------------------------------
// Dense list row (search results / "all" / "files" / list view)
// ---------------------------------------------------------------------------

export type ListColumnId = "name" | "preview" | "date" | "size";

const LIST_COLS_STORAGE_KEY = "shibaplan_project_list_cols_v2";
const LIST_COL_WIDTHS_STORAGE_KEY = "shibaplan_project_list_col_widths_v1";
const DEFAULT_LIST_COLUMNS: ListColumnId[] = ["preview", "name", "date", "size"];

type ResizableListCol = Exclude<ListColumnId, "name">;
type ListColumnWidths = Record<ResizableListCol, number>;

const DEFAULT_LIST_COL_WIDTHS: ListColumnWidths = {
  preview: 76,
  date: 96,
  size: 78,
};

const LIST_COL_WIDTH_LIMITS: Record<ResizableListCol, { min: number; max: number }> = {
  preview: { min: 52, max: 180 },
  date: { min: 72, max: 180 },
  size: { min: 56, max: 160 },
};

const LIST_COLUMN_META: Record<
  ListColumnId,
  { label: string; headerClass: string; cellClass: string }
> = {
  name: {
    label: "名称",
    headerClass: "min-w-[120px] flex-1 text-left",
    cellClass: "flex min-w-[120px] flex-1 items-center gap-2.5",
  },
  preview: {
    label: "预览",
    headerClass: "shrink-0 text-center",
    cellClass: "flex shrink-0 items-center justify-center",
  },
  date: {
    label: "时间",
    headerClass: "hidden sm:block shrink-0 text-center",
    cellClass: "hidden sm:flex shrink-0 items-center justify-center",
  },
  size: {
    label: "条目 / 大小",
    headerClass: "hidden md:block shrink-0 text-right",
    cellClass: "hidden md:block shrink-0 text-right",
  },
};

function loadSavedListColWidths(): ListColumnWidths {
  try {
    const raw = localStorage.getItem(LIST_COL_WIDTHS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ListColumnWidths>;
      const clamp = (k: ResizableListCol) => {
        const v = parsed[k];
        if (typeof v !== "number" || Number.isNaN(v)) {
          return DEFAULT_LIST_COL_WIDTHS[k];
        }
        return Math.max(
          LIST_COL_WIDTH_LIMITS[k].min,
          Math.min(LIST_COL_WIDTH_LIMITS[k].max, Math.round(v))
        );
      };
      return {
        preview: clamp("preview"),
        date: clamp("date"),
        size: clamp("size"),
      };
    }
  } catch {
    // ignore
  }
  return DEFAULT_LIST_COL_WIDTHS;
}

function loadSavedListColumns(): ListColumnId[] {
  try {
    const raw = localStorage.getItem(LIST_COLS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as string[];
      if (
        Array.isArray(parsed) &&
        parsed.length === DEFAULT_LIST_COLUMNS.length &&
        DEFAULT_LIST_COLUMNS.every((c) => parsed.includes(c))
      ) {
        return parsed as ListColumnId[];
      }
    }
  } catch {
    // ignore
  }
  return DEFAULT_LIST_COLUMNS;
}

interface ProjectListRowProps {
  item: IndexedArchiveItem;
  columns: ListColumnId[];
  colWidths: ListColumnWidths;
  isSelected: boolean;
  isSearching: boolean;
  highlightTerms: string[];
  onSelect: (item: IndexedArchiveItem) => void;
  onHover?: (item: IndexedArchiveItem | null) => void;
  onContextMenu?: (e: React.MouseEvent, item: IndexedArchiveItem) => void;
}

export const ProjectListRow = memo(function ProjectListRow({
  item,
  columns,
  colWidths,
  isSelected,
  isSearching,
  highlightTerms,
  onSelect,
  onHover,
  onContextMenu,
}: ProjectListRowProps) {
  return (
    <div
      onClick={() => onSelect(item)}
      onDoubleClick={() => openArchivePath(item.path)}
      onMouseEnter={onHover ? () => onHover(item) : undefined}
      onMouseLeave={onHover ? () => onHover(null) : undefined}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, item) : undefined}
      className={`group flex h-11 items-center gap-2.5 rounded-md border px-3 text-xs transition-colors cursor-pointer ${
        isSelected
          ? "border-primary/50 bg-card/90"
          : "border-transparent bg-card/25 hover:border-border/70 hover:bg-card/90"
      }`}
    >
      {columns.map((colId) => {
        if (colId === "name") {
          return (
            <div key={colId} className={LIST_COLUMN_META.name.cellClass}>
              <AttachmentIcon
                path={item.path}
                isDir={item.is_dir}
                className="h-4 w-4"
              />
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                {renderHighlightedText(
                  isSearching ? item.name : item.displayTitle,
                  highlightTerms
                )}
              </span>
            </div>
          );
        }
        if (colId === "preview") {
          return (
            <div
              key={colId}
              style={{ width: colWidths.preview }}
              className={LIST_COLUMN_META.preview.cellClass}
            >
              {item.thumbnail_path ? (
                <ProjectThumbnail
                  thumbPath={item.thumbnail_path}
                  alt={item.name}
                  variant="compact"
                />
              ) : (
                <span className="text-[11px] text-muted-foreground/25">—</span>
              )}
            </div>
          );
        }
        if (colId === "date") {
          return (
            <div
              key={colId}
              style={{ width: colWidths.date }}
              className={LIST_COLUMN_META.date.cellClass}
            >
              {item.dateLabel ? (
                <span className="truncate rounded-md bg-muted/70 px-2 py-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                  {item.dateLabel}
                </span>
              ) : (
                <span className="text-[11px] text-muted-foreground/25">—</span>
              )}
            </div>
          );
        }
        return (
          <div
            key={colId}
            style={{ width: colWidths.size }}
            className={`${LIST_COLUMN_META.size.cellClass} truncate font-mono text-[11px] tabular-nums text-muted-foreground`}
          >
            {item.is_dir
              ? `${item.child_count} 项`
              : item.size > 0
              ? formatFileSize(item.size)
              : "—"}
          </div>
        );
      })}

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          openArchivePath(item.path);
        }}
        className="w-7 shrink-0 flex items-center justify-center rounded-lg p-1.5 text-muted-foreground opacity-70 transition hover:bg-accent hover:text-foreground group-hover:opacity-100"
        title="在资源管理器中打开"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </button>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Virtualized dense list: only rows near the viewport are mounted, so even
// the full 18k-entry "all files" scope scrolls smoothly.
// ---------------------------------------------------------------------------

interface VirtualProjectListProps {
  items: IndexedArchiveItem[];
  scrollElementRef: RefObject<HTMLDivElement>;
  selectedPath: string | null;
  isSearching: boolean;
  highlightTerms: string[];
  onSelect: (item: IndexedArchiveItem) => void;
  onHover?: (item: IndexedArchiveItem | null) => void;
  onContextMenu?: (e: React.MouseEvent, item: IndexedArchiveItem) => void;
}

const LIST_ROW_GAP = 6;

export function VirtualProjectList({
  items,
  scrollElementRef,
  selectedPath,
  isSearching,
  highlightTerms,
  onSelect,
  onHover,
  onContextMenu,
}: VirtualProjectListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [columns, setColumns] = useState<ListColumnId[]>(loadSavedListColumns);
  const [colWidths, setColWidths] = useState<ListColumnWidths>(
    loadSavedListColWidths
  );
  const [resizingCol, setResizingCol] = useState<ResizableListCol | null>(null);
  const [dragCol, setDragCol] = useState<ListColumnId | null>(null);
  const [dragOverCol, setDragOverCol] = useState<ListColumnId | null>(null);

  const startResizeCol = (
    e: React.MouseEvent,
    targetCol: ResizableListCol,
    direction: 1 | -1
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidths[targetCol];
    const { min, max } = LIST_COL_WIDTH_LIMITS[targetCol];
    let latestW = startW;
    setResizingCol(targetCol);

    const onMove = (ev: MouseEvent) => {
      latestW = Math.max(
        min,
        Math.min(max, Math.round(startW + (ev.clientX - startX) * direction))
      );
      setColWidths((prev) =>
        prev[targetCol] === latestW ? prev : { ...prev, [targetCol]: latestW }
      );
    };
    const onUp = () => {
      setResizingCol(null);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setColWidths((prev) => {
        try {
          localStorage.setItem(
            LIST_COL_WIDTHS_STORAGE_KEY,
            JSON.stringify(prev)
          );
        } catch {
          // ignore
        }
        return prev;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const resetColWidth = (targetCol: ResizableListCol) => {
    setColWidths((prev) => {
      const next = { ...prev, [targetCol]: DEFAULT_LIST_COL_WIDTHS[targetCol] };
      try {
        localStorage.setItem(LIST_COL_WIDTHS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const reorderColumns = (from: ListColumnId, to: ListColumnId) => {
    if (from === to) return;
    setColumns((prev) => {
      const next = prev.filter((c) => c !== from);
      const targetIdx = next.indexOf(to);
      if (targetIdx < 0) return prev;
      const fromIdx = prev.indexOf(from);
      const toIdx = prev.indexOf(to);
      const insertAt = fromIdx < toIdx ? targetIdx + 1 : targetIdx;
      next.splice(insertAt, 0, from);
      try {
        localStorage.setItem(LIST_COLS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  // Offset of the list inside the scroll pane (content above it may change).
  const measureOffset = () => {
    const listEl = listRef.current;
    const scrollEl = scrollElementRef.current;
    if (!listEl || !scrollEl) return;
    const offset =
      listEl.getBoundingClientRect().top -
      scrollEl.getBoundingClientRect().top +
      scrollEl.scrollTop;
    setScrollMargin((prev) => (Math.abs(prev - offset) > 0.5 ? offset : prev));
  };

  useLayoutEffect(measureOffset);

  useLayoutEffect(() => {
    const scrollEl = scrollElementRef.current;
    if (!scrollEl) return;
    const ro = new ResizeObserver(() => measureOffset());
    ro.observe(scrollEl);
    Array.from(scrollEl.children).forEach((c) => ro.observe(c));
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollElementRef]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => 44 + LIST_ROW_GAP,
    overscan: 10,
    scrollMargin,
    getItemKey: (index) => items[index]?.path ?? index,
  });

  return (
    <div>
      {/* Draggable & Resizable Column Header Bar */}
      <div className="mb-1.5 flex h-7 items-center gap-2.5 border-b border-border/60 px-3 text-[11px] font-medium text-muted-foreground select-none">
        {columns.map((colId, idx) => {
          const meta = LIST_COLUMN_META[colId];
          const isDragging = dragCol === colId;
          const isOver = dragOverCol === colId && dragCol !== colId;
          const nextCol = columns[idx + 1];
          // Determine which column this right-edge divider resizes
          const resizeTarget: { col: ResizableListCol; dir: 1 | -1 } | null =
            colId !== "name"
              ? { col: colId, dir: 1 }
              : nextCol && nextCol !== "name"
              ? { col: nextCol, dir: -1 }
              : null;

          return (
            <div
              key={colId}
              style={colId !== "name" ? { width: colWidths[colId] } : undefined}
              draggable={!resizingCol}
              onDragStart={(e) => {
                if (resizingCol) {
                  e.preventDefault();
                  return;
                }
                setDragCol(colId);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", colId);
              }}
              onDragOver={(e) => {
                if (!dragCol) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dragOverCol !== colId) setDragOverCol(colId);
              }}
              onDragLeave={() => {
                if (dragOverCol === colId) setDragOverCol(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragCol) reorderColumns(dragCol, colId);
                setDragCol(null);
                setDragOverCol(null);
              }}
              onDragEnd={() => {
                setDragCol(null);
                setDragOverCol(null);
              }}
              title="按住拖动可调整分栏顺序"
              className={`relative ${meta.headerClass} cursor-grab active:cursor-grabbing rounded px-1 py-0.5 transition-colors hover:bg-accent/60 hover:text-foreground ${
                isDragging ? "opacity-40" : ""
              } ${isOver ? "bg-primary/15 text-primary ring-1 ring-primary/40" : ""}`}
            >
              <span className="block truncate">{meta.label}</span>
              {resizeTarget && (
                <div
                  draggable={false}
                  onMouseDown={(e) =>
                    startResizeCol(e, resizeTarget.col, resizeTarget.dir)
                  }
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    resetColWidth(resizeTarget.col);
                  }}
                  title="左右拖动调整列宽，双击恢复默认"
                  className="group/resizer absolute -right-2 top-0 bottom-0 z-20 flex w-2.5 cursor-col-resize items-center justify-center"
                >
                  <span
                    className={`h-3.5 w-[2px] rounded-full transition-colors ${
                      resizingCol === resizeTarget.col
                        ? "bg-primary"
                        : "bg-border/60 group-hover/resizer:bg-primary/80"
                    }`}
                  />
                </div>
              )}
            </div>
          );
        })}
        <div className="w-7 shrink-0" />
      </div>

      <div
        ref={listRef}
        style={{ height: virtualizer.getTotalSize(), position: "relative" }}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const item = items[row.index];
          if (!item) return null;
          return (
            <div
              key={row.key}
              data-index={row.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                paddingBottom: LIST_ROW_GAP,
                transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)`,
              }}
            >
              <ProjectListRow
                item={item}
                columns={columns}
                colWidths={colWidths}
                isSelected={selectedPath === item.path}
                isSearching={isSearching}
                highlightTerms={highlightTerms}
                onSelect={onSelect}
                onHover={onHover}
                onContextMenu={onContextMenu}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline card
// ---------------------------------------------------------------------------

interface ProjectTimelineCardProps {
  item: IndexedArchiveItem;
  isSelected: boolean;
  rootTag?: string;
  showRootTag: boolean;
  onSelect: (item: IndexedArchiveItem) => void;
  onHover?: (item: IndexedArchiveItem | null) => void;
  onContextMenu?: (e: React.MouseEvent, item: IndexedArchiveItem) => void;
}

export const ProjectTimelineCard = memo(function ProjectTimelineCard({
  item,
  isSelected,
  rootTag,
  showRootTag,
  onSelect,
  onHover,
  onContextMenu,
}: ProjectTimelineCardProps) {
  return (
    <div
      onClick={() => onSelect(item)}
      onDoubleClick={() => openArchivePath(item.path)}
      onMouseEnter={onHover ? () => onHover(item) : undefined}
      onMouseLeave={onHover ? () => onHover(null) : undefined}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, item) : undefined}
      style={offscreenSkip(96)}
      className={`group relative rounded-lg border p-2.5 transition-colors cursor-pointer ${
        isSelected
          ? "border-primary/55 bg-card"
          : "border-transparent bg-card/85 hover:border-border hover:bg-surface-elevated"
      }`}
    >
      <div className="flex flex-col sm:flex-row items-start gap-3">
        <ProjectThumbnail
          thumbPath={item.thumbnail_path}
          alt={item.displayTitle}
          variant="timeline"
        />

        <div className="min-w-0 flex-1 w-full">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {item.dateLabel && (
                  <span className="shrink-0 font-mono text-xs text-primary/90">
                    {item.dateLabel}
                  </span>
                )}
                {showRootTag && rootTag && (
                  <span className="truncate rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {rootTag}
                  </span>
                )}
                <span className="font-mono text-xs text-muted-foreground/75">
                  ·{" "}
                  {item.is_dir
                    ? `${item.child_count} 项`
                    : item.ext.toUpperCase() || "文件"}
                </span>
              </div>

              <div
                className="text-[13.5px] font-medium text-foreground"
                title={item.name}
              >
                {item.displayTitle}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openArchivePath(item.path);
                }}
                className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                title="打开项目文件夹"
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Grid card
// ---------------------------------------------------------------------------

interface ProjectGridCardProps {
  item: IndexedArchiveItem;
  isSelected: boolean;
  isStarred: boolean;
  rootTag?: string;
  showRootTag: boolean;
  cardWidth: number;
  onSelect: (item: IndexedArchiveItem) => void;
  onHover?: (item: IndexedArchiveItem | null) => void;
  onToggleStar: (path: string) => void;
  onContextMenu?: (e: React.MouseEvent, item: IndexedArchiveItem) => void;
}

export const ProjectGridCard = memo(function ProjectGridCard({
  item,
  isSelected,
  isStarred,
  cardWidth,
  onSelect,
  onHover,
  onContextMenu,
}: ProjectGridCardProps) {
  const thumbH = Math.round(cardWidth * 0.58);
  return (
    <div
      onClick={() => onSelect(item)}
      onDoubleClick={() => openArchivePath(item.path)}
      onMouseEnter={onHover ? () => onHover(item) : undefined}
      onMouseLeave={onHover ? () => onHover(null) : undefined}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, item) : undefined}
      style={offscreenSkip(thumbH + 64)}
      className={`group flex flex-col rounded-lg border p-2.5 transition-colors cursor-pointer ${
        isSelected
          ? "border-primary/55 bg-card"
          : "border-transparent bg-card hover:border-border hover:bg-surface-elevated"
      }`}
    >
      <ProjectThumbnail
        thumbPath={item.thumbnail_path}
        alt={item.displayTitle}
        variant="card"
        fixedHeight={thumbH}
        showPlaceholder
      />

      <div className="flex items-center gap-1.5 min-w-0">
        {isStarred && (
          <Star className="h-3 w-3 shrink-0 text-primary fill-current" />
        )}
        <div
          className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground"
          title={item.name}
        >
          {item.displayTitle}
        </div>
      </div>

      <div className="mt-0.5 flex items-center justify-between gap-2 text-[11.5px] text-muted-foreground/80">
        <span className="truncate font-mono tabular-nums">
          {item.dateLabel || ""}
        </span>
        <span className="shrink-0 font-mono tabular-nums">
          {item.is_dir ? `${item.child_count} 项` : item.ext.toUpperCase() || "文件"}
        </span>
      </div>
    </div>
  );
});
