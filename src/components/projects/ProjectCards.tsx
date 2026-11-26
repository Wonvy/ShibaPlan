import React, { memo, RefObject, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  File,
  FileText,
  Folder,
  FolderOpen,
  Star,
} from "lucide-react";
import { IndexedArchiveItem, openArchivePath } from "../../lib/archive";
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

interface ProjectListRowProps {
  item: IndexedArchiveItem;
  isSelected: boolean;
  isSearching: boolean;
  highlightTerms: string[];
  onSelect: (item: IndexedArchiveItem) => void;
  onContextMenu?: (e: React.MouseEvent, item: IndexedArchiveItem) => void;
}

export const ProjectListRow = memo(function ProjectListRow({
  item,
  isSelected,
  isSearching,
  highlightTerms,
  onSelect,
  onContextMenu,
}: ProjectListRowProps) {
  return (
    <div
      onClick={() => onSelect(item)}
      onDoubleClick={() => openArchivePath(item.path)}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, item) : undefined}
      className={`group flex items-center gap-2.5 rounded-md border px-3 py-2 text-xs transition-colors cursor-pointer ${
        isSelected
          ? "border-primary/55 bg-card"
          : "border-transparent bg-card/80 hover:border-border hover:bg-surface-elevated"
      }`}
    >
      {item.thumbnail_path ? (
        <ProjectThumbnail
          thumbPath={item.thumbnail_path}
          alt={item.name}
          variant="compact"
        />
      ) : item.is_dir ? (
        <Folder className="h-4 w-4 shrink-0 text-primary" />
      ) : (
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-foreground">
            {renderHighlightedText(
              isSearching ? item.name : item.displayTitle,
              highlightTerms
            )}
          </span>
          {item.ext && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs uppercase text-muted-foreground">
              {item.ext}
            </span>
          )}
        </div>
        <div className="truncate font-mono text-xs text-muted-foreground">
          {renderHighlightedText(item.relative_path, highlightTerms)}
        </div>
      </div>

      {item.dateLabel && (
        <span className="hidden sm:inline-block shrink-0 rounded-md bg-muted/70 px-2 py-0.5 font-mono text-xs text-muted-foreground">
          {item.dateLabel}
        </span>
      )}

      {!item.is_dir && item.size > 0 && (
        <span className="hidden md:inline-block w-16 text-right font-mono text-xs text-muted-foreground">
          {formatFileSize(item.size)}
        </span>
      )}

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          openArchivePath(item.path);
        }}
        className="shrink-0 rounded-lg p-1.5 text-muted-foreground opacity-70 transition hover:bg-accent hover:text-foreground group-hover:opacity-100"
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
  onContextMenu,
}: VirtualProjectListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

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
    estimateSize: () => 52 + LIST_ROW_GAP,
    overscan: 10,
    scrollMargin,
    getItemKey: (index) => items[index]?.path ?? index,
  });

  return (
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
              isSelected={selectedPath === item.path}
              isSearching={isSearching}
              highlightTerms={highlightTerms}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
            />
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline card
// ---------------------------------------------------------------------------

interface ProjectTimelineCardProps {
  item: IndexedArchiveItem;
  isSelected: boolean;
  isExpanded: boolean;
  rootTag?: string;
  showRootTag: boolean;
  expandedChildren: IndexedArchiveItem[];
  onSelect: (item: IndexedArchiveItem) => void;
  onToggleExpand: (path: string) => void;
  onContextMenu?: (e: React.MouseEvent, item: IndexedArchiveItem) => void;
}

export const ProjectTimelineCard = memo(function ProjectTimelineCard({
  item,
  isSelected,
  isExpanded,
  rootTag,
  showRootTag,
  expandedChildren,
  onSelect,
  onToggleExpand,
  onContextMenu,
}: ProjectTimelineCardProps) {
  return (
    <div
      onClick={() => onSelect(item)}
      onDoubleClick={() => openArchivePath(item.path)}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, item) : undefined}
      style={isExpanded ? undefined : offscreenSkip(124)}
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

        <div className="min-w-0 flex-1 space-y-1 w-full">
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

              <div className="truncate font-mono text-xs text-muted-foreground/65">
                {item.relative_path}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {item.is_dir && item.child_count > 0 && (
                <button
                  type="button"
                  onClick={() => onToggleExpand(item.path)}
                  className="inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  <span>{isExpanded ? "收起" : "预览"}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => openArchivePath(item.path)}
                className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                title="打开项目文件夹"
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {isExpanded && (
            <div className="mt-2 space-y-1 border-t border-border/60 pt-2">
              {expandedChildren.length === 0 ? (
                <div className="text-xs text-muted-foreground">
                  暂无可预览子文件
                </div>
              ) : (
                expandedChildren.slice(0, 10).map((child) => (
                  <button
                    key={child.path}
                    type="button"
                    onClick={() => openArchivePath(child.path)}
                    className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  >
                    {child.is_dir ? (
                      <Folder className="h-3 w-3 shrink-0 text-primary/80" />
                    ) : (
                      <File className="h-3 w-3 shrink-0" />
                    )}
                    <span className="truncate">{child.name}</span>
                  </button>
                ))
              )}
            </div>
          )}
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
  onToggleStar: (path: string) => void;
  onContextMenu?: (e: React.MouseEvent, item: IndexedArchiveItem) => void;
}

export const ProjectGridCard = memo(function ProjectGridCard({
  item,
  isSelected,
  isStarred,
  cardWidth,
  onSelect,
  onContextMenu,
}: ProjectGridCardProps) {
  const thumbH = Math.round(cardWidth * 0.58);
  return (
    <div
      onClick={() => onSelect(item)}
      onDoubleClick={() => openArchivePath(item.path)}
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

      <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground/80">
        {item.dateLabel && (
          <span className="font-mono tabular-nums">{item.dateLabel}</span>
        )}
        {item.dateLabel && <span className="opacity-50">·</span>}
        <span className="truncate font-mono tabular-nums">
          {item.is_dir ? `${item.child_count} 项` : item.ext.toUpperCase() || "文件"}
        </span>
      </div>
    </div>
  );
});
