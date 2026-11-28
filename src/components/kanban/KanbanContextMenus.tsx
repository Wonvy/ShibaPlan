import React from "react";
import {
  Calendar,
  Check,
  Columns3,
  Copy,
  Kanban,
  LayoutGrid,
  Link2,
  Maximize2,
  Minimize2,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Scan,
  Star,
  Trash2,
  Waves,
} from "lucide-react";
import {
  BoardColumn,
  ColumnDisplayOptions,
  TaskItem,
  TaskPriorityColor,
} from "../../types";
import { useI18n } from "../../lib/i18n";
import {
  AreaMenuState,
  TASK_PRIORITY_COLORS,
  copyTextToClipboard,
} from "./constants";

const itemCls =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-popover-foreground transition-colors hover:bg-accent";

/* ------------------------------------------------------------------ */
/* Content Area Right-Click Context Menu (Card / Column Body / Board)  */
/* ------------------------------------------------------------------ */

export interface AreaContextMenuProps {
  menu: AreaMenuState;
  /** Resolved task for `kind: "card"` menus (null if it no longer exists). */
  ctxTask: TaskItem | null;
  layoutMode: "row" | "canvas";
  close: () => void;
  // card actions
  startRenameTask: (task: TaskItem) => void;
  openTaskEditor: (task: TaskItem) => void;
  startFocus: (task: TaskItem) => void;
  toggleStar: (task: TaskItem) => void;
  setTaskPriorityColor: (
    task: TaskItem,
    color: TaskPriorityColor | undefined
  ) => void;
  toggleDone: (task: TaskItem) => void;
  duplicateTask: (task: TaskItem) => void;
  moveTaskToRiver: (task: TaskItem) => void;
  requestDeleteTask: (task: TaskItem) => void;
  // column actions
  startAddTask: (colId: string) => void;
  toggleColumnCollapse: (colId: string) => void;
  openColumnDisplayMenu: (colId: string, x: number, y: number) => void;
  // board actions
  startCreateColumn: () => void;
  toggleLayoutMode: () => void;
  setAllColumnsCollapsed: (collapsed: boolean) => void;
  tidyCanvasLayout: () => void;
  fitCanvasToScreen: () => void;
  resetCanvasView: () => void;
}

export const AreaContextMenu: React.FC<AreaContextMenuProps> = ({
  menu,
  ctxTask,
  layoutMode,
  close,
  startRenameTask,
  openTaskEditor,
  startFocus,
  toggleStar,
  setTaskPriorityColor,
  toggleDone,
  duplicateTask,
  moveTaskToRiver,
  requestDeleteTask,
  startAddTask,
  toggleColumnCollapse,
  openColumnDisplayMenu,
  startCreateColumn,
  toggleLayoutMode,
  setAllColumnsCollapsed,
  tidyCanvasLayout,
  fitCanvasToScreen,
  resetCanvasView,
}) => {
  const { t } = useI18n();

  return (
    <div
      style={{ left: menu.x, top: menu.y }}
      onClick={(e) => e.stopPropagation()}
      className="fixed z-50 w-56 rounded-lg border border-border bg-popover p-1 shadow-popover-soft"
    >
      {menu.kind === "card" &&
        (() => {
          if (!ctxTask) return null;
          const isDone = ctxTask.status === "done";
          const linkUrl = menu.linkUrl;
          return (
            <>
              {linkUrl && (
                <button
                  type="button"
                  onClick={() => {
                    void copyTextToClipboard(linkUrl);
                    close();
                  }}
                  className={itemCls}
                >
                  <Link2 className="h-3.5 w-3.5 text-zinc-400" />
                  <span>{t("kanban.copyLink")}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  startRenameTask(ctxTask);
                  close();
                }}
                className={itemCls}
              >
                <Pencil className="h-3.5 w-3.5 text-zinc-400" />
                <span>{t("kanban.renameCard")}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  openTaskEditor(ctxTask);
                  close();
                }}
                className={itemCls}
              >
                <Calendar className="h-3.5 w-3.5 text-zinc-400" />
                <span>{t("kanban.schedule")}</span>
              </button>

              {!isDone && (
                <button
                  type="button"
                  onClick={() => {
                    startFocus(ctxTask);
                    close();
                  }}
                  className={itemCls}
                >
                  <Play className="h-3.5 w-3.5 text-zinc-400" />
                  <span>{t("kanban.focus")}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  toggleStar(ctxTask);
                  close();
                }}
                className={itemCls}
              >
                <Star className="h-3.5 w-3.5 text-zinc-400" />
                <span>{t("kanban.star")}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  toggleDone(ctxTask);
                  close();
                }}
                className={itemCls}
              >
                <Check className="h-3.5 w-3.5 text-zinc-400" />
                <span>
                  {isDone ? t("kanban.restoreTodo") : t("kanban.markDone")}
                </span>
              </button>

              <div className="my-1 border-t border-white/[0.06]" />

              <div className="px-1 py-1">
                <div className="grid grid-cols-4 gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setTaskPriorityColor(ctxTask, undefined);
                      close();
                    }}
                    title="恢复默认颜色"
                    className={`flex items-center justify-center gap-1 rounded-md border px-1 py-1 text-[11px] font-medium transition-colors ${
                      !ctxTask.priorityColor
                        ? "border-foreground/25 bg-accent text-foreground"
                        : "border-transparent bg-secondary/45 text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full border border-muted-foreground/60 bg-transparent" />
                    <span>默认</span>
                  </button>
                  {TASK_PRIORITY_COLORS.map((opt) => {
                    const active = ctxTask.priorityColor === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setTaskPriorityColor(
                            ctxTask,
                            active ? undefined : opt.id
                          );
                          close();
                        }}
                        title={active ? `恢复默认颜色` : `标记为${opt.label}`}
                        className={`flex items-center justify-center gap-1 rounded-md border px-1 py-1 text-[11px] font-medium transition-colors ${
                          active
                            ? opt.pillActiveClass
                            : "border-transparent bg-secondary/45 text-muted-foreground hover:bg-accent hover:text-foreground"
                        }`}
                      >
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${opt.dotClass}`}
                        />
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="my-1 border-t border-white/[0.06]" />

              <button
                type="button"
                onClick={() => {
                  duplicateTask(ctxTask);
                  close();
                }}
                className={itemCls}
              >
                <Copy className="h-3.5 w-3.5 text-zinc-400" />
                <span>复制卡片</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  moveTaskToRiver(ctxTask);
                  close();
                }}
                className={itemCls}
              >
                <Waves className="h-3.5 w-3.5 text-zinc-400" />
                <span>移入灵感流</span>
              </button>

              <div className="my-1 border-t border-white/[0.06]" />

              <button
                type="button"
                onClick={() => {
                  requestDeleteTask(ctxTask);
                  close();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-rose-400 transition hover:bg-rose-500/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>{t("common.delete")}</span>
              </button>
            </>
          );
        })()}

      {menu.kind === "column" && (
        <>
          <button
            type="button"
            onClick={() => {
              startAddTask(menu.colId);
              close();
            }}
            className={itemCls}
          >
            <Plus className="h-3.5 w-3.5 text-zinc-400" />
            <span>{t("kanban.addCard")}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              toggleColumnCollapse(menu.colId);
              close();
            }}
            className={itemCls}
          >
            <Minimize2 className="h-3.5 w-3.5 text-zinc-400" />
            <span>折叠此列</span>
          </button>

          <button
            type="button"
            onClick={() => {
              openColumnDisplayMenu(menu.colId, menu.x, menu.y);
              close();
            }}
            className={itemCls}
          >
            <Kanban className="h-3.5 w-3.5 text-zinc-400" />
            <span>列显示设置</span>
          </button>
        </>
      )}

      {menu.kind === "board" && (
        <>
          <button
            type="button"
            onClick={() => {
              startCreateColumn();
              close();
            }}
            className={itemCls}
          >
            <Plus className="h-3.5 w-3.5 text-zinc-400" />
            <span>{t("kanban.newColumn")}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              toggleLayoutMode();
              close();
            }}
            className={itemCls}
          >
            {layoutMode === "row" ? (
              <LayoutGrid className="h-3.5 w-3.5 text-zinc-400" />
            ) : (
              <Columns3 className="h-3.5 w-3.5 text-zinc-400" />
            )}
            <span>
              {layoutMode === "row" ? "切换到自由画布" : "切换到列表排布"}
            </span>
          </button>

          <div className="my-1 border-t border-white/[0.06]" />

          <button
            type="button"
            onClick={() => {
              setAllColumnsCollapsed(true);
              close();
            }}
            className={itemCls}
          >
            <Minimize2 className="h-3.5 w-3.5 text-zinc-400" />
            <span>全部折叠</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setAllColumnsCollapsed(false);
              close();
            }}
            className={itemCls}
          >
            <Maximize2 className="h-3.5 w-3.5 text-zinc-400" />
            <span>全部展开</span>
          </button>

          {layoutMode === "canvas" && (
            <>
              <div className="my-1 border-t border-white/[0.06]" />
              <button
                type="button"
                onClick={() => {
                  tidyCanvasLayout();
                  close();
                }}
                className={itemCls}
              >
                <LayoutGrid className="h-3.5 w-3.5 text-zinc-400" />
                <span>一键整齐排列</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  fitCanvasToScreen();
                  close();
                }}
                className={itemCls}
              >
                <Scan className="h-3.5 w-3.5 text-zinc-400" />
                <span>适配全屏</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  resetCanvasView();
                  close();
                }}
                className={itemCls}
              >
                <RotateCcw className="h-3.5 w-3.5 text-zinc-400" />
                <span>重置画布视角</span>
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Column Header Right-Click Context Menu                              */
/* ------------------------------------------------------------------ */

export const ColumnContextMenu: React.FC<{
  column: BoardColumn;
  x: number;
  y: number;
  toggleColumnDisplay: (colId: string, key: keyof ColumnDisplayOptions) => void;
  startRename: (col: BoardColumn) => void;
  resetColumnWidth: (colId: string) => void;
  close: () => void;
}> = ({ column, x, y, toggleColumnDisplay, startRename, resetColumnWidth, close }) => {
  const { t } = useI18n();
  const displayItems: {
    key: keyof ColumnDisplayOptions;
    label: string;
  }[] = [
    { key: "showEffort", label: t("kanban.ctxShowEffort") },
    { key: "showDate", label: t("kanban.ctxShowDate") },
    { key: "showNotes", label: t("kanban.ctxShowNotes") },
    { key: "showImage", label: t("kanban.ctxShowImage") },
  ];
  return (
    <div
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
      className="fixed z-50 w-44 rounded-lg border border-border bg-popover p-1 shadow-popover-soft"
    >
      {displayItems.map((item) => {
        const checked = column.display?.[item.key] ?? true;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => toggleColumnDisplay(column.id, item.key)}
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-white/[0.07]"
          >
            <span>{item.label}</span>
            {checked && <Check className="h-3.5 w-3.5 text-shiba-400" />}
          </button>
        );
      })}

      <div className="my-1 border-t border-white/[0.06]" />

      <button
        type="button"
        onClick={() => {
          startRename(column);
          close();
        }}
        className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-300 transition hover:bg-white/[0.07]"
      >
        {t("kanban.ctxRename")}
      </button>

      <button
        type="button"
        onClick={() => {
          resetColumnWidth(column.id);
          close();
        }}
        className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-300 transition hover:bg-white/[0.07]"
      >
        {t("kanban.ctxResetWidth")}
      </button>
    </div>
  );
};
