import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BookOpen,
  Check,
  FileCode2,
  Frame,
  Grid,
  Magnet,
  Maximize2,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Sparkles,
  ToggleRight,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  InfoBoard,
  InfoControlType,
  InfoPushServerConfig,
  InfoScriptLang,
  InfoSourceKind,
  InfoWidget,
  WorkspaceData,
} from "../types";
import {
  createDefaultInfoBoards,
  isTauriRuntime,
  openPathInOs,
  uid,
} from "../lib/storage";
import { openExternalUrl } from "../lib/updater";
import {
  applyPixelRectToLayout,
  arrangeWidgetsInsideContainer,
  autoArrangeFreeformWidgets,
  DEFAULT_CONTAINER_PX_H,
  DEFAULT_CONTAINER_PX_W,
  DEFAULT_CONTROL_ICON_H,
  DEFAULT_CONTROL_ICON_W,
  DEFAULT_CONTROL_SWITCH_H,
  DEFAULT_CONTROL_SWITCH_W,
  DEFAULT_WIDGET_PX_H,
  DEFAULT_WIDGET_PX_W,
  DOT_GRID_STEP,
  findFreePixelSlot,
  findTargetContainerId,
  getWidgetPixelRect,
  gridLayoutToPixelRect,
  MIN_WIDGET_PX_H,
  MIN_WIDGET_PX_W,
  PixelRect,
  SNAP_GAP,
  SnapGuide,
  snapMovePixelRect,
  snapResizePixelRect,
} from "../lib/infoGrid";
import {
  extractPlainTextFromParsed,
  inferScriptFromFilename,
  INFO_WIDGET_TEMPLATES,
  InfoWidgetTemplate,
  parseInfoOutput,
} from "../lib/infoProtocol";
import {
  getInfoScriptsDir,
  InfoPushServerStatus,
  InfoWidgetRuntimeState,
  readScriptFile,
} from "../lib/infoRunner";
import { Button } from "./ui/button";
import { InfoWidgetCard, ResizeEdge } from "./info/InfoWidgetCard";
import { InfoContextMenu, InfoMenuState } from "./info/InfoContextMenu";
import { InfoWidgetEditorDialog } from "./info/InfoWidgetEditorDialog";
import { InfoProtocolDialog } from "./info/InfoProtocolDialog";
import { InfoLogDialog } from "./info/InfoLogDialog";
import { InfoPushServerDialog } from "./info/InfoPushServerDialog";

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.0;
const DEFAULT_PAN = { x: 24, y: 24 };

function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(z.toFixed(3))));
}

function canScrollableAncestorHandleWheel(
  target: EventTarget | null,
  boundary: HTMLElement,
  deltaX: number,
  deltaY: number
): boolean {
  let el = target instanceof HTMLElement ? target : null;
  if (!el || !el.closest("[data-info-widget]")) return false;
  while (el && el !== boundary) {
    const cs = window.getComputedStyle(el);
    if (
      (cs.overflowY === "auto" || cs.overflowY === "scroll") &&
      el.scrollHeight > el.clientHeight + 1
    ) {
      if (
        (deltaY < 0 && el.scrollTop > 0) ||
        (deltaY > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1)
      ) {
        return true;
      }
    }
    if (
      (cs.overflowX === "auto" || cs.overflowX === "scroll") &&
      el.scrollWidth > el.clientWidth + 1
    ) {
      if (
        (deltaX < 0 && el.scrollLeft > 0) ||
        (deltaX > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
      ) {
        return true;
      }
    }
    el = el.parentElement;
  }
  return false;
}

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
  dropTargetContainerId?: string;
  movingChildIds?: Set<string>;
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

  // Infinite Canvas Viewport (pan + zoom)
  const viewportRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState<{ x: number; y: number }>(DEFAULT_PAN);
  const [zoom, setZoom] = useState<number>(1);
  const [isPanning, setIsPanning] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);

  const panRef = useRef(pan);
  panRef.current = pan;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const snapEnabled = activeBoard.snapEnabled ?? true;
  const [editMode, setEditMode] = useState(false);
  const editModeRef = useRef(editMode);
  editModeRef.current = editMode;
  const locked = !editMode;

  const boardWidgets = useMemo(
    () =>
      (workspace.infoWidgets ?? []).filter((w) => w.boardId === activeBoard.id),
    [workspace.infoWidgets, activeBoard.id]
  );

  // World-space PixelRect map for every widget on the current board (infinite coordinates)
  const baseRects = useMemo(() => {
    const map = new Map<string, PixelRect>();
    for (const w of boardWidgets) {
      map.set(w.id, getWidgetPixelRect(w));
    }
    return map;
  }, [boardWidgets]);

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
  const [initialNewPos, setInitialNewPos] = useState<
    { x: number; y: number } | undefined
  >(undefined);
  const [initialNewKind, setInitialNewKind] = useState<
    InfoSourceKind | undefined
  >(undefined);
  const [protocolOpen, setProtocolOpen] = useState(false);
  const [pushDialogOpen, setPushDialogOpen] = useState(false);
  const [logWidgetId, setLogWidgetId] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  // Script File Drag-and-Drop state
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const dragDepthRef = useRef(0);
  const lastNativeDropAtRef = useRef(0);

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

  // Cursor-centered exponential zoom helper
  const zoomAtPoint = useCallback(
    (clientX: number, clientY: number, nextZoom: number) => {
      const el = viewportRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const clamped = clampZoom(nextZoom);
      const curZoom = zoomRef.current;
      const curPan = panRef.current;
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const worldX = (localX - curPan.x) / curZoom;
      const worldY = (localY - curPan.y) / curZoom;
      const nextPan = {
        x: Math.round(localX - worldX * clamped),
        y: Math.round(localY - worldY * clamped),
      };
      panRef.current = nextPan;
      zoomRef.current = clamped;
      setZoom(clamped);
      setPan(nextPan);
    },
    []
  );

  const zoomAroundCenter = useCallback(
    (nextZoom: number) => {
      const el = viewportRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      zoomAtPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        nextZoom
      );
    },
    [zoomAtPoint]
  );

  const resetView = useCallback(() => {
    panRef.current = DEFAULT_PAN;
    zoomRef.current = 1;
    setPan(DEFAULT_PAN);
    setZoom(1);
  }, []);

  const fitAllWidgets = useCallback(() => {
    const rects = Array.from(baseRectsRef.current.values());
    if (rects.length === 0) {
      resetView();
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const r of rects) {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w);
      maxY = Math.max(maxY, r.y + r.h);
    }

    const el = viewportRef.current;
    const vw = el?.clientWidth ?? 1000;
    const vh = el?.clientHeight ?? 650;
    const pad = 48;
    const spanW = Math.max(1, maxX - minX);
    const spanH = Math.max(1, maxY - minY);
    const nextZoom = clampZoom(
      Math.min(1.2, (vw - pad * 2) / spanW, (vh - pad * 2) / spanH)
    );

    const contentW = spanW * nextZoom;
    const contentH = spanH * nextZoom;
    const nextPan = {
      x: Math.round((vw - contentW) / 2 - minX * nextZoom),
      y: Math.round((vh - contentH) / 2 - minY * nextZoom),
    };
    panRef.current = nextPan;
    zoomRef.current = nextZoom;
    setZoom(nextZoom);
    setPan(nextPan);
  }, [resetView]);

  const focusRectInViewport = useCallback((rect: PixelRect) => {
    const el = viewportRef.current;
    const vw = el?.clientWidth ?? 1000;
    const vh = el?.clientHeight ?? 650;
    const pad = 48;
    const curZoom = zoomRef.current;
    const fitsAtCurZoom =
      rect.w * curZoom <= vw - pad * 2 && rect.h * curZoom <= vh - pad * 2;
    const nextZoom =
      fitsAtCurZoom && curZoom >= 0.75
        ? curZoom
        : clampZoom(
            Math.min(
              1,
              (vw - pad * 2) / Math.max(1, rect.w),
              (vh - pad * 2) / Math.max(1, rect.h)
            )
          );
    const centerX = rect.x + rect.w / 2;
    const centerY = rect.y + rect.h / 2;
    const nextPan = {
      x: Math.round(vw / 2 - centerX * nextZoom),
      y: Math.round(vh / 2 - centerY * nextZoom),
    };
    panRef.current = nextPan;
    zoomRef.current = nextZoom;
    setZoom(nextZoom);
    setPan(nextPan);
  }, []);

  // Native non-passive wheel listener: Ctrl/Cmd+Wheel zooms around cursor, plain wheel pans canvas
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * 0.0018);
        zoomAtPoint(e.clientX, e.clientY, zoomRef.current * factor);
        return;
      }

      if (canScrollableAncestorHandleWheel(e.target, el, e.deltaX, e.deltaY)) {
        return;
      }

      e.preventDefault();
      const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
      const dy = e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY;
      setPan((prev) => {
        const next = { x: prev.x - dx, y: prev.y - dy };
        panRef.current = next;
        return next;
      });
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", handleWheel);
    };
  }, [zoomAtPoint]);

  // Keyboard shortcuts: Space (pan), Ctrl+= / Ctrl+- / Ctrl+0
  const anyDialogOpen =
    editorOpen || protocolOpen || pushDialogOpen || Boolean(logWidgetId);

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      const el = target instanceof HTMLElement ? target : null;
      if (!el) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el.isContentEditable
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (anyDialogOpen || isTypingTarget(e.target)) return;

      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        setSpacePressed(true);
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          zoomAroundCenter(zoomRef.current * 1.15);
        } else if (e.key === "-") {
          e.preventDefault();
          zoomAroundCenter(zoomRef.current / 1.15);
        } else if (e.key === "0") {
          e.preventDefault();
          resetView();
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setSpacePressed(false);
      }
    };

    const onBlur = () => setSpacePressed(false);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [anyDialogOpen, zoomAroundCenter, resetView]);

  // Canvas drag panning (middle mouse anywhere, Space+left-click anywhere, or left-click on empty canvas)
  const startCanvasPan = useCallback(
    (clientX: number, clientY: number) => {
      const startPan = panRef.current;
      setIsPanning(true);

      const onMove = (ev: PointerEvent) => {
        const next = {
          x: startPan.x + (ev.clientX - clientX),
          y: startPan.y + (ev.clientY - clientY),
        };
        panRef.current = next;
        setPan(next);
      };

      const onUp = () => {
        setIsPanning(false);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        window.removeEventListener("blur", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      window.addEventListener("blur", onUp);
    },
    []
  );

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

  // Zoom-compensated 1:1 Pointer-Synchronized Drag Handler (infinite freeform canvas)
  const handleStartDrag = useCallback(
    (e: React.PointerEvent, widget: InfoWidget) => {
      if (e.button !== 0 || !editModeRef.current || spacePressed) return;
      if ((e.target as HTMLElement).closest("button, a, input, select")) return;
      e.preventDefault();
      e.stopPropagation();

      const origRect =
        baseRectsRef.current.get(widget.id) ?? getWidgetPixelRect(widget);
      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const startZoom = zoomRef.current;

      const useSnap = activeBoardRef.current.snapEnabled ?? true;
      const isContainer = widget.source.kind === "container";
      const childIds = isContainer
        ? new Set(
            boardWidgetsRef.current
              .filter((w) => w.parentId === widget.id)
              .map((w) => w.id)
          )
        : new Set<string>();
      const containerItems = isContainer
        ? []
        : boardWidgetsRef.current
            .filter(
              (w) => w.source.kind === "container" && w.id !== widget.id
            )
            .map((w) => ({
              id: w.id,
              rect: baseRectsRef.current.get(w.id) ?? getWidgetPixelRect(w),
            }));

      let moved = false;

      const onMove = (ev: PointerEvent) => {
        const dx = (ev.clientX - startClientX) / startZoom;
        const dy = (ev.clientY - startClientY) / startZoom;
        if (
          !moved &&
          Math.abs(ev.clientX - startClientX) < 3 &&
          Math.abs(ev.clientY - startClientY) < 3
        ) {
          return;
        }
        moved = true;

        const rawRect: PixelRect = {
          x: origRect.x + dx,
          y: origRect.y + dy,
          w: origRect.w,
          h: origRect.h,
        };

        const otherItems: Array<{ id: string; rect: PixelRect }> = [];
        for (const [id, r] of baseRectsRef.current.entries()) {
          if (id !== widget.id && !childIds.has(id)) {
            otherItems.push({ id, rect: r });
          }
        }

        const snapped = snapMovePixelRect(widget.id, rawRect, otherItems, {
          snapEnabled: useSnap,
          altBypass: ev.altKey,
          gap: SNAP_GAP,
          gridStep: DOT_GRID_STEP,
        });

        const previewRects = new Map(baseRectsRef.current);
        previewRects.set(widget.id, snapped.rect);

        if (isContainer && childIds.size > 0) {
          const deltaX = snapped.rect.x - origRect.x;
          const deltaY = snapped.rect.y - origRect.y;
          for (const cid of childIds) {
            const cr = baseRectsRef.current.get(cid);
            if (cr) {
              previewRects.set(cid, {
                ...cr,
                x: cr.x + deltaX,
                y: cr.y + deltaY,
              });
            }
          }
        }

        const dropTargetContainerId = isContainer
          ? undefined
          : findTargetContainerId(snapped.rect, containerItems);

        setInteraction({
          mode: "drag",
          widgetId: widget.id,
          previewRects,
          guides: snapped.guides,
          dropTargetContainerId,
          movingChildIds: isContainer ? childIds : undefined,
        });
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        window.removeEventListener("blur", onUp);
        const cur = interactionRef.current;
        setInteraction(null);
        if (!cur || !moved) return;

        if (isContainer) {
          const nextWidgets = boardWidgetsRef.current.map((w) => {
            if (w.id === widget.id || childIds.has(w.id)) {
              const r = cur.previewRects.get(w.id);
              return r
                ? { ...w, layout: applyPixelRectToLayout(w.layout, r) }
                : w;
            }
            return w;
          });
          replaceBoardWidgets(nextWidgets);
          return;
        }

        const draggedRect = cur.previewRects.get(widget.id);
        if (!draggedRect) return;
        const nextParentId = cur.dropTargetContainerId;
        const nextWidgets = [
          ...boardWidgetsRef.current.filter((w) => w.id !== widget.id),
          ...boardWidgetsRef.current
            .filter((w) => w.id === widget.id)
            .map((w) => ({
              ...w,
              parentId: nextParentId,
              layout: applyPixelRectToLayout(w.layout, draggedRect),
            })),
        ];
        replaceBoardWidgets(nextWidgets);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      window.addEventListener("blur", onUp);
    },
    [spacePressed, replaceBoardWidgets]
  );

  // Zoom-compensated 1:1 Pointer-Synchronized 5-Edge Resize Handler (infinite canvas)
  const handleStartResize = useCallback(
    (e: React.PointerEvent, widget: InfoWidget, edge: ResizeEdge) => {
      if (e.button !== 0 || !editModeRef.current || spacePressed) return;
      e.preventDefault();
      e.stopPropagation();

      const origRect =
        baseRectsRef.current.get(widget.id) ?? getWidgetPixelRect(widget);
      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const startZoom = zoomRef.current;

      const useSnap = activeBoardRef.current.snapEnabled ?? true;

      let changed = false;

      const onMove = (ev: PointerEvent) => {
        const dx = (ev.clientX - startClientX) / startZoom;
        const dy = (ev.clientY - startClientY) / startZoom;
        if (!changed && Math.abs(ev.clientX - startClientX) < 3 && Math.abs(ev.clientY - startClientY) < 3) {
          return;
        }
        changed = true;

        let nextX = origRect.x;
        let nextY = origRect.y;
        let nextW = origRect.w;
        let nextH = origRect.h;

        if (edge === "e" || edge === "se") {
          nextW = Math.max(MIN_WIDGET_PX_W, origRect.w + dx);
        }
        if (edge === "s" || edge === "se") {
          nextH = Math.max(MIN_WIDGET_PX_H, origRect.h + dy);
        }
        if (edge === "w") {
          const maxLeft = origRect.x + origRect.w - MIN_WIDGET_PX_W;
          nextX = Math.min(maxLeft, origRect.x + dx);
          nextW = origRect.x + origRect.w - nextX;
        }
        if (edge === "n") {
          const maxTop = origRect.y + origRect.h - MIN_WIDGET_PX_H;
          nextY = Math.min(maxTop, origRect.y + dy);
          nextH = origRect.y + origRect.h - nextY;
        }

        const rawRect: PixelRect = { x: nextX, y: nextY, w: nextW, h: nextH };

        const otherItems: Array<{ id: string; rect: PixelRect }> = [];
        for (const [id, r] of baseRectsRef.current.entries()) {
          if (id !== widget.id) otherItems.push({ id, rect: r });
        }

        const snapped = snapResizePixelRect(
          widget.id,
          rawRect,
          edge,
          otherItems,
          {
            snapEnabled: useSnap,
            altBypass: ev.altKey,
            gap: SNAP_GAP,
            gridStep: DOT_GRID_STEP,
          }
        );

        const previewRects = new Map(baseRectsRef.current);
        previewRects.set(widget.id, snapped.rect);

        setInteraction({
          mode: "resize",
          widgetId: widget.id,
          previewRects,
          guides: snapped.guides,
        });
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        window.removeEventListener("blur", onUp);
        const cur = interactionRef.current;
        setInteraction(null);
        if (!cur || !changed) return;

        const resizedRect = cur.previewRects.get(widget.id);
        if (!resizedRect) return;
        const nextWidgets = boardWidgetsRef.current.map((w) =>
          w.id === widget.id
            ? { ...w, layout: applyPixelRectToLayout(w.layout, resizedRect) }
            : w
        );
        replaceBoardWidgets(nextWidgets);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      window.addEventListener("blur", onUp);
    },
    [spacePressed, replaceBoardWidgets]
  );

  const activeRects = interaction ? interaction.previewRects : baseRects;

  // Convert client or viewport center to world coordinates
  const clientToWorld = useCallback((clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.round((clientX - rect.left - panRef.current.x) / zoomRef.current),
      y: Math.round((clientY - rect.top - panRef.current.y) / zoomRef.current),
    };
  }, []);

  const getPreferredWorldOrigin = useCallback(
    (cardW = DEFAULT_WIDGET_PX_W, cardH = DEFAULT_WIDGET_PX_H) => {
      const el = viewportRef.current;
      if (!el) return { x: 0, y: 0 };
      const rect = el.getBoundingClientRect();
      return {
        x: Math.round(
          (rect.width / 2 - panRef.current.x) / zoomRef.current - cardW / 2
        ),
        y: Math.round(
          (rect.height / 2 - panRef.current.y) / zoomRef.current - cardH / 2
        ),
      };
    },
    []
  );

  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const onRunWidgetRef = useRef(onRunWidget);
  onRunWidgetRef.current = onRunWidget;
  const onNotifyRef = useRef(onNotify);
  onNotifyRef.current = onNotify;

  const createWidgetsFromScripts = useCallback(
    (
      items: Array<{
        title: string;
        lang: InfoScriptLang;
        scriptPath?: string;
        inlineCode?: string;
      }>,
      clientX?: number,
      clientY?: number
    ) => {
      if (items.length === 0) return;

      const LANG_ACCENTS: Record<InfoScriptLang, string> = {
        python: "#38bdf8",
        powershell: "#5e6ad2",
        node: "#34d399",
        bash: "#f59e0b",
        batch: "#a78bfa",
        json: "#fb7185",
      };

      const dropAnchor =
        typeof clientX === "number" && typeof clientY === "number"
          ? (() => {
              const world = clientToWorld(clientX, clientY);
              return {
                x: Math.round(world.x - DEFAULT_WIDGET_PX_W / 2),
                y: Math.round(world.y - DEFAULT_WIDGET_PX_H / 2),
              };
            })()
          : getPreferredWorldOrigin(DEFAULT_WIDGET_PX_W, DEFAULT_WIDGET_PX_H);

      const ws = workspaceRef.current;
      const curBoard = activeBoardRef.current;
      const occupied: PixelRect[] = Array.from(baseRectsRef.current.values());
      const now = new Date().toISOString();
      const created: InfoWidget[] = [];

      for (const item of items) {
        const slot = findFreePixelSlot(
          occupied,
          DEFAULT_WIDGET_PX_W,
          DEFAULT_WIDGET_PX_H,
          dropAnchor.x,
          dropAnchor.y,
          SNAP_GAP
        );
        const rect: PixelRect = {
          x: slot.x,
          y: slot.y,
          w: DEFAULT_WIDGET_PX_W,
          h: DEFAULT_WIDGET_PX_H,
        };
        occupied.push(rect);

        created.push({
          id: uid("info"),
          boardId: curBoard.id,
          title: item.title,
          description: item.scriptPath
            ? `拖入脚本：${item.scriptPath}`
            : "拖入脚本自动创建",
          source: {
            kind: "script",
            scriptLang: item.lang,
            scriptPath: item.scriptPath,
            inlineCode: item.inlineCode,
          },
          schedule: {
            mode: "manual",
          },
          layout: {
            x: 0,
            y: 0,
            w: 4,
            h: 4,
            minW: 2,
            minH: 2,
            px: rect.x,
            py: rect.y,
            pw: rect.w,
            ph: rect.h,
          },
          appearance: {
            accentColor: LANG_ACCENTS[item.lang] ?? "#5e6ad2",
          },
          createdAt: now,
          updatedAt: now,
        });
      }

      onUpdateRef.current({
        ...ws,
        infoWidgets: [...(ws.infoWidgets ?? []), ...created],
      });
      setEditMode(true);
      if (created.length > 0) {
        focusRectInViewport(getWidgetPixelRect(created[created.length - 1]));
      }

      onNotifyRef.current(
        created.length === 1
          ? `已从脚本创建卡片「${created[0].title}」并开始运行`
          : `已从 ${created.length} 个脚本创建卡片并开始运行`
      );

      for (const w of created) {
        void onRunWidgetRef.current(w, "manual");
      }
    },
    [clientToWorld, getPreferredWorldOrigin, focusRectInViewport]
  );

  // Native OS File Drag-and-Drop listener (Tauri WindowEvent::DragDrop -> "os-drag-drop")
  useEffect(() => {
    if (!isTauriRuntime() || anyDialogOpen) {
      setIsFileDragOver(false);
      return;
    }
    let unlisten: (() => void) | undefined;
    let disposed = false;

    import("@tauri-apps/api/event").then(({ listen }) => {
      if (disposed) return;
      listen<{ kind: string; paths: string[]; x: number; y: number }>(
        "os-drag-drop",
        async (event) => {
          const payload = event.payload;
          if (payload.kind === "enter" || payload.kind === "over") {
            setIsFileDragOver(true);
            return;
          }
          if (payload.kind === "leave") {
            setIsFileDragOver(false);
            return;
          }
          if (payload.kind === "drop") {
            setIsFileDragOver(false);
            lastNativeDropAtRef.current = Date.now();
            if (!payload.paths || payload.paths.length === 0) return;

            const dpr = window.devicePixelRatio || 1;
            const dropClientX = payload.x / dpr;
            const dropClientY = payload.y / dpr;

            const items: Array<{
              title: string;
              lang: InfoScriptLang;
              scriptPath?: string;
              inlineCode?: string;
            }> = [];

            for (const rawPath of payload.paths) {
              const inferred = inferScriptFromFilename(rawPath);
              if (!inferred) continue;
              let inlineCode: string | undefined;
              try {
                inlineCode = await readScriptFile(rawPath);
              } catch {
                inlineCode = undefined;
              }
              items.push({
                title: inferred.title,
                lang: inferred.lang,
                scriptPath: rawPath,
                inlineCode,
              });
            }

            if (items.length === 0) {
              onNotifyRef.current(
                "请拖入脚本文件（支持 .py / .ps1 / .js / .sh / .bat / .cmd）"
              );
              return;
            }
            createWidgetsFromScripts(items, dropClientX, dropClientY);
          }
        }
      ).then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [anyDialogOpen, createWidgetsFromScripts]);

  // Board actions
  const handleAddBoard = () => {
    const nextBoard: InfoBoard = {
      id: uid("board"),
      name: `面板 ${boards.length + 1}`,
      layoutMode: "free",
      showGrid: true,
      locked: false,
      snapEnabled: true,
      preventOverlap: false,
      cols: 12,
      rowHeight: 52,
    };
    onUpdate({
      ...workspace,
      infoBoards: [...boards, nextBoard],
    });
    setActiveBoardId(nextBoard.id);
    resetView();
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
      resetView();
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
    preferredWorldX?: number,
    preferredWorldY?: number,
    preferredKind?: InfoSourceKind
  ) => {
    const defW =
      preferredKind === "container"
        ? DEFAULT_CONTAINER_PX_W
        : preferredKind === "control"
          ? DEFAULT_CONTROL_SWITCH_W
          : DEFAULT_WIDGET_PX_W;
    const defH =
      preferredKind === "container"
        ? DEFAULT_CONTAINER_PX_H
        : preferredKind === "control"
          ? DEFAULT_CONTROL_SWITCH_H
          : DEFAULT_WIDGET_PX_H;
    const fallback = getPreferredWorldOrigin(defW, defH);
    const pxSlot = findFreePixelSlot(
      Array.from(baseRects.values()),
      defW,
      defH,
      preferredWorldX ?? (boardWidgets.length === 0 ? 0 : fallback.x),
      preferredWorldY ?? (boardWidgets.length === 0 ? 0 : fallback.y),
      SNAP_GAP
    );
    setEditingWidget(null);
    setInitialNewPos(pxSlot);
    setInitialNewKind(preferredKind);
    setEditMode(true);
    setEditorOpen(true);
  };

  const handleAddBlankContainer = (
    preferredWorldX?: number,
    preferredWorldY?: number
  ) => {
    const fallback = getPreferredWorldOrigin(
      DEFAULT_CONTAINER_PX_W,
      DEFAULT_CONTAINER_PX_H
    );
    const pxSlot = findFreePixelSlot(
      Array.from(baseRects.values()),
      DEFAULT_CONTAINER_PX_W,
      DEFAULT_CONTAINER_PX_H,
      preferredWorldX ?? (boardWidgets.length === 0 ? 0 : fallback.x),
      preferredWorldY ?? (boardWidgets.length === 0 ? 0 : fallback.y),
      SNAP_GAP
    );
    const now = new Date().toISOString();
    const container: InfoWidget = {
      id: uid("info"),
      boardId: activeBoard.id,
      title: "",
      source: {
        kind: "container",
      },
      schedule: {
        mode: "manual",
      },
      layout: {
        x: 0,
        y: 0,
        w: 4,
        h: 4,
        minW: 2,
        minH: 2,
        px: pxSlot.x,
        py: pxSlot.y,
        pw: DEFAULT_CONTAINER_PX_W,
        ph: DEFAULT_CONTAINER_PX_H,
      },
      createdAt: now,
      updatedAt: now,
    };
    onUpdate({
      ...workspace,
      infoWidgets: [...(workspace.infoWidgets ?? []), container],
    });
    setEditMode(true);
    focusRectInViewport({
      x: pxSlot.x,
      y: pxSlot.y,
      w: DEFAULT_CONTAINER_PX_W,
      h: DEFAULT_CONTAINER_PX_H,
    });
    onNotify("已新建空白卡片（容器），可直接拖入其他卡片或开关/图标");
  };

  const handleAddControlAtPos = (
    controlType: InfoControlType,
    preferredWorldX?: number,
    preferredWorldY?: number
  ) => {
    const w =
      controlType === "icon" ? DEFAULT_CONTROL_ICON_W : DEFAULT_CONTROL_SWITCH_W;
    const h =
      controlType === "icon" ? DEFAULT_CONTROL_ICON_H : DEFAULT_CONTROL_SWITCH_H;
    const fallback = getPreferredWorldOrigin(w, h);
    const desiredX = preferredWorldX ?? fallback.x;
    const desiredY = preferredWorldY ?? fallback.y;

    const containers = boardWidgets
      .filter((bw) => bw.source.kind === "container")
      .map((bw) => ({
        id: bw.id,
        rect: baseRects.get(bw.id) ?? getWidgetPixelRect(bw),
      }));
    const targetParentId = findTargetContainerId(
      { x: desiredX, y: desiredY, w, h },
      containers
    );
    const occupied = boardWidgets
      .filter((bw) => bw.source.kind !== "container")
      .map((bw) => baseRects.get(bw.id) ?? getWidgetPixelRect(bw));
    const slot = findFreePixelSlot(
      occupied,
      w,
      h,
      desiredX,
      desiredY,
      10
    );
    const now = new Date().toISOString();
    const ctrl: InfoWidget = {
      id: uid("info"),
      boardId: activeBoard.id,
      parentId: targetParentId,
      title: "",
      source: {
        kind: "control",
        controlType,
        controlState: false,
        controlIcon: controlType === "icon" ? "zap" : "power",
        controlActionKind: "none",
      },
      schedule: {
        mode: "manual",
      },
      layout: {
        x: 0,
        y: 0,
        w: 2,
        h: 2,
        minW: 1,
        minH: 1,
        px: slot.x,
        py: slot.y,
        pw: w,
        ph: h,
      },
      createdAt: now,
      updatedAt: now,
    };
    onUpdate({
      ...workspace,
      infoWidgets: [...(workspace.infoWidgets ?? []), ctrl],
    });
    setEditMode(true);
    focusRectInViewport({ x: slot.x, y: slot.y, w, h });
    onNotify(controlType === "switch" ? "已新建开关元件（右键可绑定脚本）" : "已新建图标按钮（右键可绑定操作）");
  };

  const handleToggleControl = useCallback(
    (widget: InfoWidget) => {
      const nextState = !widget.source.controlState;
      const updated: InfoWidget = {
        ...widget,
        source: {
          ...widget.source,
          controlState: nextState,
        },
        updatedAt: new Date().toISOString(),
      };
      const ws = workspaceRef.current;
      onUpdate({
        ...ws,
        infoWidgets: (ws.infoWidgets ?? []).map((item) =>
          item.id === widget.id ? updated : item
        ),
      });

      const act = updated.source.controlActionKind ?? "none";
      if (act === "script" || act === "command") {
        void onRunWidget(updated, "manual");
      } else if (act === "url" && updated.source.controlTarget?.trim()) {
        openExternalUrl(updated.source.controlTarget.trim()).catch(() => {});
      } else if (act === "path" && updated.source.controlTarget?.trim()) {
        openPathInOs(updated.source.controlTarget.trim()).catch(() => {});
      }
    },
    [onUpdate, onRunWidget]
  );

  const handleTriggerControl = useCallback(
    (widget: InfoWidget) => {
      const act = widget.source.controlActionKind ?? "none";
      if (act === "script" || act === "command") {
        void onRunWidget(widget, "manual");
      } else if (act === "url" && widget.source.controlTarget?.trim()) {
        openExternalUrl(widget.source.controlTarget.trim()).catch((e) =>
          onNotify(e instanceof Error ? e.message : "打开链接失败")
        );
      } else if (act === "path" && widget.source.controlTarget?.trim()) {
        openPathInOs(widget.source.controlTarget.trim()).catch((e) =>
          onNotify(e instanceof Error ? e.message : "打开路径失败")
        );
      } else {
        onNotify(
          `已点击「${widget.source.controlLabel?.trim() || widget.title.trim() || "图标"}」（编辑可绑定触发脚本/链接）`
        );
      }
    },
    [onRunWidget, onNotify]
  );

  const handleAddFromTemplate = (
    tpl: InfoWidgetTemplate,
    preferredWorldX?: number,
    preferredWorldY?: number
  ) => {
    const tplPx = gridLayoutToPixelRect({ x: 0, y: 0, w: tpl.w, h: tpl.h });
    const fallback = getPreferredWorldOrigin(tplPx.w, tplPx.h);
    const pxSlot = findFreePixelSlot(
      Array.from(baseRects.values()),
      tplPx.w,
      tplPx.h,
      preferredWorldX ?? (boardWidgets.length === 0 ? 0 : fallback.x),
      preferredWorldY ?? (boardWidgets.length === 0 ? 0 : fallback.y),
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
        x: 0,
        y: 0,
        w: tpl.w,
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
      nextWidgets = (workspace.infoWidgets ?? []).map((w) =>
        w.id === saved.id ? saved : w
      );
    } else {
      const targetW = Math.max(
        MIN_WIDGET_PX_W,
        saved.layout.pw ?? DEFAULT_WIDGET_PX_W
      );
      const targetH = Math.max(
        MIN_WIDGET_PX_H,
        saved.layout.ph ?? DEFAULT_WIDGET_PX_H
      );
      const isContainer = saved.source.kind === "container";
      const occupiedRects = boardWidgets
        .filter((bw) =>
          isContainer ? bw.source.kind === "container" : bw.source.kind !== "container"
        )
        .map((bw) => baseRects.get(bw.id) ?? getWidgetPixelRect(bw));
      const pxSlot = findFreePixelSlot(
        occupiedRects,
        targetW,
        targetH,
        saved.layout.px ?? 0,
        saved.layout.py ?? 0,
        SNAP_GAP
      );
      const finalRect: PixelRect = {
        x: pxSlot.x,
        y: pxSlot.y,
        w: targetW,
        h: targetH,
      };
      const containerItems = isContainer
        ? []
        : boardWidgets
            .filter((bw) => bw.source.kind === "container")
            .map((bw) => ({
              id: bw.id,
              rect: baseRects.get(bw.id) ?? getWidgetPixelRect(bw),
            }));
      const targetParentId = isContainer
        ? undefined
        : saved.parentId ?? findTargetContainerId(finalRect, containerItems);

      const placed: InfoWidget = {
        ...saved,
        parentId: targetParentId,
        layout: {
          ...saved.layout,
          px: finalRect.x,
          py: finalRect.y,
          pw: finalRect.w,
          ph: finalRect.h,
        },
      };
      nextWidgets = [...(workspace.infoWidgets ?? []), placed];
      saved = placed;
    }

    onUpdate({
      ...workspace,
      infoWidgets: nextWidgets,
    });
    if (!existing) {
      setEditMode(true);
      focusRectInViewport(getWidgetPixelRect(saved));
    }
    const label = saved.title || saved.source.controlLabel || "卡片";
    onNotify(existing ? `已更新「${label}」` : `已添加「${label}」`);
    if (
      runImmediately &&
      saved.source.kind !== "container" &&
      (saved.source.kind !== "control" ||
        saved.source.controlActionKind === "script" ||
        saved.source.controlActionKind === "command")
    ) {
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
    const world = clientToWorld(e.clientX, e.clientY);
    setContextMenu({
      kind: "canvas",
      worldX: world.x,
      worldY: world.y,
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

  const { orderedWidgets, childCountByContainer } = useMemo(() => {
    const containers = boardWidgets.filter((w) => w.source.kind === "container");
    const nonContainers = boardWidgets.filter((w) => w.source.kind !== "container");
    const counts = new Map<string, number>();
    for (const w of nonContainers) {
      if (w.parentId) {
        counts.set(w.parentId, (counts.get(w.parentId) ?? 0) + 1);
      }
    }
    return {
      orderedWidgets: [...containers, ...nonContainers],
      childCountByContainer: counts,
    };
  }, [boardWidgets]);

  // Synced viewport dot-matrix background
  const dotStepScreen = Math.max(8, DOT_GRID_STEP * zoom);
  const dotOffsetX = ((pan.x % dotStepScreen) + dotStepScreen) % dotStepScreen;
  const dotOffsetY = ((pan.y % dotStepScreen) + dotStepScreen) % dotStepScreen;

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
                onClick={() => {
                  setActiveBoardId(b.id);
                  resetView();
                }}
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
            onClick={() => updateBoardMeta({ snapEnabled: !snapEnabled })}
            title="开启/关闭智能磁吸与对齐参考线（拖拽时按住 Alt 可临时忽略吸附）"
            aria-label="智能磁吸"
            className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
              snapEnabled
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-background/70 text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <Magnet className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() =>
              updateBoardMeta({ showGrid: !(activeBoard.showGrid ?? true) })
            }
            title="显示/隐藏背景参考点阵"
            aria-label="参考点阵"
            className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
              activeBoard.showGrid ?? true
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-background/70 text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <Grid className="h-3.5 w-3.5" />
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
            aria-label="外部推送接收配置"
            className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
              pushServerStatus?.running
                ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/15"
                : "border-border bg-background/70 text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <Radio className="h-3.5 w-3.5" />
          </button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setProtocolOpen(true)}
            title="查看接口规范"
            aria-label="查看接口规范"
            className="h-7 w-7"
          >
            <BookOpen className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="secondary"
            size="icon"
            disabled={boardWidgets.length === 0}
            onClick={() => void onRunAllWidgets(activeBoard.id)}
            title="刷新当前画布全部卡片"
            aria-label="全部刷新"
            className="h-7 w-7"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>

          <button
            type="button"
            onClick={() => handleAddBlankContainer()}
            title="新建空白卡片（容器，支持拖入其他卡片与微组件）"
            aria-label="新建空白卡片"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Frame className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => openNewWidgetDialog(undefined, undefined, "control")}
            title="新建微组件（开关 / 图标）"
            aria-label="新建微组件"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ToggleRight className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setEditMode((v) => !v)}
            title={
              editMode
                ? "退出布局编辑模式（锁定卡片位置防误拖）"
                : "开启布局编辑模式（拖拽移动与调整卡片大小）"
            }
            className={`inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-xs font-medium transition-colors ${
              editMode
                ? "border-primary/50 bg-primary/15 text-primary hover:bg-primary/20"
                : "border-border bg-background/80 text-foreground hover:bg-accent"
            }`}
          >
            {editMode ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Pencil className="h-3.5 w-3.5" />
            )}
            <span>{editMode ? "完成编辑" : "编辑布局"}</span>
          </button>

          <Button
            size="sm"
            onClick={() => openNewWidgetDialog()}
            className="h-7 gap-1 px-2.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>新建卡片</span>
          </Button>
        </div>
      </div>

        {/* Main Freeform Infinite Canvas Viewport */}
      <div
        ref={viewportRef}
        onContextMenu={handleCanvasContextMenu}
        onDragEnter={(e) => {
          if (!e.dataTransfer?.types?.includes("Files")) return;
          e.preventDefault();
          dragDepthRef.current += 1;
          setIsFileDragOver(true);
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer?.types?.includes("Files")) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          if (!isFileDragOver) setIsFileDragOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.dataTransfer?.types?.includes("Files")) return;
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) setIsFileDragOver(false);
        }}
        onDrop={async (e) => {
          if (!e.dataTransfer?.files?.length) return;
          e.preventDefault();
          dragDepthRef.current = 0;
          setIsFileDragOver(false);
          if (Date.now() - lastNativeDropAtRef.current < 400) return;

          const files = Array.from(e.dataTransfer.files);
          const dropClientX = e.clientX;
          const dropClientY = e.clientY;
          const items: Array<{
            title: string;
            lang: InfoScriptLang;
            scriptPath?: string;
            inlineCode?: string;
          }> = [];

          for (const file of files) {
            const inferred = inferScriptFromFilename(file.name);
            if (!inferred) continue;
            const fileWithPath = file as File & { path?: string };
            let inlineCode: string | undefined;
            try {
              inlineCode = await file.text();
            } catch {
              inlineCode = undefined;
            }
            items.push({
              title: inferred.title,
              lang: inferred.lang,
              scriptPath: fileWithPath.path || undefined,
              inlineCode,
            });
          }

          if (items.length === 0) {
            onNotify("请拖入脚本文件（支持 .py / .ps1 / .js / .sh / .bat / .cmd）");
            return;
          }
          createWidgetsFromScripts(items, dropClientX, dropClientY);
        }}
        onPointerDownCapture={(e) => {
          if (e.button === 1 || (e.button === 0 && spacePressed)) {
            e.preventDefault();
            e.stopPropagation();
            startCanvasPan(e.clientX, e.clientY);
          }
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          if ((e.target as HTMLElement).closest("[data-info-widget]")) return;
          if ((e.target as HTMLElement).closest("button, a, input, select")) return;
          e.preventDefault();
          startCanvasPan(e.clientX, e.clientY);
        }}
        className={`relative flex-1 overflow-hidden select-none ${
          isPanning
            ? "cursor-grabbing"
            : spacePressed
            ? "cursor-grab"
            : "cursor-default"
        }`}
        style={
          showGrid
            ? {
                backgroundImage:
                  "radial-gradient(circle, hsl(var(--muted-foreground) / 0.24) 1px, transparent 1px)",
                backgroundSize: `${dotStepScreen}px ${dotStepScreen}px`,
                backgroundPosition: `${dotOffsetX}px ${dotOffsetY}px`,
              }
            : undefined
        }
      >
        {/* World Transform Layer */}
        <div
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
            transformOrigin: "0 0",
          }}
          className="absolute left-0 top-0 h-0 w-0"
        >
          {/* Magnetic Alignment Guide Lines */}
          {interaction && interaction.guides.length > 0 && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-0 top-0 z-40 h-0 w-0"
            >
              {interaction.guides.map((g, idx) => {
                const start = g.start;
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

          {/* Widgets (containers rendered before non-containers for clear stacking order) */}
          {orderedWidgets.map((widget) => {
            const pixelRect =
              activeRects.get(widget.id) ?? getWidgetPixelRect(widget);

            return (
              <InfoWidgetCard
                key={widget.id}
                widget={widget}
                pixelRect={pixelRect}
                panMode={spacePressed || isPanning}
                isDropTarget={interaction?.dropTargetContainerId === widget.id}
                childCount={childCountByContainer.get(widget.id) ?? 0}
                runtime={runtimeMap[widget.id]}
                locked={locked}
                pushBaseUrl={pushBaseUrl}
                isDragging={
                  interaction?.mode === "drag" &&
                  interaction.widgetId === widget.id
                }
                isGroupMoving={Boolean(
                  interaction?.movingChildIds?.has(widget.id)
                )}
                isResizing={
                  interaction?.mode === "resize" &&
                  interaction.widgetId === widget.id
                }
                anyInteracting={Boolean(interaction)}
                onStartDrag={handleStartDrag}
                onStartResize={handleStartResize}
                onToggleControl={handleToggleControl}
                onTriggerControl={handleTriggerControl}
                onRun={(w) => void onRunWidget(w, "manual")}
                onCancel={(w) => void onCancelWidget(w.id)}
                onEdit={(w) => {
                  setEditingWidget(w);
                  setInitialNewPos(undefined);
                  setInitialNewKind(undefined);
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

        {/* Empty State Onboarding (viewport centered) */}
        {boardWidgets.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
            <div className="pointer-events-auto flex max-w-md flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border bg-surface/65 p-6 text-center backdrop-blur-sm">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/12 text-primary">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="space-y-1.5">
                <h2 className="text-sm font-semibold text-foreground">
                  打造你的自由无限信息画布
                </h2>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  支持直接拖入本地脚本文件（.py / .ps1 / .js / .sh / .bat）自动创建卡片，或配置命令行、HTTP 接口与外部推送；Ctrl + 滚轮缩放画布、拖拽空白处或按住空格键平移视图。
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
          </div>
        )}

        {/* Floating Zoom HUD */}
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute bottom-3 right-3 z-30 flex items-center gap-0.5 rounded-lg border border-border/80 bg-popover/90 p-1 text-xs shadow-md backdrop-blur-md"
        >
          <button
            type="button"
            onClick={() => zoomAroundCenter(zoomRef.current / 1.15)}
            title="缩小画布 (Ctrl + -)"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={resetView}
            title="点击重置视角为 100% (Ctrl + 0)"
            className="h-6 min-w-[44px] rounded-md px-1.5 font-mono text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => zoomAroundCenter(zoomRef.current * 1.15)}
            title="放大画布 (Ctrl + +)"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <div className="mx-0.5 h-3.5 w-px bg-border" />
          <button
            type="button"
            onClick={() => zoomAroundCenter(1)}
            title="1:1 实际尺寸 (100%)"
            aria-label="1:1 实际尺寸"
            className={`inline-flex h-6 items-center justify-center rounded-md px-1 transition-colors hover:bg-accent ${
              Math.round(zoom * 100) === 100
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="rounded border border-current px-1 font-mono text-[9.5px] font-semibold leading-[14px]">
              1:1
            </span>
          </button>
          <button
            type="button"
            onClick={fitAllWidgets}
            title="适配全部卡片到当前窗口"
            className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Maximize2 className="h-3 w-3" />
            <span className="hidden sm:inline">适配全部</span>
          </button>
        </div>

        {/* Script Drag-and-Drop Overlay */}
        {isFileDragOver && (
          <div className="pointer-events-none absolute inset-3 z-50 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary bg-primary/10 backdrop-blur-[2px]">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary shadow-sm">
              <FileCode2 className="h-5 w-5" />
            </div>
            <div className="text-sm font-semibold text-foreground">
              松开鼠标自动创建脚本卡片
            </div>
            <div className="text-xs text-muted-foreground">
              支持 .py / .ps1 / .js / .sh / .bat / .cmd
            </div>
          </div>
        )}
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
          isRunning={Boolean(ctxWidget && runtimeMap[ctxWidget.id]?.running)}
          hasColumns={workspace.columns.length > 0}
          pushBaseUrl={pushBaseUrl}
          onClose={() => setContextMenu(null)}
          onNotify={onNotify}
          onRunWidget={(w) => void onRunWidget(w, "manual")}
          onCancelWidget={(w) => void onCancelWidget(w.id)}
          onEditWidget={(w) => {
            setEditingWidget(w);
            setInitialNewPos(undefined);
            setInitialNewKind(undefined);
            setEditorOpen(true);
          }}
          onViewLogs={(w) => setLogWidgetId(w.id)}
          onCopyPlainText={(w) => {
            const res = runtimeMap[w.id]?.lastResult;
            if (!res) {
              onNotify("暂无输出内容");
              return;
            }
            const parsed = parseInfoOutput(
              res,
              w.source.jsonPath,
              w.appearance?.displayView
            );
            navigator.clipboard
              .writeText(extractPlainTextFromParsed(parsed))
              .catch(() => {});
            onNotify("已复制展示文本");
          }}
          onCopyRawOutput={(w) => {
            const raw = runtimeMap[w.id]?.lastResult?.stdout ?? "";
            if (!raw) {
              onNotify("暂无原始输出");
              return;
            }
            navigator.clipboard.writeText(raw).catch(() => {});
            onNotify("已复制原始输出");
          }}
          onSendToKanban={(w) => {
            const res = runtimeMap[w.id]?.lastResult;
            const parsed = res
              ? parseInfoOutput(
                  res,
                  w.source.jsonPath,
                  w.appearance?.displayView
                )
              : null;
            const summary = parsed
              ? extractPlainTextFromParsed(parsed)
              : undefined;
            handleSendToKanban(
              `[${w.title}] ${summary?.split("\n")[0] || "跟进信息"}`,
              summary
            );
          }}
          onSendToIdea={(w) => {
            const res = runtimeMap[w.id]?.lastResult;
            const parsed = res
              ? parseInfoOutput(
                  res,
                  w.source.jsonPath,
                  w.appearance?.displayView
                )
              : null;
            const summary = parsed
              ? extractPlainTextFromParsed(parsed)
              : w.title;
            handleSendToIdea(`[${w.title}]\n${summary}`);
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
          onSetDisplayView={(w, view) => {
            onUpdate({
              ...workspace,
              infoWidgets: (workspace.infoWidgets ?? []).map((item) =>
                item.id === w.id
                  ? {
                      ...item,
                      appearance: {
                        ...(item.appearance ?? {}),
                        displayView: view === "auto" ? undefined : view,
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
            const curR = baseRects.get(w.id) ?? getWidgetPixelRect(w);
            const resetW =
              w.source.kind === "container"
                ? DEFAULT_CONTAINER_PX_W
                : w.source.kind === "control"
                  ? w.source.controlType === "icon"
                    ? DEFAULT_CONTROL_ICON_W
                    : DEFAULT_CONTROL_SWITCH_W
                  : DEFAULT_WIDGET_PX_W;
            const resetH =
              w.source.kind === "container"
                ? DEFAULT_CONTAINER_PX_H
                : w.source.kind === "control"
                  ? w.source.controlType === "icon"
                    ? DEFAULT_CONTROL_ICON_H
                    : DEFAULT_CONTROL_SWITCH_H
                  : DEFAULT_WIDGET_PX_H;
            replaceBoardWidgets(
              boardWidgets.map((item) =>
                item.id === w.id
                  ? {
                      ...item,
                      layout: applyPixelRectToLayout(item.layout, {
                        ...curR,
                        w: resetW,
                        h: resetH,
                      }),
                    }
                  : item
              )
            );
          }}
          onArrangeContainer={(container) => {
            const containerRect =
              baseRects.get(container.id) ?? getWidgetPixelRect(container);
            const children = boardWidgets
              .filter((w) => w.parentId === container.id)
              .map((w) => ({
                id: w.id,
                rect: baseRects.get(w.id) ?? getWidgetPixelRect(w),
              }));
            if (children.length === 0) {
              onNotify("当前空白卡片内还没有子卡片");
              return;
            }
            const hasHeader =
              !container.appearance?.hideHeader &&
              Boolean(container.title.trim());
            const arranged = arrangeWidgetsInsideContainer(
              containerRect,
              hasHeader,
              children
            );
            replaceBoardWidgets(
              boardWidgets.map((item) => {
                const r = arranged.get(item.id);
                return r
                  ? { ...item, layout: applyPixelRectToLayout(item.layout, r) }
                  : item;
              })
            );
            onNotify("已整理容器内卡片");
          }}
          onDetachFromContainer={(w) => {
            replaceBoardWidgets(
              boardWidgets.map((item) =>
                item.id === w.id ? { ...item, parentId: undefined } : item
              )
            );
            onNotify("已移出空白卡片");
          }}
          onCloneWidget={(w) => {
            const curR = baseRects.get(w.id) ?? getWidgetPixelRect(w);
            const pxSlot = findFreePixelSlot(
              Array.from(baseRects.values()),
              curR.w,
              curR.h,
              curR.x,
              curR.y + curR.h + SNAP_GAP,
              SNAP_GAP
            );
            const now = new Date().toISOString();
            const cloned: InfoWidget = {
              ...w,
              id: uid("info"),
              parentId: undefined,
              title: w.title ? `${w.title} (副本)` : "",
              layout: {
                ...w.layout,
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
              infoWidgets: (workspace.infoWidgets ?? [])
                .filter((item) => item.id !== w.id)
                .map((item) =>
                  item.parentId === w.id ? { ...item, parentId: undefined } : item
                ),
            });
            onNotify(
              w.title ? `已删除「${w.title}」` : "已删除卡片"
            );
          }}
          onAddAtPos={(wx, wy) => openNewWidgetDialog(wx, wy)}
          onAddBlankContainer={(wx, wy) => handleAddBlankContainer(wx, wy)}
          onAddControlAtPos={(ct, wx, wy) => handleAddControlAtPos(ct, wx, wy)}
          onRefreshAll={() => void onRunAllWidgets(activeBoard.id)}
          onResetView={resetView}
          onFitAll={fitAllWidgets}
          onAutoArrange={() => {
            const arranged = autoArrangeFreeformWidgets(
              boardWidgets,
              1200,
              SNAP_GAP
            );
            replaceBoardWidgets(
              boardWidgets.map((w) => {
                const r = arranged.get(w.id);
                return r
                  ? {
                      ...w,
                      layout: applyPixelRectToLayout(w.layout, r),
                    }
                  : w;
              })
            );
            resetView();
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
        initialPos={initialNewPos}
        initialKind={initialNewKind}
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
