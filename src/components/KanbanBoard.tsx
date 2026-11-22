import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Columns3,
  Copy,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  GripVertical,
  Kanban,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Minus,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Scan,
  Star,
  Trash2,
  Waves,
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
  openPathInOs,
  savePastedImage,
  uid,
} from "../lib/storage";
import { useI18n } from "../lib/i18n";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

interface KanbanBoardProps {
  workspace: WorkspaceData;
  onUpdate: (next: WorkspaceData) => void;
}

const EFFORT_LABEL: Record<EffortSize, string> = {
  S: "30m",
  M: "1.5h",
  L: "3h",
};

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  workspace,
  onUpdate,
}) => {
  const { t } = useI18n();
  const [boardTab, setBoardTab] = useState<"all" | "done">("all");
  const [layoutMode, setLayoutMode] = useState<"row" | "canvas">("row");

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

  const toggleColumnCollapse = (colId: string) => {
    onUpdate({
      ...workspace,
      columns: workspace.columns.map((c) =>
        c.id === colId ? { ...c, collapsed: !c.collapsed } : c
      ),
    });
  };

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

  const handleCanvasWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (layoutMode !== "canvas") return;
    const insideColumnScroll = Boolean(
      (e.target as HTMLElement).closest("[data-column-scroll]")
    );
    // Zoom when Ctrl/Meta is held OR when wheeling on empty canvas area
    if (e.ctrlKey || e.metaKey || !insideColumnScroll) {
      e.preventDefault();
      const rect = canvasRef.current?.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.09 : 0.91;
      setCanvasZoom((prevZoom) => {
        const nextZoom = Math.min(
          1.8,
          Math.max(0.35, +(prevZoom * factor).toFixed(3))
        );
        if (rect && nextZoom !== prevZoom) {
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

  const startMoveColumnOnCanvas = (
    e: React.MouseEvent,
    col: BoardColumn,
    colIndex: number
  ) => {
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
  };

  // Add column state
  const [creatingCol, setCreatingCol] = useState(false);
  const [newColTitle, setNewColTitle] = useState("");
  const [newColColor, setNewColColor] = useState(COLUMN_COLORS[0]);

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

  const [areaContextMenu, setAreaContextMenu] = useState<
    | { kind: "card"; taskId: string; colId: string; x: number; y: number }
    | { kind: "column"; colId: string; x: number; y: number }
    | { kind: "board"; x: number; y: number }
    | null
  >(null);

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

  const openAreaContextMenu = (
    e: React.MouseEvent,
    menu:
      | { kind: "card"; taskId: string; colId: string }
      | { kind: "column"; colId: string }
      | { kind: "board" }
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setColContextMenu(null);
    const menuW = 184;
    const menuH = menu.kind === "card" ? 260 : 180;
    const x = Math.min(e.clientX, window.innerWidth - menuW - 12);
    const y = Math.min(e.clientY, window.innerHeight - menuH - 12);
    setAreaContextMenu({ ...menu, x, y });
  };

  const duplicateTask = (task: TaskItem) => {
    const copy: TaskItem = {
      ...task,
      id: uid("task"),
      title: `${task.title} (副本)`,
      status: "todo",
      actualMinutes: 0,
      completedAt: undefined,
      createdAt: new Date().toISOString(),
    };
    const idx = workspace.tasks.findIndex((item) => item.id === task.id);
    const nextTasks =
      idx >= 0
        ? [
            ...workspace.tasks.slice(0, idx + 1),
            copy,
            ...workspace.tasks.slice(idx + 1),
          ]
        : [copy, ...workspace.tasks];
    onUpdate({ ...workspace, tasks: nextTasks });
  };

  const moveTaskToRiver = (task: TaskItem) => {
    const colTitle =
      workspace.columns.find((c) => c.id === task.columnId)?.title ?? "灵感";
    const combined = task.notes
      ? task.notes.startsWith(task.title)
        ? task.notes
        : `${task.title}\n${task.notes}`
      : task.title;
    onUpdate({
      ...workspace,
      tasks: workspace.tasks.filter((item) => item.id !== task.id),
      ideas: [
        {
          id: uid("idea"),
          content: combined,
          tag: colTitle,
          imagePreview: task.imagePreview,
          imagePath: task.imagePath,
          createdAt: new Date().toISOString(),
        },
        ...workspace.ideas,
      ],
    });
  };

  const setAllColumnsCollapsed = (collapsed: boolean) => {
    onUpdate({
      ...workspace,
      columns: workspace.columns.map((c) => ({ ...c, collapsed })),
    });
  };

  // Freeform Canvas: Fit all columns cleanly into viewport
  const fitCanvasToScreen = (colsOverride?: BoardColumn[]) => {
    const cols = colsOverride ?? workspace.columns;
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
      const ch = columnRefs.current.get(c.id)?.offsetHeight ?? (c.collapsed ? 116 : 360);
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
    const nextZoom = Math.min(1.15, Math.max(0.35, +Math.min(scaleX, scaleY).toFixed(2)));
    const nextPanX = Math.round((rect.width - contentW * nextZoom) / 2 - minX * nextZoom);
    const nextPanY = Math.round((rect.height - contentH * nextZoom) / 2 - minY * nextZoom);

    setCanvasZoom(nextZoom);
    setCanvasPan({ x: nextPanX, y: nextPanY });
  };

  // Freeform Canvas: Auto-arrange columns into a crisp aligned grid
  const tidyCanvasLayout = () => {
    if (workspace.columns.length === 0) return;
    const perRow = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(workspace.columns.length))));
    const gapX = 28;
    const gapY = 28;
    let curX = 0;
    let curY = 0;
    let rowMaxH = 0;

    const tidied = workspace.columns.map((col, idx) => {
      const colInRow = idx % perRow;
      if (colInRow === 0 && idx > 0) {
        curX = 0;
        curY += rowMaxH + gapY;
        rowMaxH = 0;
      }
      const w = col.collapsed ? 224 : col.width ?? 288;
      const h = columnRefs.current.get(col.id)?.offsetHeight ?? (col.collapsed ? 116 : 340);
      const positioned: BoardColumn = { ...col, x: curX, y: curY };
      curX += w + gapX;
      rowMaxH = Math.max(rowMaxH, h);
      return positioned;
    });

    onUpdate({ ...workspace, columns: tidied });
    setTimeout(() => fitCanvasToScreen(tidied), 30);
  };

  const toggleColumnDisplay = (
    colId: string,
    key: keyof ColumnDisplayOptions
  ) => {
    onUpdate({
      ...workspace,
      columns: workspace.columns.map((c) => {
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
  };

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
  const [resizingGap, setResizingGap] = useState<number | null>(null);

  const activeColumnGap = resizingGap ?? workspace.settings.columnGap ?? 16;

  const startResizeColumnGap = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startGap = workspace.settings.columnGap ?? 16;
    let latestGap = startGap;
    setResizingGap(startGap);

    const onMove = (ev: MouseEvent) => {
      latestGap = Math.round(
        Math.min(64, Math.max(4, startGap + (ev.clientX - startX)))
      );
      setResizingGap(latestGap);
    };
    const onUp = () => {
      setResizingGap(null);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      onUpdateRef.current({
        ...workspaceRef.current,
        settings: {
          ...workspaceRef.current.settings,
          columnGap: latestGap,
        },
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const resetColumnGap = () => {
    onUpdate({
      ...workspace,
      settings: {
        ...workspace.settings,
        columnGap: 16,
      },
    });
  };

  const handleColumnReorderDrop = (
    e: React.DragEvent,
    targetColId: string,
    side: "left" | "right"
  ) => {
    const sourceId =
      dragColId || e.dataTransfer.getData("application/x-shibaplan-column");
    setDragColId(null);
    setDragOverColSlot(null);
    if (!sourceId || sourceId === targetColId) return;

    const dragged = workspace.columns.find((c) => c.id === sourceId);
    if (!dragged) return;
    const remaining = workspace.columns.filter((c) => c.id !== sourceId);
    const idx = remaining.findIndex((c) => c.id === targetColId);
    if (idx < 0) return;
    const insertAt = side === "right" ? idx + 1 : idx;
    const nextColumns = [
      ...remaining.slice(0, insertAt),
      dragged,
      ...remaining.slice(insertAt),
    ];
    onUpdate({
      ...workspace,
      columns: nextColumns,
    });
  };

  const startResizeFolderHeight = (
    e: React.MouseEvent,
    col: BoardColumn
  ) => {
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
  };

  const resetFolderHeight = (colId: string) => {
    onUpdate({
      ...workspace,
      columns: workspace.columns.map((c) =>
        c.id === colId ? { ...c, collapsedHeight: undefined } : c
      ),
    });
  };

  const startResizeColumn = (
    e: React.MouseEvent,
    col: BoardColumn
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = col.width ?? 288;
    let latestW = startW;
    setResizingCol({ colId: col.id, width: startW });

    const onMove = (ev: MouseEvent) => {
      latestW = Math.round(Math.min(640, Math.max(220, startW + (ev.clientX - startX))));
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
  };

  const resetColumnWidth = (colId: string) => {
    onUpdate({
      ...workspace,
      columns: workspace.columns.map((c) =>
        c.id === colId ? { ...c, width: undefined } : c
      ),
    });
  };

  // Inline add task state
  const [addingTaskColId, setAddingTaskColId] = useState<string | null>(null);
  const [draftTaskTitle, setDraftTaskTitle] = useState("");

  // Drag & Drop state
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<{
    taskId: string;
    position: "before" | "after";
  } | null>(null);
  const [hoveredColId, setHoveredColId] = useState<string | null>(null);

  // Column DOM refs for native OS folder drop hit-testing
  const columnRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const workspaceRef = useRef(workspace);
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    workspaceRef.current = workspace;
    onUpdateRef.current = onUpdate;
  }, [workspace, onUpdate]);

  // Folder shortcut expand/collapse & cached file entries
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [folderFiles, setFolderFiles] = useState<Record<string, FolderEntry[]>>({});
  const [loadingFolders, setLoadingFolders] = useState<Record<string, boolean>>({});

  // Compact card collapse state & hover large image preview
  const [collapsedCards, setCollapsedCards] = useState<Record<string, boolean>>({});
  const [hoveredImage, setHoveredImage] = useState<{
    src: string;
    x: number;
    y: number;
  } | null>(null);

  const toggleCardCollapse = (taskId: string) => {
    setCollapsedCards((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  };

  const handleImageHover = (
    src: string,
    e: React.MouseEvent<HTMLImageElement>
  ) => {
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
  };

  const loadFolder = async (taskId: string, folderPath: string) => {
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
  };

  const toggleFolderExpand = (task: TaskItem) => {
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
  };

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

  // Schedule / Edit card modal state
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editStartTime, setEditStartTime] = useState("");
  const [editImagePreview, setEditImagePreview] = useState<string | undefined>(
    undefined
  );

  const openTaskEditor = (task: TaskItem) => {
    setEditingTaskId(task.id);
    setEditTitle(task.title);
    setEditNotes(task.notes ?? "");
    setEditDueDate(task.dueDate ?? "");
    setEditStartTime(task.startTime ?? "");
    setEditImagePreview(task.imagePreview);
  };

  // Hover-to-paste: when mouse hovers a column and user presses Ctrl+V, insert & open editor
  useEffect(() => {
    const onWindowPaste = async (e: ClipboardEvent) => {
      if (!hoveredColId || editingTaskId || creatingCol || addingTaskColId) {
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
            const savedPath = await savePastedImage(
              reader.result,
              ext,
              workspace.settings.customDataDir
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
            onUpdate({
              ...workspace,
              tasks: [newTask, ...workspace.tasks],
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
        onUpdate({
          ...workspace,
          tasks: [folderTask, ...workspace.tasks],
        });
        return;
      }

      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const firstLine = (lines[0] ?? text).slice(0, 80);
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
      onUpdate({
        ...workspace,
        tasks: [newTask, ...workspace.tasks],
      });
      openTaskEditor(newTask);
    };

    window.addEventListener("paste", onWindowPaste);
    return () => window.removeEventListener("paste", onWindowPaste);
  }, [hoveredColId, editingTaskId, creatingCol, addingTaskColId, workspace, onUpdate]);

  const handleSaveTaskEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTaskId || !editTitle.trim()) return;
    onUpdate({
      ...workspace,
      tasks: workspace.tasks.map((t) =>
        t.id === editingTaskId
          ? {
              ...t,
              title: editTitle.trim(),
              notes: editNotes.trim() || undefined,
              dueDate: editDueDate || undefined,
              startTime: editStartTime || undefined,
              imagePreview: editImagePreview,
            }
          : t
      ),
    });
    setEditingTaskId(null);
  };

  const setQuickDateOffset = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    setEditDueDate(`${y}-${m}-${day}`);
  };

  const formatShortDate = (dateStr: string) => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    if (dateStr === todayStr) return "今天";
    return dateStr.slice(5).replace("-", "/");
  };

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

  const handleCreateColumn = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const title = newColTitle.trim();
    if (!title) {
      setCreatingCol(false);
      return;
    }
    const nextCol: BoardColumn = {
      id: uid("col"),
      title,
      color: newColColor,
    };
    onUpdate({
      ...workspace,
      columns: [...workspace.columns, nextCol],
    });
    setNewColTitle("");
    setNewColColor(
      COLUMN_COLORS[(workspace.columns.length + 1) % COLUMN_COLORS.length]
    );
    setCreatingCol(false);
  };

  const handleRenameColumn = (colId: string) => {
    const title = editingColTitle.trim();
    if (title) {
      onUpdate({
        ...workspace,
        columns: workspace.columns.map((c) =>
          c.id === colId ? { ...c, title } : c
        ),
      });
    }
    setEditingColId(null);
  };

  const handleDeleteColumn = (colId: string) => {
    onUpdate({
      ...workspace,
      columns: workspace.columns.filter((c) => c.id !== colId),
      tasks: workspace.tasks.filter((t) => t.columnId !== colId),
    });
  };

  const handleAddTask = (colId: string) => {
    const title = draftTaskTitle.trim();
    if (!title) {
      setAddingTaskColId(null);
      return;
    }
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
    onUpdate({
      ...workspace,
      tasks: [newTask, ...workspace.tasks],
    });
    setDraftTaskTitle("");
    setAddingTaskColId(null);
  };

  const commitFocus = (task: TaskItem, markDone: boolean) => {
    const addedMinutes =
      elapsedSeconds > 10 ? Math.max(1, Math.round(elapsedSeconds / 60)) : 0;
    const now = new Date().toISOString();

    const updatedTasks = workspace.tasks.map((t) =>
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
            ...workspace.focusLogs,
          ]
        : workspace.focusLogs;

    onUpdate({
      ...workspace,
      tasks: updatedTasks,
      focusLogs: nextLogs,
    });
    setElapsedSeconds(0);
    setIsRunning(false);
    if (markDone) setActiveTaskId(null);
  };

  const handleStartFocus = (task: TaskItem) => {
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
      onUpdate({
        ...workspace,
        tasks: workspace.tasks.map((t) =>
          t.id === task.id ? { ...t, status: "in_progress" } : t
        ),
      });
    }
  };

  const toggleDone = (task: TaskItem) => {
    if (activeTaskId === task.id && task.status !== "done") {
      commitFocus(task, true);
      return;
    }
    const nextDone = task.status !== "done";
    onUpdate({
      ...workspace,
      tasks: workspace.tasks.map((t) =>
        t.id === task.id
          ? {
              ...t,
              status: nextDone ? "done" : "todo",
              completedAt: nextDone ? new Date().toISOString() : undefined,
            }
          : t
      ),
    });
  };

  const toggleStar = (task: TaskItem) => {
    onUpdate({
      ...workspace,
      tasks: workspace.tasks.map((t) =>
        t.id === task.id ? { ...t, importance: t.importance === 3 ? 2 : 3 } : t
      ),
    });
  };

  const cycleEffort = (task: TaskItem) => {
    const order: EffortSize[] = ["S", "M", "L"];
    const nextEffort = order[(order.indexOf(task.effort) + 1) % order.length];
    onUpdate({
      ...workspace,
      tasks: workspace.tasks.map((t) =>
        t.id === task.id
          ? {
              ...t,
              effort: nextEffort,
              estimatedMinutes: EFFORT_MINUTES[nextEffort],
            }
          : t
      ),
    });
  };

  const deleteTask = (id: string) => {
    onUpdate({
      ...workspace,
      tasks: workspace.tasks.filter((t) => t.id !== id),
    });
    if (activeTaskId === id) {
      setActiveTaskId(null);
      setIsRunning(false);
      setElapsedSeconds(0);
    }
  };

  const handleDrop = (
    e: React.DragEvent,
    targetColId: string,
    targetTaskId?: string,
    position: "before" | "after" = "before"
  ) => {
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
          if (item.kind === "file" && typeof item.webkitGetAsEntry === "function") {
            const entry = item.webkitGetAsEntry();
            if (entry) entries.push(entry);
          }
        }
      }

      const fileList = Array.from(dtFiles || []);
      const processDroppedItems = async () => {
        const ws = workspaceRef.current;
        const created: TaskItem[] = [];

        if (entries.length > 0) {
          for (const entry of entries) {
            if (entry.isDirectory) {
              const dirEntry = entry as FileSystemDirectoryEntry;
              const reader = dirEntry.createReader();
              const childEntries = await new Promise<FolderEntry[]>((resolve) => {
                reader.readEntries(
                  (list) => {
                    const mapped = list
                      .filter(
                        (c) =>
                          c.name !== ".DS_Store" &&
                          c.name !== "Thumbs.db" &&
                          c.name !== "desktop.ini"
                      )
                      .map((c) => ({
                        name: c.name,
                        path: c.fullPath || c.name,
                        is_dir: c.isDirectory,
                      }))
                      .sort((a, b) =>
                        a.is_dir === b.is_dir
                          ? a.name.localeCompare(b.name)
                          : a.is_dir
                          ? -1
                          : 1
                      );
                    resolve(mapped);
                  },
                  () => resolve([])
                );
              });
              created.push({
                id: uid("task"),
                title: entry.name,
                notes: entry.fullPath || entry.name,
                columnId: targetColId,
                folderPath: entry.fullPath || entry.name,
                cachedFiles: childEntries,
                importance: 2,
                effort: "S",
                estimatedMinutes: EFFORT_MINUTES.S,
                actualMinutes: 0,
                status: "todo",
                createdAt: new Date().toISOString(),
              });
            } else {
              const fileEntry = entry as FileSystemFileEntry;
              const fileObj = await new Promise<File | null>((resolve) =>
                fileEntry.file(
                  (f) => resolve(f),
                  () => resolve(null)
                )
              );
              let imgPreview: string | undefined;
              if (fileObj && fileObj.type.startsWith("image/")) {
                imgPreview = await new Promise<string | undefined>((resolve) => {
                  const r = new FileReader();
                  r.onload = () =>
                    resolve(typeof r.result === "string" ? r.result : undefined);
                  r.onerror = () => resolve(undefined);
                  r.readAsDataURL(fileObj);
                });
              }
              created.push({
                id: uid("task"),
                title: entry.name,
                notes: entry.fullPath || entry.name,
                columnId: targetColId,
                filePath: entry.fullPath || entry.name,
                imagePreview: imgPreview,
                importance: 2,
                effort: "S",
                estimatedMinutes: EFFORT_MINUTES.S,
                actualMinutes: 0,
                status: "todo",
                createdAt: new Date().toISOString(),
              });
            }
          }
        } else if (fileList.length > 0) {
          for (const f of fileList) {
            let imgPreview: string | undefined;
            if (f.type.startsWith("image/")) {
              imgPreview = await new Promise<string | undefined>((resolve) => {
                const r = new FileReader();
                r.onload = () =>
                  resolve(typeof r.result === "string" ? r.result : undefined);
                r.onerror = () => resolve(undefined);
                r.readAsDataURL(f);
              });
            }
            created.push({
              id: uid("task"),
              title: f.name,
              columnId: targetColId,
              filePath: f.name,
              imagePreview: imgPreview,
              importance: 2,
              effort: "S",
              estimatedMinutes: EFFORT_MINUTES.S,
              actualMinutes: 0,
              status: "todo",
              createdAt: new Date().toISOString(),
            });
          }
        }

        if (created.length > 0) {
          onUpdateRef.current({
            ...ws,
            tasks: [...created, ...ws.tasks],
          });
        }
      };

      processDroppedItems();
      setDragTaskId(null);
      setDragOverColId(null);
      setDragOverSlot(null);
      return;
    }

    // 1. Check if an Idea card was dragged from IdeaRiver
    const draggedIdeaId = e.dataTransfer.getData("application/x-shibaplan-idea");
    if (draggedIdeaId) {
      const idea = workspace.ideas.find((i) => i.id === draggedIdeaId);
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
          const idx = workspace.tasks.findIndex((t) => t.id === targetTaskId);
          const insertAt = position === "after" ? idx + 1 : idx;
          nextTasks =
            idx >= 0
              ? [
                  ...workspace.tasks.slice(0, insertAt),
                  newTask,
                  ...workspace.tasks.slice(insertAt),
                ]
              : [newTask, ...workspace.tasks];
        } else {
          nextTasks = [newTask, ...workspace.tasks];
        }

        onUpdate({
          ...workspace,
          tasks: nextTasks,
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
    const dragged = workspace.tasks.find((t) => t.id === activeDragId);
    if (!dragged) return;

    const remaining = workspace.tasks.filter((t) => t.id !== activeDragId);
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

    onUpdate({
      ...workspace,
      tasks: nextTasks,
    });
    setDragTaskId(null);
    setDragOverColId(null);
    setDragOverSlot(null);
  };

  const formatClock = (sec: number) => {
    const m = Math.floor(sec / 60)
      .toString()
      .padStart(2, "0");
    const s = (sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const doneCount = workspace.tasks.filter((t) => t.status === "done").length;

  return (
    <div className="flex h-full flex-col overflow-hidden px-3 sm:px-5 py-2.5 sm:py-3">
      {/* Ultra-Minimal Top Bar */}
      <div className="mb-2.5 flex items-center justify-between gap-2 shrink-0">
        {activeTask ? (
          <div className="flex flex-1 items-center justify-between gap-3 rounded-xl bg-[#18181b] px-3 py-1.5 ring-1 ring-shiba-500/30">
            <div className="flex items-center gap-2 min-w-0">
              <span className="h-2 w-2 shrink-0 rounded-full bg-shiba-400 animate-pulse" />
              <span className="truncate text-xs font-medium text-zinc-100">
                {activeTask.title}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <span className="flex items-center gap-1 font-mono text-xs font-semibold text-shiba-400">
                <Clock className="h-3 w-3" />
                {formatClock(elapsedSeconds)}
              </span>
              <button
                onClick={() => setIsRunning((r) => !r)}
                className="rounded-md bg-white/[0.06] p-1 text-zinc-200 hover:bg-white/[0.12]"
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
                className="rounded-md bg-shiba-500 px-2 py-1 text-[11px] font-semibold text-zinc-950 hover:bg-shiba-400"
              >
                {t("kanban.finish")}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center rounded-lg bg-white/[0.04] p-0.5 ring-1 ring-white/[0.05]">
            <button
              onClick={() => setBoardTab("all")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                boardTab === "all"
                  ? "bg-[#232328] text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
              title={t("kanban.tabAll")}
            >
              <Kanban className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("kanban.tabAll")}</span>
            </button>
            <button
              onClick={() => setBoardTab("done")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                boardTab === "done"
                  ? "bg-[#232328] text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
              title={t("kanban.tabDone")}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("kanban.tabDone")}</span>
            </button>
          </div>
        )}

        {boardTab === "all" && (
          <div className="flex items-center gap-1.5">
            {/* Layout Mode Switcher: Row vs Freeform Canvas */}
            <div className="flex items-center rounded-lg bg-white/[0.04] p-0.5 ring-1 ring-white/[0.05]">
              <button
                onClick={() => setLayoutMode("row")}
                className={`rounded-md p-1.5 transition ${
                  layoutMode === "row"
                    ? "bg-[#232328] text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
                title="列表排布"
              >
                <Columns3 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setLayoutMode("canvas")}
                className={`rounded-md p-1.5 transition ${
                  layoutMode === "canvas"
                    ? "bg-[#232328] text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
                title="自由画布 (Ctrl+滚轮缩放 / 空格拖动画布)"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
            </div>

            <button
              onClick={() => setCreatingCol(true)}
              className="flex items-center gap-1 rounded-lg bg-white/[0.05] px-2.5 py-1.5 text-xs text-zinc-300 transition hover:bg-white/[0.1] hover:text-zinc-100"
              title={t("kanban.newColumn")}
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("kanban.newColumn")}</span>
            </button>
          </div>
        )}
      </div>

      {/* Dedicated Completed Tasks Tab View */}
      {boardTab === "done" ? (
        <div className="flex-1 overflow-y-auto">
          {doneCount === 0 ? (
            <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.07] bg-[#151518]/50 p-8 text-center">
              <CheckCircle2 className="h-6 w-6 text-zinc-600" />
              <p className="mt-2.5 text-xs text-zinc-500">
                {t("kanban.noDoneTasks")}
              </p>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-2 pb-4">
              {workspace.tasks
                .filter((task) => task.status === "done")
                .sort((a, b) =>
                  (b.completedAt ?? b.createdAt).localeCompare(
                    a.completedAt ?? a.createdAt
                  )
                )
                .map((task) => {
                  const col = columnMap.get(task.columnId);
                  return (
                    <div
                      key={task.id}
                      className="group flex items-center justify-between gap-3 rounded-xl bg-[#161619] px-4 py-3 ring-1 ring-white/[0.05] transition hover:bg-[#1a1a1f]"
                    >
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-zinc-400 line-through">
                            {task.title}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                            {col && (
                              <span className="flex items-center gap-1">
                                <span
                                  className="h-1.5 w-1.5 rounded-full opacity-70"
                                  style={{ backgroundColor: col.color }}
                                />
                                {col.title}
                              </span>
                            )}
                            {task.completedAt && (
                              <span>
                                {t("kanban.completedAt")}{" "}
                                {new Date(task.completedAt).toLocaleString(
                                  "zh-CN",
                                  {
                                    month: "2-digit",
                                    day: "2-digit",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  }
                                )}
                              </span>
                            )}
                            {task.actualMinutes > 0 && (
                              <span>
                                {t("kanban.usedMinutes")} {task.actualMinutes}m
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => toggleDone(task)}
                          className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/[0.08] hover:text-shiba-400"
                          title={t("kanban.restoreTodo")}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setConfirmDeleteTask(task)}
                          className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/[0.08] hover:text-rose-400"
                          title={t("common.delete")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      ) : workspace.columns.length === 0 && !creatingCol ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.07] bg-[#151518]/50 p-6 sm:p-8 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.05] text-zinc-400">
            <Kanban className="h-5 w-5" />
          </div>
          <p className="mt-3 text-sm font-medium text-zinc-200">
            {t("kanban.emptyTitle")}
          </p>
          <p className="mt-1 max-w-xs text-xs leading-relaxed text-zinc-500">
            {t("kanban.emptyDesc")}
          </p>
          <button
            onClick={() => setCreatingCol(true)}
            className="mt-4 flex items-center gap-1.5 rounded-xl bg-shiba-500 px-4 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-shiba-400"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("kanban.createFirst")}
          </button>
        </div>
      ) : (
        /* Row Layout OR Freeform Canvas Layout */
        <div
          ref={canvasRef}
          onWheel={handleCanvasWheel}
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
                : "flex flex-1 items-stretch"
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
            const colTasks = workspace.tasks.filter(
              (tItem) => tItem.columnId === col.id
            );
            const pendingCount = colTasks.filter(
              (tItem) => tItem.status !== "done"
            ).length;
            const colDoneCount = colTasks.length - pendingCount;
            const estMinutes = colTasks
              .filter((tItem) => tItem.status !== "done")
              .reduce((sum, item) => sum + item.estimatedMinutes, 0);
            const isDropTarget = dragOverColId === col.id;

            const colWidth =
              resizingCol?.colId === col.id
                ? resizingCol.width
                : col.width ?? 288;

            const canvasPos =
              layoutMode === "canvas"
                ? movingCol?.colId === col.id
                  ? { x: movingCol.x, y: movingCol.y }
                  : { x: col.x ?? colIndex * 316, y: col.y ?? 0 }
                : null;

            /* Folder-Style Collapsed Column View */
            if (col.collapsed) {
              const progress =
                colTasks.length === 0
                  ? 0
                  : Math.round((colDoneCount / colTasks.length) * 100);
              const folderHeight =
                resizingFolderH?.colId === col.id
                  ? resizingFolderH.height
                  : col.collapsedHeight;
              const showLeftInsert =
                layoutMode === "row" &&
                dragOverColSlot?.colId === col.id &&
                dragOverColSlot.side === "left" &&
                dragColId !== col.id;
              const showRightInsert =
                layoutMode === "row" &&
                dragOverColSlot?.colId === col.id &&
                dragOverColSlot.side === "right" &&
                dragColId !== col.id;

              return (
                <React.Fragment key={col.id}>
                <div
                  data-board-column="true"
                  draggable={layoutMode === "row"}
                  onDragStart={(e) => {
                    if (layoutMode !== "row") return;
                    e.dataTransfer.setData("application/x-shibaplan-column", col.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragColId(col.id);
                  }}
                  onDragEnd={() => {
                    setDragColId(null);
                    setDragOverColSlot(null);
                  }}
                  ref={(el) => {
                    if (el) columnRefs.current.set(col.id, el);
                    else columnRefs.current.delete(col.id);
                  }}
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
                  onMouseDown={(e) =>
                    startMoveColumnOnCanvas(e, col, colIndex)
                  }
                  onDoubleClick={(e) => {
                    if ((e.target as HTMLElement).closest("[data-folder-resize]")) {
                      return;
                    }
                    toggleColumnCollapse(col.id);
                  }}
                  onMouseEnter={() => setHoveredColId(col.id)}
                  onMouseLeave={() => {
                    if (hoveredColId === col.id) setHoveredColId(null);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (
                      layoutMode === "row" &&
                      (dragColId ||
                        e.dataTransfer.types.includes(
                          "application/x-shibaplan-column"
                        ))
                    ) {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const side =
                        e.clientX > rect.left + rect.width / 2
                          ? "right"
                          : "left";
                      setDragOverColSlot({ colId: col.id, side });
                      return;
                    }
                    setDragOverColId(col.id);
                  }}
                  onDragLeave={() => {
                    if (dragOverColId === col.id) setDragOverColId(null);
                    if (dragOverColSlot?.colId === col.id) {
                      setDragOverColSlot(null);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (
                      layoutMode === "row" &&
                      (dragColId ||
                        e.dataTransfer.getData("application/x-shibaplan-column"))
                    ) {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const side =
                        e.clientX > rect.left + rect.width / 2
                          ? "right"
                          : "left";
                      handleColumnReorderDrop(e, col.id, side);
                      return;
                    }
                    handleDrop(e, col.id);
                  }}
                  className={`group/folder relative flex w-56 shrink-0 flex-col justify-between gap-2.5 rounded-2xl p-3.5 transition-all duration-200 ${
                    folderHeight ? "" : "h-fit"
                  } ${
                    dragColId === col.id ? "opacity-40 scale-[0.98]" : ""
                  } ${
                    layoutMode === "canvas" ? "cursor-move" : "cursor-grab active:cursor-grabbing"
                  } ${
                    isDropTarget
                      ? "bg-[#23211b] shadow-[0_8px_24px_rgba(245,158,11,0.14)]"
                      : "bg-[#17171b] shadow-[0_2px_10px_rgba(0,0,0,0.22)] hover:bg-[#1e1e24] hover:shadow-[0_6px_18px_rgba(0,0,0,0.34)]"
                  }`}
                >
                  {showLeftInsert && (
                    <div className="pointer-events-none absolute -left-1.5 bottom-2 top-2 z-30 w-0.5 rounded-full bg-shiba-400" />
                  )}
                  {showRightInsert && (
                    <div className="pointer-events-none absolute -right-1.5 bottom-2 top-2 z-30 w-0.5 rounded-full bg-shiba-400" />
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Folder
                        className="h-4 w-4 shrink-0"
                        style={{ color: col.color }}
                      />
                      <span className="truncate text-xs font-semibold text-zinc-100">
                        {col.title}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleColumnCollapse(col.id)}
                      className="rounded-md p-1 text-zinc-400 transition hover:bg-white/[0.08] hover:text-zinc-100"
                      title="展开看板列"
                    >
                      <Maximize2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    <div className="flex items-end justify-between gap-2">
                      <div className="flex items-baseline gap-3">
                        <div>
                          <div className="font-mono text-2xl font-semibold leading-none tabular-nums tracking-tight text-zinc-100">
                            {pendingCount}
                          </div>
                          <div className="mt-1 text-[10px] text-zinc-500">
                            待办
                          </div>
                        </div>

                        <div className="h-6 w-px bg-white/[0.06]" />

                        <div>
                          <div className="font-mono text-lg font-medium leading-none tabular-nums text-zinc-400">
                            {colDoneCount}
                          </div>
                          <div className="mt-1 text-[10px] text-zinc-500">
                            完成
                          </div>
                        </div>
                      </div>

                      {estMinutes > 0 && (
                        <div className="text-right">
                          <div className="font-mono text-sm font-medium leading-none tabular-nums text-zinc-300">
                            {(estMinutes / 60).toFixed(1)}h
                          </div>
                          <div className="mt-1 text-[10px] text-zinc-500">
                            预估
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
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
                    onMouseDown={(e) => startResizeFolderHeight(e, col)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      resetFolderHeight(col.id);
                    }}
                    className="group/fresize absolute bottom-0 left-3 right-3 z-20 flex h-2.5 cursor-row-resize items-center justify-center"
                    title="上下拖动调整高度，双击恢复默认"
                  >
                    <div
                      className={`h-0.5 rounded-full transition ${
                        resizingFolderH?.colId === col.id
                          ? "w-16 bg-shiba-400"
                          : "w-8 bg-transparent group-hover/fresize:bg-shiba-400/70"
                      }`}
                    />
                  </div>
                </div>
                {layoutMode === "row" && (
                  <div
                    onMouseDown={startResizeColumnGap}
                    onDoubleClick={resetColumnGap}
                    style={{ width: activeColumnGap }}
                    className="group/gap relative flex shrink-0 cursor-col-resize items-center justify-center"
                    title="左右拖动调整看板间距，双击恢复默认"
                  >
                    <div
                      className={`h-12 w-0.5 rounded-full transition ${
                        resizingGap !== null
                          ? "h-24 bg-shiba-400"
                          : "bg-transparent group-hover/gap:bg-shiba-400/60"
                      }`}
                    />
                    {resizingGap !== null && (
                      <span className="pointer-events-none absolute top-2 rounded bg-[#1c1c21] px-1 py-0.5 font-mono text-[10px] text-shiba-400 shadow">
                        {activeColumnGap}
                      </span>
                    )}
                  </div>
                )}
                </React.Fragment>
              );
            }

            const showLeftInsert =
              layoutMode === "row" &&
              dragOverColSlot?.colId === col.id &&
              dragOverColSlot.side === "left" &&
              dragColId !== col.id;
            const showRightInsert =
              layoutMode === "row" &&
              dragOverColSlot?.colId === col.id &&
              dragOverColSlot.side === "right" &&
              dragColId !== col.id;

            return (
              <React.Fragment key={col.id}>
              <div
                data-board-column="true"
                ref={(el) => {
                  if (el) columnRefs.current.set(col.id, el);
                  else columnRefs.current.delete(col.id);
                }}
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
                          typeof window !== "undefined" &&
                          window.innerWidth < 640
                            ? undefined
                            : colWidth,
                      }
                }
                onMouseEnter={() => setHoveredColId(col.id)}
                onMouseLeave={() => {
                  if (hoveredColId === col.id) setHoveredColId(null);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (
                    layoutMode === "row" &&
                    (dragColId ||
                      e.dataTransfer.types.includes(
                        "application/x-shibaplan-column"
                      ))
                  ) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const side =
                      e.clientX > rect.left + rect.width / 2
                        ? "right"
                        : "left";
                    setDragOverColSlot({ colId: col.id, side });
                    return;
                  }
                  setDragOverColId(col.id);
                }}
                onDragLeave={() => {
                  if (dragOverColId === col.id) setDragOverColId(null);
                  if (dragOverColSlot?.colId === col.id) {
                    setDragOverColSlot(null);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (
                    layoutMode === "row" &&
                    (dragColId ||
                      e.dataTransfer.getData("application/x-shibaplan-column"))
                  ) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const side =
                      e.clientX > rect.left + rect.width / 2
                        ? "right"
                        : "left";
                    handleColumnReorderDrop(e, col.id, side);
                    return;
                  }
                  handleDrop(e, col.id);
                }}
                className={`relative flex w-[84vw] sm:w-auto shrink-0 snap-center flex-col overflow-hidden rounded-2xl p-3 transition-all duration-200 ${
                  dragColId === col.id ? "opacity-40 scale-[0.98]" : ""
                } ${
                  isDropTarget
                    ? "bg-[#1d1d22] shadow-[0_8px_26px_rgba(0,0,0,0.38)]"
                    : layoutMode === "canvas"
                    ? "bg-[#16161a] shadow-[0_8px_28px_rgba(0,0,0,0.36)]"
                    : "bg-[#16161a] shadow-[0_2px_10px_rgba(0,0,0,0.18)]"
                }`}
              >
                {showLeftInsert && (
                  <div className="pointer-events-none absolute -left-1.5 bottom-3 top-3 z-30 w-0.5 rounded-full bg-shiba-400" />
                )}
                {showRightInsert && (
                  <div className="pointer-events-none absolute -right-1.5 bottom-3 top-3 z-30 w-0.5 rounded-full bg-shiba-400" />
                )}
                {/* Right-edge Drag Resize Handle */}
                <div
                  onMouseDown={(e) => startResizeColumn(e, col)}
                  onDoubleClick={() => resetColumnWidth(col.id)}
                  className="group/resize absolute bottom-3 right-0 top-3 z-20 hidden w-2 cursor-col-resize items-center justify-center sm:flex"
                  title="左右拖动调整列宽，双击恢复默认"
                >
                  <div
                    className={`h-10 w-0.5 rounded-full transition ${
                      resizingCol?.colId === col.id
                        ? "bg-shiba-400 h-20"
                        : "bg-transparent group-hover/resize:bg-shiba-400/70"
                    }`}
                  />
                </div>
                {/* Column Header (Drag to reorder in Row mode / reposition in Canvas mode; Double-click to fold) */}
                <div
                  draggable={layoutMode === "row" && editingColId !== col.id}
                  onDragStart={(e) => {
                    if (layoutMode !== "row") return;
                    e.stopPropagation();
                    e.dataTransfer.setData(
                      "application/x-shibaplan-column",
                      col.id
                    );
                    e.dataTransfer.effectAllowed = "move";
                    setDragColId(col.id);
                  }}
                  onDragEnd={() => {
                    setDragColId(null);
                    setDragOverColSlot(null);
                  }}
                  onMouseDown={(e) =>
                    startMoveColumnOnCanvas(e, col, colIndex)
                  }
                  onDoubleClick={(e) => {
                    if ((e.target as HTMLElement).closest("button, input")) {
                      return;
                    }
                    toggleColumnCollapse(col.id);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    const menuW = 176;
                    const menuH = 220;
                    const x = Math.min(e.clientX, window.innerWidth - menuW - 12);
                    const y = Math.min(e.clientY, window.innerHeight - menuH - 12);
                    setColContextMenu({ colId: col.id, x, y });
                  }}
                  className={`group/col mb-2.5 flex items-center justify-between gap-2 px-1 select-none ${
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
                    {editingColId === col.id ? (
                      <input
                        autoFocus
                        value={editingColTitle}
                        onChange={(e) => setEditingColTitle(e.target.value)}
                        onBlur={() => handleRenameColumn(col.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRenameColumn(col.id);
                          if (e.key === "Escape") setEditingColId(null);
                        }}
                        className="w-full rounded bg-[#1f1f24] px-1.5 py-0.5 text-xs font-medium text-zinc-100 focus:outline-none"
                      />
                    ) : (
                      <span
                        className="truncate text-xs font-semibold tracking-wide text-zinc-200 select-none"
                        title="双击折叠，右键重命名或设置显示项"
                      >
                        {col.title}
                      </span>
                    )}
                    <span className="text-xs text-zinc-500">
                      {pendingCount}
                    </span>
                  </div>

                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={() => toggleColumnCollapse(col.id)}
                      className="rounded-md p-1 text-zinc-500 opacity-100 sm:opacity-0 transition sm:group-hover/col:opacity-100 hover:bg-white/[0.06] hover:text-zinc-200"
                      title="折叠为文件夹"
                    >
                      <Minimize2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        setAddingTaskColId(col.id);
                        setDraftTaskTitle("");
                      }}
                      className="rounded-md p-1 text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"
                      title="新增卡片"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setConfirmDeleteCol(col)}
                      className="rounded-md p-1 text-zinc-600 opacity-100 sm:opacity-0 transition sm:group-hover/col:opacity-100 hover:bg-white/[0.06] hover:text-rose-400"
                      title={t("kanban.deleteColumn")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Inline Add Task */}
                {addingTaskColId === col.id && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleAddTask(col.id);
                    }}
                    className="mb-2.5 rounded-xl bg-[#1d1d21] p-2.5 ring-1 ring-white/[0.12]"
                  >
                    <input
                      autoFocus
                      type="text"
                      value={draftTaskTitle}
                      onChange={(e) => setDraftTaskTitle(e.target.value)}
                      onBlur={() => handleAddTask(col.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setAddingTaskColId(null);
                          setDraftTaskTitle("");
                        }
                      }}
                      placeholder="输入任务标题，回车确认..."
                      className="w-full bg-transparent text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none"
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
                    setAddingTaskColId(col.id);
                    setDraftTaskTitle("");
                  }}
                  onContextMenu={(e) => {
                    if ((e.target as HTMLElement).closest("[data-kanban-card]")) {
                      return;
                    }
                    openAreaContextMenu(e, { kind: "column", colId: col.id });
                  }}
                  className="flex-1 space-y-1.5 overflow-y-auto pr-0.5"
                >
                  {colTasks.length === 0 ? (
                    <div className="flex h-20 items-center justify-center rounded-xl border border-dashed border-white/[0.05] text-[11px] text-zinc-600">
                      拖入卡片或点 + 新增
                    </div>
                  ) : (
                    colTasks.map((task) => {
                      const isDone = task.status === "done";
                      const isFocusing = activeTaskId === task.id;
                      const isBeingDragged = dragTaskId === task.id;
                      const showInsertBefore =
                        dragOverSlot?.taskId === task.id &&
                        dragOverSlot.position === "before" &&
                        !isBeingDragged;
                      const showInsertAfter =
                        dragOverSlot?.taskId === task.id &&
                        dragOverSlot.position === "after" &&
                        !isBeingDragged;

                      return (
                        <div
                          key={task.id}
                          data-kanban-card="true"
                          onContextMenu={(e) =>
                            openAreaContextMenu(e, {
                              kind: "card",
                              taskId: task.id,
                              colId: col.id,
                            })
                          }
                          className="relative"
                        >
                          {showInsertBefore && (
                            <div className="mb-1.5 h-0.5 w-full rounded-full bg-shiba-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]" />
                          )}
                          <div
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData(
                                "application/x-shibaplan-task",
                                task.id
                              );
                              e.dataTransfer.effectAllowed = "copyMove";
                              setDragTaskId(task.id);
                            }}
                            onDragEnd={() => {
                              setDragTaskId(null);
                              setDragOverColId(null);
                              setDragOverSlot(null);
                            }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const rect =
                                e.currentTarget.getBoundingClientRect();
                              const pos =
                                e.clientY > rect.top + rect.height / 2
                                  ? "after"
                                  : "before";
                              setDragOverColId(col.id);
                              setDragOverSlot({ taskId: task.id, position: pos });
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const rect =
                                e.currentTarget.getBoundingClientRect();
                              const pos =
                                e.clientY > rect.top + rect.height / 2
                                  ? "after"
                                  : "before";
                              handleDrop(e, col.id, task.id, pos);
                            }}
                            className={`group cursor-grab active:cursor-grabbing rounded-xl px-2.5 py-2 transition-all duration-150 ${
                              isBeingDragged
                                ? "opacity-35 scale-[0.98] bg-[#1e1e24] shadow-none"
                                : isFocusing
                                ? "bg-[#24211b] shadow-[0_4px_14px_rgba(245,158,11,0.12)]"
                                : isDone
                                ? "bg-[#19191e]/70 opacity-55 shadow-none"
                                : "bg-[#1d1d22] shadow-[0_1px_4px_rgba(0,0,0,0.22)] hover:bg-[#25252c] hover:shadow-[0_5px_14px_rgba(0,0,0,0.34)]"
                            }`}
                          >
                          <div className="flex items-start gap-2">
                            {/* Minimalist Hairline Checkbox */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleDone(task);
                              }}
                              className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border transition ${
                                isDone
                                  ? "border-zinc-500/70 text-zinc-400"
                                  : "border-zinc-600/80 hover:border-shiba-400"
                              }`}
                              title={
                                isDone
                                  ? t("kanban.restoreTodo")
                                  : t("kanban.markDone")
                              }
                            >
                              {isDone && (
                                <Check className="h-2.5 w-2.5 stroke-[2.5]" />
                              )}
                            </button>

                            <div className="flex-1 min-w-0">
                              {task.folderPath ? (
                                /* Compact Expandable Folder Shortcut Card */
                                <div>
                                  <div className="flex items-center justify-between gap-1">
                                    <button
                                      type="button"
                                      onClick={() => toggleFolderExpand(task)}
                                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                                      title={
                                        expandedFolders[task.id]
                                          ? t("kanban.collapseFolder")
                                          : t("kanban.expandFolder")
                                      }
                                    >
                                      {expandedFolders[task.id] ? (
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

                                    <div className="flex shrink-0 items-center gap-0.5">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          openPathInOs(task.folderPath!)
                                        }
                                        className="rounded p-0.5 text-zinc-400 transition hover:bg-white/[0.08] hover:text-shiba-400"
                                        title={t("kanban.openFolder")}
                                      >
                                        <ExternalLink className="h-3 w-3" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          toggleCardCollapse(task.id)
                                        }
                                        className="rounded p-0.5 text-zinc-500 transition hover:bg-white/[0.08] hover:text-zinc-200"
                                        title={
                                          collapsedCards[task.id]
                                            ? t("kanban.expandFolder")
                                            : t("kanban.collapseFolder")
                                        }
                                      >
                                        {collapsedCards[task.id] ? (
                                          <ChevronRight className="h-3.5 w-3.5" />
                                        ) : (
                                          <ChevronDown className="h-3.5 w-3.5" />
                                        )}
                                      </button>
                                    </div>
                                  </div>

                                  {!collapsedCards[task.id] && (
                                    <>
                                      <p className="mt-0.5 truncate font-mono text-[10px] text-zinc-500">
                                        {task.folderPath}
                                      </p>

                                      {expandedFolders[task.id] && (
                                        <div className="mt-2 rounded-lg bg-[#111113] p-1.5 ring-1 ring-white/[0.06]">
                                          <div className="mb-1 flex items-center justify-between px-1">
                                            <span className="text-[10px] text-zinc-500">
                                              {`${(folderFiles[task.id] ?? task.cachedFiles ?? []).length} ${t("common.items")}`}
                                            </span>
                                            {isTauriRuntime() && (
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  loadFolder(
                                                    task.id,
                                                    task.folderPath!
                                                  )
                                                }
                                                className="rounded p-0.5 text-zinc-500 hover:text-zinc-200"
                                                title={t("kanban.refreshFolder")}
                                              >
                                                <RefreshCw
                                                  className={`h-3 w-3 ${
                                                    loadingFolders[task.id]
                                                      ? "animate-spin"
                                                      : ""
                                                  }`}
                                                />
                                              </button>
                                            )}
                                          </div>

                                          {loadingFolders[task.id] ? (
                                            <p className="px-1 py-1.5 text-[11px] text-zinc-500">
                                              {t("kanban.folderLoading")}
                                            </p>
                                          ) : (
                                              folderFiles[task.id] ??
                                              task.cachedFiles ??
                                              []
                                            ).length === 0 ? (
                                            <p className="px-1 py-1.5 text-[11px] text-zinc-500">
                                              {t("kanban.folderEmpty")}
                                            </p>
                                          ) : (
                                            <div className="max-h-36 space-y-0.5 overflow-y-auto">
                                              {(
                                                folderFiles[task.id] ??
                                                task.cachedFiles ??
                                                []
                                              ).map((entry) => (
                                                <button
                                                  key={entry.path}
                                                  type="button"
                                                  onClick={() =>
                                                    openPathInOs(entry.path)
                                                  }
                                                  className="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-[11px] text-zinc-300 transition hover:bg-white/[0.06] hover:text-zinc-100"
                                                >
                                                  {entry.is_dir ? (
                                                    <Folder className="h-3 w-3 shrink-0 text-shiba-400/80" />
                                                  ) : (
                                                    <FileText className="h-3 w-3 shrink-0 text-zinc-500" />
                                                  )}
                                                  <span className="truncate">
                                                    {entry.name}
                                                  </span>
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
                                      ) : (
                                        task.importance === 3 &&
                                        !isDone && (
                                          <Star
                                            className="mt-0.5 h-3 w-3 shrink-0 text-shiba-400"
                                            fill="currentColor"
                                          />
                                        )
                                      )}
                                      <p
                                        className={`text-[13px] leading-snug ${
                                          collapsedCards[task.id]
                                            ? "truncate"
                                            : ""
                                        } ${
                                          isDone
                                            ? "text-zinc-500 line-through"
                                            : "text-zinc-100"
                                        }`}
                                      >
                                        {task.title}
                                      </p>
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
                                      {(((col.display?.showNotes ?? true) &&
                                        Boolean(task.notes)) ||
                                        ((col.display?.showImage ?? true) &&
                                          Boolean(task.imagePreview)) ||
                                        task.title.includes("\n") ||
                                        task.title.length > 26 ||
                                        Boolean(collapsedCards[task.id])) && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            toggleCardCollapse(task.id);
                                          }}
                                          className="shrink-0 rounded p-0.5 text-zinc-500 opacity-60 transition hover:bg-white/[0.08] hover:text-zinc-200 group-hover:opacity-100"
                                          title={
                                            collapsedCards[task.id]
                                              ? t("kanban.expandFolder")
                                              : t("kanban.collapseFolder")
                                          }
                                        >
                                          {collapsedCards[task.id] ? (
                                            <ChevronRight className="h-3.5 w-3.5" />
                                          ) : (
                                            <ChevronDown className="h-3.5 w-3.5" />
                                          )}
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  {!collapsedCards[task.id] && (
                                    <>
                                      {(col.display?.showNotes ?? true) &&
                                        task.notes && (
                                          <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-zinc-500">
                                            {task.notes}
                                          </p>
                                        )}
                                      {(col.display?.showImage ?? true) &&
                                        task.imagePreview && (
                                          <img
                                            src={task.imagePreview}
                                            alt="task attachment"
                                            onMouseEnter={(e) =>
                                              handleImageHover(
                                                task.imagePreview!,
                                                e
                                              )
                                            }
                                            onMouseLeave={() =>
                                              setHoveredImage(null)
                                            }
                                            className="mt-1.5 h-14 w-full cursor-zoom-in rounded-md object-cover ring-1 ring-white/[0.08]"
                                          />
                                        )}
                                    </>
                                  )}
                                </>
                              )}
                            </div>
                          </div>

                          {!collapsedCards[task.id] && (
                            <div className="mt-1.5 flex items-center justify-between pl-5.5">
                              <div className="flex flex-wrap items-center gap-1">
                                {(col.display?.showEffort ?? true) && (
                                  <button
                                    onClick={() => cycleEffort(task)}
                                    className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-200"
                                    title="点击切换预估耗时"
                                  >
                                    {EFFORT_LABEL[task.effort]}
                                  </button>
                                )}
                                {(col.display?.showDate ?? true) &&
                                  task.dueDate && (
                                    <button
                                      onClick={() => openTaskEditor(task)}
                                      className="flex items-center gap-1 rounded bg-shiba-500/12 px-1.5 py-0.5 text-[10px] text-shiba-300 hover:bg-shiba-500/20"
                                      title={t("kanban.schedule")}
                                    >
                                      <Calendar className="h-2.5 w-2.5" />
                                      <span>
                                        {formatShortDate(task.dueDate)}
                                        {task.startTime
                                          ? ` ${task.startTime}`
                                          : ""}
                                      </span>
                                    </button>
                                  )}
                                {(col.display?.showEffort ?? true) &&
                                  task.actualMinutes > 0 && (
                                    <span className="text-[10px] text-zinc-500">
                                      {task.actualMinutes}m
                                    </span>
                                  )}
                              </div>

                              <div className="flex items-center gap-0.5 opacity-100 sm:opacity-0 transition sm:group-hover:opacity-100">
                                <button
                                  onClick={() => openTaskEditor(task)}
                                  className="rounded p-1 text-zinc-400 hover:bg-white/[0.08] hover:text-shiba-300"
                                  title={t("kanban.schedule")}
                                >
                                  <Calendar className="h-3 w-3" />
                                </button>
                                {!isDone && (
                                  <button
                                    onClick={() => handleStartFocus(task)}
                                    className="rounded p-1 text-zinc-400 hover:bg-white/[0.08] hover:text-shiba-400"
                                    title={t("kanban.focus")}
                                  >
                                    <Play className="h-3 w-3" />
                                  </button>
                                )}
                                <button
                                  onClick={() => toggleStar(task)}
                                  className={`rounded p-1 hover:bg-white/[0.08] ${
                                    task.importance === 3
                                      ? "text-shiba-400"
                                      : "text-zinc-500 hover:text-zinc-200"
                                  }`}
                                  title={t("kanban.star")}
                                >
                                  <Star
                                    className="h-3 w-3"
                                    fill={
                                      task.importance === 3
                                        ? "currentColor"
                                        : "none"
                                    }
                                  />
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteTask(task)}
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
                    })
                  )}
                </div>
              </div>
              {layoutMode === "row" && (
                <div
                  onMouseDown={startResizeColumnGap}
                  onDoubleClick={resetColumnGap}
                  style={{ width: activeColumnGap }}
                  className="group/gap relative flex shrink-0 cursor-col-resize items-center justify-center"
                  title="左右拖动调整看板间距，双击恢复默认"
                >
                  <div
                    className={`h-12 w-0.5 rounded-full transition ${
                      resizingGap !== null
                        ? "h-24 bg-shiba-400"
                        : "bg-transparent group-hover/gap:bg-shiba-400/60"
                    }`}
                  />
                  {resizingGap !== null && (
                    <span className="pointer-events-none absolute top-2 rounded bg-[#1c1c21] px-1 py-0.5 font-mono text-[10px] text-shiba-400 shadow">
                      {activeColumnGap}
                    </span>
                  )}
                </div>
              )}
              </React.Fragment>
            );
          })}

          {/* Create New Column Card */}
          {creatingCol ? (
            <form
              onSubmit={handleCreateColumn}
              className="flex h-fit w-72 shrink-0 flex-col gap-3 rounded-2xl bg-[#18181b] p-4 ring-1 ring-white/[0.12]"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-200">
                  新建看板列
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setCreatingCol(false);
                    setNewColTitle("");
                  }}
                  className="rounded p-0.5 text-zinc-500 hover:text-zinc-200"
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
                className="rounded-lg bg-[#111113] px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 ring-1 ring-white/[0.08] focus:ring-shiba-500/50 focus:outline-none"
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
                        ? "ring-2 ring-white ring-offset-2 ring-offset-[#18181b]"
                        : "opacity-55 hover:opacity-100"
                    }`}
                  />
                ))}
              </div>

              <button
                type="submit"
                className="rounded-lg bg-shiba-500 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-shiba-400"
              >
                确认添加
              </button>
            </form>
          ) : (
            layoutMode === "row" && (
              <button
                onClick={() => setCreatingCol(true)}
                className="flex h-32 w-60 shrink-0 flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-white/[0.07] text-xs text-zinc-500 transition hover:border-white/[0.16] hover:bg-white/[0.02] hover:text-zinc-300"
              >
                <Plus className="h-4 w-4" />
                {t("kanban.newColumn")}
              </button>
            )
          )}
          </div>

          {/* Floating Canvas Zoom & Tidy Controls */}
          {layoutMode === "canvas" && (
            <div className="absolute bottom-3 right-3 z-30 flex items-center gap-1 rounded-xl bg-popover/90 px-2 py-1 text-[11px] text-popover-foreground shadow-popover-soft backdrop-blur-md">
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
        <div
          style={{ left: areaContextMenu.x, top: areaContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-44 rounded-xl bg-[#1c1c21] p-1.5 shadow-2xl ring-1 ring-white/[0.1]"
        >
          {areaContextMenu.kind === "card" &&
            (() => {
              const ctxTask = workspace.tasks.find(
                (item) => item.id === areaContextMenu.taskId
              );
              if (!ctxTask) return null;
              const isDone = ctxTask.status === "done";
              return (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      openTaskEditor(ctxTask);
                      setAreaContextMenu(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-white/[0.07]"
                  >
                    <Calendar className="h-3.5 w-3.5 text-zinc-400" />
                    <span>{t("kanban.schedule")}</span>
                  </button>

                  {!isDone && (
                    <button
                      type="button"
                      onClick={() => {
                        handleStartFocus(ctxTask);
                        setAreaContextMenu(null);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-white/[0.07]"
                    >
                      <Play className="h-3.5 w-3.5 text-zinc-400" />
                      <span>{t("kanban.focus")}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      toggleStar(ctxTask);
                      setAreaContextMenu(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-white/[0.07]"
                  >
                    <Star className="h-3.5 w-3.5 text-zinc-400" />
                    <span>{t("kanban.star")}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      toggleDone(ctxTask);
                      setAreaContextMenu(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-white/[0.07]"
                  >
                    <Check className="h-3.5 w-3.5 text-zinc-400" />
                    <span>
                      {isDone ? t("kanban.restoreTodo") : t("kanban.markDone")}
                    </span>
                  </button>

                  <div className="my-1 border-t border-white/[0.06]" />

                  <button
                    type="button"
                    onClick={() => {
                      duplicateTask(ctxTask);
                      setAreaContextMenu(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-white/[0.07]"
                  >
                    <Copy className="h-3.5 w-3.5 text-zinc-400" />
                    <span>复制卡片</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      moveTaskToRiver(ctxTask);
                      setAreaContextMenu(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-white/[0.07]"
                  >
                    <Waves className="h-3.5 w-3.5 text-zinc-400" />
                    <span>移入灵感流</span>
                  </button>

                  <div className="my-1 border-t border-white/[0.06]" />

                  <button
                    type="button"
                    onClick={() => {
                      setConfirmDeleteTask(ctxTask);
                      setAreaContextMenu(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-rose-400 transition hover:bg-rose-500/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>{t("common.delete")}</span>
                  </button>
                </>
              );
            })()}

          {areaContextMenu.kind === "column" && (
            <>
              <button
                type="button"
                onClick={() => {
                  setAddingTaskColId(areaContextMenu.colId);
                  setDraftTaskTitle("");
                  setAreaContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-white/[0.07]"
              >
                <Plus className="h-3.5 w-3.5 text-zinc-400" />
                <span>{t("kanban.addCard")}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  toggleColumnCollapse(areaContextMenu.colId);
                  setAreaContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-white/[0.07]"
              >
                <Minimize2 className="h-3.5 w-3.5 text-zinc-400" />
                <span>折叠此列</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setColContextMenu({
                    colId: areaContextMenu.colId,
                    x: areaContextMenu.x,
                    y: areaContextMenu.y,
                  });
                  setAreaContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-white/[0.07]"
              >
                <Kanban className="h-3.5 w-3.5 text-zinc-400" />
                <span>列显示设置</span>
              </button>
            </>
          )}

          {areaContextMenu.kind === "board" && (
            <>
              <button
                type="button"
                onClick={() => {
                  setCreatingCol(true);
                  setAreaContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-white/[0.07]"
              >
                <Plus className="h-3.5 w-3.5 text-zinc-400" />
                <span>{t("kanban.newColumn")}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setLayoutMode((m) => (m === "row" ? "canvas" : "row"));
                  setAreaContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-white/[0.07]"
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
                  setAreaContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-white/[0.07]"
              >
                <Minimize2 className="h-3.5 w-3.5 text-zinc-400" />
                <span>全部折叠</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setAllColumnsCollapsed(false);
                  setAreaContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-white/[0.07]"
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
                      setAreaContextMenu(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-white/[0.07]"
                  >
                    <LayoutGrid className="h-3.5 w-3.5 text-zinc-400" />
                    <span>一键整齐排列</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      fitCanvasToScreen();
                      setAreaContextMenu(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-white/[0.07]"
                  >
                    <Scan className="h-3.5 w-3.5 text-zinc-400" />
                    <span>适配全屏</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCanvasZoom(1);
                      setCanvasPan({ x: 32, y: 24 });
                      setAreaContextMenu(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-white/[0.07]"
                  >
                    <RotateCcw className="h-3.5 w-3.5 text-zinc-400" />
                    <span>重置画布视角</span>
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Column Header Right-Click Context Menu */}
      {colContextMenu &&
        (() => {
          const ctxCol = workspace.columns.find(
            (c) => c.id === colContextMenu.colId
          );
          if (!ctxCol) return null;
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
              style={{ left: colContextMenu.x, top: colContextMenu.y }}
              onClick={(e) => e.stopPropagation()}
              className="fixed z-50 w-44 rounded-xl bg-[#1c1c21] p-1.5 ring-1 ring-white/[0.12] shadow-2xl"
            >
              {displayItems.map((item) => {
                const checked = ctxCol.display?.[item.key] ?? true;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => toggleColumnDisplay(ctxCol.id, item.key)}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-white/[0.07]"
                  >
                    <span>{item.label}</span>
                    {checked && (
                      <Check className="h-3.5 w-3.5 text-shiba-400" />
                    )}
                  </button>
                );
              })}

              <div className="my-1 border-t border-white/[0.06]" />

              <button
                type="button"
                onClick={() => {
                  setEditingColId(ctxCol.id);
                  setEditingColTitle(ctxCol.title);
                  setColContextMenu(null);
                }}
                className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-300 transition hover:bg-white/[0.07]"
              >
                {t("kanban.ctxRename")}
              </button>

              <button
                type="button"
                onClick={() => {
                  resetColumnWidth(ctxCol.id);
                  setColContextMenu(null);
                }}
                className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-300 transition hover:bg-white/[0.07]"
              >
                {t("kanban.ctxResetWidth")}
              </button>
            </div>
          );
        })()}

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

      {/* Confirm Delete Card Modal (shadcn/ui Dialog) */}
      <Dialog
        open={Boolean(confirmDeleteTask)}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteTask(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-destructive/15 text-destructive">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <DialogTitle>{t("kanban.confirmDeleteCardTitle")}</DialogTitle>
            </div>
            <DialogDescription className="pt-2">
              {confirmDeleteTask
                ? t("kanban.confirmDeleteCardDesc", {
                    name: confirmDeleteTask.title,
                  })
                : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmDeleteTask(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (confirmDeleteTask) deleteTask(confirmDeleteTask.id);
                setConfirmDeleteTask(null);
              }}
            >
              {t("common.delete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm Delete Column Modal (shadcn/ui Dialog) */}
      <Dialog
        open={Boolean(confirmDeleteCol)}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteCol(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-destructive/15 text-destructive">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <DialogTitle>{t("kanban.confirmDeleteTitle")}</DialogTitle>
            </div>
            <DialogDescription className="pt-2">
              {confirmDeleteCol &&
                (() => {
                  const count = workspace.tasks.filter(
                    (item) => item.columnId === confirmDeleteCol.id
                  ).length;
                  return count > 0
                    ? t("kanban.confirmDeleteDesc", {
                        name: confirmDeleteCol.title,
                        count,
                      })
                    : t("kanban.confirmDeleteEmpty", {
                        name: confirmDeleteCol.title,
                      });
                })()}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmDeleteCol(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (confirmDeleteCol) handleDeleteColumn(confirmDeleteCol.id);
                setConfirmDeleteCol(null);
              }}
            >
              {t("common.delete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Card Time & Detail Editor Modal (shadcn/ui Dialog) */}
      <Dialog
        open={Boolean(editingTaskId)}
        onOpenChange={(open) => {
          if (!open) setEditingTaskId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" />
              {t("kanban.taskModalTitle")}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSaveTaskEdit} className="mt-4 space-y-3.5">
            <Input
              autoFocus
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              placeholder={t("kanban.taskTitlePlaceholder")}
              className="h-9 text-sm"
            />

            {editImagePreview && (
              <div className="relative inline-block">
                <img
                  src={editImagePreview}
                  alt="attached"
                  className="max-h-32 rounded-xl shadow-card-rest"
                />
                <button
                  type="button"
                  onClick={() => setEditImagePreview(undefined)}
                  className="absolute -right-2 -top-2 rounded-full bg-secondary p-1 text-secondary-foreground shadow hover:bg-accent"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            <Textarea
              rows={2}
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              placeholder={t("kanban.taskNotesPlaceholder")}
            />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {t("kanban.dateAndTime")}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setQuickDateOffset(0)}
                  >
                    {t("common.today")}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setQuickDateOffset(1)}
                  >
                    {t("common.tomorrow")}
                  </Button>
                  {editDueDate && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditDueDate("");
                        setEditStartTime("");
                      }}
                      className="text-destructive hover:text-destructive"
                    >
                      {t("common.clear")}
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="date"
                  value={editDueDate}
                  onChange={(e) => setEditDueDate(e.target.value)}
                />
                <Input
                  type="time"
                  value={editStartTime}
                  onChange={(e) => setEditStartTime(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditingTaskId(null)}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit">{t("common.save")}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
