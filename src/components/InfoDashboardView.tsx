import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BookOpen,
  Grid,
  LayoutGrid,
  Lock,
  Magnet,
  Plus,
  Radio,
  RefreshCw,
  Sparkles,
  Unlock,
  X,
} from "lucide-react";
import {
  InfoBoard,
  InfoLayoutMode,
  InfoPushServerConfig,
  InfoWidget,
  InfoWidgetLayout,
  WorkspaceData,
} from "../types";
import { createDefaultInfoBoards, openPathInOs, uid } from "../lib/storage";
import {
  autoArrangeWidgets,
  clampRect,
  DEFAULT_GRID_COLS,
  DEFAULT_ROW_HEIGHT,
  DOT_GRID_STEP,
  findFreePixelSlot,
  findNearestFreeSlot,
  getWidgetPixelRect,
  GRID_GAP,
  gridLayoutToPixelRect,
  MIN_WIDGET_PX_H,
  MIN_WIDGET_PX_W,
  PixelRect,
  resolveGridCollision,
  resolvePixelOverlap,
  SNAP_GAP,
  SnapGuide,
  snapMovePixelRect,
  snapResizePixelRect,
  syncLayoutFromPixelRect,
} from "../lib/infoGrid";
import {
  extractPlainTextFromParsed,
  INFO_WIDGET_TEMPLATES,
  InfoWidgetTemplate,
  parseInfoOutput,
} from "../lib/infoProtocol";
import {
  getInfoScriptsDir,
  InfoPushServerStatus,
  InfoWidgetRuntimeState,
} from "../lib/infoRunner";
import { Button } from "./ui/button";
import { InfoWidgetCard, ResizeEdge } from "./info/InfoWidgetCard";
import { InfoContextMenu, InfoMenuState } from "./info/InfoContextMenu";
import { InfoWidgetEditorDialog } from "./info/InfoWidgetEditorDialog";
import { InfoProtocolDialog } from "./info/InfoProtocolDialog";
import { InfoLogDialog } from "./info/InfoLogDialog";
import { InfoPushServerDialog } from "./info/InfoPushServerDialog";

interface InfoDashboardViewProps {
  workspace: WorkspaceData;
  onUpdate: (next: WorkspaceData) => void;
  runtimeMap: Record<string, InfoWidgetRuntimeState>;
  onRunWidget: (
    widget: InfoWidget,
    trigger?: "manual" | "schedule" | "startup"
  ) => Promise<unknown>;
  onCancelWidget: (widgetId: string) => Promise<unknown>;
  onRunAllWidgets: (boardId?: string) => Promise<void>;
  pushServerStatus: InfoPushServerStatus | null;
  onApplyPushConfig: (
    next: InfoPushServerConfig
  ) => Promise<InfoPushServerStatus | null>;
  onNotify: (msg: string) => void;
}

interface ActiveInteraction {
  mode: "drag" | "resize";
  widgetId: string;
  previewRects: Map<string, PixelRect>;
  guides: SnapGuide[];
  ghostGridRect?: PixelRect;
  targetGridLayout?: InfoWidgetLayout;
  previewGridWidgets?: InfoWidget[];
}

export const InfoDashboardView: React.FC<InfoDashboardViewProps> = ({
  workspace,
  onUpdate,
  runtimeMap,
  onRunWidget,
  onCancelWidget,
  onRunAllWidgets,
  pushServerStatus,
  onApplyPushConfig,
  onNotify,
}) => {
  const boards = useMemo(
    () =>
      workspace.infoBoards && workspace.infoBoards.length > 0
        ? workspace.infoBoards
        : createDefaultInfoBoards(),
    [workspace.infoBoards]
  );

  const [activeBoardId, setActiveBoardId] = useState<string>(boards[0].id);
  const activeBoard = useMemo(
    () => boards.find((b) => b.id === activeBoardId) ?? boards[0],
    [boards, activeBoardId]
  );

  useEffect(() => {
    if (!boards.some((b) => b.id === activeBoardId)) {
      setActiveBoardId(boards[0].id);
    }
  }, [boards, activeBoardId]);

  const [renamingBoardId, setRenamingBoardId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  // Canvas measurement: observe outer scroll container (never inner content!) to avoid feedback loop
  const canvasScrollRef = useRef<HTMLDivElement>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1100);

  useEffect(() => {
    const el = canvasScrollRef.current;
    if (!el) return;
    const updateWidth = () => {
      const cs = window.getComputedStyle(el);
      const padX =
        (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      const w = Math.floor(el.clientWidth - padX);
      if (w > 120) setContainerWidth(w);
    };
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const gridCols = useMemo(() => {
    if (containerWidth < 560) return 4;
    if (containerWidth < 900) return 8;
    return activeBoard.cols ?? DEFAULT_GRID_COLS;
  }, [containerWidth, activeBoard.cols]);

  const rowHeight = activeBoard.rowHeight ?? DEFAULT_ROW_HEIGHT;
  const colWidth = useMemo(() => {
    const totalGap = (gridCols - 1) * GRID_GAP;
    return Math.max(40, (containerWidth - totalGap) / gridCols);
  }, [containerWidth, gridCols]);

  const layoutMode: InfoLayoutMode = activeBoard.layoutMode ?? "free";
  const snapEnabled = activeBoard.snapEnabled ?? true;
  const preventOverlap = activeBoard.preventOverlap ?? true;
  const locked = Boolean(activeBoard.locked);

  const boardWidgets = useMemo(
    () =>
      (workspace.infoWidgets ?? []).filter((w) => w.boardId === activeBoard.id),
    [workspace.infoWidgets, activeBoard.id]
  );

  // Base resting PixelRect map for every widget on the current board (clamped inside canvas width)
  const baseRects = useMemo(() => {
    const map = new Map<string, PixelRect>();
    const forceGrid = layoutMode !== "free";
    for (const w of boardWidgets) {
      const r = getWidgetPixelRect(w, colWidth, rowHeight, GRID_GAP, forceGrid);
      const clampedW = Math.min(r.w, Math.max(MIN_WIDGET_PX_W, containerWidth));
      const clampedX = Math.max(0, Math.min(r.x, Math.max(0, containerWidth - clampedW)));
      map.set(w.id, { ...r, x: clampedX, w: clampedW });
    }
    return map;
  }, [boardWidgets, colWidth, rowHeight, layoutMode, containerWidth]);

  const [interaction, setInteraction] = useState<ActiveInteraction | null>(
    null
  );

  const interactionRef = useRef(interaction);
  interactionRef.current = interaction;

  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  const boardWidgetsRef = useRef(boardWidgets);
  boardWidgetsRef.current = boardWidgets;

  const activeBoardRef = useRef(activeBoard);
  activeBoardRef.current = activeBoard;

  const baseRectsRef = useRef(baseRects);
  baseRectsRef.current = baseRects;

  // Dialogs & Context Menu
  const [contextMenu, setContextMenu] = useState<InfoMenuState | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingWidget, setEditingWidget] = useState<InfoWidget | null>(null);
  const [initialNewGrid, setInitialNewGrid] = useState<
    { x: number; y: number } | undefined
  >(undefined);
  const [initialNewPixel, setInitialNewPixel] = useState<
    { x: number; y: number } | undefined
  >(undefined);
  const [protocolOpen, setProtocolOpen] = useState(false);
  const [pushDialogOpen, setPushDialogOpen] = useState(false);
  const [logWidgetId, setLogWidgetId] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const pushConfig: InfoPushServerConfig = workspace.settings.infoPush ?? {
    enabled: true,
    port: 18421,
    allowLan: false,
    autoCreate: true,
  };
  const pushBaseUrl =
    pushServerStatus?.baseUrl ?? `http://127.0.0.1:${pushConfig.port}`;

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  }, [contextMenu]);

  const updateBoardMeta = useCallback(
    (patch: Partial<InfoBoard>) => {
      const ws = workspaceRef.current;
      const curBoards =
        ws.infoBoards && ws.infoBoards.length > 0
          ? ws.infoBoards
          : createDefaultInfoBoards();
      onUpdate({
        ...ws,
        infoBoards: curBoards.map((b) =>
          b.id === activeBoardRef.current.id ? { ...b, ...patch } : b
        ),
      });
    },
    [onUpdate]
  );

  const replaceBoardWidgets = useCallback(
    (nextBoardWidgets: InfoWidget[]) => {
      const ws = workspaceRef.current;
      const others = (ws.infoWidgets ?? []).filter(
        (w) => w.boardId !== activeBoardRef.current.id
      );
      onUpdate({
        ...ws,
        infoWidgets: [...others, ...nextBoardWidgets],
      });
    },
    [onUpdate]
  );

  // 1:1 Pointer-Synchronized Drag Handler
  const handleStartDrag = useCallback(
    (e: React.PointerEvent, widget: InfoWidget) => {
      if (e.button !== 0 || activeBoardRef.current.locked) return;
      if ((e.target as HTMLElement).closest("button, a, input, select")) return;
      e.preventDefault();
      e.stopPropagation();

      const origRect =
        baseRectsRef.current.get(widget.id) ??
        getWidgetPixelRect(widget, colWidth, rowHeight, GRID_GAP, false);
      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const startScrollTop = canvasScrollRef.current?.scrollTop ?? 0;

      const mode: InfoLayoutMode = activeBoardRef.current.layoutMode ?? "free";
      const useSnap = activeBoardRef.current.snapEnabled ?? true;
      const noOverlap = activeBoardRef.current.preventOverlap ?? true;
      const stepX = colWidth + GRID_GAP;
      const stepY = rowHeight + GRID_GAP;

      let moved = false;

      const onMove = (ev: PointerEvent) => {
        const scrollDeltaY =
          (canvasScrollRef.current?.scrollTop ?? startScrollTop) -
          startScrollTop;
        const dx = ev.clientX - startClientX;
        const dy = ev.clientY - startClientY + scrollDeltaY;
        if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
        moved = true;

        const rawRect: PixelRect = {
          x: Math.max(
            0,
            Math.min(Math.max(0, containerWidth - origRect.w), origRect.x + dx)
          ),
          y: Math.max(0, origRect.y + dy),
          w: origRect.w,
          h: origRect.h,
        };

        if (mode === "free") {
          const otherRects: PixelRect[] = [];
          for (const [id, r] of baseRectsRef.current.entries()) {
            if (id !== widget.id) otherRects.push(r);
          }
          const snapped = snapMovePixelRect(rawRect, otherRects, {
            snapEnabled: useSnap,
            bypassSnap: ev.altKey,
            gridStep: DOT_GRID_STEP,
            maxWidth: containerWidth,
          });

          let previewRects = new Map(baseRectsRef.current);
          previewRects.set(widget.id, snapped.rect);
          if (noOverlap) {
            previewRects = resolvePixelOverlap(
              previewRects,
              widget.id,
              SNAP_GAP
            );
          }

          setInteraction({
            mode: "drag",
            widgetId: widget.id,
            previewRects,
            guides: snapped.guides,
          });
        } else {
          // Grid / Compact mode: active card tracks pointer 1:1 while ghost shows snapped slot
          const targetGrid = clampRect(
            {
              ...widget.layout,
              x: Math.round(rawRect.x / stepX),
              y: Math.round(rawRect.y / stepY),
            },
            gridCols
          );
          const previewGridWidgets = resolveGridCollision(
            boardWidgetsRef.current,
            widget.id,
            targetGrid,
            gridCols,
            mode
          );
          const previewRects = new Map<string, PixelRect>();
          for (const item of previewGridWidgets) {
            if (item.id === widget.id) {
              previewRects.set(item.id, rawRect);
            } else {
              previewRects.set(
                item.id,
                gridLayoutToPixelRect(item.layout, colWidth, rowHeight, GRID_GAP)
              );
            }
          }
          const ghostGridRect = gridLayoutToPixelRect(
            targetGrid,
            colWidth,
            rowHeight,
            GRID_GAP
          );
          setInteraction({
            mode: "drag",
            widgetId: widget.id,
            previewRects,
            guides: [],
            ghostGridRect,
            targetGridLayout: targetGrid,
            previewGridWidgets,
          });
        }
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        window.removeEventListener("blur", onUp);
        const cur = interactionRef.current;
        setInteraction(null);
        if (!cur || !moved) return;

        if (mode === "free") {
          const nextWidgets = boardWidgetsRef.current.map((w) => {
            const r = cur.previewRects.get(w.id);
            if (!r) return w;
            return {
              ...w,
              layout: syncLayoutFromPixelRect(
                w.layout,
                r,
                colWidth,
                rowHeight,
                GRID_GAP,
                gridCols
              ),
            };
          });
          replaceBoardWidgets(nextWidgets);
        } else if (cur.previewGridWidgets) {
          const nextWidgets = cur.previewGridWidgets.map((w) => {
            const pxR = gridLayoutToPixelRect(
              w.layout,
              colWidth,
              rowHeight,
              GRID_GAP
            );
            return {
              ...w,
              layout: {
                ...w.layout,
                px: pxR.x,
                py: pxR.y,
                pw: pxR.w,
                ph: pxR.h,
              },
            };
          });
          replaceBoardWidgets(nextWidgets);
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      window.addEventListener("blur", onUp);
    },
    [colWidth, rowHeight, gridCols, containerWidth, replaceBoardWidgets]
  );

  // 1:1 Pointer-Synchronized 5-Edge Resize Handler
  const handleStartResize = useCallback(
    (e: React.PointerEvent, widget: InfoWidget, edge: ResizeEdge) => {
      if (e.button !== 0 || activeBoardRef.current.locked) return;
      e.preventDefault();
      e.stopPropagation();

      const origRect =
        baseRectsRef.current.get(widget.id) ??
        getWidgetPixelRect(widget, colWidth, rowHeight, GRID_GAP, false);
      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const startScrollTop = canvasScrollRef.current?.scrollTop ?? 0;

      const mode: InfoLayoutMode = activeBoardRef.current.layoutMode ?? "free";
      const useSnap = activeBoardRef.current.snapEnabled ?? true;
      const noOverlap = activeBoardRef.current.preventOverlap ?? true;
      const stepX = colWidth + GRID_GAP;
      const stepY = rowHeight + GRID_GAP;

      let changed = false;

      const onMove = (ev: PointerEvent) => {
        const scrollDeltaY =
          (canvasScrollRef.current?.scrollTop ?? startScrollTop) -
          startScrollTop;
        const dx = ev.clientX - startClientX;
        const dy = ev.clientY - startClientY + scrollDeltaY;
        if (!changed && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
        changed = true;

        let nextX = origRect.x;
        let nextY = origRect.y;
        let nextW = origRect.w;
        let nextH = origRect.h;

        if (edge === "e" || edge === "se") {
          nextW = Math.min(
            Math.max(MIN_WIDGET_PX_W, containerWidth - origRect.x),
            Math.max(MIN_WIDGET_PX_W, origRect.w + dx)
          );
        }
        if (edge === "s" || edge === "se") {
          nextH = Math.max(MIN_WIDGET_PX_H, origRect.h + dy);
        }
        if (edge === "w") {
          const maxLeft = origRect.x + origRect.w - MIN_WIDGET_PX_W;
          nextX = Math.max(0, Math.min(maxLeft, origRect.x + dx));
          nextW = origRect.x + origRect.w - nextX;
        }
        if (edge === "n") {
          const maxTop = origRect.y + origRect.h - MIN_WIDGET_PX_H;
          nextY = Math.max(0, Math.min(maxTop, origRect.y + dy));
          nextH = origRect.y + origRect.h - nextY;
        }

        const rawRect: PixelRect = { x: nextX, y: nextY, w: nextW, h: nextH };

        if (mode === "free") {
          const otherRects: PixelRect[] = [];
          for (const [id, r] of baseRectsRef.current.entries()) {
            if (id !== widget.id) otherRects.push(r);
          }
          const snapped = snapResizePixelRect(rawRect, edge, otherRects, {
            snapEnabled: useSnap,
            bypassSnap: ev.altKey,
            maxWidth: containerWidth,
          });

          let previewRects = new Map(baseRectsRef.current);
          previewRects.set(widget.id, snapped.rect);
          if (noOverlap) {
            previewRects = resolvePixelOverlap(
              previewRects,
              widget.id,
              SNAP_GAP
            );
          }

          setInteraction({
            mode: "resize",
            widgetId: widget.id,
            previewRects,
            guides: snapped.guides,
          });
        } else {
          const targetGrid = clampRect(
            {
              ...widget.layout,
              x: Math.round(rawRect.x / stepX),
              y: Math.round(rawRect.y / stepY),
              w: Math.round((rawRect.w + GRID_GAP) / stepX),
              h: Math.round((rawRect.h + GRID_GAP) / stepY),
            },
            gridCols
          );
          const previewGridWidgets = resolveGridCollision(
            boardWidgetsRef.current,
            widget.id,
            targetGrid,
            gridCols,
            mode
          );
          const previewRects = new Map<string, PixelRect>();
          for (const item of previewGridWidgets) {
            if (item.id === widget.id) {
              previewRects.set(item.id, rawRect);
            } else {
              previewRects.set(
                item.id,
                gridLayoutToPixelRect(item.layout, colWidth, rowHeight, GRID_GAP)
              );
            }
          }
          const ghostGridRect = gridLayoutToPixelRect(
            targetGrid,
            colWidth,
            rowHeight,
            GRID_GAP
          );
          setInteraction({
            mode: "resize",
            widgetId: widget.id,
            previewRects,
            guides: [],
            ghostGridRect,
            targetGridLayout: targetGrid,
            previewGridWidgets,
          });
        }
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        window.removeEventListener("blur", onUp);
        const cur = interactionRef.current;
        setInteraction(null);
        if (!cur || !changed) return;

        if (mode === "free") {
          const nextWidgets = boardWidgetsRef.current.map((w) => {
            const r = cur.previewRects.get(w.id);
            if (!r) return w;
            return {
              ...w,
              layout: syncLayoutFromPixelRect(
                w.layout,
                r,
                colWidth,
                rowHeight,
                GRID_GAP,
                gridCols
              ),
            };
          });
          replaceBoardWidgets(nextWidgets);
        } else if (cur.previewGridWidgets) {
          const nextWidgets = cur.previewGridWidgets.map((w) => {
            const pxR = gridLayoutToPixelRect(
              w.layout,
              colWidth,
              rowHeight,
              GRID_GAP
            );
            return {
              ...w,
              layout: {
                ...w.layout,
                px: pxR.x,
                py: pxR.y,
                pw: pxR.w,
                ph: pxR.h,
              },
            };
          });
          replaceBoardWidgets(nextWidgets);
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      window.addEventListener("blur", onUp);
    },
    [colWidth, rowHeight, gridCols, containerWidth, replaceBoardWidgets]
  );

  const activeRects = interaction ? interaction.previewRects : baseRects;

  const { canvasHeight, canvasRows } = useMemo(() => {
    let maxBottom = 520;
    for (const r of activeRects.values()) {
      maxBottom = Math.max(maxBottom, r.y + r.h + 120);
    }
    const rows = Math.max(
      10,
      Math.ceil((maxBottom + GRID_GAP) / (rowHeight + GRID_GAP))
    );
    return {
      canvasHeight: maxBottom,
      canvasRows: rows,
    };
  }, [activeRects, rowHeight]);

  // Board actions
  const handleAddBoard = () => {
    const nextBoard: InfoBoard = {
      id: uid("board"),
      name: `面板 ${boards.length + 1}`,
      layoutMode: "free",
      showGrid: true,
      locked: false,
      snapEnabled: true,
      preventOverlap: true,
      cols: 12,
      rowHeight: 52,
    };
    onUpdate({
      ...workspace,
      infoBoards: [...boards, nextBoard],
    });
    setActiveBoardId(nextBoard.id);
  };

  const handleDeleteBoard = (boardId: string) => {
    if (boards.length <= 1) return;
    const remaining = boards.filter((b) => b.id !== boardId);
    onUpdate({
      ...workspace,
      infoBoards: remaining,
      infoWidgets: (workspace.infoWidgets ?? []).filter(
        (w) => w.boardId !== boardId
      ),
    });
    if (activeBoardId === boardId) {
      setActiveBoardId(remaining[0].id);
    }
    onNotify("已删除信息画布");
  };

  const commitBoardRename = () => {
    if (!renamingBoardId) return;
    const trimmed = renameDraft.trim();
    if (trimmed) {
      onUpdate({
        ...workspace,
        infoBoards: boards.map((b) =>
          b.id === renamingBoardId ? { ...b, name: trimmed } : b
        ),
      });
    }
    setRenamingBoardId(null);
  };

  // Widget CRUD
  const openNewWidgetDialog = (
    preferredGridX = 0,
    preferredGridY = 0,
    preferredPxX?: number,
    preferredPxY?: number
  ) => {
    const slot = findNearestFreeSlot(
      boardWidgets,
      4,
      4,
      gridCols,
      preferredGridX,
      preferredGridY
    );
    const defaultSize = gridLayoutToPixelRect(
      { x: 0, y: 0, w: 4, h: 4 },
      colWidth,
      rowHeight,
      GRID_GAP
    );
    const pxSlot = findFreePixelSlot(
      Array.from(baseRects.values()),
      defaultSize.w,
      defaultSize.h,
      containerWidth,
      preferredPxX ?? slot.x * (colWidth + GRID_GAP),
      preferredPxY ?? slot.y * (rowHeight + GRID_GAP),
      SNAP_GAP
    );
    setEditingWidget(null);
    setInitialNewGrid(slot);
    setInitialNewPixel(pxSlot);
    setEditorOpen(true);
  };

  const handleAddFromTemplate = (
    tpl: InfoWidgetTemplate,
    preferredGridX = 0,
    preferredGridY = 0,
    preferredPxX?: number,
    preferredPxY?: number
  ) => {
    const slot = findNearestFreeSlot(
      boardWidgets,
      tpl.w,
      tpl.h,
      gridCols,
      preferredGridX,
      preferredGridY
    );
    const wCount = Math.min(gridCols, tpl.w);
    const tplPx = gridLayoutToPixelRect(
      { x: 0, y: 0, w: wCount, h: tpl.h },
      colWidth,
      rowHeight,
      GRID_GAP
    );
    const pxSlot = findFreePixelSlot(
      Array.from(baseRects.values()),
      tplPx.w,
      tplPx.h,
      containerWidth,
      preferredPxX ?? slot.x * (colWidth + GRID_GAP),
      preferredPxY ?? slot.y * (rowHeight + GRID_GAP),
      SNAP_GAP
    );
    const now = new Date().toISOString();
    const widget: InfoWidget = {
      id: uid("info"),
      boardId: activeBoard.id,
      title: tpl.defaultTitle,
      description: tpl.description,
      source: { ...tpl.source },
      schedule: { ...tpl.schedule },
      layout: {
        x: slot.x,
        y: slot.y,
        w: wCount,
        h: tpl.h,
        minW: 2,
        minH: 2,
        px: pxSlot.x,
        py: pxSlot.y,
        pw: tplPx.w,
        ph: tplPx.h,
      },
      appearance: {
        accentColor: tpl.accentColor,
      },
      createdAt: now,
      updatedAt: now,
    };
    onUpdate({
      ...workspace,
      infoWidgets: [...(workspace.infoWidgets ?? []), widget],
    });
    onNotify(`已添加「${widget.title}」`);
    if (widget.source.kind !== "push") {
      void onRunWidget(widget, "manual");
    }
  };

  const handleSaveWidget = (saved: InfoWidget, runImmediately?: boolean) => {
    const existing = (workspace.infoWidgets ?? []).some(
      (w) => w.id === saved.id
    );
    let nextWidgets: InfoWidget[];
    if (existing) {
      nextWidgets = (workspace.infoWidgets ?? []).map((w) => {
        if (w.id !== saved.id) return w;
        // If size preset changed in editor (pw/ph cleared), recompute px size
        if (saved.layout.pw === undefined || saved.layout.ph === undefined) {
          const newSize = gridLayoutToPixelRect(
            saved.layout,
            colWidth,
            rowHeight,
            GRID_GAP
          );
          return {
            ...saved,
            layout: {
              ...saved.layout,
              pw: newSize.w,
              ph: newSize.h,
            },
          };
        }
        return saved;
      });
    } else {
      const slot = findNearestFreeSlot(
        boardWidgets,
        saved.layout.w,
        saved.layout.h,
        gridCols,
        saved.layout.x,
        saved.layout.y
      );
      const pxSize = gridLayoutToPixelRect(
        saved.layout,
        colWidth,
        rowHeight,
        GRID_GAP
      );
      const pxSlot = findFreePixelSlot(
        Array.from(baseRects.values()),
        pxSize.w,
        pxSize.h,
        containerWidth,
        saved.layout.px ?? slot.x * (colWidth + GRID_GAP),
        saved.layout.py ?? slot.y * (rowHeight + GRID_GAP),
        SNAP_GAP
      );
      const placed: InfoWidget = {
        ...saved,
        layout: {
          ...saved.layout,
          x: slot.x,
          y: slot.y,
          px: pxSlot.x,
          py: pxSlot.y,
          pw: pxSize.w,
          ph: pxSize.h,
        },
      };
      nextWidgets = [...(workspace.infoWidgets ?? []), placed];
      saved = placed;
    }

    onUpdate({
      ...workspace,
      infoWidgets: nextWidgets,
    });
    onNotify(existing ? `已更新「${saved.title}」` : `已添加「${saved.title}」`);
    if (runImmediately) {
      void onRunWidget(saved, "manual");
    }
  };

  const handleSendToKanban = (title: string, notes?: string) => {
    const firstCol = workspace.columns[0];
    if (!firstCol) {
      onNotify("请先在「看板」中创建一个列");
      return;
    }
    onUpdate({
      ...workspace,
      tasks: [
        {
          id: uid("task"),
          title,
          notes,
          columnId: firstCol.id,
          importance: 2,
          effort: "M",
          estimatedMinutes: 60,
          actualMinutes: 0,
          status: "todo",
          createdAt: new Date().toISOString(),
        },
        ...workspace.tasks,
      ],
    });
    onNotify(`已转入看板「${firstCol.title}」`);
  };

  const handleSendToIdea = (content: string) => {
    if (!content.trim()) return;
    onUpdate({
      ...workspace,
      ideas: [
        {
          id: uid("idea"),
          content: content.trim(),
          tag: "信息",
          createdAt: new Date().toISOString(),
        },
        ...workspace.ideas,
      ],
    });
    onNotify("已收入灵感流");
  };

  const handleCanvasContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-info-widget]")) return;
    e.preventDefault();
    const rect = gridContainerRef.current?.getBoundingClientRect();
    let gx = 0;
    let gy = 0;
    let px = 0;
    let py = 0;
    if (rect) {
      const relX = Math.max(0, e.clientX - rect.left);
      const relY = Math.max(0, e.clientY - rect.top);
      px = Math.round(relX);
      py = Math.round(relY);
      gx = Math.max(
        0,
        Math.min(gridCols - 1, Math.floor(relX / (colWidth + GRID_GAP)))
      );
      gy = Math.max(0, Math.floor(relY / (rowHeight + GRID_GAP)));
    }
    setContextMenu({
      kind: "canvas",
      gridX: gx,
      gridY: gy,
      pixelX: px,
      pixelY: py,
      x: e.clientX,
      y: e.clientY,
    });
  };

  const handleExportBoard = () => {
    const payload = {
      board: activeBoard,
      widgets: boardWidgets,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shibaplan-info-${activeBoard.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onNotify("已导出当前信息画布配置");
  };

  const handleImportBoard = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { widgets?: InfoWidget[] };
      if (!parsed || !Array.isArray(parsed.widgets)) {
        onNotify("画布配置文件格式无效");
        return;
      }
      const now = new Date().toISOString();
      const imported = parsed.widgets.map((w) => ({
        ...w,
        id: uid("info"),
        boardId: activeBoard.id,
        createdAt: w.createdAt || now,
        updatedAt: now,
      }));
      onUpdate({
        ...workspace,
        infoWidgets: [...(workspace.infoWidgets ?? []), ...imported],
      });
      onNotify(`已导入 ${imported.length} 张信息卡片`);
    } catch {
      onNotify("导入配置失败");
    } finally {
      e.target.value = "";
    }
  };

  const ctxWidget =
    contextMenu?.kind === "widget"
      ? boardWidgets.find((w) => w.id === contextMenu.widgetId) ?? null
      : null;

  const logWidget = logWidgetId
    ? (workspace.infoWidgets ?? []).find((w) => w.id === logWidgetId) ?? null
    : null;

  const showGrid = Boolean(activeBoard.showGrid ?? true) || Boolean(interaction);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface/50 px-4 py-2 select-none">
        {/* Left: Board Switcher */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {boards.map((b) => {
            const active = b.id === activeBoard.id;
            if (renamingBoardId === b.id) {
              return (
                <input
                  key={b.id}
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={commitBoardRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitBoardRename();
                    if (e.key === "Escape") setRenamingBoardId(null);
                  }}
                  className="h-7 w-28 rounded-md border border-primary bg-background px-2 text-xs text-foreground focus:outline-none"
                />
              );
            }
            return (
              <div
                key={b.id}
                onClick={() => setActiveBoardId(b.id)}
                onDoubleClick={() => {
                  setRenamingBoardId(b.id);
                  setRenameDraft(b.name);
                }}
                title="单击切换，双击重命名"
                className={`group/tab flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-accent text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                }`}
              >
                <span className="truncate max-w-[140px]">{b.name}</span>
                {boards.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteBoard(b.id);
                    }}
                    title="删除画布"
                    className="hidden rounded p-0.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive group-hover/tab:inline-flex"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
            );
          })}
          <button
            type="button"
            onClick={handleAddBoard}
            title="新建子画布"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Right: Controls */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() =>
              updateBoardMeta({
                layoutMode: layoutMode === "free" ? "grid" : "free",
              })
            }
            title={
              layoutMode === "free"
                ? "当前：自由拖拽（不限网格，支持智能磁吸参考线，按住 Alt 临时取消吸附）"
                : "当前：网格对齐（卡片自动对齐 12 列网格）"
            }
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background/70 px-2 text-[11.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            <span>{layoutMode === "free" ? "自由拖拽" : "网格对齐"}</span>
          </button>

          {layoutMode === "free" && (
            <button
              type="button"
              onClick={() => updateBoardMeta({ snapEnabled: !snapEnabled })}
              title="开启/关闭智能磁吸与对齐参考线（拖拽时按住 Alt 可临时忽略吸附）"
              className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11.5px] transition-colors ${
                snapEnabled
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-background/70 text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <Magnet className="h-3.5 w-3.5" />
              <span className="hidden md:inline">磁吸</span>
            </button>
          )}

          <button
            type="button"
            onClick={() =>
              updateBoardMeta({ showGrid: !(activeBoard.showGrid ?? true) })
            }
            title="显示/隐藏背景参考网格"
            className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11.5px] transition-colors ${
              activeBoard.showGrid ?? true
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-background/70 text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <Grid className="h-3.5 w-3.5" />
            <span className="hidden md:inline">参考点阵</span>
          </button>

          <button
            type="button"
            onClick={() => updateBoardMeta({ locked: !locked })}
            title={locked ? "已锁定布局，点击解锁" : "锁定布局防止误拖"}
            className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11.5px] transition-colors ${
              locked
                ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
                : "border-border bg-background/70 text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            {locked ? (
              <Lock className="h-3.5 w-3.5" />
            ) : (
              <Unlock className="h-3.5 w-3.5" />
            )}
            <span className="hidden md:inline">{locked ? "已锁定" : "锁定"}</span>
          </button>

          <div className="h-4 w-px bg-border" />

          <button
            type="button"
            onClick={() => setPushDialogOpen(true)}
            title={
              pushServerStatus?.running
                ? `外部推送接收中：${pushBaseUrl}/api/info/push/<key>`
                : "点击配置外部脚本推送接收服务"
            }
            className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11.5px] transition-colors ${
              pushServerStatus?.running
                ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/15"
                : "border-border bg-background/70 text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <Radio className="h-3.5 w-3.5" />
            <span className="font-mono text-[11px]">
              {pushServerStatus?.running
                ? `推送 :${pushServerStatus.port}`
                : "推送已停"}
            </span>
          </button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setProtocolOpen(true)}
            className="h-7 gap-1 px-2 text-xs"
          >
            <BookOpen className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">接口规范</span>
          </Button>

          <Button
            variant="secondary"
            size="sm"
            disabled={boardWidgets.length === 0}
            onClick={() => void onRunAllWidgets(activeBoard.id)}
            className="h-7 gap-1 px-2.5 text-xs"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>全部刷新</span>
          </Button>

          <Button
            size="sm"
            onClick={() => openNewWidgetDialog(0, 0)}
            className="h-7 gap-1 px-2.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>新建卡片</span>
          </Button>
        </div>
      </div>

      {/* Main Freeform / Grid Canvas */}
      <div
        ref={canvasScrollRef}
        onContextMenu={handleCanvasContextMenu}
        className="relative flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-5"
      >
        <div
          ref={gridContainerRef}
          className="relative w-full"
          style={{
            minHeight: Math.max(480, canvasHeight),
          }}
        >
          {/* Background Reference Layer */}
          {showGrid && layoutMode === "free" && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-xl"
              style={{
                backgroundImage:
                  "radial-gradient(circle, hsl(var(--muted-foreground) / 0.22) 1px, transparent 1px)",
                backgroundSize: `${DOT_GRID_STEP}px ${DOT_GRID_STEP}px`,
              }}
            />
          )}

          {showGrid && layoutMode !== "free" && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
            >
              {Array.from({ length: canvasRows }).map((_, rIdx) => (
                <div
                  key={rIdx}
                  className="flex"
                  style={{
                    height: rowHeight,
                    marginBottom: rIdx < canvasRows - 1 ? GRID_GAP : 0,
                    gap: GRID_GAP,
                  }}
                >
                  {Array.from({ length: gridCols }).map((__, cIdx) => (
                    <div
                      key={cIdx}
                      className="flex-1 rounded-lg border border-dashed border-border/35 bg-surface/15"
                    />
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Empty State Onboarding */}
          {boardWidgets.length === 0 && (
            <div className="relative z-10 flex min-h-[420px] flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border bg-surface/20 p-6 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/12 text-primary">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="max-w-md space-y-1.5">
                <h2 className="text-sm font-semibold text-foreground">
                  打造你的自动化信息仪表盘
                </h2>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  支持本地脚本、命令行、HTTP 接口与外部主动推送；卡片可 1:1 自由拖拽定位与多边缘缩放大小，并自动显示磁吸对齐参考线（按住 Alt 可临时忽略吸附）。
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button size="sm" onClick={() => openNewWidgetDialog(0, 0)}>
                  <Plus className="h-3.5 w-3.5" />
                  <span>新建自定义卡片</span>
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    handleAddFromTemplate(INFO_WIDGET_TEMPLATES[0], 0, 0)
                  }
                >
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  <span>添加系统监控示例</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setProtocolOpen(true)}
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  <span>查看接口规范</span>
                </Button>
              </div>
            </div>
          )}

          {/* Ghost Snap Target Preview (in grid/compact mode) */}
          {interaction?.ghostGridRect && (
            <div
              aria-hidden="true"
              style={{
                left: interaction.ghostGridRect.x,
                top: interaction.ghostGridRect.y,
                width: interaction.ghostGridRect.w,
                height: interaction.ghostGridRect.h,
              }}
              className="pointer-events-none absolute z-0 rounded-xl border-2 border-dashed border-primary/70 bg-primary/10 transition-all duration-75"
            />
          )}

          {/* Magnetic Alignment Guide Lines */}
          {interaction && interaction.guides.length > 0 && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-40"
            >
              {interaction.guides.map((g, idx) => {
                const start = Math.max(0, g.start);
                const length = Math.max(24, g.end - start);
                if (g.orientation === "v") {
                  return (
                    <React.Fragment key={`vg-${idx}`}>
                      <div
                        style={{
                          left: g.pos,
                          top: start,
                          height: length,
                        }}
                        className="absolute w-px border-l border-dashed border-primary shadow-[0_0_6px_hsl(var(--primary)/0.55)]"
                      />
                      {g.label && (
                        <span
                          style={{
                            left: g.pos + 4,
                            top: start + length / 2 - 9,
                          }}
                          className="absolute rounded bg-primary px-1 py-px font-mono text-[9.5px] font-medium text-primary-foreground shadow"
                        >
                          {g.label}
                        </span>
                      )}
                    </React.Fragment>
                  );
                }
                return (
                  <React.Fragment key={`hg-${idx}`}>
                    <div
                      style={{
                        top: g.pos,
                        left: start,
                        width: length,
                      }}
                      className="absolute h-px border-t border-dashed border-primary shadow-[0_0_6px_hsl(var(--primary)/0.55)]"
                    />
                    {g.label && (
                      <span
                        style={{
                          top: g.pos + 4,
                          left: start + length / 2 - 14,
                        }}
                        className="absolute rounded bg-primary px-1 py-px font-mono text-[9.5px] font-medium text-primary-foreground shadow"
                      >
                        {g.label}
                      </span>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          )}

          {/* Widgets */}
          {boardWidgets.map((widget) => {
            const pixelRect =
              activeRects.get(widget.id) ??
              getWidgetPixelRect(
                widget,
                colWidth,
                rowHeight,
                GRID_GAP,
                layoutMode !== "free"
              );
            const gridSizeLabel =
              layoutMode !== "free" &&
              interaction?.widgetId === widget.id &&
              interaction.targetGridLayout
                ? `${interaction.targetGridLayout.w} × ${interaction.targetGridLayout.h}`
                : undefined;

            return (
              <InfoWidgetCard
                key={widget.id}
                widget={widget}
                pixelRect={pixelRect}
                gridSizeLabel={gridSizeLabel}
                runtime={runtimeMap[widget.id]}
                locked={locked}
                pushBaseUrl={pushBaseUrl}
                isDragging={
                  interaction?.mode === "drag" &&
                  interaction.widgetId === widget.id
                }
                isResizing={
                  interaction?.mode === "resize" &&
                  interaction.widgetId === widget.id
                }
                anyInteracting={Boolean(interaction)}
                onStartDrag={handleStartDrag}
                onStartResize={handleStartResize}
                onRun={(w) => void onRunWidget(w, "manual")}
                onCancel={(w) => void onCancelWidget(w.id)}
                onEdit={(w) => {
                  setEditingWidget(w);
                  setInitialNewGrid(undefined);
                  setInitialNewPixel(undefined);
                  setEditorOpen(true);
                }}
                onViewLogs={(w) => setLogWidgetId(w.id)}
                onContextMenu={(e, w) =>
                  setContextMenu({
                    kind: "widget",
                    widgetId: w.id,
                    x: e.clientX,
                    y: e.clientY,
                  })
                }
                onSendItemToKanban={handleSendToKanban}
                onSendItemToIdea={handleSendToIdea}
                onNotify={onNotify}
              />
            );
          })}
        </div>
      </div>

      {/* Hidden File Input for Board Config Import */}
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        onChange={handleImportBoard}
        className="hidden"
      />

      {/* Right-Click Context Menu */}
      {contextMenu && (
        <InfoContextMenu
          menu={contextMenu}
          widget={ctxWidget}
          board={activeBoard}
          isRunning={Boolean(ctxWidget && runtimeMap[ctxWidget.id]?.running)}
          hasColumns={workspace.columns.length > 0}
          pushBaseUrl={pushBaseUrl}
          onClose={() => setContextMenu(null)}
          onNotify={onNotify}
          onRunWidget={(w) => void onRunWidget(w, "manual")}
          onCancelWidget={(w) => void onCancelWidget(w.id)}
          onEditWidget={(w) => {
            setEditingWidget(w);
            setInitialNewGrid(undefined);
            setInitialNewPixel(undefined);
            setEditorOpen(true);
          }}
          onViewLogs={(w) => setLogWidgetId(w.id)}
          onCopyPlainText={(w) => {
            const res = runtimeMap[w.id]?.lastResult;
            if (!res) {
              onNotify("暂无输出内容");
              return;
            }
            const parsed = parseInfoOutput(res, w.source.jsonPath);
            navigator.clipboard
              .writeText(extractPlainTextFromParsed(parsed))
              .catch(() => {});
            onNotify("已复制展示文本");
          }}
          onCopyRawOutput={(w) => {
            const res = runtimeMap[w.id]?.lastResult;
            if (!res) {
              onNotify("暂无输出内容");
              return;
            }
            navigator.clipboard.writeText(res.stdout).catch(() => {});
            onNotify("已复制原始输出");
          }}
          onSendToKanban={(w) => {
            const res = runtimeMap[w.id]?.lastResult;
            const parsed = res
              ? parseInfoOutput(res, w.source.jsonPath)
              : null;
            handleSendToKanban(
              parsed?.title || w.title,
              parsed ? extractPlainTextFromParsed(parsed) : w.description
            );
          }}
          onSendToIdea={(w) => {
            const res = runtimeMap[w.id]?.lastResult;
            const parsed = res
              ? parseInfoOutput(res, w.source.jsonPath)
              : null;
            const text = parsed
              ? `${parsed.title || w.title}\n${extractPlainTextFromParsed(parsed)}`
              : w.title;
            handleSendToIdea(text);
          }}
          onTogglePause={(w) => {
            onUpdate({
              ...workspace,
              infoWidgets: (workspace.infoWidgets ?? []).map((item) =>
                item.id === w.id
                  ? {
                      ...item,
                      schedule: {
                        ...item.schedule,
                        paused: !item.schedule.paused,
                      },
                    }
                  : item
              ),
            });
            onNotify(w.schedule.paused ? "已恢复自动任务" : "已暂停自动任务");
          }}
          onSetAccent={(w, color) => {
            onUpdate({
              ...workspace,
              infoWidgets: (workspace.infoWidgets ?? []).map((item) =>
                item.id === w.id
                  ? {
                      ...item,
                      appearance: {
                        ...(item.appearance ?? {}),
                        accentColor: color,
                      },
                    }
                  : item
              ),
            });
          }}
          onToggleHideHeader={(w) => {
            onUpdate({
              ...workspace,
              infoWidgets: (workspace.infoWidgets ?? []).map((item) =>
                item.id === w.id
                  ? {
                      ...item,
                      appearance: {
                        ...(item.appearance ?? {}),
                        hideHeader: !item.appearance?.hideHeader,
                      },
                    }
                  : item
              ),
            });
          }}
          onResetWidgetSize={(w) => {
            const defaultSize = gridLayoutToPixelRect(
              { x: 0, y: 0, w: Math.min(gridCols, 4), h: 4 },
              colWidth,
              rowHeight,
              GRID_GAP
            );
            if (layoutMode === "free") {
              const curR =
                baseRects.get(w.id) ??
                getWidgetPixelRect(w, colWidth, rowHeight, GRID_GAP, false);
              let map = new Map(baseRects);
              map.set(w.id, { ...curR, w: defaultSize.w, h: defaultSize.h });
              if (preventOverlap) {
                map = resolvePixelOverlap(map, w.id, SNAP_GAP);
              }
              replaceBoardWidgets(
                boardWidgets.map((item) => {
                  const r = map.get(item.id);
                  return r
                    ? {
                        ...item,
                        layout: syncLayoutFromPixelRect(
                          item.layout,
                          r,
                          colWidth,
                          rowHeight,
                          GRID_GAP,
                          gridCols
                        ),
                      }
                    : item;
                })
              );
            } else {
              const resolved = resolveGridCollision(
                boardWidgets,
                w.id,
                { ...w.layout, w: Math.min(gridCols, 4), h: 4 },
                gridCols,
                layoutMode
              );
              replaceBoardWidgets(resolved);
            }
          }}
          onCloneWidget={(w) => {
            const curR =
              baseRects.get(w.id) ??
              getWidgetPixelRect(w, colWidth, rowHeight, GRID_GAP, false);
            const slot = findNearestFreeSlot(
              boardWidgets,
              w.layout.w,
              w.layout.h,
              gridCols,
              w.layout.x,
              w.layout.y + w.layout.h
            );
            const pxSlot = findFreePixelSlot(
              Array.from(baseRects.values()),
              curR.w,
              curR.h,
              containerWidth,
              curR.x,
              curR.y + curR.h + SNAP_GAP,
              SNAP_GAP
            );
            const now = new Date().toISOString();
            const cloned: InfoWidget = {
              ...w,
              id: uid("info"),
              title: `${w.title} (副本)`,
              layout: {
                ...w.layout,
                x: slot.x,
                y: slot.y,
                px: pxSlot.x,
                py: pxSlot.y,
                pw: curR.w,
                ph: curR.h,
              },
              createdAt: now,
              updatedAt: now,
            };
            onUpdate({
              ...workspace,
              infoWidgets: [...(workspace.infoWidgets ?? []), cloned],
            });
            onNotify("已克隆卡片");
          }}
          onDeleteWidget={(w) => {
            onUpdate({
              ...workspace,
              infoWidgets: (workspace.infoWidgets ?? []).filter(
                (item) => item.id !== w.id
              ),
            });
            onNotify(`已删除「${w.title}」`);
          }}
          onAddAtPos={(gx, gy, px, py) => openNewWidgetDialog(gx, gy, px, py)}
          onAddFromTemplate={(tpl, gx, gy, px, py) =>
            handleAddFromTemplate(tpl, gx, gy, px, py)
          }
          onRefreshAll={() => void onRunAllWidgets(activeBoard.id)}
          onToggleLayoutMode={(nextMode) => {
            updateBoardMeta({ layoutMode: nextMode });
            if (nextMode !== "free") {
              replaceBoardWidgets(
                autoArrangeWidgets(
                  boardWidgets,
                  gridCols,
                  colWidth,
                  rowHeight,
                  GRID_GAP
                )
              );
            }
          }}
          onToggleSnap={() => updateBoardMeta({ snapEnabled: !snapEnabled })}
          onTogglePreventOverlap={() =>
            updateBoardMeta({ preventOverlap: !preventOverlap })
          }
          onToggleGrid={() =>
            updateBoardMeta({ showGrid: !(activeBoard.showGrid ?? true) })
          }
          onToggleLocked={() => updateBoardMeta({ locked: !locked })}
          onAutoArrange={() => {
            replaceBoardWidgets(
              autoArrangeWidgets(
                boardWidgets,
                gridCols,
                colWidth,
                rowHeight,
                GRID_GAP
              )
            );
            onNotify("已自动整理对齐卡片");
          }}
          onOpenScriptsDir={() => {
            getInfoScriptsDir(workspace.settings.customDataDir)
              .then((dir) => openPathInOs(dir))
              .catch(() => {});
          }}
          onOpenProtocolDoc={() => setProtocolOpen(true)}
          onExportBoard={handleExportBoard}
          onImportBoard={() => importInputRef.current?.click()}
        />
      )}

      {/* Editor Dialog */}
      <InfoWidgetEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        editingWidget={editingWidget}
        boardId={activeBoard.id}
        initialGrid={initialNewGrid}
        initialPixel={initialNewPixel}
        customDataDir={workspace.settings.customDataDir}
        pushBaseUrl={pushBaseUrl}
        onSave={handleSaveWidget}
        onNotify={onNotify}
      />

      {/* Push Receiver Config Dialog */}
      <InfoPushServerDialog
        open={pushDialogOpen}
        onOpenChange={setPushDialogOpen}
        config={pushConfig}
        status={pushServerStatus}
        onApply={onApplyPushConfig}
        onNotify={onNotify}
      />

      {/* Protocol Spec Dialog */}
      <InfoProtocolDialog
        open={protocolOpen}
        onOpenChange={setProtocolOpen}
        onNotify={onNotify}
      />

      {/* History Log Dialog */}
      <InfoLogDialog
        open={Boolean(logWidget)}
        onOpenChange={(o) => {
          if (!o) setLogWidgetId(null);
        }}
        widget={logWidget}
        runtime={logWidget ? runtimeMap[logWidget.id] : undefined}
        onRunNow={(w) => void onRunWidget(w, "manual")}
        onNotify={onNotify}
      />
    </div>
  );
};
