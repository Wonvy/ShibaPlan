import React from "react";
import { Folder, Maximize2, Minimize2, SquarePen, Trash2 } from "lucide-react";
import { BoardColumn, TaskItem } from "../../types";
import { FolderEntry } from "../../lib/storage";
import { InsertPosition, TranslateFn } from "./constants";
import { TaskCard, TaskCardActions } from "./TaskCard";

/** Referentially stable column-level callbacks. */
export interface KanbanColumnActions {
  registerColumnRef: (colId: string, el: HTMLDivElement | null) => void;
  beginColumnDrag: (e: React.DragEvent, colId: string) => void;
  endColumnDrag: () => void;
  startMoveColumnOnCanvas: (
    e: React.MouseEvent,
    col: BoardColumn,
    colIndex: number
  ) => void;
  toggleColumnCollapse: (colId: string) => void;
  hoverEnter: (colId: string) => void;
  hoverLeave: (colId: string) => void;
  columnDragOver: (e: React.DragEvent<HTMLDivElement>, colId: string) => void;
  columnDragLeave: (colId: string) => void;
  columnDrop: (e: React.DragEvent<HTMLDivElement>, colId: string) => void;
  startResizeFolderHeight: (e: React.MouseEvent, col: BoardColumn) => void;
  resetFolderHeight: (colId: string) => void;
  startResizeColumn: (e: React.MouseEvent, col: BoardColumn) => void;
  resetColumnWidth: (colId: string) => void;
  startResizeColumnGap: (e: React.MouseEvent, col: BoardColumn) => void;
  resetColumnGap: (colId: string) => void;
  openColumnHeaderMenu: (e: React.MouseEvent, colId: string) => void;
  setEditingColTitle: (value: string) => void;
  commitRenameColumn: (colId: string) => void;
  cancelRenameColumn: () => void;
  startAddTask: (colId: string) => void;
  openAddTaskModal: (colId: string) => void;
  setDraftTaskTitle: (value: string) => void;
  commitAddTask: (colId: string) => void;
  cancelAddTask: () => void;
  requestDeleteColumn: (col: BoardColumn) => void;
}

export interface KanbanColumnProps {
  col: BoardColumn;
  colIndex: number;
  colTasks: TaskItem[];
  layoutMode: "row" | "canvas";
  canvasX: number | null;
  canvasY: number | null;
  colWidth: number;
  folderHeight: number | undefined;
  isDropTarget: boolean;
  isDraggingColumn: boolean;
  insertSide: "left" | "right" | null;
  isResizingWidth: boolean;
  isResizingFolder: boolean;
  isEditingTitle: boolean;
  editingTitle: string;
  isAddingTask: boolean;
  draftTaskTitle: string;
  activeColumnGap: number;
  isResizingGap: boolean;
  activeTaskId: string | null;
  renamingTaskId: string | null;
  dragTaskId: string | null;
  dragOverSlot: { taskId: string; position: InsertPosition } | null;
  collapsedCards: Record<string, boolean>;
  expandedFolders: Record<string, boolean>;
  folderFiles: Record<string, FolderEntry[]>;
  loadingFolders: Record<string, boolean>;
  locale: string;
  t: TranslateFn;
  cardActions: TaskCardActions;
  actions: KanbanColumnActions;
}

const ColumnGapHandle: React.FC<{
  col: BoardColumn;
  activeColumnGap: number;
  isResizingGap: boolean;
  actions: KanbanColumnActions;
}> = ({ col, activeColumnGap, isResizingGap, actions }) => (
  <div
    onMouseDown={(e) => actions.startResizeColumnGap(e, col)}
    onDoubleClick={() => actions.resetColumnGap(col.id)}
    style={{ width: activeColumnGap }}
    className="group/gap relative flex shrink-0 cursor-col-resize items-center justify-center"
    title="左右拖动调整此列间距，双击恢复默认"
  >
    <div
      className={`h-12 w-0.5 rounded-full transition ${
        isResizingGap
          ? "h-24 bg-shiba-400"
          : "bg-transparent group-hover/gap:bg-shiba-400/60"
      }`}
    />
    {isResizingGap && (
      <span className="pointer-events-none absolute top-2 rounded bg-[#1c1c21] px-1 py-0.5 font-mono text-xs text-shiba-400 shadow">
        {activeColumnGap}
      </span>
    )}
  </div>
);

const KanbanColumnImpl: React.FC<KanbanColumnProps> = ({
  col,
  colIndex,
  colTasks,
  layoutMode,
  canvasX,
  canvasY,
  colWidth,
  folderHeight,
  isDropTarget,
  isDraggingColumn,
  insertSide,
  isResizingWidth,
  isResizingFolder,
  isEditingTitle,
  editingTitle,
  isAddingTask,
  draftTaskTitle,
  activeColumnGap,
  isResizingGap,
  activeTaskId,
  renamingTaskId,
  dragTaskId,
  dragOverSlot,
  collapsedCards,
  expandedFolders,
  folderFiles,
  loadingFolders,
  locale,
  t,
  cardActions,
  actions,
}) => {
  const pendingCount = colTasks.filter(
    (tItem) => tItem.status !== "done"
  ).length;
  const colDoneCount = colTasks.length - pendingCount;
  const estMinutes = colTasks
    .filter((tItem) => tItem.status !== "done")
    .reduce((sum, item) => sum + item.estimatedMinutes, 0);

  const canvasPos =
    canvasX !== null && canvasY !== null ? { x: canvasX, y: canvasY } : null;

  const showLeftInsert = insertSide === "left";
  const showRightInsert = insertSide === "right";

  const setRef = (el: HTMLDivElement | null) =>
    actions.registerColumnRef(col.id, el);

  const gapHandle =
    layoutMode === "row" ? (
      <ColumnGapHandle
        col={col}
        activeColumnGap={activeColumnGap}
        isResizingGap={isResizingGap}
        actions={actions}
      />
    ) : null;

  /* Folder-Style Collapsed Column View */
  if (col.collapsed) {
    const progress =
      colTasks.length === 0
        ? 0
        : Math.round((colDoneCount / colTasks.length) * 100);

    return (
      <>
        <div
          data-board-column="true"
          draggable={layoutMode === "row"}
          onDragStart={(e) => {
            if (layoutMode !== "row") return;
            actions.beginColumnDrag(e, col.id);
          }}
          onDragEnd={actions.endColumnDrag}
          ref={setRef}
          style={{
            ...(canvasPos
              ? {
                  position: "absolute" as const,
                  left: canvasPos.x,
                  top: canvasPos.y,
                  width: 224,
                }
              : {}),
            ...(folderHeight ? { height: folderHeight } : {}),
          }}
          onMouseDown={(e) => actions.startMoveColumnOnCanvas(e, col, colIndex)}
          onDoubleClick={(e) => {
            if ((e.target as HTMLElement).closest("[data-folder-resize]")) {
              return;
            }
            actions.toggleColumnCollapse(col.id);
          }}
          onMouseEnter={() => actions.hoverEnter(col.id)}
          onMouseLeave={() => actions.hoverLeave(col.id)}
          onDragOver={(e) => actions.columnDragOver(e, col.id)}
          onDragLeave={() => actions.columnDragLeave(col.id)}
          onDrop={(e) => actions.columnDrop(e, col.id)}
          className={`group/folder relative flex w-56 shrink-0 flex-col justify-between gap-2.5 rounded-lg border p-3 transition-all duration-150 ${
            folderHeight ? "" : "h-fit"
          } ${isDraggingColumn ? "opacity-40 scale-[0.98]" : ""} ${
            layoutMode === "canvas"
              ? "cursor-move"
              : "cursor-grab active:cursor-grabbing"
          } ${
            isDropTarget
              ? "border-primary/60 bg-primary/[0.08] shadow-card-hover"
              : "border-border bg-card shadow-card-rest hover:border-foreground/15 hover:bg-surface-elevated"
          }`}
        >
          {showLeftInsert && (
            <div className="pointer-events-none absolute -left-1.5 bottom-2 top-2 z-30 w-0.5 rounded-full bg-primary" />
          )}
          {showRightInsert && (
            <div className="pointer-events-none absolute -right-1.5 bottom-2 top-2 z-30 w-0.5 rounded-full bg-primary" />
          )}
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Folder className="h-4 w-4 shrink-0" style={{ color: col.color }} />
              <span className="truncate text-xs font-medium text-foreground">
                {col.title}
              </span>
            </div>

            <button
              type="button"
              onClick={() => actions.toggleColumnCollapse(col.id)}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="展开看板列"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-end justify-between gap-2">
              <div className="flex items-baseline gap-3">
                <div>
                  <div className="font-mono text-2xl font-semibold leading-none tabular-nums tracking-tight text-foreground">
                    {pendingCount}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">待办</div>
                </div>

                <div className="h-6 w-px bg-border" />

                <div>
                  <div className="font-mono text-lg font-medium leading-none tabular-nums text-muted-foreground">
                    {colDoneCount}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">完成</div>
                </div>
              </div>

              {estMinutes > 0 && (
                <div className="text-right">
                  <div className="font-mono text-sm font-medium leading-none tabular-nums text-foreground/85">
                    {(estMinutes / 60).toFixed(1)}h
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">预估</div>
                </div>
              )}
            </div>

            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${progress}%`,
                  backgroundColor: col.color,
                }}
              />
            </div>
          </div>

          {/* Bottom Drag Resize Handle for Collapsed Folder Height */}
          <div
            data-folder-resize="true"
            onMouseDown={(e) => actions.startResizeFolderHeight(e, col)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              actions.resetFolderHeight(col.id);
            }}
            className="group/fresize absolute bottom-0 left-3 right-3 z-20 flex h-2.5 cursor-row-resize items-center justify-center"
            title="上下拖动调整高度，双击恢复默认"
          >
            <div
              className={`h-0.5 rounded-full transition ${
                isResizingFolder
                  ? "w-16 bg-shiba-400"
                  : "w-8 bg-transparent group-hover/fresize:bg-shiba-400/70"
              }`}
            />
          </div>
        </div>
        {gapHandle}
      </>
    );
  }

  const showNotes = col.display?.showNotes ?? true;
  const showImage = col.display?.showImage ?? true;
  const showEffort = col.display?.showEffort ?? true;
  const showDate = col.display?.showDate ?? true;

  return (
    <>
      <div
        data-board-column="true"
        ref={setRef}
        style={
          canvasPos
            ? {
                position: "absolute",
                left: canvasPos.x,
                top: canvasPos.y,
                width: colWidth,
                maxHeight: 540,
              }
            : {
                width:
                  typeof window !== "undefined" && window.innerWidth < 640
                    ? undefined
                    : colWidth,
              }
        }
        onMouseEnter={() => actions.hoverEnter(col.id)}
        onMouseLeave={() => actions.hoverLeave(col.id)}
        onDragOver={(e) => actions.columnDragOver(e, col.id)}
        onDragLeave={() => actions.columnDragLeave(col.id)}
        onDrop={(e) => actions.columnDrop(e, col.id)}
        className={`relative flex w-[84vw] sm:w-auto shrink-0 snap-center flex-col overflow-hidden rounded-lg border p-2.5 transition-all duration-150 ${
          isDraggingColumn ? "opacity-40 scale-[0.98]" : ""
        } ${
          isDropTarget
            ? "border-primary/55 bg-surface-elevated shadow-card-hover"
            : layoutMode === "canvas"
            ? "border-border bg-surface shadow-popover-soft"
            : "border-border/80 bg-surface shadow-col-rest"
        }`}
      >
        {showLeftInsert && (
          <div className="pointer-events-none absolute -left-1.5 bottom-3 top-3 z-30 w-0.5 rounded-full bg-primary" />
        )}
        {showRightInsert && (
          <div className="pointer-events-none absolute -right-1.5 bottom-3 top-3 z-30 w-0.5 rounded-full bg-primary" />
        )}
        {/* Right-edge Drag Resize Handle */}
        <div
          onMouseDown={(e) => actions.startResizeColumn(e, col)}
          onDoubleClick={() => actions.resetColumnWidth(col.id)}
          className="group/resize absolute bottom-3 right-0 top-3 z-20 hidden w-2 cursor-col-resize items-center justify-center sm:flex"
          title="左右拖动调整列宽，双击恢复默认"
        >
          <div
            className={`h-10 w-0.5 rounded-full transition ${
              isResizingWidth
                ? "bg-primary h-20"
                : "bg-transparent group-hover/resize:bg-primary/70"
            }`}
          />
        </div>
        {/* Column Header (Drag to reorder in Row mode / reposition in Canvas mode; Double-click to fold) */}
        <div
          draggable={layoutMode === "row" && !isEditingTitle}
          onDragStart={(e) => {
            if (layoutMode !== "row") return;
            e.stopPropagation();
            actions.beginColumnDrag(e, col.id);
          }}
          onDragEnd={actions.endColumnDrag}
          onMouseDown={(e) => actions.startMoveColumnOnCanvas(e, col, colIndex)}
          onDoubleClick={(e) => {
            if ((e.target as HTMLElement).closest("button, input")) {
              return;
            }
            actions.toggleColumnCollapse(col.id);
          }}
          onContextMenu={(e) => actions.openColumnHeaderMenu(e, col.id)}
          className={`group/col mb-2 flex items-center justify-between gap-2 px-1 py-0.5 select-none ${
            layoutMode === "canvas"
              ? "cursor-move"
              : "cursor-grab active:cursor-grabbing"
          }`}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: col.color }}
            />
            {isEditingTitle ? (
              <input
                autoFocus
                value={editingTitle}
                onChange={(e) => actions.setEditingColTitle(e.target.value)}
                onBlur={() => actions.commitRenameColumn(col.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") actions.commitRenameColumn(col.id);
                  if (e.key === "Escape") actions.cancelRenameColumn();
                }}
                className="w-full rounded border border-primary/50 bg-background px-1.5 py-0.5 text-xs font-medium text-foreground focus:outline-none"
              />
            ) : (
              <span
                className="truncate text-[12.5px] font-medium tracking-[-0.01em] text-foreground select-none"
                title="双击折叠，右键重命名或设置显示项"
              >
                {col.title}
              </span>
            )}
          </div>

          <div className="flex items-center gap-0.5">
            <button
              onClick={() => actions.requestDeleteColumn(col)}
              className="rounded-md p-1 text-muted-foreground/70 opacity-100 sm:opacity-0 transition sm:group-hover/col:opacity-100 hover:bg-destructive/15 hover:text-destructive"
              title={t("kanban.deleteColumn")}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => actions.toggleColumnCollapse(col.id)}
              className="rounded-md p-1 text-muted-foreground opacity-100 sm:opacity-0 transition sm:group-hover/col:opacity-100 hover:bg-accent hover:text-foreground"
              title="折叠为文件夹"
            >
              <Minimize2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) {
                  actions.startAddTask(col.id);
                } else {
                  actions.openAddTaskModal(col.id);
                }
              }}
              className="rounded-md p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
              title="新建卡片（按住 Ctrl 点击可快速行内新增）"
            >
              <SquarePen className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Inline Add Task */}
        {isAddingTask && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              actions.commitAddTask(col.id);
            }}
            className="mb-2 rounded-md border border-primary/50 bg-card p-2 shadow-card-rest"
          >
            <input
              autoFocus
              type="text"
              value={draftTaskTitle}
              onChange={(e) => actions.setDraftTaskTitle(e.target.value)}
              onBlur={() => actions.commitAddTask(col.id)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  actions.cancelAddTask();
                }
              }}
              placeholder="输入任务标题，回车确认..."
              className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground/65 focus:outline-none"
            />
          </form>
        )}

        {/* Cards (Double-click empty area to add card; Right-click for column menu) */}
        <div
          data-column-scroll="true"
          onDoubleClick={(e) => {
            if ((e.target as HTMLElement).closest("[data-kanban-card]")) {
              return;
            }
            actions.startAddTask(col.id);
          }}
          onContextMenu={(e) => {
            if ((e.target as HTMLElement).closest("[data-kanban-card]")) {
              return;
            }
            cardActions.openAreaContextMenu(e, {
              kind: "column",
              colId: col.id,
            });
          }}
          className="flex-1 space-y-1.5 overflow-y-auto overscroll-contain pr-0.5"
        >
          {colTasks.length === 0 ? (
            <div className="flex h-20 items-center justify-center rounded-md border border-dashed border-border/70 text-xs text-muted-foreground/60">
              拖入卡片或点 + 新增
            </div>
          ) : (
            colTasks.map((task) => {
              const isBeingDragged = dragTaskId === task.id;
              const insertPosition =
                !isBeingDragged && dragOverSlot?.taskId === task.id
                  ? dragOverSlot.position
                  : null;
              return (
                <TaskCard
                  key={task.id}
                  task={task}
                  colId={col.id}
                  showNotes={showNotes}
                  showImage={showImage}
                  showEffort={showEffort}
                  showDate={showDate}
                  isFocusing={activeTaskId === task.id}
                  isRenaming={renamingTaskId === task.id}
                  isBeingDragged={isBeingDragged}
                  insertPosition={insertPosition}
                  isCollapsed={Boolean(collapsedCards[task.id])}
                  expandedFolders={expandedFolders}
                  folderFiles={folderFiles}
                  loadingFolders={loadingFolders}
                  locale={locale}
                  t={t}
                  actions={cardActions}
                />
              );
            })
          )}
        </div>
      </div>
      {gapHandle}
    </>
  );
};

/** Shallow prop compare, but compares `colTasks` element-wise. */
function areColumnPropsEqual(
  prev: KanbanColumnProps,
  next: KanbanColumnProps
): boolean {
  const keys = Object.keys(next) as (keyof KanbanColumnProps)[];
  for (const key of keys) {
    if (key === "colTasks") continue;
    if (prev[key] !== next[key]) return false;
  }
  const a = prev.colTasks;
  const b = next.colTasks;
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export const KanbanColumn = React.memo(KanbanColumnImpl, areColumnPropsEqual);
KanbanColumn.displayName = "KanbanColumn";
