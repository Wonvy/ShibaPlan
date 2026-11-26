import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Columns3,
  Kanban,
  LayoutGrid,
  Minus,
  Pause,
  Play,
  Plus,
  Scan,
  X,
} from "lucide-react";
import {
  BoardColumn,
  COLUMN_COLORS,
  ColumnDisplayOptions,
  EFFORT_MINUTES,
  EffortSize,
  TaskItem,
  WorkspaceData,
} from "../types";
import {
  FolderEntry,
  inspectPath,
  isTauriRuntime,
  listFolderEntries,
  savePastedImage,
  uid,
} from "../lib/storage";
import { useI18n } from "../lib/i18n";
import {
  AreaMenuRequest,
  AreaMenuState,
  InsertPosition,
  formatClock,
} from "./kanban/constants";
import { useStableCallback } from "./kanban/useStableCallback";
import { buildTasksFromDroppedItems } from "./kanban/dropUtils";
import { TaskCardActions } from "./kanban/TaskCard";
import { KanbanColumn, KanbanColumnActions } from "./kanban/KanbanColumn";
import { DoneTasksView } from "./kanban/DoneTasksView";
import {
  ConfirmDeleteColumnDialog,
  ConfirmDeleteTaskDialog,
  TaskEditFields,
  TaskEditorDialog,
} from "./kanban/KanbanDialogs";
import {
  AreaContextMenu,
  ColumnContextMenu,
} from "./kanban/KanbanContextMenus";

interface KanbanBoardProps {
  workspace: WorkspaceData;
  onUpdate: (next: WorkspaceData) => void;
}

const EMPTY_TASKS: TaskItem[] = [];

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  workspace,
  onUpdate,
}) => {
  const { t, locale } = useI18n();
  const stableT = useStableCallback(t);
  const [boardTab, setBoardTab] = useState<"all" | "done">("all");
  const [layoutMode, setLayoutMode] = useState<"row" | "canvas">("row");

  // Keep latest workspace & onUpdate in refs so callbacks stay referentially stable
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  // Freeform Canvas Pan & Zoom state
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [canvasPan, setCanvasPan] = useState({ x: 32, y: 24 });
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const [movingCol, setMovingCol] = useState<{
    colId: string;
    x: number;
    y: number;
  } | null>(null);
  const [snapGuides, setSnapGuides] = useState<{
    vertical: number[];
    horizontal: number[];
  }>({ vertical: [], horizontal: [] });

  // Column DOM refs for native OS folder drop hit-testing
  const columnRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const registerColumnRef = useCallback(
    (colId: string, el: HTMLDivElement | null) => {
      if (el) columnRefs.current.set(colId, el);
      else columnRefs.current.delete(colId);
    },
    []
  );

  const toggleColumnCollapse = useStableCallback((colId: string) => {
    const ws = workspaceRef.current;
    onUpdateRef.current({
      ...ws,
      columns: ws.columns.map((c) =>
        c.id === colId ? { ...c, collapsed: !c.collapsed } : c
      ),
    });
  });

  // Canvas keyboard shortcuts: Space (pan), Ctrl+= / Ctrl+- (zoom), Ctrl+0 (reset)
  useEffect(() => {
    if (layoutMode !== "canvas") return;
    const onKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const inInput =
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          (active as HTMLElement).isContentEditable);
      if (inInput) return;

      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        setSpacePressed(true);
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        setCanvasZoom((z) => Math.min(1.8, +(z + 0.1).toFixed(2)));
      } else if ((e.ctrlKey || e.metaKey) && e.key === "-") {
        e.preventDefault();
        setCanvasZoom((z) => Math.max(0.35, +(z - 0.1).toFixed(2)));
      } else if ((e.ctrlKey || e.metaKey) && e.key === "0") {
        e.preventDefault();
        setCanvasZoom(1);
        setCanvasPan({ x: 32, y: 24 });
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpacePressed(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [layoutMode]);

  const startCanvasPan = (e: React.MouseEvent<HTMLDivElement>) => {
    if (layoutMode !== "canvas") return;
    const isMiddle = e.button === 1;
    const isEmptyClick =
      e.button === 0 &&
      (spacePressed ||
        !(e.target as HTMLElement).closest("[data-board-column]"));
    if (!isMiddle && !isEmptyClick) return;
    e.preventDefault();
    setIsPanning(true);
    const startX = e.clientX;
    const startY = e.clientY;
    const originPan = { ...canvasPan };

    const onMove = (ev: MouseEvent) => {
      setCanvasPan({
        x: originPan.x + (ev.clientX - startX),
        y: originPan.y + (ev.clientY - startY),
      });
    };
    const onUp = () => {
      setIsPanning(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startMoveColumnOnCanvas = useStableCallback(
    (e: React.MouseEvent, col: BoardColumn, colIndex: number) => {
      if (layoutMode !== "canvas" || e.button !== 0 || spacePressed) return;
      if ((e.target as HTMLElement).closest("button, input")) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const baseX = col.x ?? colIndex * 316;
      const baseY = col.y ?? 0;
      const myW = col.collapsed ? 224 : col.width ?? 288;
      const myH = columnRefs.current.get(col.id)?.offsetHeight ?? 200;

      // Pre-collect other columns' geometry for smart snapping & alignment guides
      const others = workspaceRef.current.columns
        .map((c, idx) => ({ c, idx }))
        .filter(({ c }) => c.id !== col.id)
        .map(({ c, idx }) => {
          const ox = c.x ?? idx * 316;
          const oy = c.y ?? 0;
          const ow = c.collapsed ? 224 : c.width ?? 288;
          const oh = columnRefs.current.get(c.id)?.offsetHeight ?? 200;
          return {
            left: ox,
            right: ox + ow,
            centerX: ox + ow / 2,
            top: oy,
            bottom: oy + oh,
            centerY: oy + oh / 2,
          };
        });

      let latestX = baseX;
      let latestY = baseY;
      setMovingCol({ colId: col.id, x: baseX, y: baseY });

      const SNAP = 10;
      const GAP = 24;

      const onMove = (ev: MouseEvent) => {
        let rawX = baseX + (ev.clientX - startX) / canvasZoom;
        let rawY = baseY + (ev.clientY - startY) / canvasZoom;

        const vGuides: number[] = [];
        const hGuides: number[] = [];

        // Hold Alt to bypass snapping temporarily
        if (!ev.altKey && others.length > 0) {
          let bestDx = SNAP + 1;
          let snappedX = rawX;
          let activeVGuide: number | null = null;

          for (const o of others) {
            const xChecks: { candidateX: number; guideX: number }[] = [
              { candidateX: o.left, guideX: o.left }, // left-to-left
              { candidateX: o.right - myW, guideX: o.right }, // right-to-right
              { candidateX: o.centerX - myW / 2, guideX: o.centerX }, // center-to-center
              { candidateX: o.right + GAP, guideX: o.right + GAP }, // clean gap right
              { candidateX: o.left - GAP - myW, guideX: o.left - GAP }, // clean gap left
            ];
            for (const chk of xChecks) {
              const diff = Math.abs(rawX - chk.candidateX);
              if (diff < bestDx) {
                bestDx = diff;
                snappedX = chk.candidateX;
                activeVGuide = chk.guideX;
              }
            }
          }
          if (activeVGuide !== null) {
            rawX = snappedX;
            vGuides.push(Math.round(activeVGuide));
          }

          let bestDy = SNAP + 1;
          let snappedY = rawY;
          let activeHGuide: number | null = null;

          for (const o of others) {
            const yChecks: { candidateY: number; guideY: number }[] = [
              { candidateY: o.top, guideY: o.top }, // top-to-top
              { candidateY: o.bottom - myH, guideY: o.bottom }, // bottom-to-bottom
              { candidateY: o.centerY - myH / 2, guideY: o.centerY }, // center-to-center
              { candidateY: o.bottom + 20, guideY: o.bottom + 20 }, // clean gap below
              { candidateY: o.top - 20 - myH, guideY: o.top - 20 }, // clean gap above
            ];
            for (const chk of yChecks) {
              const diff = Math.abs(rawY - chk.candidateY);
              if (diff < bestDy) {
                bestDy = diff;
                snappedY = chk.candidateY;
                activeHGuide = chk.guideY;
              }
            }
          }
          if (activeHGuide !== null) {
            rawY = snappedY;
            hGuides.push(Math.round(activeHGuide));
          }
        }

        latestX = Math.round(rawX);
        latestY = Math.round(rawY);
        setSnapGuides({ vertical: vGuides, horizontal: hGuides });
        setMovingCol({ colId: col.id, x: latestX, y: latestY });
      };

      const onUp = () => {
        setMovingCol(null);
        setSnapGuides({ vertical: [], horizontal: [] });
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        onUpdateRef.current({
          ...workspaceRef.current,
          columns: workspaceRef.current.columns.map((c) =>
            c.id === col.id ? { ...c, x: latestX, y: latestY } : c
          ),
        });
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    }
  );

  // Add column state
  const [creatingCol, setCreatingCol] = useState(false);
  const [newColTitle, setNewColTitle] = useState("");
  const [newColColor, setNewColColor] = useState(COLUMN_COLORS[0]);

  const isBoardCanvasVisible =
    boardTab === "all" && (workspace.columns.length > 0 || creatingCol);

  // Non-passive wheel handler:
  // - Shift + wheel scrolls horizontally in row mode (or pans horizontally in canvas mode)
  // - Canvas mode zoom on Ctrl/Meta + wheel or wheel on empty canvas
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || !isBoardCanvasVisible) return;

    const onWheel = (e: WheelEvent) => {
      if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
        const delta =
          Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        if (delta === 0) return;
        e.preventDefault();
        if (layoutMode === "row") {
          el.scrollLeft += delta;
        } else {
          setCanvasPan((prev) => ({ x: prev.x - delta, y: prev.y }));
        }
        return;
      }

      if (layoutMode !== "canvas") return;
      const insideColumnScroll = Boolean(
        (e.target as HTMLElement | null)?.closest("[data-column-scroll]")
      );
      if (e.ctrlKey || e.metaKey || !insideColumnScroll) {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const factor = e.deltaY < 0 ? 1.09 : 0.91;
        setCanvasZoom((prevZoom) => {
          const nextZoom = Math.min(
            1.8,
            Math.max(0.35, +(prevZoom * factor).toFixed(3))
          );
          if (nextZoom !== prevZoom) {
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            setCanvasPan((prevPan) => {
              const ratio = nextZoom / prevZoom;
              return {
                x: mx - (mx - prevPan.x) * ratio,
                y: my - (my - prevPan.y) * ratio,
              };
            });
          }
          return nextZoom;
        });
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [layoutMode, isBoardCanvasVisible]);

  // Rename & delete column state
  const [editingColId, setEditingColId] = useState<string | null>(null);
  const [editingColTitle, setEditingColTitle] = useState("");
  const [confirmDeleteCol, setConfirmDeleteCol] = useState<BoardColumn | null>(
    null
  );
  const [confirmDeleteTask, setConfirmDeleteTask] = useState<TaskItem | null>(
    null
  );
  const [colContextMenu, setColContextMenu] = useState<{
    colId: string;
    x: number;
    y: number;
  } | null>(null);

  const [areaContextMenu, setAreaContextMenu] =
    useState<AreaMenuState | null>(null);

  useEffect(() => {
    if (!colContextMenu && !areaContextMenu) return;
    const close = () => {
      setColContextMenu(null);
      setAreaContextMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [colContextMenu, areaContextMenu]);

  const openAreaContextMenu = useStableCallback(
    (e: React.MouseEvent, menu: AreaMenuRequest) => {
      e.preventDefault();
      e.stopPropagation();
      setColContextMenu(null);
      const menuW = 184;
      const menuH = menu.kind === "card" ? 290 : 180;
      const x = Math.min(e.clientX, window.innerWidth - menuW - 12);
      const y = Math.min(e.clientY, window.innerHeight - menuH - 12);
      setAreaContextMenu({ ...menu, x, y });
    }
  );

  const duplicateTask = useStableCallback((task: TaskItem) => {
    const ws = workspaceRef.current;
    const copy: TaskItem = {
      ...task,
      id: uid("task"),
      title: `${task.title} (副本)`,
      status: "todo",
      actualMinutes: 0,
      completedAt: undefined,
      createdAt: new Date().toISOString(),
    };
    const idx = ws.tasks.findIndex((item) => item.id === task.id);
    const nextTasks =
      idx >= 0
        ? [...ws.tasks.slice(0, idx + 1), copy, ...ws.tasks.slice(idx + 1)]
        : [copy, ...ws.tasks];
    onUpdateRef.current({ ...ws, tasks: nextTasks });
  });

  const moveTaskToRiver = useStableCallback((task: TaskItem) => {
    const ws = workspaceRef.current;
    const colTitle =
      ws.columns.find((c) => c.id === task.columnId)?.title ?? "灵感";
    const combined = task.notes
      ? task.notes.startsWith(task.title)
        ? task.notes
        : `${task.title}\n${task.notes}`
      : task.title;
    onUpdateRef.current({
      ...ws,
      tasks: ws.tasks.filter((item) => item.id !== task.id),
      ideas: [
        {
          id: uid("idea"),
          content: combined,
          tag: colTitle,
          imagePreview: task.imagePreview,
          imagePath: task.imagePath,
          createdAt: new Date().toISOString(),
        },
        ...ws.ideas,
      ],
    });
  });

  const setAllColumnsCollapsed = useStableCallback((collapsed: boolean) => {
    const ws = workspaceRef.current;
    onUpdateRef.current({
      ...ws,
      columns: ws.columns.map((c) => ({ ...c, collapsed })),
    });
  });

  // Freeform Canvas: Fit all columns cleanly into viewport
  const fitCanvasToScreen = useStableCallback(
    (colsOverride?: BoardColumn[]) => {
      const cols = colsOverride ?? workspaceRef.current.columns;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect || cols.length === 0) {
        setCanvasZoom(1);
        setCanvasPan({ x: 32, y: 24 });
        return;
      }

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      cols.forEach((c, idx) => {
        const cx = c.x ?? idx * 316;
        const cy = c.y ?? 0;
        const cw = c.collapsed ? 224 : c.width ?? 288;
        const ch =
          columnRefs.current.get(c.id)?.offsetHeight ??
          (c.collapsed ? 116 : 360);
        minX = Math.min(minX, cx);
        minY = Math.min(minY, cy);
        maxX = Math.max(maxX, cx + cw);
        maxY = Math.max(maxY, cy + ch);
      });

      const contentW = Math.max(100, maxX - minX);
      const contentH = Math.max(100, maxY - minY);
      const pad = 48;
      const scaleX = (rect.width - pad * 2) / contentW;
      const scaleY = (rect.height - pad * 2) / contentH;
      const nextZoom = Math.min(
        1.15,
        Math.max(0.35, +Math.min(scaleX, scaleY).toFixed(2))
      );
      const nextPanX = Math.round(
        (rect.width - contentW * nextZoom) / 2 - minX * nextZoom
      );
      const nextPanY = Math.round(
        (rect.height - contentH * nextZoom) / 2 - minY * nextZoom
      );

      setCanvasZoom(nextZoom);
      setCanvasPan({ x: nextPanX, y: nextPanY });
    }
  );

  // Freeform Canvas: Auto-arrange columns into a crisp aligned grid
  const tidyCanvasLayout = useStableCallback(() => {
    const ws = workspaceRef.current;
    if (ws.columns.length === 0) return;
    const perRow = Math.min(
      4,
      Math.max(2, Math.ceil(Math.sqrt(ws.columns.length)))
    );
    const gapX = 28;
    const gapY = 28;
    let curX = 0;
    let curY = 0;
    let rowMaxH = 0;

    const tidied = ws.columns.map((col, idx) => {
      const colInRow = idx % perRow;
      if (colInRow === 0 && idx > 0) {
        curX = 0;
        curY += rowMaxH + gapY;
        rowMaxH = 0;
      }
      const w = col.collapsed ? 224 : col.width ?? 288;
      const h =
        columnRefs.current.get(col.id)?.offsetHeight ??
        (col.collapsed ? 116 : 340);
      const positioned: BoardColumn = { ...col, x: curX, y: curY };
      curX += w + gapX;
      rowMaxH = Math.max(rowMaxH, h);
      return positioned;
    });

    onUpdateRef.current({ ...ws, columns: tidied });
    setTimeout(() => fitCanvasToScreen(tidied), 30);
  });

  const toggleColumnDisplay = useStableCallback(
    (colId: string, key: keyof ColumnDisplayOptions) => {
      const ws = workspaceRef.current;
      onUpdateRef.current({
        ...ws,
        columns: ws.columns.map((c) => {
          if (c.id !== colId) return c;
          const current = c.display?.[key] ?? true;
          return {
            ...c,
            display: {
              ...c.display,
              [key]: !current,
            },
          };
        }),
      });
    }
  );

  // Per-column horizontal drag resize state
  const [resizingCol, setResizingCol] = useState<{
    colId: string;
    width: number;
  } | null>(null);

  // Collapsed folder vertical drag resize state
  const [resizingFolderH, setResizingFolderH] = useState<{
    colId: string;
    height: number;
  } | null>(null);

  // Row-mode column drag reorder & interactive gap resize state
  const [dragColId, setDragColId] = useState<string | null>(null);
  const [dragOverColSlot, setDragOverColSlot] = useState<{
    colId: string;
    side: "left" | "right";
  } | null>(null);
  const [resizingGap, setResizingGap] = useState<{
    colId: string;
    gap: number;
  } | null>(null);

  const defaultColumnGap = workspace.settings.columnGap ?? 16;

  const startResizeColumnGap = useStableCallback(
    (e: React.MouseEvent, col: BoardColumn) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startGap =
        col.gapAfter ?? workspaceRef.current.settings.columnGap ?? 16;
      let latestGap = startGap;
      setResizingGap({ colId: col.id, gap: startGap });

      const onMove = (ev: MouseEvent) => {
        latestGap = Math.round(
          Math.min(160, Math.max(4, startGap + (ev.clientX - startX)))
        );
        setResizingGap({ colId: col.id, gap: latestGap });
      };
      const onUp = () => {
        setResizingGap(null);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        onUpdateRef.current({
          ...workspaceRef.current,
          columns: workspaceRef.current.columns.map((c) =>
            c.id === col.id ? { ...c, gapAfter: latestGap } : c
          ),
        });
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    }
  );

  const resetColumnGap = useStableCallback((colId: string) => {
    const ws = workspaceRef.current;
    const fallback = ws.settings.columnGap ?? 16;
    onUpdateRef.current({
      ...ws,
      columns: ws.columns.map((c) =>
        c.id === colId
          ? { ...c, gapAfter: fallback === 16 ? undefined : 16 }
          : c
      ),
    });
  });

  const handleColumnReorderDrop = useStableCallback(
    (e: React.DragEvent, targetColId: string, side: "left" | "right") => {
      const ws = workspaceRef.current;
      const sourceId =
        dragColId || e.dataTransfer.getData("application/x-shibaplan-column");
      setDragColId(null);
      setDragOverColSlot(null);
      if (!sourceId || sourceId === targetColId) return;

      const dragged = ws.columns.find((c) => c.id === sourceId);
      if (!dragged) return;
      const remaining = ws.columns.filter((c) => c.id !== sourceId);
      const idx = remaining.findIndex((c) => c.id === targetColId);
      if (idx < 0) return;
      const insertAt = side === "right" ? idx + 1 : idx;
      const nextColumns = [
        ...remaining.slice(0, insertAt),
        dragged,
        ...remaining.slice(insertAt),
      ];
      onUpdateRef.current({
        ...ws,
        columns: nextColumns,
      });
    }
  );

  const startResizeFolderHeight = useStableCallback(
    (e: React.MouseEvent, col: BoardColumn) => {
      e.preventDefault();
      e.stopPropagation();
      const startY = e.clientY;
      const currentElH = columnRefs.current.get(col.id)?.offsetHeight ?? 108;
      const startH = col.collapsedHeight ?? currentElH;
      let latestH = startH;
      setResizingFolderH({ colId: col.id, height: startH });

      const scale = layoutMode === "canvas" ? canvasZoom : 1;

      const onMove = (ev: MouseEvent) => {
        latestH = Math.round(
          Math.min(480, Math.max(84, startH + (ev.clientY - startY) / scale))
        );
        setResizingFolderH({ colId: col.id, height: latestH });
      };
      const onUp = () => {
        setResizingFolderH(null);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        onUpdateRef.current({
          ...workspaceRef.current,
          columns: workspaceRef.current.columns.map((c) =>
            c.id === col.id ? { ...c, collapsedHeight: latestH } : c
          ),
        });
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    }
  );

  const resetFolderHeight = useStableCallback((colId: string) => {
    const ws = workspaceRef.current;
    onUpdateRef.current({
      ...ws,
      columns: ws.columns.map((c) =>
        c.id === colId ? { ...c, collapsedHeight: undefined } : c
      ),
    });
  });

  const startResizeColumn = useStableCallback(
    (e: React.MouseEvent, col: BoardColumn) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = col.width ?? 288;
      let latestW = startW;
      setResizingCol({ colId: col.id, width: startW });

      const onMove = (ev: MouseEvent) => {
        latestW = Math.round(
          Math.min(640, Math.max(220, startW + (ev.clientX - startX)))
        );
        setResizingCol({ colId: col.id, width: latestW });
      };
      const onUp = () => {
        setResizingCol(null);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        onUpdateRef.current({
          ...workspaceRef.current,
          columns: workspaceRef.current.columns.map((c) =>
            c.id === col.id ? { ...c, width: latestW } : c
          ),
        });
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    }
  );

  const resetColumnWidth = useStableCallback((colId: string) => {
    const ws = workspaceRef.current;
    onUpdateRef.current({
      ...ws,
      columns: ws.columns.map((c) =>
        c.id === colId ? { ...c, width: undefined } : c
      ),
    });
  });

  // Inline add task state
  const [addingTaskColId, setAddingTaskColId] = useState<string | null>(null);
  const [draftTaskTitle, setDraftTaskTitle] = useState("");

  // Drag & Drop state
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<{
    taskId: string;
    position: InsertPosition;
  } | null>(null);

  // Hovered column id is only read by the paste handler; keep in a ref so
  // hovering columns never triggers a React re-render of the board.
  const hoveredColIdRef = useRef<string | null>(null);

  // Folder shortcut expand/collapse & cached file entries
  const [expandedFolders, setExpandedFolders] = useState<
    Record<string, boolean>
  >({});
  const [folderFiles, setFolderFiles] = useState<Record<string, FolderEntry[]>>(
    {}
  );
  const [loadingFolders, setLoadingFolders] = useState<Record<string, boolean>>(
    {}
  );

  // Compact card collapse state & hover large image preview
  const [collapsedCards, setCollapsedCards] = useState<Record<string, boolean>>(
    {}
  );
  const [hoveredImage, setHoveredImage] = useState<{
    src: string;
    x: number;
    y: number;
  } | null>(null);

  const toggleCardCollapse = useCallback((taskId: string) => {
    setCollapsedCards((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  }, []);

  const handleImageHover = useCallback(
    (src: string, e: React.MouseEvent<HTMLImageElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const previewW = 360;
      const previewH = 280;
      let x = rect.right + 12;
      if (x + previewW > window.innerWidth - 16) {
        x = Math.max(16, rect.left - previewW - 12);
      }
      let y = rect.top - 20;
      if (y + previewH > window.innerHeight - 16) {
        y = Math.max(16, window.innerHeight - previewH - 16);
      }
      setHoveredImage({ src, x, y });
    },
    []
  );

  const handleImageLeave = useCallback(() => {
    setHoveredImage(null);
  }, []);

  const loadFolder = useCallback(async (taskId: string, folderPath: string) => {
    setLoadingFolders((prev) => ({ ...prev, [taskId]: true }));
    try {
      const entries = await listFolderEntries(folderPath);
      setFolderFiles((prev) => ({ ...prev, [taskId]: entries }));
    } catch (err) {
      console.error("Failed to list folder:", err);
      setFolderFiles((prev) => ({ ...prev, [taskId]: [] }));
    } finally {
      setLoadingFolders((prev) => ({ ...prev, [taskId]: false }));
    }
  }, []);

  const toggleFolderExpand = useStableCallback((task: TaskItem) => {
    if (!task.folderPath) return;
    const nextOpen = !expandedFolders[task.id];
    setExpandedFolders((prev) => ({ ...prev, [task.id]: nextOpen }));
    if (nextOpen && !folderFiles[task.id]) {
      if (isTauriRuntime()) {
        loadFolder(task.id, task.folderPath);
      } else if (task.cachedFiles) {
        setFolderFiles((prev) => ({ ...prev, [task.id]: task.cachedFiles! }));
      }
    }
  });

  // Native OS Folder/File Drag-and-Drop listener (Rust WindowEvent::DragDrop -> "os-drag-drop")
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;

    const findColumnAtPoint = (physX: number, physY: number): string | null => {
      const dpr = window.devicePixelRatio || 1;
      const points = [
        { x: physX / dpr, y: physY / dpr },
        { x: physX, y: physY },
      ];
      for (const pt of points) {
        for (const [colId, el] of columnRefs.current.entries()) {
          const rect = el.getBoundingClientRect();
          if (
            pt.x >= rect.left &&
            pt.x <= rect.right &&
            pt.y >= rect.top &&
            pt.y <= rect.bottom
          ) {
            return colId;
          }
        }
      }
      return null;
    };

    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<{ kind: string; paths: string[]; x: number; y: number }>(
        "os-drag-drop",
        async (event) => {
          const payload = event.payload;
          if (payload.kind === "over" || payload.kind === "enter") {
            const colId = findColumnAtPoint(payload.x, payload.y);
            setDragOverColId(colId);
          } else if (payload.kind === "leave") {
            setDragOverColId(null);
          } else if (payload.kind === "drop") {
            const ws = workspaceRef.current;
            const targetColId =
              findColumnAtPoint(payload.x, payload.y) ??
              ws.columns[0]?.id ??
              null;
            setDragOverColId(null);
            if (!targetColId || payload.paths.length === 0) return;

            const newTasks: TaskItem[] = [];
            for (const rawPath of payload.paths) {
              const info = await inspectPath(rawPath);
              if (!info) continue;
              newTasks.push({
                id: uid("task"),
                title: info.name,
                notes: info.path,
                columnId: targetColId,
                folderPath: info.is_dir ? info.path : undefined,
                filePath: info.is_dir ? undefined : info.path,
                importance: 2,
                effort: "S",
                estimatedMinutes: EFFORT_MINUTES.S,
                actualMinutes: 0,
                status: "todo",
                createdAt: new Date().toISOString(),
              });
            }

            if (newTasks.length > 0) {
              onUpdateRef.current({
                ...ws,
                tasks: [...newTasks, ...ws.tasks],
              });
            }
          }
        }
      ).then((fn) => {
        unlisten = fn;
      });
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Focus timer state
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Schedule / Edit card modal state (form fields live inside TaskEditorDialog)
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null);

  // Inline card rename state
  const [renamingTaskId, setRenamingTaskId] = useState<string | null>(null);

  const startRenameTask = useCallback((task: TaskItem) => {
    setRenamingTaskId(task.id);
  }, []);

  const cancelRenameTask = useCallback(() => {
    setRenamingTaskId(null);
  }, []);

  const commitRenameTask = useStableCallback(
    (taskId: string, rawTitle: string) => {
      const title = rawTitle.trim();
      if (title) {
        const ws = workspaceRef.current;
        const existing = ws.tasks.find((item) => item.id === taskId);
        if (existing && existing.title !== title) {
          onUpdateRef.current({
            ...ws,
            tasks: ws.tasks.map((item) =>
              item.id === taskId ? { ...item, title } : item
            ),
          });
        }
      }
      setRenamingTaskId(null);
    }
  );

  const openTaskEditor = useCallback((task: TaskItem) => {
    setEditingTask(task);
  }, []);

  const closeTaskEditor = useCallback(() => {
    setEditingTask(null);
  }, []);

  const handleSaveTaskEdit = useStableCallback((fields: TaskEditFields) => {
    if (!editingTask) return;
    const ws = workspaceRef.current;
    onUpdateRef.current({
      ...ws,
      tasks: ws.tasks.map((t) =>
        t.id === editingTask.id
          ? {
              ...t,
              title: fields.title,
              notes: fields.notes,
              dueDate: fields.dueDate,
              startTime: fields.startTime,
              imagePreview: fields.imagePreview,
            }
          : t
      ),
    });
    setEditingTask(null);
  });

  // Hover-to-paste: when mouse hovers a column and user presses Ctrl+V, insert & open editor
  useEffect(() => {
    const onWindowPaste = async (e: ClipboardEvent) => {
      const hoveredColId = hoveredColIdRef.current;
      if (
        !hoveredColId ||
        editingTask ||
        renamingTaskId ||
        creatingCol ||
        addingTaskColId
      ) {
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

      const items = e.clipboardData?.items;
      if (!items) return;

      // 1. Check for image first
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const file = items[i].getAsFile();
          if (!file) continue;
          e.preventDefault();
          const ext = items[i].type.split("/")[1] || "png";
          const reader = new FileReader();
          reader.onload = async () => {
            if (typeof reader.result !== "string") return;
            const ws = workspaceRef.current;
            const savedPath = await savePastedImage(
              reader.result,
              ext,
              ws.settings.customDataDir
            );
            const newTask: TaskItem = {
              id: uid("task"),
              title: "截图任务",
              columnId: hoveredColId,
              importance: 2,
              effort: "S",
              estimatedMinutes: EFFORT_MINUTES.S,
              actualMinutes: 0,
              status: "todo",
              imagePreview: reader.result,
              imagePath: savedPath || undefined,
              createdAt: new Date().toISOString(),
            };
            onUpdateRef.current({
              ...ws,
              tasks: [newTask, ...ws.tasks],
            });
            openTaskEditor(newTask);
          };
          reader.readAsDataURL(file);
          return;
        }
      }

      // 2. Otherwise check for text (also detect local folder paths)
      const text = e.clipboardData?.getData("text/plain")?.trim();
      if (!text) return;
      e.preventDefault();

      const ws = workspaceRef.current;
      const pathInfo = await inspectPath(text);
      if (pathInfo && pathInfo.is_dir) {
        const folderTask: TaskItem = {
          id: uid("task"),
          title: pathInfo.name,
          notes: pathInfo.path,
          columnId: hoveredColId,
          folderPath: pathInfo.path,
          importance: 2,
          effort: "S",
          estimatedMinutes: EFFORT_MINUTES.S,
          actualMinutes: 0,
          status: "todo",
          createdAt: new Date().toISOString(),
        };
        onUpdateRef.current({
          ...ws,
          tasks: [folderTask, ...ws.tasks],
        });
        return;
      }

      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const rawFirstLine = (lines[0] ?? text).trim();
      const isPastedUrl = /^https?:\/\/\S+$/i.test(rawFirstLine);
      const firstLine = isPastedUrl ? rawFirstLine : rawFirstLine.slice(0, 80);
      const restNotes = lines.length > 1 ? text : undefined;

      const newTask: TaskItem = {
        id: uid("task"),
        title: firstLine,
        notes: restNotes,
        columnId: hoveredColId,
        importance: 2,
        effort: "S",
        estimatedMinutes: EFFORT_MINUTES.S,
        actualMinutes: 0,
        status: "todo",
        createdAt: new Date().toISOString(),
      };
      onUpdateRef.current({
        ...ws,
        tasks: [newTask, ...ws.tasks],
      });
      openTaskEditor(newTask);
    };

    window.addEventListener("paste", onWindowPaste);
    return () => window.removeEventListener("paste", onWindowPaste);
  }, [editingTask, renamingTaskId, creatingCol, addingTaskColId, openTaskEditor]);

  useEffect(() => {
    if (!isRunning || !activeTaskId) return;
    const timer = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [isRunning, activeTaskId]);

  const activeTask = useMemo(
    () => workspace.tasks.find((t) => t.id === activeTaskId) ?? null,
    [workspace.tasks, activeTaskId]
  );

  const columnMap = useMemo(() => {
    const map = new Map<string, BoardColumn>();
    workspace.columns.forEach((c) => map.set(c.id, c));
    return map;
  }, [workspace.columns]);

  // Pre-group tasks by columnId in one O(N) pass per tasks change
  const tasksByColumn = useMemo(() => {
    const map = new Map<string, TaskItem[]>();
    for (const task of workspace.tasks) {
      const list = map.get(task.columnId);
      if (list) list.push(task);
      else map.set(task.columnId, [task]);
    }
    return map;
  }, [workspace.tasks]);

  const handleCreateColumn = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const title = newColTitle.trim();
    if (!title) {
      setCreatingCol(false);
      return;
    }
    const ws = workspaceRef.current;
    const nextCol: BoardColumn = {
      id: uid("col"),
      title,
      color: newColColor,
    };
    onUpdateRef.current({
      ...ws,
      columns: [...ws.columns, nextCol],
    });
    setNewColTitle("");
    setNewColColor(
      COLUMN_COLORS[(ws.columns.length + 1) % COLUMN_COLORS.length]
    );
    setCreatingCol(false);
  };

  const handleRenameColumn = useStableCallback((colId: string) => {
    const title = editingColTitle.trim();
    if (title) {
      const ws = workspaceRef.current;
      onUpdateRef.current({
        ...ws,
        columns: ws.columns.map((c) => (c.id === colId ? { ...c, title } : c)),
      });
    }
    setEditingColId(null);
  });

  const handleDeleteColumn = useStableCallback((colId: string) => {
    const ws = workspaceRef.current;
    onUpdateRef.current({
      ...ws,
      columns: ws.columns.filter((c) => c.id !== colId),
      tasks: ws.tasks.filter((t) => t.columnId !== colId),
    });
  });

  const handleAddTask = useStableCallback((colId: string) => {
    const title = draftTaskTitle.trim();
    if (!title) {
      setAddingTaskColId(null);
      return;
    }
    const ws = workspaceRef.current;
    const newTask: TaskItem = {
      id: uid("task"),
      title,
      columnId: colId,
      importance: 2,
      effort: "S",
      estimatedMinutes: EFFORT_MINUTES.S,
      actualMinutes: 0,
      status: "todo",
      createdAt: new Date().toISOString(),
    };
    onUpdateRef.current({
      ...ws,
      tasks: [newTask, ...ws.tasks],
    });
    setDraftTaskTitle("");
    setAddingTaskColId(null);
  });

  const commitFocus = useStableCallback((task: TaskItem, markDone: boolean) => {
    const ws = workspaceRef.current;
    const addedMinutes =
      elapsedSeconds > 10 ? Math.max(1, Math.round(elapsedSeconds / 60)) : 0;
    const now = new Date().toISOString();

    const updatedTasks = ws.tasks.map((t) =>
      t.id === task.id
        ? {
            ...t,
            actualMinutes: t.actualMinutes + addedMinutes,
            status: markDone ? ("done" as const) : t.status,
            completedAt: markDone ? now : t.completedAt,
          }
        : t
    );

    const nextLogs =
      addedMinutes > 0
        ? [
            {
              id: uid("log"),
              taskId: task.id,
              taskTitle: task.title,
              minutes: addedMinutes,
              startedAt: new Date(
                Date.now() - elapsedSeconds * 1000
              ).toISOString(),
              endedAt: now,
            },
            ...ws.focusLogs,
          ]
        : ws.focusLogs;

    onUpdateRef.current({
      ...ws,
      tasks: updatedTasks,
      focusLogs: nextLogs,
    });
    setElapsedSeconds(0);
    setIsRunning(false);
    if (markDone) setActiveTaskId(null);
  });

  const handleStartFocus = useStableCallback((task: TaskItem) => {
    if (activeTaskId === task.id) {
      setIsRunning((r) => !r);
      return;
    }
    if (activeTask && elapsedSeconds > 10) {
      commitFocus(activeTask, false);
    }
    setActiveTaskId(task.id);
    setElapsedSeconds(0);
    setIsRunning(true);
    if (task.status === "todo") {
      const ws = workspaceRef.current;
      onUpdateRef.current({
        ...ws,
        tasks: ws.tasks.map((t) =>
          t.id === task.id ? { ...t, status: "in_progress" } : t
        ),
      });
    }
  });

  const toggleDone = useStableCallback((task: TaskItem) => {
    if (activeTaskId === task.id && task.status !== "done") {
      commitFocus(task, true);
      return;
    }
    const ws = workspaceRef.current;
    const nextDone = task.status !== "done";
    onUpdateRef.current({
      ...ws,
      tasks: ws.tasks.map((t) =>
        t.id === task.id
          ? {
              ...t,
              status: nextDone ? "done" : "todo",
              completedAt: nextDone ? new Date().toISOString() : undefined,
            }
          : t
      ),
    });
  });

  const toggleStar = useStableCallback((task: TaskItem) => {
    const ws = workspaceRef.current;
    onUpdateRef.current({
      ...ws,
      tasks: ws.tasks.map((t) =>
        t.id === task.id ? { ...t, importance: t.importance === 3 ? 2 : 3 } : t
      ),
    });
  });

  const cycleEffort = useStableCallback((task: TaskItem) => {
    const ws = workspaceRef.current;
    const order: EffortSize[] = ["S", "M", "L"];
    const nextEffort = order[(order.indexOf(task.effort) + 1) % order.length];
    onUpdateRef.current({
      ...ws,
      tasks: ws.tasks.map((t) =>
        t.id === task.id
          ? {
              ...t,
              effort: nextEffort,
              estimatedMinutes: EFFORT_MINUTES[nextEffort],
            }
          : t
      ),
    });
  });

  const deleteTask = useStableCallback((id: string) => {
    const ws = workspaceRef.current;
    onUpdateRef.current({
      ...ws,
      tasks: ws.tasks.filter((t) => t.id !== id),
    });
    if (activeTaskId === id) {
      setActiveTaskId(null);
      setIsRunning(false);
      setElapsedSeconds(0);
    }
  });

  const handleDrop = useStableCallback(
    (
      e: React.DragEvent,
      targetColId: string,
      targetTaskId?: string,
      position: InsertPosition = "before"
    ) => {
      const ws = workspaceRef.current;

      // 0. Check if OS files or folders were dropped via HTML5 DataTransfer (works in Browser & WebView)
      const dtItems = e.dataTransfer.items;
      const dtFiles = e.dataTransfer.files;
      if (
        !dragTaskId &&
        !e.dataTransfer.getData("application/x-shibaplan-idea") &&
        !e.dataTransfer.getData("application/x-shibaplan-task") &&
        !e.dataTransfer.getData("application/x-shibaplan-column") &&
        ((dtItems && dtItems.length > 0) || (dtFiles && dtFiles.length > 0))
      ) {
        const entries: FileSystemEntry[] = [];
        if (dtItems) {
          for (let i = 0; i < dtItems.length; i++) {
            const item = dtItems[i];
            if (
              item.kind === "file" &&
              typeof item.webkitGetAsEntry === "function"
            ) {
              const entry = item.webkitGetAsEntry();
              if (entry) entries.push(entry);
            }
          }
        }

        const fileList = Array.from(dtFiles || []);
        void buildTasksFromDroppedItems(entries, fileList, targetColId).then(
          (created) => {
            if (created.length > 0) {
              const cur = workspaceRef.current;
              onUpdateRef.current({
                ...cur,
                tasks: [...created, ...cur.tasks],
              });
            }
          }
        );

        setDragTaskId(null);
        setDragOverColId(null);
        setDragOverSlot(null);
        return;
      }

      // 1. Check if an Idea card was dragged from IdeaRiver
      const draggedIdeaId = e.dataTransfer.getData(
        "application/x-shibaplan-idea"
      );
      if (draggedIdeaId) {
        const idea = ws.ideas.find((i) => i.id === draggedIdeaId);
        if (idea) {
          const now = new Date().toISOString();
          const lines = idea.content
            .split(/\r?\n/)
            .filter((l) => l.trim().length > 0);
          const newTask: TaskItem = {
            id: uid("task"),
            title: (lines[0] ?? idea.content).slice(0, 80) || "截图灵感",
            notes: lines.length > 1 ? idea.content : undefined,
            columnId: targetColId,
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

          let nextTasks: TaskItem[];
          if (targetTaskId) {
            const idx = ws.tasks.findIndex((t) => t.id === targetTaskId);
            const insertAt = position === "after" ? idx + 1 : idx;
            nextTasks =
              idx >= 0
                ? [
                    ...ws.tasks.slice(0, insertAt),
                    newTask,
                    ...ws.tasks.slice(insertAt),
                  ]
                : [newTask, ...ws.tasks];
          } else {
            nextTasks = [newTask, ...ws.tasks];
          }

          onUpdateRef.current({
            ...ws,
            tasks: nextTasks,
            ideas: ws.ideas.filter((i) => i.id !== idea.id),
            trashedIdeas: [
              {
                ...idea,
                convertedTaskId: newTask.id,
                deletedAt: now,
                reason: "used",
              },
              ...ws.trashedIdeas,
            ],
          });
        }
        setDragTaskId(null);
        setDragOverColId(null);
        setDragOverSlot(null);
        return;
      }

      // 2. Otherwise handle internal Kanban task card drag & precise reorder
      const activeDragId =
        dragTaskId || e.dataTransfer.getData("application/x-shibaplan-task");
      if (!activeDragId) return;
      const dragged = ws.tasks.find((t) => t.id === activeDragId);
      if (!dragged) return;

      const remaining = ws.tasks.filter((t) => t.id !== activeDragId);
      const updatedDragged: TaskItem = { ...dragged, columnId: targetColId };

      let nextTasks: TaskItem[];
      if (targetTaskId && targetTaskId !== activeDragId) {
        const idx = remaining.findIndex((t) => t.id === targetTaskId);
        if (idx >= 0) {
          const insertAt = position === "after" ? idx + 1 : idx;
          nextTasks = [
            ...remaining.slice(0, insertAt),
            updatedDragged,
            ...remaining.slice(insertAt),
          ];
        } else {
          nextTasks = [...remaining, updatedDragged];
        }
      } else {
        nextTasks = [...remaining, updatedDragged];
      }

      onUpdateRef.current({
        ...ws,
        tasks: nextTasks,
      });
      setDragTaskId(null);
      setDragOverColId(null);
      setDragOverSlot(null);
    }
  );

  // Referentially stable action bundle passed to every TaskCard
  const cardDragStart = useCallback((e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData("application/x-shibaplan-task", taskId);
    e.dataTransfer.effectAllowed = "copyMove";
    setDragTaskId(taskId);
  }, []);

  const cardDragEnd = useCallback(() => {
    setDragTaskId(null);
    setDragOverColId(null);
    setDragOverSlot(null);
  }, []);

  const cardDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>, colId: string, taskId: string) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      const pos: InsertPosition =
        e.clientY > rect.top + rect.height / 2 ? "after" : "before";
      setDragOverColId((prev) => (prev === colId ? prev : colId));
      setDragOverSlot((prev) =>
        prev && prev.taskId === taskId && prev.position === pos
          ? prev
          : { taskId, position: pos }
      );
    },
    []
  );

  const cardDrop = useStableCallback(
    (e: React.DragEvent<HTMLDivElement>, colId: string, taskId: string) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      const pos: InsertPosition =
        e.clientY > rect.top + rect.height / 2 ? "after" : "before";
      handleDrop(e, colId, taskId, pos);
    }
  );

  const requestDeleteTask = useCallback((task: TaskItem) => {
    setConfirmDeleteTask(task);
  }, []);

  const cardActions = useMemo<TaskCardActions>(
    () => ({
      openAreaContextMenu,
      onDragStart: cardDragStart,
      onDragEnd: cardDragEnd,
      onDragOver: cardDragOver,
      onDrop: cardDrop,
      toggleDone,
      toggleFolderExpand,
      toggleCardCollapse,
      loadFolder,
      onImageHover: handleImageHover,
      onImageLeave: handleImageLeave,
      cycleEffort,
      openTaskEditor,
      startRename: startRenameTask,
      commitRename: commitRenameTask,
      cancelRename: cancelRenameTask,
      startFocus: handleStartFocus,
      toggleStar,
      requestDelete: requestDeleteTask,
    }),
    [
      openAreaContextMenu,
      cardDragStart,
      cardDragEnd,
      cardDragOver,
      cardDrop,
      toggleDone,
      toggleFolderExpand,
      toggleCardCollapse,
      loadFolder,
      handleImageHover,
      handleImageLeave,
      cycleEffort,
      openTaskEditor,
      startRenameTask,
      commitRenameTask,
      cancelRenameTask,
      handleStartFocus,
      toggleStar,
      requestDeleteTask,
    ]
  );

  // Referentially stable action bundle passed to every KanbanColumn
  const beginColumnDrag = useCallback((e: React.DragEvent, colId: string) => {
    e.dataTransfer.setData("application/x-shibaplan-column", colId);
    e.dataTransfer.effectAllowed = "move";
    setDragColId(colId);
  }, []);

  const endColumnDrag = useCallback(() => {
    setDragColId(null);
    setDragOverColSlot(null);
  }, []);

  const hoverEnter = useCallback((colId: string) => {
    hoveredColIdRef.current = colId;
  }, []);

  const hoverLeave = useCallback((colId: string) => {
    if (hoveredColIdRef.current === colId) {
      hoveredColIdRef.current = null;
    }
  }, []);

  const columnDragOver = useStableCallback(
    (e: React.DragEvent<HTMLDivElement>, colId: string) => {
      e.preventDefault();
      if (
        layoutMode === "row" &&
        (dragColId ||
          e.dataTransfer.types.includes("application/x-shibaplan-column"))
      ) {
        const rect = e.currentTarget.getBoundingClientRect();
        const side: "left" | "right" =
          e.clientX > rect.left + rect.width / 2 ? "right" : "left";
        setDragOverColSlot((prev) =>
          prev && prev.colId === colId && prev.side === side
            ? prev
            : { colId, side }
        );
        return;
      }
      setDragOverColId((prev) => (prev === colId ? prev : colId));
    }
  );

  const columnDragLeave = useCallback((colId: string) => {
    setDragOverColId((prev) => (prev === colId ? null : prev));
    setDragOverColSlot((prev) => (prev?.colId === colId ? null : prev));
  }, []);

  const columnDrop = useStableCallback(
    (e: React.DragEvent<HTMLDivElement>, colId: string) => {
      e.preventDefault();
      if (
        layoutMode === "row" &&
        (dragColId || e.dataTransfer.getData("application/x-shibaplan-column"))
      ) {
        const rect = e.currentTarget.getBoundingClientRect();
        const side: "left" | "right" =
          e.clientX > rect.left + rect.width / 2 ? "right" : "left";
        handleColumnReorderDrop(e, colId, side);
        return;
      }
      handleDrop(e, colId);
    }
  );

  const openColumnHeaderMenu = useCallback(
    (e: React.MouseEvent, colId: string) => {
      e.preventDefault();
      const menuW = 176;
      const menuH = 220;
      const x = Math.min(e.clientX, window.innerWidth - menuW - 12);
      const y = Math.min(e.clientY, window.innerHeight - menuH - 12);
      setColContextMenu({ colId, x, y });
    },
    []
  );

  const cancelRenameColumn = useCallback(() => {
    setEditingColId(null);
  }, []);

  const startAddTask = useCallback((colId: string) => {
    setAddingTaskColId(colId);
    setDraftTaskTitle("");
  }, []);

  const cancelAddTask = useCallback(() => {
    setAddingTaskColId(null);
    setDraftTaskTitle("");
  }, []);

  const requestDeleteColumn = useCallback((col: BoardColumn) => {
    setConfirmDeleteCol(col);
  }, []);

  const columnActions = useMemo<KanbanColumnActions>(
    () => ({
      registerColumnRef,
      beginColumnDrag,
      endColumnDrag,
      startMoveColumnOnCanvas,
      toggleColumnCollapse,
      hoverEnter,
      hoverLeave,
      columnDragOver,
      columnDragLeave,
      columnDrop,
      startResizeFolderHeight,
      resetFolderHeight,
      startResizeColumn,
      resetColumnWidth,
      startResizeColumnGap,
      resetColumnGap,
      openColumnHeaderMenu,
      setEditingColTitle,
      commitRenameColumn: handleRenameColumn,
      cancelRenameColumn,
      startAddTask,
      setDraftTaskTitle,
      commitAddTask: handleAddTask,
      cancelAddTask,
      requestDeleteColumn,
    }),
    [
      registerColumnRef,
      beginColumnDrag,
      endColumnDrag,
      startMoveColumnOnCanvas,
      toggleColumnCollapse,
      hoverEnter,
      hoverLeave,
      columnDragOver,
      columnDragLeave,
      columnDrop,
      startResizeFolderHeight,
      resetFolderHeight,
      startResizeColumn,
      resetColumnWidth,
      startResizeColumnGap,
      resetColumnGap,
      openColumnHeaderMenu,
      handleRenameColumn,
      cancelRenameColumn,
      startAddTask,
      handleAddTask,
      cancelAddTask,
      requestDeleteColumn,
    ]
  );

  const ctxMenuTask = useMemo(() => {
    if (!areaContextMenu || areaContextMenu.kind !== "card") return null;
    return (
      workspace.tasks.find((item) => item.id === areaContextMenu.taskId) ?? null
    );
  }, [areaContextMenu, workspace.tasks]);

  const ctxMenuColumn = useMemo(() => {
    if (!colContextMenu) return null;
    return (
      workspace.columns.find((c) => c.id === colContextMenu.colId) ?? null
    );
  }, [colContextMenu, workspace.columns]);

  const renamingColId = useMemo(() => {
    if (!renamingTaskId) return null;
    return (
      workspace.tasks.find((item) => item.id === renamingTaskId)?.columnId ??
      null
    );
  }, [renamingTaskId, workspace.tasks]);

  const confirmDeleteColTaskCount = useMemo(() => {
    if (!confirmDeleteCol) return 0;
    return (tasksByColumn.get(confirmDeleteCol.id) ?? EMPTY_TASKS).length;
  }, [confirmDeleteCol, tasksByColumn]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Unified Linear View Sub-Toolbar */}
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border/70 bg-background px-3 sm:px-5">
        {activeTask ? (
          <div className="flex flex-1 items-center justify-between gap-3 rounded-md border border-primary/40 bg-card px-2.5 py-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className="h-2 w-2 shrink-0 rounded-full bg-primary animate-pulse" />
              <span className="truncate text-xs font-medium text-foreground">
                {activeTask.title}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <span className="flex items-center gap-1 font-mono text-xs font-semibold tabular-nums text-primary">
                <Clock className="h-3 w-3" />
                {formatClock(elapsedSeconds)}
              </span>
              <button
                onClick={() => setIsRunning((r) => !r)}
                className="rounded border border-border bg-secondary p-1 text-foreground hover:bg-accent"
                title={isRunning ? t("kanban.pause") : t("kanban.resume")}
              >
                {isRunning ? (
                  <Pause className="h-3 w-3" />
                ) : (
                  <Play className="h-3 w-3" />
                )}
              </button>
              <button
                onClick={() => commitFocus(activeTask, true)}
                className="rounded bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground hover:brightness-110"
              >
                {t("kanban.finish")}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center rounded-md border border-border bg-surface p-0.5">
            <button
              onClick={() => setBoardTab("all")}
              className={`flex h-6 items-center gap-1.5 rounded-[4px] px-2.5 text-xs font-medium transition-colors ${
                boardTab === "all"
                  ? "bg-accent text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title={t("kanban.tabAll")}
            >
              <Kanban className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("kanban.tabAll")}</span>
            </button>
            <button
              onClick={() => setBoardTab("done")}
              className={`flex h-6 items-center gap-1.5 rounded-[4px] px-2.5 text-xs font-medium transition-colors ${
                boardTab === "done"
                  ? "bg-accent text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title={t("kanban.tabDone")}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("kanban.tabDone")}</span>
            </button>
          </div>
        )}

        {boardTab === "all" && (
          <div className="flex items-center gap-2">
            {/* Layout Mode Switcher: Row vs Freeform Canvas */}
            <div className="flex items-center rounded-md border border-border bg-surface p-0.5">
              <button
                onClick={() => setLayoutMode("row")}
                className={`flex h-6 w-6 items-center justify-center rounded-[4px] transition-colors ${
                  layoutMode === "row"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                title="列表排布"
              >
                <Columns3 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setLayoutMode("canvas")}
                className={`flex h-6 w-6 items-center justify-center rounded-[4px] transition-colors ${
                  layoutMode === "canvas"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                title="自由画布 (Ctrl+滚轮缩放 / 空格拖动画布)"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="h-3.5 w-px bg-border" />

            <button
              onClick={() => setCreatingCol(true)}
              className="flex h-7 items-center gap-1 rounded-md border border-border bg-secondary/75 px-2.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-foreground"
              title={t("kanban.newColumn")}
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("kanban.newColumn")}</span>
            </button>
          </div>
        )}
      </div>

      {/* Main Board Content */}
      <div className="flex flex-1 flex-col overflow-hidden px-3 sm:px-5 py-3">

      {/* Dedicated Completed Tasks Tab View */}
      {boardTab === "done" ? (
        <DoneTasksView
          tasks={workspace.tasks}
          columnMap={columnMap}
          toggleDone={toggleDone}
          requestDelete={requestDeleteTask}
        />
      ) : workspace.columns.length === 0 && !creatingCol ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface/40 p-6 sm:p-8 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
            <Kanban className="h-5 w-5" />
          </div>
          <p className="mt-3 text-sm font-medium text-foreground">
            {t("kanban.emptyTitle")}
          </p>
          <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
            {t("kanban.emptyDesc")}
          </p>
          <button
            onClick={() => setCreatingCol(true)}
            className="mt-4 flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] transition hover:brightness-110"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("kanban.createFirst")}
          </button>
        </div>
      ) : (
        /* Row Layout OR Freeform Canvas Layout */
        <div
          ref={canvasRef}
          onMouseDown={startCanvasPan}
          onContextMenu={(e) => {
            if ((e.target as HTMLElement).closest("[data-board-column]")) return;
            openAreaContextMenu(e, { kind: "board" });
          }}
          style={
            layoutMode === "canvas"
              ? {
                  backgroundImage:
                    "radial-gradient(circle, rgba(161,161,170,0.16) 1px, transparent 1px)",
                  backgroundSize: `${Math.max(14, 24 * canvasZoom)}px ${Math.max(
                    14,
                    24 * canvasZoom
                  )}px`,
                  backgroundPosition: `${canvasPan.x}px ${canvasPan.y}px`,
                }
              : undefined
          }
          className={
            layoutMode === "canvas"
              ? `relative flex-1 overflow-hidden rounded-2xl ring-1 ring-white/[0.05] ${
                  isPanning
                    ? "cursor-grabbing"
                    : spacePressed
                    ? "cursor-grab"
                    : "cursor-default"
                }`
              : "flex flex-1 gap-3 sm:gap-4 overflow-x-auto overflow-y-hidden pb-1 snap-x snap-mandatory sm:snap-none"
          }
        >
          <div
            style={
              layoutMode === "canvas"
                ? {
                    transform: `translate3d(${canvasPan.x}px, ${canvasPan.y}px, 0) scale(${canvasZoom})`,
                    transformOrigin: "0 0",
                  }
                : undefined
            }
            className={
              layoutMode === "canvas"
                ? "relative h-full w-full"
                : "mx-auto flex shrink-0 items-stretch"
            }
          >
            {/* Smart Alignment Reference Guides in Canvas Mode */}
            {layoutMode === "canvas" &&
              snapGuides.vertical.map((gx, idx) => (
                <div
                  key={`vg-${idx}`}
                  style={{ left: gx, top: -2000, height: 6000 }}
                  className="pointer-events-none absolute z-40 w-px bg-shiba-400/70"
                />
              ))}
            {layoutMode === "canvas" &&
              snapGuides.horizontal.map((gy, idx) => (
                <div
                  key={`hg-${idx}`}
                  style={{ top: gy, left: -2000, width: 6000 }}
                  className="pointer-events-none absolute z-40 h-px bg-shiba-400/70"
                />
              ))}
            {workspace.columns.map((col, colIndex) => {
              const colTasks = tasksByColumn.get(col.id) ?? EMPTY_TASKS;
              const colWidth =
                resizingCol?.colId === col.id
                  ? resizingCol.width
                  : col.width ?? 288;
              const folderHeight =
                resizingFolderH?.colId === col.id
                  ? resizingFolderH.height
                  : col.collapsedHeight;
              const canvasX =
                layoutMode === "canvas"
                  ? movingCol?.colId === col.id
                    ? movingCol.x
                    : col.x ?? colIndex * 316
                  : null;
              const canvasY =
                layoutMode === "canvas"
                  ? movingCol?.colId === col.id
                    ? movingCol.y
                    : col.y ?? 0
                  : null;
              const insertSide =
                layoutMode === "row" &&
                dragOverColSlot?.colId === col.id &&
                dragColId !== col.id
                  ? dragOverColSlot.side
                  : null;
              const isEditingThisTitle = editingColId === col.id;
              const isAddingToThis = addingTaskColId === col.id;

              return (
                <KanbanColumn
                  key={col.id}
                  col={col}
                  colIndex={colIndex}
                  colTasks={colTasks}
                  layoutMode={layoutMode}
                  canvasX={canvasX}
                  canvasY={canvasY}
                  colWidth={colWidth}
                  folderHeight={folderHeight}
                  isDropTarget={dragOverColId === col.id}
                  isDraggingColumn={dragColId === col.id}
                  insertSide={insertSide}
                  isResizingWidth={resizingCol?.colId === col.id}
                  isResizingFolder={resizingFolderH?.colId === col.id}
                  isEditingTitle={isEditingThisTitle}
                  editingTitle={isEditingThisTitle ? editingColTitle : ""}
                  isAddingTask={isAddingToThis}
                  draftTaskTitle={isAddingToThis ? draftTaskTitle : ""}
                  activeColumnGap={
                    resizingGap?.colId === col.id
                      ? resizingGap.gap
                      : col.gapAfter ?? defaultColumnGap
                  }
                  isResizingGap={resizingGap?.colId === col.id}
                  activeTaskId={activeTaskId}
                  renamingTaskId={col.id === renamingColId ? renamingTaskId : null}
                  dragTaskId={dragTaskId}
                  dragOverSlot={dragOverSlot}
                  collapsedCards={collapsedCards}
                  expandedFolders={expandedFolders}
                  folderFiles={folderFiles}
                  loadingFolders={loadingFolders}
                  locale={locale}
                  t={stableT}
                  cardActions={cardActions}
                  actions={columnActions}
                />
              );
            })}

            {/* Create New Column Card */}
            {creatingCol ? (
              <form
                onSubmit={handleCreateColumn}
                className="flex h-fit w-72 shrink-0 flex-col gap-3 rounded-lg border border-border bg-card p-3.5 shadow-card-rest"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground">
                    新建看板列
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setCreatingCol(false);
                      setNewColTitle("");
                    }}
                    className="rounded-md p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                <input
                  autoFocus
                  type="text"
                  value={newColTitle}
                  onChange={(e) => setNewColTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setCreatingCol(false);
                      setNewColTitle("");
                    }
                  }}
                  placeholder="列名称（如：设计 / 开发 / 评测）"
                  className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/65 focus:border-primary/70 focus:outline-none focus:ring-1 focus:ring-primary/40"
                />

                <div className="flex items-center gap-2">
                  {COLUMN_COLORS.map((c) => (
                    <button
                      type="button"
                      key={c}
                      onClick={() => setNewColColor(c)}
                      style={{ backgroundColor: c }}
                      className={`h-4 w-4 rounded-full transition ${
                        newColColor === c
                          ? "ring-2 ring-foreground ring-offset-2 ring-offset-card"
                          : "opacity-55 hover:opacity-100"
                      }`}
                    />
                  ))}
                </div>

                <button
                  type="submit"
                  className="rounded-md bg-primary py-1.5 text-xs font-medium text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] hover:brightness-110"
                >
                  确认添加
                </button>
              </form>
            ) : (
              layoutMode === "row" && (
                <button
                  onClick={() => setCreatingCol(true)}
                  className="flex h-28 w-56 shrink-0 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:bg-surface/60 hover:text-foreground"
                >
                  <Plus className="h-4 w-4" />
                  {t("kanban.newColumn")}
                </button>
              )
            )}
          </div>

          {/* Floating Canvas Zoom & Tidy Controls */}
          {layoutMode === "canvas" && (
            <div className="absolute bottom-3 right-3 z-30 flex items-center gap-1 rounded-lg border border-border bg-popover/95 px-2 py-1 text-xs text-popover-foreground shadow-popover-soft backdrop-blur-md">
              <button
                type="button"
                onClick={tidyCanvasLayout}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                title="一键整齐排列"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => fitCanvasToScreen()}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                title="适配全屏 (居中查看所有列)"
              >
                <Scan className="h-3.5 w-3.5" />
              </button>
              <div className="mx-0.5 h-3.5 w-px bg-border" />
              <button
                type="button"
                onClick={() =>
                  setCanvasZoom((z) => Math.max(0.35, +(z - 0.1).toFixed(2)))
                }
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                title="缩小 (Ctrl + -)"
              >
                <Minus className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setCanvasZoom(1);
                  setCanvasPan({ x: 32, y: 24 });
                }}
                className="min-w-[40px] rounded px-1.5 py-0.5 font-mono text-foreground hover:bg-accent"
                title="重置缩放与视角 (Ctrl + 0)"
              >
                {Math.round(canvasZoom * 100)}%
              </button>
              <button
                type="button"
                onClick={() =>
                  setCanvasZoom((z) => Math.min(1.8, +(z + 0.1).toFixed(2)))
                }
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                title="放大 (Ctrl + +)"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Content Area Right-Click Context Menu (Card / Column Body / Board Background) */}
      {areaContextMenu && (
        <AreaContextMenu
          menu={areaContextMenu}
          ctxTask={ctxMenuTask}
          layoutMode={layoutMode}
          close={() => setAreaContextMenu(null)}
          startRenameTask={startRenameTask}
          openTaskEditor={openTaskEditor}
          startFocus={handleStartFocus}
          toggleStar={toggleStar}
          toggleDone={toggleDone}
          duplicateTask={duplicateTask}
          moveTaskToRiver={moveTaskToRiver}
          requestDeleteTask={requestDeleteTask}
          startAddTask={startAddTask}
          toggleColumnCollapse={toggleColumnCollapse}
          openColumnDisplayMenu={(colId, x, y) =>
            setColContextMenu({ colId, x, y })
          }
          startCreateColumn={() => setCreatingCol(true)}
          toggleLayoutMode={() =>
            setLayoutMode((m) => (m === "row" ? "canvas" : "row"))
          }
          setAllColumnsCollapsed={setAllColumnsCollapsed}
          tidyCanvasLayout={tidyCanvasLayout}
          fitCanvasToScreen={() => fitCanvasToScreen()}
          resetCanvasView={() => {
            setCanvasZoom(1);
            setCanvasPan({ x: 32, y: 24 });
          }}
        />
      )}

      {/* Column Header Right-Click Context Menu */}
      {colContextMenu && ctxMenuColumn && (
        <ColumnContextMenu
          column={ctxMenuColumn}
          x={colContextMenu.x}
          y={colContextMenu.y}
          toggleColumnDisplay={toggleColumnDisplay}
          startRename={(col) => {
            setEditingColId(col.id);
            setEditingColTitle(col.title);
          }}
          resetColumnWidth={resetColumnWidth}
          close={() => setColContextMenu(null)}
        />
      )}

      {/* Hover Large Image Preview */}
      {hoveredImage && (
        <div
          style={{ left: hoveredImage.x, top: hoveredImage.y }}
          className="pointer-events-none fixed z-50 rounded-2xl bg-[#18181b]/95 p-2 ring-1 ring-white/[0.15] shadow-2xl backdrop-blur-md"
        >
          <img
            src={hoveredImage.src}
            alt="large preview"
            className="max-h-[320px] max-w-[380px] rounded-xl object-contain"
          />
        </div>
      )}

      {/* Confirm Delete Card Modal */}
      <ConfirmDeleteTaskDialog
        task={confirmDeleteTask}
        onCancel={() => setConfirmDeleteTask(null)}
        onConfirm={(task) => deleteTask(task.id)}
      />

      {/* Confirm Delete Column Modal */}
      <ConfirmDeleteColumnDialog
        column={confirmDeleteCol}
        taskCount={confirmDeleteColTaskCount}
        onCancel={() => setConfirmDeleteCol(null)}
        onConfirm={(col) => handleDeleteColumn(col.id)}
      />

      {/* Card Time & Detail Editor Modal */}
      <TaskEditorDialog
        task={editingTask}
        onClose={closeTaskEditor}
        onSave={handleSaveTaskEdit}
      />
      </div>
    </div>
  );
};
