import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Copy,
  FileDown,
  Gauge,
  GripHorizontal,
  GripVertical,
  Image as ImageIcon,
  List,
  Loader2,
  Moon,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Sun,
  Trash2,
  Wand2,
  Waves,
  X,
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
  WeatherKind,
  WorkspaceData,
} from "../types";
import {
  fetchCurrentWeather,
  getCachedWeatherSync,
  getHourAtmosphere,
  getWeatherClassName,
} from "../lib/atmosphere";
import {
  exportIdeaToMarkdown,
  generateAISpec,
  savePastedImage,
  uid,
} from "../lib/storage";
import { breakdownIdeaWithAI } from "../lib/ai";
import { useI18n } from "../lib/i18n";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Separator } from "./ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

interface IdeaRiverProps {
  workspace: WorkspaceData;
  onUpdate: (next: WorkspaceData) => void;
}

type RiverSpeed = "slow" | "normal" | "fast";
type IdeaViewMode = "river" | "list";

const SPEED_PX_PER_SEC: Record<RiverSpeed, number> = {
  slow: 22,
  normal: 42,
  fast: 76,
};

const SPEED_LABEL: Record<RiverSpeed, string> = {
  slow: "慢速",
  normal: "中速",
  fast: "快速",
};

const LANE_SPEED_FACTORS = [1.0, 0.78, 1.18, 0.88, 1.08, 0.82];

function computeCardWidth(idea: IdeaItem): number {
  let hash = 0;
  for (let i = 0; i < idea.id.length; i++) {
    hash = (hash * 31 + idea.id.charCodeAt(i)) | 0;
  }
  const jitter = (Math.abs(hash) % 72) - 24;
  const charCount = idea.content.length;
  const base =
    170 + Math.min(charCount, 48) * 3.6 + (idea.imagePreview ? 44 : 0);
  return Math.round(Math.max(176, Math.min(390, base + jitter)));
}

const renderWeatherIcon = (
  kind?: WeatherKind,
  isNight?: boolean,
  className = "h-3.5 w-3.5 shrink-0"
) => {
  switch (kind) {
    case "rain":
      return <CloudRain className={className} />;
    case "storm":
      return <CloudLightning className={className} />;
    case "snow":
      return <CloudSnow className={className} />;
    case "fog":
      return <CloudFog className={className} />;
    case "cloudy":
      return <Cloud className={className} />;
    case "clear":
      return isNight ? (
        <Moon className={className} />
      ) : (
        <Sun className={className} />
      );
    default:
      return isNight ? (
        <Moon className={className} />
      ) : (
        <Sun className={className} />
      );
  }
};

export const IdeaRiver: React.FC<IdeaRiverProps> = ({
  workspace,
  onUpdate,
}) => {
  const { t } = useI18n();
  // Dock layout: collapsible + resizable height
  const [collapsed, setCollapsed] = useState(false);
  const [liveWeather, setLiveWeather] = useState<IdeaWeather | null>(() =>
    getCachedWeatherSync()
  );
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
  const [height, setHeight] = useState(() =>
    typeof window !== "undefined" && window.innerWidth < 640 ? 176 : 236
  );
  const [resizing, setResizing] = useState(false);

  // View mode: flowing river vs paginated list
  const [viewMode, setViewMode] = useState<IdeaViewMode>("river");
  const [currentPage, setCurrentPage] = useState(1);
  const lastWheelRef = useRef(0);

  // River flow state
  const [paused, setPaused] = useState(false);
  const [hoveredRiver, setHoveredRiver] = useState(false);
  const [speed, setSpeed] = useState<RiverSpeed>("slow");

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
        baseUrl: "https://api.openai.com/v1",
        apiKey: "",
        model: "gpt-4o-mini",
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
  const [riverMenu, setRiverMenu] = useState<
    | { kind: "idea"; ideaId: string; x: number; y: number }
    | { kind: "area"; x: number; y: number }
    | null
  >(null);

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

  const openRiverMenu = (
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
  };

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

  const handleCardEnter = (
    idea: IdeaItem,
    e: React.MouseEvent<HTMLDivElement>
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const tooltipW = 320;
    let x = rect.left + rect.width / 2 - tooltipW / 2;
    x = Math.max(16, Math.min(window.innerWidth - tooltipW - 16, x));
    const y = rect.top - 10;
    setHoveredCard({ idea, x, y });
  };

  const handleDragStartIdea = (e: React.DragEvent, idea: IdeaItem) => {
    e.dataTransfer.setData("application/x-shibaplan-idea", idea.id);
    e.dataTransfer.setData("text/plain", idea.content);
    e.dataTransfer.effectAllowed = "move";
    setHoveredCard(null);
  };

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

  const handleMoveToTrash = (idea: IdeaItem) => {
    const trashed: TrashedIdeaItem = {
      ...idea,
      deletedAt: new Date().toISOString(),
      reason: "deleted",
    };
    onUpdate({
      ...workspace,
      ideas: workspace.ideas.filter((i) => i.id !== idea.id),
      trashedIdeas: [trashed, ...workspace.trashedIdeas],
    });
    if (selectedIdeaId === idea.id) setSelectedIdeaId(null);
  };

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

  const renderPill = (idea: IdeaItem, key: string) => {
    const width = computeCardWidth(idea) + (riverAtmosphere ? 16 : 0);
    const atmo = riverAtmosphere
      ? getHourAtmosphere(idea.createdAt, currentTheme)
      : null;
    const effectiveWeather = idea.weather ?? (riverAtmosphere ? liveWeather : null);
    const weatherCls =
      riverAtmosphere && atmo
        ? getWeatherClassName(effectiveWeather?.kind, atmo.isNight)
        : "";
    const tailFill = atmo
      ? atmo.background.match(/#[0-9a-fA-F]{6}/)?.[0] ?? "#1a1a1f"
      : currentTheme === "dark"
        ? "#1a1a1f"
        : currentTheme === "paper"
          ? "#faf6ee"
          : "#ffffff";

    return (
      <div
        key={key}
        data-idea-pill="true"
        draggable
        onDragStart={(e) => handleDragStartIdea(e, idea)}
        style={{
          width,
          ...(atmo
            ? { background: atmo.background, color: atmo.textColor }
            : {}),
        }}
        onMouseEnter={(e) => handleCardEnter(idea, e)}
        onMouseLeave={() => setHoveredCard(null)}
        onClick={() => {
          setHoveredCard(null);
          setSelectedIdeaId(idea.id);
        }}
        onContextMenu={(e) =>
          openRiverMenu(e, { kind: "idea", ideaId: idea.id })
        }
        className={`idea-speech-bubble group relative flex h-11 shrink-0 cursor-grab active:cursor-grabbing items-center gap-2.5 px-3.5 shadow-[0_2px_10px_rgba(0,0,0,0.24)] transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_6px_18px_rgba(0,0,0,0.38)] ${
          atmo ? "" : "bg-[#1a1a1f] hover:bg-[#24242c]"
        }`}
      >
        {/* Speech-bubble curved corner tail */}
        <svg
          viewBox="0 0 12 12"
          className="pointer-events-none absolute -left-[6px] bottom-0 h-3 w-3"
          aria-hidden="true"
        >
          <path d="M12 0 V12 H0 C5 12 9 8 12 0 Z" fill={tailFill} />
        </svg>

        {/* Animated Weather Overlay Layer (clipped to bubble interior) */}
        {weatherCls && (
          <div
            className={`pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] ${weatherCls}`}
          />
        )}

        {idea.imagePreview && (
          <img
            src={idea.imagePreview}
            alt="thumbnail"
            className="relative z-10 h-8 w-8 shrink-0 rounded-lg object-cover ring-1 ring-white/[0.12]"
          />
        )}

        <div className="relative z-10 min-w-0 flex-1">
          <p
            style={atmo ? { color: atmo.textColor } : undefined}
            className={`truncate text-[13px] ${atmo ? "" : "text-zinc-200"}`}
          >
            {idea.content}
          </p>
        </div>

        {riverAtmosphere && atmo && (
          <span
            style={{ color: atmo.mutedColor }}
            title={`${atmo.periodLabel}${
              effectiveWeather?.label ? ` · ${effectiveWeather.label}` : ""
            }${
              typeof effectiveWeather?.tempC === "number"
                ? ` ${effectiveWeather.tempC}°C`
                : ""
            }`}
            className="relative z-10 flex shrink-0 items-center"
          >
            {renderWeatherIcon(
              effectiveWeather?.kind,
              atmo.isNight,
              "h-3.5 w-3.5"
            )}
          </span>
        )}

        <span
          style={
            atmo
              ? { backgroundColor: atmo.badgeBg, color: atmo.mutedColor }
              : undefined
          }
          className={`relative z-10 shrink-0 rounded-md px-1.5 py-0.5 text-xs ${
            atmo ? "" : "bg-white/[0.05] text-zinc-400"
          }`}
        >
          {idea.tag || "灵感"}
        </span>
      </div>
    );
  };

  return (
    <section
      style={{ height: collapsed ? 42 : height }}
      onDragOver={handleBoardCardDragOver}
      onDragLeave={handleBoardCardDragLeave}
      onDrop={handleBoardCardDrop}
      className={`relative flex shrink-0 flex-col border-t bg-[#131316] select-none ${
        dragOverFromBoard
          ? "border-shiba-400/70 ring-1 ring-inset ring-shiba-400/40"
          : "border-white/[0.06]"
      } ${resizing ? "" : "transition-[height] duration-200 ease-out"}`}
    >
      {/* Subtle Drop Overlay Badge when dragging a Kanban card here */}
      {dragOverFromBoard && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-shiba-500/[0.06] backdrop-blur-[1px]">
          <span className="rounded-lg bg-[#1c1c21]/95 px-3 py-1 text-xs font-medium text-shiba-300 ring-1 ring-shiba-400/50 shadow-lg">
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
          <div className="flex h-1 w-12 items-center justify-center rounded-full bg-white/[0.08] transition group-hover:bg-shiba-500/60">
            <GripHorizontal className="h-3 w-3 text-transparent group-hover:text-zinc-950" />
          </div>
        </div>
      )}

      {/* Ultra-Minimal Icon-First Header Bar */}
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
        >
          {viewMode === "river" ? (
            <Waves className="h-3.5 w-3.5 shrink-0 text-shiba-400" />
          ) : (
            <List className="h-3.5 w-3.5 shrink-0 text-shiba-400" />
          )}
          <span className="truncate text-[13px] font-medium text-zinc-200">
            {t("river.title")}
          </span>
          {riverAtmosphere && liveWeather && (
            <span
              className="hidden sm:inline-flex items-center gap-1 rounded-md bg-white/[0.05] px-1.5 py-0.5 text-xs text-zinc-400"
              title="当前自动获取的本地天气"
            >
              {renderWeatherIcon(
                liveWeather.kind,
                new Date().getHours() >= 20 || new Date().getHours() <= 4,
                "h-3 w-3 text-shiba-400"
              )}
              <span>
                {liveWeather.label}
                {typeof liveWeather.tempC === "number"
                  ? ` ${liveWeather.tempC}°C`
                  : ""}
              </span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {!collapsed && (
            <>
              <button
                type="button"
                onClick={toggleRiverAtmosphere}
                className={`rounded-lg p-1.5 transition ${
                  riverAtmosphere
                    ? "bg-shiba-500/15 text-shiba-300"
                    : "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
                }`}
                title={
                  riverAtmosphere
                    ? "已开启 24 小时与天气氛围主题（点击关闭）"
                    : "开启 24 小时与天气氛围主题"
                }
              >
                <CloudSun className="h-3.5 w-3.5" />
              </button>
              <div className="flex items-center rounded-lg bg-white/[0.04] p-0.5 ring-1 ring-white/[0.05]">
                <button
                  onClick={() => setViewMode("river")}
                  className={`rounded-md p-1 transition ${
                    viewMode === "river"
                      ? "bg-[#232328] text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                  title={t("river.modeRiver")}
                >
                  <Waves className="h-3 w-3" />
                </button>
                <button
                  onClick={() => setViewMode("list")}
                  className={`rounded-md p-1 transition ${
                    viewMode === "list"
                      ? "bg-[#232328] text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-300"
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
                    className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-100"
                    title={paused ? t("river.resume") : t("river.pause")}
                  >
                    {paused ? (
                      <Play className="h-3.5 w-3.5 text-shiba-400" />
                    ) : (
                      <Pause className="h-3.5 w-3.5" />
                    )}
                  </button>

                  <button
                    onClick={cycleSpeed}
                    className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-100"
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
            className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-100"
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
            className="rounded-lg bg-white/[0.06] p-1.5 text-zinc-200 transition hover:bg-white/[0.11]"
            title={t("river.addIdea")}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>

          <button
            onClick={() => setCollapsed((c) => !c)}
            className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-100"
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
              <div
                key={`lane-${rowIdx}`}
                className="flex h-14 items-center overflow-hidden py-1"
              >
                <div
                  ref={(el) => {
                    trackRefs.current[rowIdx] = el;
                  }}
                  className="flex items-center will-change-transform"
                >
                  <div
                    ref={(el) => {
                      groupRefs.current[rowIdx] = el;
                    }}
                    className="flex shrink-0 items-center gap-3 pr-3"
                  >
                    {laneItems.map(({ idea, key }) => renderPill(idea, key))}
                  </div>
                </div>
              </div>
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
                  <div
                    key={idea.id}
                    data-idea-pill="true"
                    draggable
                    onDragStart={(e) => handleDragStartIdea(e, idea)}
                    onMouseEnter={(e) => handleCardEnter(idea, e)}
                    onMouseLeave={() => setHoveredCard(null)}
                    onClick={() => {
                      setHoveredCard(null);
                      setSelectedIdeaId(idea.id);
                    }}
                    onContextMenu={(e) =>
                      openRiverMenu(e, { kind: "idea", ideaId: idea.id })
                    }
                    className="group flex h-9 cursor-grab active:cursor-grabbing items-center justify-between gap-3 rounded-xl bg-[#1a1a1f] px-3 shadow-[0_1px_4px_rgba(0,0,0,0.2)] transition-all duration-150 hover:bg-[#24242c] hover:shadow-[0_4px_12px_rgba(0,0,0,0.32)]"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <GripVertical className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
                      {idea.imagePreview && (
                        <img
                          src={idea.imagePreview}
                          alt="thumb"
                          className="h-6 w-6 shrink-0 rounded object-cover ring-1 ring-white/[0.1]"
                        />
                      )}
                      <span className="truncate text-xs text-zinc-200">
                        {idea.content}
                      </span>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <span className="rounded bg-white/[0.05] px-1.5 py-0.5 text-xs text-zinc-400">
                        {idea.tag || "灵感"}
                      </span>
                      <span className="text-xs text-zinc-500">
                        {new Date(idea.createdAt).toLocaleString("zh-CN", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMoveToTrash(idea);
                        }}
                        className="rounded p-1 text-zinc-500 opacity-0 transition group-hover:opacity-100 hover:bg-white/[0.08] hover:text-rose-400"
                        title="移入回收站"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
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
        <div
          style={{ left: riverMenu.x, top: riverMenu.y }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-44 rounded-xl bg-[#1c1c21] p-1.5 shadow-2xl ring-1 ring-white/[0.1]"
        >
          {riverMenu.kind === "idea" &&
            (() => {
              const ctxIdea = workspace.ideas.find(
                (i) => i.id === riverMenu.ideaId
              );
              if (!ctxIdea) return null;
              return (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingIdeaId(ctxIdea.id);
                      setDraft(ctxIdea.content);
                      setDraftTag(ctxIdea.tag || t("river.defaultTag"));
                      setDraftImage(ctxIdea.imagePreview || null);
                      setAddOpen(true);
                      setRiverMenu(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-white/[0.07]"
                  >
                    <Pencil className="h-3.5 w-3.5 text-zinc-400" />
                    <span>{t("river.editIdea")}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedIdeaId(ctxIdea.id);
                      setRiverMenu(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-white/[0.07]"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-shiba-400" />
                    <span>AI Prompt</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(ctxIdea.content);
                      setRiverMenu(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-white/[0.07]"
                  >
                    <Copy className="h-3.5 w-3.5 text-zinc-400" />
                    <span>复制内容</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      handleExportMd(ctxIdea);
                      setRiverMenu(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-white/[0.07]"
                  >
                    <FileDown className="h-3.5 w-3.5 text-zinc-400" />
                    <span>{t("river.exportMd")}</span>
                  </button>

                  {workspace.columns.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        handleSendToKanban(ctxIdea);
                        setRiverMenu(null);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-white/[0.07]"
                    >
                      <ArrowUpRight className="h-3.5 w-3.5 text-zinc-400" />
                      <span>{t("river.sendToKanban")}</span>
                    </button>
                  )}

                  <div className="my-1 border-t border-white/[0.06]" />

                  <button
                    type="button"
                    onClick={() => {
                      handleMoveToTrash(ctxIdea);
                      setRiverMenu(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-rose-400 transition hover:bg-rose-500/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>移入回收站</span>
                  </button>
                </>
              );
            })()}

          {riverMenu.kind === "area" && (
            <>
              <button
                type="button"
                onClick={() => {
                  setEditingIdeaId(null);
                  setDraft("");
                  setDraftTag(t("river.defaultTag"));
                  setDraftImage(null);
                  setAddOpen(true);
                  setRiverMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-white/[0.07]"
              >
                <Plus className="h-3.5 w-3.5 text-zinc-400" />
                <span>{t("river.addIdea")}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setViewMode((m) => (m === "river" ? "list" : "river"));
                  setRiverMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-white/[0.07]"
              >
                {viewMode === "river" ? (
                  <List className="h-3.5 w-3.5 text-zinc-400" />
                ) : (
                  <Waves className="h-3.5 w-3.5 text-zinc-400" />
                )}
                <span>
                  {viewMode === "river" ? "切换到列表视图" : "切换到河流视图"}
                </span>
              </button>

              {viewMode === "river" && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setPaused((p) => !p);
                      setRiverMenu(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-white/[0.07]"
                  >
                    {paused ? (
                      <Play className="h-3.5 w-3.5 text-shiba-400" />
                    ) : (
                      <Pause className="h-3.5 w-3.5 text-zinc-400" />
                    )}
                    <span>{paused ? t("river.resume") : t("river.pause")}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      cycleSpeed();
                      setRiverMenu(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-white/[0.07]"
                  >
                    <Gauge className="h-3.5 w-3.5 text-zinc-400" />
                    <span>切换流速 ({SPEED_LABEL[speed]})</span>
                  </button>
                </>
              )}

              <div className="my-1 border-t border-white/[0.06]" />

              <button
                type="button"
                onClick={() => {
                  setTrashOpen(true);
                  setRiverMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-white/[0.07]"
              >
                <Trash2 className="h-3.5 w-3.5 text-zinc-400" />
                <span>
                  {t("river.trashTitle")} ({workspace.trashedIdeas.length})
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setCollapsed(true);
                  setRiverMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-white/[0.07]"
              >
                <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
                <span>折叠灵感流</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* Hover Full-Content Preview Popover */}
      {hoveredCard && !selectedIdea && !addOpen && !trashOpen && (
        <div
          style={{
            left: hoveredCard.x,
            top: hoveredCard.y,
            transform: "translateY(-100%)",
          }}
          className="pointer-events-none fixed z-40 w-[320px] rounded-2xl bg-[#1c1c21]/95 p-3.5 ring-1 ring-white/[0.12] shadow-2xl backdrop-blur-md"
        >
          {hoveredCard.idea.imagePreview && (
            <img
              src={hoveredCard.idea.imagePreview}
              alt="full preview"
              className="mb-2.5 max-h-36 w-full rounded-xl object-cover ring-1 ring-white/[0.08]"
            />
          )}
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-100">
            {hoveredCard.idea.content}
          </p>
          <div className="mt-2.5 flex items-center justify-between border-t border-white/[0.06] pt-2 text-xs text-zinc-500">
            <span>
              {hoveredCard.idea.tag || "灵感"} ·{" "}
              {new Date(hoveredCard.idea.createdAt).toLocaleString("zh-CN", {
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span className="flex items-center gap-1 text-shiba-400">
              <Sparkles className="h-2.5 w-2.5" />
              拖入看板或点击查看
            </span>
          </div>
        </div>
      )}

      {/* Quick Add / Edit Idea Modal (shadcn/ui Dialog) */}
      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) {
            setEditingIdeaId(null);
            setSaveModeMenuOpen(false);
          }
        }}
      >
        <DialogContent className="max-w-lg select-text">
          <DialogHeader>
            <DialogTitle>
              {editingIdeaId ? t("river.editIdea") : t("river.newIdea")}
            </DialogTitle>
          </DialogHeader>

          <Textarea
            autoFocus
            rows={4}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (enterToSave) {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSaveIdea();
                }
              } else {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  handleSaveIdea();
                }
              }
            }}
            placeholder={t("river.ideaPlaceholder")}
            className="mt-3 text-sm"
          />

          {draftImage && (
            <div className="relative mt-2.5 inline-block">
              <img
                src={draftImage}
                alt="preview"
                className="max-h-28 rounded-xl shadow-card-rest"
              />
              <button
                onClick={() => setDraftImage(null)}
                className="absolute -right-2 -top-2 rounded-full bg-secondary p-1 text-secondary-foreground shadow hover:bg-accent"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Input
                type="text"
                value={draftTag}
                onChange={(e) => setDraftTag(e.target.value)}
                placeholder={t("river.tagPlaceholder")}
                className="w-24"
              />
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <ImageIcon className="h-3.5 w-3.5" />
                {t("river.pasteTip")}
              </span>
            </div>

            <div className="relative flex items-center">
              {saveModeMenuOpen && (
                <div className="absolute bottom-full right-0 mb-1.5 w-44 rounded-xl bg-popover p-1 shadow-popover-soft">
                  <button
                    type="button"
                    onClick={() => setEnterToSave(true)}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs text-popover-foreground hover:bg-accent"
                  >
                    <span>{t("river.enterSave")}</span>
                    {enterToSave && (
                      <Check className="h-3.5 w-3.5 text-primary" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEnterToSave(false)}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs text-popover-foreground hover:bg-accent"
                  >
                    <span>{t("river.ctrlEnterSave")}</span>
                    {!enterToSave && (
                      <Check className="h-3.5 w-3.5 text-primary" />
                    )}
                  </button>
                </div>
              )}

              <div className="flex items-stretch overflow-hidden rounded-lg bg-primary text-primary-foreground shadow-sm">
                <button
                  type="button"
                  onClick={handleSaveIdea}
                  disabled={!draft.trim() && !draftImage}
                  className="h-8 px-3.5 text-xs font-medium transition hover:opacity-90 disabled:opacity-40"
                >
                  {t("common.save")}
                </button>
                <button
                  type="button"
                  onClick={() => setSaveModeMenuOpen((v) => !v)}
                  className="flex items-center justify-center border-l border-primary-foreground/20 px-1.5 transition hover:opacity-90"
                  title={
                    enterToSave
                      ? t("river.enterSave")
                      : t("river.ctrlEnterSave")
                  }
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Idea Detail & AI Prompt Modal (shadcn/ui Dialog) */}
      <Dialog
        open={Boolean(selectedIdea)}
        onOpenChange={(open) => {
          if (!open) setSelectedIdeaId(null);
        }}
      >
        <DialogContent className="flex max-h-[84vh] max-w-xl flex-col p-0 select-text">
          <div className="flex items-center justify-between px-5 py-3.5">
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              {t("river.detailTitle")}
            </DialogTitle>
            {selectedIdea && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleMoveToTrash(selectedIdea)}
                className="mr-6 text-muted-foreground hover:text-destructive"
                title={t("river.trashTitle")}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>

          <Separator />

          {selectedIdea && (
            <>
              <div className="flex-1 space-y-3 overflow-y-auto p-5">
                {exportMsg && (
                  <div className="rounded-lg bg-emerald-500/12 px-3 py-2 text-xs text-emerald-500">
                    {exportMsg}
                  </div>
                )}
                {aiError && (
                  <div className="rounded-lg bg-destructive/12 px-3 py-2 text-xs text-destructive">
                    {aiError}
                  </div>
                )}

                {selectedIdea.imagePreview && (
                  <img
                    src={selectedIdea.imagePreview}
                    alt="attached"
                    className="max-h-48 rounded-xl shadow-card-rest object-contain"
                  />
                )}

                <pre className="whitespace-pre-wrap rounded-xl bg-background p-4 font-mono text-xs leading-relaxed text-foreground/90">
                  {selectedSpecText}
                </pre>
              </div>

              <Separator />

              <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5">
                {workspace.columns.length > 0 ? (
                  <div className="flex items-center gap-1.5">
                    <select
                      value={targetColId}
                      onChange={(e) => setTargetColId(e.target.value)}
                      className="h-8 rounded-lg bg-background px-2.5 text-xs text-foreground focus:outline-none"
                    >
                      {workspace.columns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="secondary"
                      onClick={() => handleSendToKanban(selectedIdea)}
                    >
                      <ArrowUpRight className="h-3.5 w-3.5" />
                      {t("river.sendToKanban")}
                    </Button>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {t("river.needColumnForIdea")}
                  </span>
                )}

                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    disabled={aiBreakingDown}
                    onClick={() => handleAiBreakdown(selectedIdea)}
                    title="调用 AI 自动拆解为 3~5 张看板卡片"
                  >
                    {aiBreakingDown ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Wand2 className="h-3.5 w-3.5 text-primary" />
                    )}
                    {aiBreakingDown ? "拆解中..." : "AI 拆解卡片"}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => handleExportMd(selectedIdea)}
                  >
                    <FileDown className="h-3.5 w-3.5" />
                    {t("river.exportMd")}
                  </Button>
                  <Button onClick={handleCopySpec}>
                    {copied ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        {t("river.copied")}
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        {t("river.copyForAi")}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Idea Recycle Bin Modal (shadcn/ui Dialog) */}
      <Dialog open={trashOpen} onOpenChange={setTrashOpen}>
        <DialogContent className="flex max-h-[80vh] max-w-lg flex-col p-0 select-text">
          <div className="flex items-center justify-between px-5 py-3.5">
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-muted-foreground" />
              {t("river.trashTitle")}
              <span className="text-xs font-normal text-muted-foreground">
                ({workspace.trashedIdeas.length})
              </span>
            </DialogTitle>

            {workspace.trashedIdeas.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleEmptyTrash}
                className="mr-6 text-destructive hover:text-destructive"
              >
                {t("river.emptyTrashBtn")}
              </Button>
            )}
          </div>

          <Separator />

          <div className="flex-1 space-y-2 overflow-y-auto p-4">
            {workspace.trashedIdeas.length === 0 ? (
              <div className="py-10 text-center text-xs text-muted-foreground">
                {t("river.trashEmptyDesc")}
              </div>
            ) : (
              workspace.trashedIdeas.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-3 rounded-xl bg-background p-3 shadow-card-rest"
                >
                  <div className="flex min-w-0 flex-1 gap-2.5">
                    {item.imagePreview && (
                      <img
                        src={item.imagePreview}
                        alt="trashed"
                        className="h-10 w-10 shrink-0 rounded-lg object-cover"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-xs text-foreground/85">
                        {item.content}
                      </p>
                      <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                        <span
                          className={`rounded px-1.5 py-0.5 ${
                            item.reason === "used"
                              ? "bg-emerald-500/12 text-emerald-500"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {item.reason === "used"
                            ? t("river.reasonUsed")
                            : t("river.reasonDeleted")}
                        </span>
                        <span>
                          {new Date(item.deletedAt).toLocaleString("zh-CN", {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleRestoreFromTrash(item)}
                      title={t("river.restore")}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handlePermanentDelete(item.id)}
                      className="hover:text-destructive"
                      title={t("river.permanentDelete")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
};
