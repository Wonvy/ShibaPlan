import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CloudSun,
  Gauge,
  GripHorizontal,
  List,
  Pause,
  Play,
  Plus,
  Trash2,
  Waves,
} from "lucide-react";
import {
  BoardColumn,
  COLUMN_COLORS,
  EFFORT_MINUTES,
  IdeaItem,
  IdeaWeather,
  TaskItem,
  ThemeMode,
  TrashedIdeaItem,
  WorkspaceData,
} from "../types";
import {
  fetchCurrentWeather,
  getCachedWeatherSync,
} from "../lib/atmosphere";
import { getTodayCalendarInfo } from "../lib/lunar";
import {
  exportIdeaToMarkdown,
  generateAISpec,
  savePastedImage,
  uid,
} from "../lib/storage";
import { breakdownIdeaWithAI } from "../lib/ai";
import { useI18n } from "../lib/i18n";
import {
  IdeaViewMode,
  LANE_SPEED_FACTORS,
  RiverSpeed,
  SPEED_PX_PER_SEC,
  renderWeatherIcon,
} from "./idea-river/constants";
import { IdeaLane } from "./idea-river/IdeaLane";
import { IdeaListRow } from "./idea-river/IdeaListRow";
import { HoverPreview } from "./idea-river/HoverPreview";
import { IdeaEditorDialog } from "./idea-river/IdeaEditorDialog";
import { IdeaDetailDialog } from "./idea-river/IdeaDetailDialog";
import { TrashDialog } from "./idea-river/TrashDialog";
import {
  RiverContextMenu,
  RiverMenuState,
} from "./idea-river/RiverContextMenu";

interface IdeaRiverProps {
  workspace: WorkspaceData;
  onUpdate: (next: WorkspaceData) => void;
}

export const IdeaRiver: React.FC<IdeaRiverProps> = ({
  workspace,
  onUpdate,
}) => {
  const { t } = useI18n();
  // Latest workspace snapshot for stable callbacks (avoids `workspace` in deps)
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  // Dock layout: collapsible + resizable height (persisted in localStorage)
  const RIVER_UI_STATE_KEY = "shibaplan_river_ui_state";
  const initialRiverUi = useMemo(() => {
    const defaultHeight =
      typeof window !== "undefined" && window.innerWidth < 640 ? 176 : 236;
    const defaults: {
      collapsed: boolean;
      height: number;
      viewMode: IdeaViewMode;
      speed: RiverSpeed;
      paused: boolean;
    } = {
      collapsed: false,
      height: defaultHeight,
      viewMode: "river",
      speed: "slow",
      paused: false,
    };
    if (typeof window === "undefined") return defaults;
    try {
      const raw = window.localStorage.getItem(RIVER_UI_STATE_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw) as Partial<typeof defaults>;
      return {
        collapsed:
          typeof parsed.collapsed === "boolean"
            ? parsed.collapsed
            : defaults.collapsed,
        height:
          typeof parsed.height === "number" &&
          Number.isFinite(parsed.height) &&
          parsed.height >= 120 &&
          parsed.height <= 480
            ? Math.round(parsed.height)
            : defaults.height,
        viewMode:
          parsed.viewMode === "list" || parsed.viewMode === "river"
            ? parsed.viewMode
            : defaults.viewMode,
        speed:
          parsed.speed === "slow" ||
          parsed.speed === "normal" ||
          parsed.speed === "fast"
            ? parsed.speed
            : defaults.speed,
        paused:
          typeof parsed.paused === "boolean" ? parsed.paused : defaults.paused,
      };
    } catch {
      return defaults;
    }
  }, []);

  const [collapsed, setCollapsed] = useState<boolean>(initialRiverUi.collapsed);
  const [liveWeather, setLiveWeather] = useState<IdeaWeather | null>(() =>
    getCachedWeatherSync()
  );

  // Header info pill display preferences (right-click checkboxes)
  type InfoDisplayPrefs = {
    weather: boolean;
    date: boolean;
    lunar: boolean;
    festival: boolean;
  };
  const [infoPrefs, setInfoPrefs] = useState<InfoDisplayPrefs>(() => {
    try {
      const raw = localStorage.getItem("shibaplan_river_info_prefs");
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<InfoDisplayPrefs>;
        return {
          weather: parsed.weather ?? true,
          date: parsed.date ?? true,
          lunar: parsed.lunar ?? true,
          festival: parsed.festival ?? true,
        };
      }
    } catch {
      // ignore
    }
    return { weather: true, date: true, lunar: true, festival: true };
  });
  const [infoMenuPos, setInfoMenuPos] = useState<{
    left: number;
    bottom: number;
  } | null>(null);
  const [dayTick, setDayTick] = useState(() => new Date().toDateString());

  useEffect(() => {
    const id = window.setInterval(() => {
      const cur = new Date().toDateString();
      setDayTick((prev) => (prev === cur ? prev : cur));
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!infoMenuPos) return;
    const close = () => setInfoMenuPos(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [infoMenuPos]);

  const toggleInfoPref = useCallback((key: keyof InfoDisplayPrefs) => {
    setInfoPrefs((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem("shibaplan_river_info_prefs", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const todayInfo = useMemo(() => {
    void dayTick;
    return getTodayCalendarInfo(new Date());
  }, [dayTick]);
  const riverAtmosphere = workspace.settings.riverAtmosphere ?? true;
  const currentTheme: ThemeMode = workspace.settings.theme || "dark";

  useEffect(() => {
    let active = true;
    fetchCurrentWeather().then((w) => {
      if (active && w) setLiveWeather(w);
    });
    return () => {
      active = false;
    };
  }, []);

  const toggleRiverAtmosphere = () => {
    onUpdate({
      ...workspace,
      settings: {
        ...workspace.settings,
        riverAtmosphere: !riverAtmosphere,
      },
    });
  };
  const [height, setHeight] = useState<number>(initialRiverUi.height);
  const [resizing, setResizing] = useState(false);

  // View mode: flowing river vs paginated list
  const [viewMode, setViewMode] = useState<IdeaViewMode>(
    initialRiverUi.viewMode
  );
  const [currentPage, setCurrentPage] = useState(1);
  const lastWheelRef = useRef(0);

  // River flow state
  const [paused, setPaused] = useState<boolean>(initialRiverUi.paused);
  const [hoveredRiver, setHoveredRiver] = useState(false);
  const [speed, setSpeed] = useState<RiverSpeed>(initialRiverUi.speed);

  useEffect(() => {
    if (resizing) return;
    try {
      window.localStorage.setItem(
        RIVER_UI_STATE_KEY,
        JSON.stringify({ collapsed, height, viewMode, speed, paused })
      );
    } catch {
      // ignore
    }
  }, [collapsed, height, viewMode, speed, paused, resizing]);

  // Hover full-content tooltip state
  const [hoveredCard, setHoveredCard] = useState<{
    idea: IdeaItem;
    x: number;
    y: number;
  } | null>(null);

  // Quick add / edit modal
  const [addOpen, setAddOpen] = useState(false);
  const [editingIdeaId, setEditingIdeaId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [draftTag, setDraftTag] = useState("灵感");
  const [draftImage, setDraftImage] = useState<string | null>(null);
  const [saveModeMenuOpen, setSaveModeMenuOpen] = useState(false);

  const enterToSave = workspace.settings.enterToSave ?? true;
  const setEnterToSave = (val: boolean) => {
    onUpdate({
      ...workspace,
      settings: {
        ...workspace.settings,
        enterToSave: val,
      },
    });
    setSaveModeMenuOpen(false);
  };

  // Detail / AI Spec modal
  const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null);
  const [targetColId, setTargetColId] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [aiBreakingDown, setAiBreakingDown] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const handleAiBreakdown = async (idea: IdeaItem) => {
    setAiError(null);
    setAiBreakingDown(true);
    try {
      const cfg = workspace.settings.ai ?? {
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        apiKey: "",
        model: "glm-4-flash",
      };
      const items = await breakdownIdeaWithAI(idea, cfg);
      const now = new Date().toISOString();

      let nextColumns = workspace.columns;
      let colId = targetColId || workspace.columns[0]?.id;
      if (!colId) {
        const autoCol: BoardColumn = {
          id: uid("col"),
          title: idea.tag || "AI 拆解",
          color: COLUMN_COLORS[0],
        };
        nextColumns = [autoCol];
        colId = autoCol.id;
      }

      const createdTasks: TaskItem[] = items.map((item) => ({
        id: uid("task"),
        title: item.title,
        notes: item.notes,
        columnId: colId!,
        importance: 2,
        effort: item.effort,
        estimatedMinutes: EFFORT_MINUTES[item.effort],
        actualMinutes: 0,
        status: "todo",
        createdAt: now,
        sourceIdeaId: idea.id,
      }));

      onUpdate({
        ...workspace,
        columns: nextColumns,
        tasks: [...createdTasks, ...workspace.tasks],
        ideas: workspace.ideas.filter((i) => i.id !== idea.id),
        trashedIdeas: [
          {
            ...idea,
            deletedAt: now,
            reason: "used",
          },
          ...workspace.trashedIdeas,
        ],
      });
      setSelectedIdeaId(null);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "AI 拆解失败");
    } finally {
      setAiBreakingDown(false);
    }
  };

  // Double-click inline creator at non-overlapping mouse position
  const [inlineComposer, setInlineComposer] = useState<{
    x: number;
    y: number;
    lane: number;
    text: string;
    imagePreview: string | null;
  } | null>(null);

  // Recycle Bin modal
  const [trashOpen, setTrashOpen] = useState(false);

  // Right-click context menu for IdeaRiver (card vs empty area)
  const [riverMenu, setRiverMenu] = useState<RiverMenuState | null>(null);

  useEffect(() => {
    if (!riverMenu) return;
    const close = () => setRiverMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [riverMenu]);

  const openRiverMenu = useCallback(
    (
      e: React.MouseEvent,
      menu: { kind: "idea"; ideaId: string } | { kind: "area" }
    ) => {
      e.preventDefault();
      e.stopPropagation();
      setHoveredCard(null);
      const menuW = 180;
      const menuH = menu.kind === "idea" ? 240 : 190;
      const x = Math.min(e.clientX, window.innerWidth - menuW - 12);
      const y = Math.min(e.clientY, window.innerHeight - menuH - 12);
      setRiverMenu({ ...menu, x, y });
    },
    []
  );

  // Drop-target state for Kanban cards dragged into IdeaRiver (Alt = copy, default = move)
  const [dragOverFromBoard, setDragOverFromBoard] = useState(false);
  const [dragCopyMode, setDragCopyMode] = useState(false);

  const handleBoardCardDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("application/x-shibaplan-task")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = e.altKey ? "copy" : "move";
    setDragOverFromBoard(true);
    setDragCopyMode(e.altKey);
  };

  const handleBoardCardDragLeave = (e: React.DragEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setDragOverFromBoard(false);
      setDragCopyMode(false);
    }
  };

  const handleBoardCardDrop = (e: React.DragEvent) => {
    const taskId = e.dataTransfer.getData("application/x-shibaplan-task");
    setDragOverFromBoard(false);
    setDragCopyMode(false);
    if (!taskId) return;
    e.preventDefault();

    const task = workspace.tasks.find((item) => item.id === taskId);
    if (!task) return;

    const colTitle =
      workspace.columns.find((c) => c.id === task.columnId)?.title ??
      t("river.defaultTag");

    const combinedContent = task.notes
      ? task.notes.startsWith(task.title)
        ? task.notes
        : `${task.title}\n${task.notes}`
      : task.title;

    const newIdea: IdeaItem = {
      id: uid("idea"),
      content: combinedContent,
      tag: colTitle,
      imagePreview: task.imagePreview,
      imagePath: task.imagePath,
      createdAt: new Date().toISOString(),
    };

    const isCopy = e.altKey;
    onUpdate({
      ...workspace,
      ideas: [newIdea, ...workspace.ideas],
      tasks: isCopy
        ? workspace.tasks
        : workspace.tasks.filter((item) => item.id !== task.id),
    });
  };

  // Multi-lane animation refs (no duplicated cards; even 1 card floats gently across the river)
  const containerRef = useRef<HTMLDivElement | null>(null);
  const trackRefs = useRef<(HTMLDivElement | null)[]>([]);
  const groupRefs = useRef<(HTMLDivElement | null)[]>([]);
  // Position in px (translate3d(x, 0, 0)), initialized inside viewport so cards are immediately visible
  const posXRef = useRef<(number | null)[]>([null, null, null, null, null, null]);

  const rowCount = useMemo(() => {
    const available = Math.max(56, height - 54);
    return Math.max(1, Math.min(6, Math.floor(available / 58)));
  }, [height]);

  // Auto-pagination for List View based on current dock height
  const pageSize = useMemo(() => {
    const available = Math.max(88, height - 86);
    return Math.max(2, Math.floor(available / 44));
  }, [height]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(workspace.ideas.length / pageSize)),
    [workspace.ideas.length, pageSize]
  );

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paginatedIdeas = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return workspace.ideas.slice(start, start + pageSize);
  }, [workspace.ideas, currentPage, pageSize]);

  // Distribute real ideas once across lanes (respecting preferred lane if set)
  const lanes = useMemo(() => {
    if (workspace.ideas.length === 0) return [];
    const maxAssignedLane = workspace.ideas.reduce(
      (max, item) => (typeof item.lane === "number" ? Math.max(max, item.lane) : max),
      0
    );
    const activeRows = Math.min(
      rowCount,
      Math.max(Math.min(rowCount, workspace.ideas.length), maxAssignedLane + 1)
    );
    const result: { idea: IdeaItem; key: string }[][] = Array.from(
      { length: activeRows },
      () => []
    );

    workspace.ideas.forEach((idea, idx) => {
      const row =
        typeof idea.lane === "number"
          ? Math.min(activeRows - 1, Math.max(0, idea.lane))
          : idx % activeRows;
      result[row].push({ idea, key: idea.id });
    });

    return result;
  }, [workspace.ideas, rowCount]);

  const selectedIdea = useMemo(
    () => workspace.ideas.find((i) => i.id === selectedIdeaId) ?? null,
    [workspace.ideas, selectedIdeaId]
  );

  const selectedSpecText = useMemo(
    () => (selectedIdea ? generateAISpec(selectedIdea) : ""),
    [selectedIdea]
  );

  useEffect(() => {
    if (workspace.columns.length > 0 && !targetColId) {
      setTargetColId(workspace.columns[0].id);
    }
  }, [workspace.columns, targetColId]);

  // Hover-to-paste on IdeaRiver: auto-insert pasted text or image and open editor
  useEffect(() => {
    const onWindowPaste = async (e: ClipboardEvent) => {
      if (!hoveredRiver || addOpen || selectedIdeaId || trashOpen) return;
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
            const newIdea: IdeaItem = {
              id: uid("idea"),
              content: "",
              tag: "灵感",
              imagePreview: reader.result,
              imagePath: savedPath || undefined,
              createdAt: new Date().toISOString(),
            };
            onUpdate({
              ...workspace,
              ideas: [newIdea, ...workspace.ideas],
            });
            setEditingIdeaId(newIdea.id);
            setDraft("");
            setDraftTag("灵感");
            setDraftImage(reader.result);
            setHoveredCard(null);
            setAddOpen(true);
          };
          reader.readAsDataURL(file);
          return;
        }
      }

      const text = e.clipboardData?.getData("text/plain")?.trim();
      if (!text) return;
      e.preventDefault();

      const newIdea: IdeaItem = {
        id: uid("idea"),
        content: text,
        tag: "灵感",
        createdAt: new Date().toISOString(),
      };
      onUpdate({
        ...workspace,
        ideas: [newIdea, ...workspace.ideas],
      });
      setEditingIdeaId(newIdea.id);
      setDraft(text);
      setDraftTag("灵感");
      setDraftImage(null);
      setHoveredCard(null);
      setAddOpen(true);
    };

    window.addEventListener("paste", onWindowPaste);
    return () => window.removeEventListener("paste", onWindowPaste);
  }, [hoveredRiver, addOpen, selectedIdeaId, trashOpen, workspace, onUpdate]);

  // Drag handle for resizing bottom dock height (mouse + touch)
  const startResizeAtY = (startY: number) => {
    if (collapsed) setCollapsed(false);
    setResizing(true);
    const startHeight = height;

    const onMove = (clientY: number) => {
      const maxH = Math.min(480, Math.round(window.innerHeight * 0.65));
      const next = Math.min(maxH, Math.max(120, startHeight + (startY - clientY)));
      setHeight(next);
    };
    const onMouseMove = (ev: MouseEvent) => onMove(ev.clientY);
    const onTouchMove = (ev: TouchEvent) => {
      if (ev.touches[0]) onMove(ev.touches[0].clientY);
    };
    const onUp = () => {
      setResizing(false);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onUp);
  };

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    startResizeAtY(e.clientY);
  };

  const startResizeTouch = (e: React.TouchEvent) => {
    if (e.touches[0]) {
      startResizeAtY(e.touches[0].clientY);
    }
  };

  // Gentle continuous river drift even with a single card (zero duplication)
  useEffect(() => {
    if (collapsed || viewMode !== "river" || workspace.ideas.length === 0) {
      return;
    }
    let rafId = 0;
    let lastTime = performance.now();

    const step = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const shouldFlow =
        !paused &&
        !hoveredRiver &&
        !addOpen &&
        !inlineComposer &&
        !selectedIdeaId &&
        !trashOpen &&
        !riverMenu;
      const viewportW = containerRef.current?.clientWidth ?? 0;

      if (viewportW > 0) {
        const baseSpeed = SPEED_PX_PER_SEC[speed];
        for (let row = 0; row < lanes.length; row++) {
          const track = trackRefs.current[row];
          const group = groupRefs.current[row];
          if (!track || !group) continue;
          const contentW = group.offsetWidth;
          if (contentW <= 0) continue;

          if (posXRef.current[row] === null || posXRef.current[row] === undefined) {
            posXRef.current[row] = Math.min(
              Math.max(16, row * 56),
              Math.max(16, viewportW - 120)
            );
            track.style.transform = `translate3d(${posXRef.current[row]}px, 0, 0)`;
          }

          if (shouldFlow) {
            const factor = LANE_SPEED_FACTORS[row % LANE_SPEED_FACTORS.length];
            let nextX = (posXRef.current[row] ?? 0) - baseSpeed * factor * dt;
            if (nextX < -contentW) {
              nextX = viewportW;
            }
            posXRef.current[row] = nextX;
            track.style.transform = `translate3d(${nextX}px, 0, 0)`;
          }
        }
      }
      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [
    collapsed,
    viewMode,
    paused,
    hoveredRiver,
    speed,
    addOpen,
    inlineComposer,
    selectedIdeaId,
    trashOpen,
    riverMenu,
    lanes.length,
    workspace.ideas.length,
  ]);

  // Find nearest non-overlapping spot inside river container for double-click creation
  const handleRiverDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-idea-pill]")) return;
    if ((e.target as HTMLElement).closest("[data-inline-composer]")) return;
    const container = containerRef.current;
    if (!container) return;

    const cRect = container.getBoundingClientRect();
    const pillW = Math.min(256, Math.max(180, cRect.width - 24));
    const pillH = 48;
    const pad = 8;

    const existing = Array.from(
      container.querySelectorAll<HTMLElement>("[data-idea-pill]")
    ).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left - cRect.left - 8,
        top: r.top - cRect.top - 6,
        right: r.right - cRect.left + 8,
        bottom: r.bottom - cRect.top + 6,
      };
    });

    const clampX = (x: number) =>
      Math.max(pad, Math.min(cRect.width - pillW - pad, x));
    const clampY = (y: number) =>
      Math.max(4, Math.min(cRect.height - pillH - 4, y));

    const overlapsAny = (x: number, y: number) => {
      const r = { left: x, top: y, right: x + pillW, bottom: y + pillH };
      return existing.some(
        (b) =>
          !(
            r.right <= b.left ||
            r.left >= b.right ||
            r.bottom <= b.top ||
            r.top >= b.bottom
          )
      );
    };

    const startX = clampX(e.clientX - cRect.left - pillW / 2);
    const startY = clampY(e.clientY - cRect.top - pillH / 2);

    let chosenX = startX;
    let chosenY = startY;

    if (overlapsAny(startX, startY)) {
      let found = false;
      const stepX = 42;
      const stepY = 56;
      for (let ring = 1; ring <= 10 && !found; ring++) {
        const candidates: [number, number][] = [
          [startX + ring * stepX, startY],
          [startX - ring * stepX, startY],
          [startX, startY + ring * stepY],
          [startX, startY - ring * stepY],
          [startX + ring * stepX, startY + stepY],
          [startX - ring * stepX, startY + stepY],
          [startX + ring * stepX, startY - stepY],
          [startX - ring * stepX, startY - stepY],
        ];
        for (const [cx, cy] of candidates) {
          const x = clampX(cx);
          const y = clampY(cy);
          if (!overlapsAny(x, y)) {
            chosenX = x;
            chosenY = y;
            found = true;
            break;
          }
        }
      }
    }

    const lane = Math.min(
      Math.max(0, rowCount - 1),
      Math.max(0, Math.floor(chosenY / 56))
    );

    setHoveredCard(null);
    setInlineComposer({
      x: chosenX,
      y: chosenY,
      lane,
      text: "",
      imagePreview: null,
    });
  };

  const handleSaveInlineComposer = async () => {
    if (!inlineComposer) return;
    const trimmed = inlineComposer.text.trim();
    if (!trimmed && !inlineComposer.imagePreview) {
      setInlineComposer(null);
      return;
    }
    let savedPath: string | undefined;
    if (inlineComposer.imagePreview) {
      const p = await savePastedImage(
        inlineComposer.imagePreview,
        "png",
        workspace.settings.customDataDir
      );
      if (p) savedPath = p;
    }

    const newIdea: IdeaItem = {
      id: uid("idea"),
      content: trimmed || "[截图灵感]",
      tag: t("river.defaultTag"),
      lane: inlineComposer.lane,
      imagePreview: inlineComposer.imagePreview || undefined,
      imagePath: savedPath,
      weather: liveWeather ?? getCachedWeatherSync() ?? undefined,
      createdAt: new Date().toISOString(),
    };
    onUpdate({
      ...workspace,
      ideas: [...workspace.ideas, newIdea],
    });
    setInlineComposer(null);
  };

  const cycleSpeed = () => {
    const order: RiverSpeed[] = ["slow", "normal", "fast"];
    setSpeed(order[(order.indexOf(speed) + 1) % order.length]);
  };

  // Mouse wheel horizontal scrolling in River View
  const handleRiverWheel = (e: React.WheelEvent) => {
    if (workspace.ideas.length === 0) return;
    const rawDelta =
      Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(rawDelta) < 1) return;

    const viewportW = containerRef.current?.clientWidth ?? 0;
    if (viewportW <= 0) return;

    setHoveredCard(null);
    const shift = rawDelta * 0.9;
    for (let row = 0; row < lanes.length; row++) {
      const track = trackRefs.current[row];
      const group = groupRefs.current[row];
      if (!track || !group) continue;
      const contentW = group.offsetWidth;
      if (contentW <= 0) continue;

      let nextX = (posXRef.current[row] ?? 16) - shift;
      if (nextX < -contentW) {
        nextX = viewportW;
      } else if (nextX > viewportW) {
        nextX = -contentW;
      }
      posXRef.current[row] = nextX;
      track.style.transform = `translate3d(${nextX}px, 0, 0)`;
    }
  };

  // Mouse wheel quick pagination in List View
  const handleListWheel = (e: React.WheelEvent) => {
    if (totalPages <= 1) return;
    const now = Date.now();
    if (now - lastWheelRef.current < 160) return;
    if (Math.abs(e.deltaY) < 8) return;

    lastWheelRef.current = now;
    setHoveredCard(null);
    if (e.deltaY > 0) {
      setCurrentPage((p) => (p < totalPages ? p + 1 : 1));
    } else {
      setCurrentPage((p) => (p > 1 ? p - 1 : totalPages));
    }
  };

  // ---- Stable per-card callbacks (passed to memoized IdeaPill / IdeaListRow) ----
  const handleCardEnter = useCallback(
    (idea: IdeaItem, e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const tooltipW = 320;
      let x = rect.left + rect.width / 2 - tooltipW / 2;
      x = Math.max(16, Math.min(window.innerWidth - tooltipW - 16, x));
      const y = rect.top - 10;
      setHoveredCard({ idea, x, y });
    },
    []
  );

  const handleCardLeave = useCallback(() => setHoveredCard(null), []);

  const handleSelectIdea = useCallback((ideaId: string) => {
    setHoveredCard(null);
    setSelectedIdeaId(ideaId);
  }, []);

  const handleIdeaContextMenu = useCallback(
    (e: React.MouseEvent, ideaId: string) =>
      openRiverMenu(e, { kind: "idea", ideaId }),
    [openRiverMenu]
  );

  const handleDragStartIdea = useCallback(
    (e: React.DragEvent, idea: IdeaItem) => {
      e.dataTransfer.setData("application/x-shibaplan-idea", idea.id);
      e.dataTransfer.setData("text/plain", idea.content);
      e.dataTransfer.effectAllowed = "move";
      setHoveredCard(null);
    },
    []
  );

  const registerTrack = useCallback(
    (rowIdx: number, el: HTMLDivElement | null) => {
      trackRefs.current[rowIdx] = el;
    },
    []
  );

  const registerGroup = useCallback(
    (rowIdx: number, el: HTMLDivElement | null) => {
      groupRefs.current[rowIdx] = el;
    },
    []
  );

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") setDraftImage(reader.result);
        };
        reader.readAsDataURL(file);
        e.preventDefault();
        break;
      }
    }
  };

  const handleSaveIdea = async () => {
    if (!draft.trim() && !draftImage) {
      setAddOpen(false);
      setEditingIdeaId(null);
      return;
    }
    let savedPath: string | undefined;
    if (draftImage) {
      const p = await savePastedImage(
        draftImage,
        "png",
        workspace.settings.customDataDir
      );
      if (p) savedPath = p;
    }

    if (editingIdeaId) {
      onUpdate({
        ...workspace,
        ideas: workspace.ideas.map((i) =>
          i.id === editingIdeaId
            ? {
                ...i,
                content: draft.trim() || "[截图灵感]",
                tag: draftTag.trim() || "灵感",
                imagePreview: draftImage || undefined,
                imagePath: savedPath ?? i.imagePath,
              }
            : i
        ),
      });
    } else {
      const newIdea: IdeaItem = {
        id: uid("idea"),
        content: draft.trim() || "[截图灵感]",
        tag: draftTag.trim() || "灵感",
        imagePreview: draftImage || undefined,
        imagePath: savedPath,
        weather: liveWeather ?? getCachedWeatherSync() ?? undefined,
        createdAt: new Date().toISOString(),
      };
      onUpdate({
        ...workspace,
        ideas: [newIdea, ...workspace.ideas],
      });
    }
    setDraft("");
    setDraftImage(null);
    setEditingIdeaId(null);
    setAddOpen(false);
  };

  const handleCopySpec = async () => {
    if (!selectedSpecText) return;
    await navigator.clipboard.writeText(selectedSpecText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleExportMd = async (idea: IdeaItem) => {
    const spec = generateAISpec(idea);
    const slug = idea.content.slice(0, 18).trim() || idea.id;
    const savedPath = await exportIdeaToMarkdown(
      slug,
      spec,
      workspace.settings.customDataDir
    );
    if (savedPath) {
      onUpdate({
        ...workspace,
        ideas: workspace.ideas.map((i) =>
          i.id === idea.id ? { ...i, exportedMdPath: savedPath } : i
        ),
      });
      setExportMsg(`已导出到 ${savedPath}`);
    } else {
      const blob = new Blob([spec], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slug}.md`;
      a.click();
      URL.revokeObjectURL(url);
      setExportMsg("已下载 .md 文件");
    }
    setTimeout(() => setExportMsg(null), 2800);
  };

  const handleSendToKanban = (idea: IdeaItem) => {
    const colId = targetColId || workspace.columns[0]?.id;
    if (!colId) return;
    const now = new Date().toISOString();
    const taskId = uid("task");
    const lines = idea.content
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0);
    const newTask: TaskItem = {
      id: taskId,
      title: (lines[0] ?? idea.content).slice(0, 80) || "截图灵感",
      notes: lines.length > 1 ? idea.content : undefined,
      columnId: colId,
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
    onUpdate({
      ...workspace,
      tasks: [newTask, ...workspace.tasks],
      ideas: workspace.ideas.filter((i) => i.id !== idea.id),
      trashedIdeas: [
        {
          ...idea,
          convertedTaskId: taskId,
          deletedAt: now,
          reason: "used",
        },
        ...workspace.trashedIdeas,
      ],
    });
    setSelectedIdeaId(null);
  };

  const handleMoveToTrash = useCallback(
    (idea: IdeaItem) => {
      const ws = workspaceRef.current;
      const trashed: TrashedIdeaItem = {
        ...idea,
        deletedAt: new Date().toISOString(),
        reason: "deleted",
      };
      onUpdate({
        ...ws,
        ideas: ws.ideas.filter((i) => i.id !== idea.id),
        trashedIdeas: [trashed, ...ws.trashedIdeas],
      });
      setSelectedIdeaId((cur) => (cur === idea.id ? null : cur));
    },
    [onUpdate]
  );

  const handleRestoreFromTrash = (trashed: TrashedIdeaItem) => {
    const { deletedAt: _d, reason: _r, ...restoredIdea } = trashed;
    onUpdate({
      ...workspace,
      ideas: [restoredIdea, ...workspace.ideas],
      trashedIdeas: workspace.trashedIdeas.filter((t) => t.id !== trashed.id),
    });
  };

  const handlePermanentDelete = (id: string) => {
    onUpdate({
      ...workspace,
      trashedIdeas: workspace.trashedIdeas.filter((t) => t.id !== id),
    });
  };

  const handleEmptyTrash = () => {
    onUpdate({
      ...workspace,
      trashedIdeas: [],
    });
  };

  return (
    <section
      style={{ height: collapsed ? 42 : height }}
      onDragOver={handleBoardCardDragOver}
      onDragLeave={handleBoardCardDragLeave}
      onDrop={handleBoardCardDrop}
      className={`relative flex shrink-0 flex-col border-t bg-surface-river select-none ${
        dragOverFromBoard
          ? "border-primary/70 ring-1 ring-inset ring-primary/40"
          : "border-border"
      } ${resizing ? "" : "transition-[height] duration-200 ease-out"}`}
    >
      {/* Subtle Drop Overlay Badge when dragging a Kanban card here */}
      {dragOverFromBoard && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-primary/[0.06] backdrop-blur-[1px]">
          <span className="rounded-md border border-primary/45 bg-popover/95 px-3 py-1 text-xs font-medium text-primary shadow-popover-soft">
            {dragCopyMode ? "松手复制到灵感流 (Alt)" : "松手移入灵感流 (按住 Alt 复制)"}
          </span>
        </div>
      )}
      {/* Top Resize Handle */}
      {!collapsed && (
        <div
          onMouseDown={startResize}
          onTouchStart={startResizeTouch}
          className="group absolute -top-2 left-0 right-0 z-10 flex h-4 cursor-row-resize items-center justify-center touch-none"
          title="上下拖动调整高度"
        >
          <div className="flex h-1 w-12 items-center justify-center rounded-full bg-border transition group-hover:bg-primary/70">
            <GripHorizontal className="h-3 w-3 text-transparent group-hover:text-primary-foreground" />
          </div>
        </div>
      )}

      {/* Linear Dock Header Bar (Idea cards below keep their original style) */}
      <div
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest("button, input, a")) return;
          setCollapsed((c) => !c);
        }}
        className="flex h-9 shrink-0 items-center justify-between gap-2 px-3 sm:px-5"
      >
        <div
          className="flex items-center gap-2 min-w-0 cursor-pointer"
          title={collapsed ? "双击展开灵感流" : "双击折叠灵感流"}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const menuW = 148;
            setInfoMenuPos({
              left: Math.max(8, Math.min(e.clientX, window.innerWidth - menuW - 12)),
              bottom: window.innerHeight - e.clientY + 6,
            });
          }}
        >
          {viewMode === "river" ? (
            <Waves className="h-3.5 w-3.5 shrink-0 text-primary" />
          ) : (
            <List className="h-3.5 w-3.5 shrink-0 text-primary" />
          )}
          <span className="truncate text-[12.5px] font-medium tracking-[-0.01em] text-foreground">
            {t("river.title")}
          </span>
          {((infoPrefs.weather && riverAtmosphere && liveWeather) ||
            infoPrefs.date ||
            (infoPrefs.lunar && Boolean(todayInfo.lunarLabel)) ||
            (infoPrefs.festival && Boolean(todayInfo.festivalLabel))) && (
            <span
              className="hidden sm:inline-flex items-center gap-1.5 rounded border border-border/70 bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground"
              title="右键自定义显示项（天气 / 日期 / 农历 / 节日）"
            >
              {infoPrefs.weather && riverAtmosphere && liveWeather && (
                <span className="inline-flex items-center gap-1">
                  {renderWeatherIcon(
                    liveWeather.kind,
                    new Date().getHours() >= 20 || new Date().getHours() <= 4,
                    "h-3 w-3 text-primary"
                  )}
                  <span>
                    {liveWeather.label}
                    {typeof liveWeather.tempC === "number"
                      ? ` ${liveWeather.tempC}°C`
                      : ""}
                  </span>
                </span>
              )}
              {infoPrefs.date && (
                <>
                  {infoPrefs.weather && riverAtmosphere && liveWeather && (
                    <span className="opacity-35">·</span>
                  )}
                  <span>{todayInfo.dateLabel}</span>
                </>
              )}
              {infoPrefs.lunar && todayInfo.lunarLabel && (
                <>
                  {((infoPrefs.weather && riverAtmosphere && liveWeather) ||
                    infoPrefs.date) && <span className="opacity-35">·</span>}
                  <span>{todayInfo.lunarLabel}</span>
                </>
              )}
              {infoPrefs.festival && todayInfo.festivalLabel && (
                <>
                  {((infoPrefs.weather && riverAtmosphere && liveWeather) ||
                    infoPrefs.date ||
                    (infoPrefs.lunar && Boolean(todayInfo.lunarLabel))) && (
                    <span className="opacity-35">·</span>
                  )}
                  <span className="font-medium text-primary">
                    {todayInfo.festivalLabel}
                  </span>
                </>
              )}
            </span>
          )}
        </div>

        {/* Right-click checklist popover for Weather / Date / Lunar / Festival */}
        {infoMenuPos && (
          <div
            style={{ left: infoMenuPos.left, bottom: infoMenuPos.bottom }}
            onClick={(e) => e.stopPropagation()}
            className="fixed z-50 w-36 rounded-lg border border-border bg-popover p-1 shadow-popover-soft"
          >
            {(
              [
                { key: "weather", label: "天气" },
                { key: "date", label: "日期" },
                { key: "lunar", label: "农历" },
                { key: "festival", label: "节日" },
              ] as const
            ).map((item) => {
              const checked = infoPrefs[item.key];
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => toggleInfoPref(item.key)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-popover-foreground transition-colors hover:bg-accent"
                >
                  <span
                    className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border transition-colors ${
                      checked
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-muted-foreground/45 bg-transparent"
                    }`}
                  >
                    {checked && <Check className="h-2.5 w-2.5 stroke-[2.8]" />}
                  </span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-1 shrink-0">
          {!collapsed && (
            <>
              <button
                type="button"
                onClick={toggleRiverAtmosphere}
                className={`rounded-md p-1.5 transition-colors ${
                  riverAtmosphere
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
                title={
                  riverAtmosphere
                    ? "已开启 24 小时与天气氛围主题（点击关闭）"
                    : "开启 24 小时与天气氛围主题"
                }
              >
                <CloudSun className="h-3.5 w-3.5" />
              </button>
              <div className="flex items-center rounded-md border border-border bg-surface p-0.5">
                <button
                  onClick={() => setViewMode("river")}
                  className={`rounded-[4px] p-1 transition-colors ${
                    viewMode === "river"
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title={t("river.modeRiver")}
                >
                  <Waves className="h-3 w-3" />
                </button>
                <button
                  onClick={() => setViewMode("list")}
                  className={`rounded-[4px] p-1 transition-colors ${
                    viewMode === "list"
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title={t("river.modeList")}
                >
                  <List className="h-3 w-3" />
                </button>
              </div>

              {viewMode === "river" && (
                <>
                  <button
                    onClick={() => setPaused((p) => !p)}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    title={paused ? t("river.resume") : t("river.pause")}
                  >
                    {paused ? (
                      <Play className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <Pause className="h-3.5 w-3.5" />
                    )}
                  </button>

                  <button
                    onClick={cycleSpeed}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    title={t(`river.speed${speed[0].toUpperCase()}${speed.slice(1)}`)}
                  >
                    <Gauge className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </>
          )}

          <button
            onClick={() => setTrashOpen(true)}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={`${t("river.trashTitle")} (${workspace.trashedIdeas.length})`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>

          <button
            onClick={() => {
              setEditingIdeaId(null);
              setDraft("");
              setDraftTag(t("river.defaultTag"));
              setDraftImage(null);
              setAddOpen(true);
            }}
            className="rounded-md border border-border bg-secondary/75 p-1.5 text-secondary-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={t("river.addIdea")}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>

          <button
            onClick={() => setCollapsed((c) => !c)}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={collapsed ? "展开" : "折叠"}
          >
            {collapsed ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Main Dock Body */}
      {!collapsed && viewMode === "river" && (
        <div
          ref={containerRef}
          onMouseEnter={() => setHoveredRiver(true)}
          onMouseLeave={() => {
            setHoveredRiver(false);
            setHoveredCard(null);
          }}
          onDoubleClick={handleRiverDoubleClick}
          onContextMenu={(e) => {
            if ((e.target as HTMLElement).closest("[data-idea-pill]")) return;
            openRiverMenu(e, { kind: "area" });
          }}
          onWheel={handleRiverWheel}
          className="relative flex flex-1 flex-col justify-center gap-2.5 overflow-hidden px-4 pb-3 pt-1"
        >
          {workspace.ideas.length === 0 && !inlineComposer ? (
            <div className="flex w-full items-center justify-center text-xs text-zinc-500">
              {t("river.emptyRiver")}
            </div>
          ) : (
            lanes.map((laneItems, rowIdx) => (
              <IdeaLane
                key={`lane-${rowIdx}`}
                rowIdx={rowIdx}
                items={laneItems}
                riverAtmosphere={riverAtmosphere}
                currentTheme={currentTheme}
                liveWeather={liveWeather}
                registerTrack={registerTrack}
                registerGroup={registerGroup}
                onDragStart={handleDragStartIdea}
                onEnter={handleCardEnter}
                onLeave={handleCardLeave}
                onSelect={handleSelectIdea}
                onContextMenu={handleIdeaContextMenu}
              />
            ))
          )}

          {/* Non-overlapping Inline Composer at Mouse Position */}
          {inlineComposer && (
            <div
              data-inline-composer="true"
              style={{ left: inlineComposer.x, top: inlineComposer.y }}
              className="absolute z-30 flex h-12 w-64 items-center gap-2 rounded-2xl bg-[#202026] px-3 ring-1 ring-shiba-400/70 shadow-2xl"
            >
              {inlineComposer.imagePreview && (
                <img
                  src={inlineComposer.imagePreview}
                  alt="pasted"
                  className="h-8 w-8 shrink-0 rounded-lg object-cover ring-1 ring-white/10"
                />
              )}
              <input
                autoFocus
                type="text"
                value={inlineComposer.text}
                onChange={(e) =>
                  setInlineComposer((prev) =>
                    prev ? { ...prev, text: e.target.value } : null
                  )
                }
                onPaste={(e) => {
                  const items = e.clipboardData?.items;
                  if (!items) return;
                  for (let i = 0; i < items.length; i++) {
                    if (items[i].type.startsWith("image/")) {
                      const file = items[i].getAsFile();
                      if (!file) continue;
                      const reader = new FileReader();
                      reader.onload = () => {
                        if (typeof reader.result === "string") {
                          setInlineComposer((prev) =>
                            prev
                              ? { ...prev, imagePreview: reader.result as string }
                              : null
                          );
                        }
                      };
                      reader.readAsDataURL(file);
                      e.preventDefault();
                      break;
                    }
                  }
                }}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSaveInlineComposer();
                  } else if (e.key === "Escape") {
                    setInlineComposer(null);
                  }
                }}
                onBlur={() => handleSaveInlineComposer()}
                placeholder={t("river.addIdea")}
                className="min-w-0 flex-1 bg-transparent text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none"
              />
            </div>
          )}
        </div>
      )}

      {/* Paginated List View with Mouse Wheel Quick Flip */}
      {!collapsed && viewMode === "list" && (
        <div
          onMouseEnter={() => setHoveredRiver(true)}
          onMouseLeave={() => {
            setHoveredRiver(false);
            setHoveredCard(null);
          }}
          onDoubleClick={(e) => {
            if ((e.target as HTMLElement).closest("[data-idea-pill]")) return;
            setEditingIdeaId(null);
            setDraft("");
            setDraftTag(t("river.defaultTag"));
            setDraftImage(null);
            setAddOpen(true);
          }}
          onContextMenu={(e) => {
            if ((e.target as HTMLElement).closest("[data-idea-pill]")) return;
            openRiverMenu(e, { kind: "area" });
          }}
          onWheel={handleListWheel}
          className="flex flex-1 flex-col justify-between overflow-hidden px-6 pb-2.5 pt-1"
        >
          {workspace.ideas.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-xs text-zinc-500">
              暂无灵感记录，点击「记灵感」或悬停此处按 Ctrl+V 添加
            </div>
          ) : (
            <>
              <div className="space-y-1.5 overflow-hidden">
                {paginatedIdeas.map((idea) => (
                  <IdeaListRow
                    key={idea.id}
                    idea={idea}
                    onDragStart={handleDragStartIdea}
                    onEnter={handleCardEnter}
                    onLeave={handleCardLeave}
                    onSelect={handleSelectIdea}
                    onContextMenu={handleIdeaContextMenu}
                    onTrash={handleMoveToTrash}
                  />
                ))}
              </div>

              {/* Minimal Pagination Footer */}
              {totalPages > 1 && (
                <div className="mt-1 flex items-center justify-center gap-2 text-xs text-zinc-500">
                  <button
                    onClick={() =>
                      setCurrentPage((p) => (p > 1 ? p - 1 : totalPages))
                    }
                    className="rounded p-0.5 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <span className="font-mono text-zinc-400">
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    onClick={() =>
                      setCurrentPage((p) => (p < totalPages ? p + 1 : 1))
                    }
                    className="rounded p-0.5 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* IdeaRiver Right-Click Context Menu */}
      {riverMenu && (
        <RiverContextMenu
          menu={riverMenu}
          ctxIdea={
            riverMenu.kind === "idea"
              ? workspace.ideas.find((i) => i.id === riverMenu.ideaId) ?? null
              : null
          }
          hasColumns={workspace.columns.length > 0}
          viewMode={viewMode}
          paused={paused}
          speed={speed}
          trashCount={workspace.trashedIdeas.length}
          onClose={() => setRiverMenu(null)}
          onEditIdea={(ctxIdea) => {
            setEditingIdeaId(ctxIdea.id);
            setDraft(ctxIdea.content);
            setDraftTag(ctxIdea.tag || t("river.defaultTag"));
            setDraftImage(ctxIdea.imagePreview || null);
            setAddOpen(true);
          }}
          onOpenDetail={(id) => setSelectedIdeaId(id)}
          onExportMd={(idea) => {
            handleExportMd(idea);
          }}
          onSendToKanban={handleSendToKanban}
          onTrashIdea={handleMoveToTrash}
          onAddIdea={() => {
            setEditingIdeaId(null);
            setDraft("");
            setDraftTag(t("river.defaultTag"));
            setDraftImage(null);
            setAddOpen(true);
          }}
          onToggleViewMode={() =>
            setViewMode((m) => (m === "river" ? "list" : "river"))
          }
          onTogglePaused={() => setPaused((p) => !p)}
          onCycleSpeed={cycleSpeed}
          onOpenTrash={() => setTrashOpen(true)}
          onCollapse={() => setCollapsed(true)}
        />
      )}

      {/* Hover Full-Content Preview Popover */}
      {hoveredCard && !selectedIdea && !addOpen && !trashOpen && (
        <HoverPreview
          idea={hoveredCard.idea}
          x={hoveredCard.x}
          y={hoveredCard.y}
        />
      )}

      {/* Quick Add / Edit Idea Modal (shadcn/ui Dialog) */}
      <IdeaEditorDialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) {
            setEditingIdeaId(null);
            setSaveModeMenuOpen(false);
          }
        }}
        isEditing={Boolean(editingIdeaId)}
        draft={draft}
        onDraftChange={setDraft}
        draftTag={draftTag}
        onDraftTagChange={setDraftTag}
        draftImage={draftImage}
        onClearImage={() => setDraftImage(null)}
        onPaste={handlePaste}
        onSave={handleSaveIdea}
        enterToSave={enterToSave}
        onSetEnterToSave={setEnterToSave}
        saveModeMenuOpen={saveModeMenuOpen}
        onToggleSaveModeMenu={() => setSaveModeMenuOpen((v) => !v)}
      />

      {/* Idea Detail & AI Prompt Modal (shadcn/ui Dialog) */}
      <IdeaDetailDialog
        selectedIdea={selectedIdea}
        specText={selectedSpecText}
        columns={workspace.columns}
        targetColId={targetColId}
        onTargetColChange={setTargetColId}
        exportMsg={exportMsg}
        aiError={aiError}
        aiBreakingDown={aiBreakingDown}
        copied={copied}
        onClose={() => setSelectedIdeaId(null)}
        onTrash={handleMoveToTrash}
        onSendToKanban={handleSendToKanban}
        onAiBreakdown={handleAiBreakdown}
        onExportMd={handleExportMd}
        onCopySpec={handleCopySpec}
      />

      {/* Idea Recycle Bin Modal (shadcn/ui Dialog) */}
      <TrashDialog
        open={trashOpen}
        onOpenChange={setTrashOpen}
        trashedIdeas={workspace.trashedIdeas}
        onEmptyTrash={handleEmptyTrash}
        onRestore={handleRestoreFromTrash}
        onPermanentDelete={handlePermanentDelete}
      />
    </section>
  );
};
