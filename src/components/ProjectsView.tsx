import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  BarChart3,
  Check,
  ChevronDown,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  File,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Image as ImageIcon,
  Kanban,
  LayoutGrid,
  List,
  Loader2,
  MoreHorizontal,
  PanelRight,
  RefreshCw,
  Search,
  Settings,
  Star,
  X,
} from "lucide-react";
import {
  COLUMN_COLORS,
  EFFORT_MINUTES,
  ProjectArchiveDir,
  TaskItem,
  WorkspaceData,
} from "../types";
import { revealPathInOs, uid } from "../lib/storage";
import {
  ExplorerEntry,
  getMemoryArchiveCache,
  IndexedArchiveItem,
  isPreviewableImageExt,
  isPreviewableTextExt,
  listProjectExplorerEntries,
  loadArchiveThumbnail,
  loadCachedProjectArchive,
  openArchivePath,
  readFileTextPreview,
  reapplyArchiveDateMode,
  scanProjectArchiveRoots,
  searchArchiveItems,
  triggerSeerPreview,
} from "../lib/archive";
import { Button } from "./ui/button";
import { ProjectThumbnail } from "./projects/ProjectThumbnail";
import {
  ProjectGridCard,
  ProjectTimelineCard,
  VirtualProjectList,
} from "./projects/ProjectCards";
import { formatFileSize, getFolderLabel } from "./projects/utils";

interface ProjectsViewProps {
  workspace: WorkspaceData;
  onUpdate: (next: WorkspaceData) => void;
  onOpenProjectSettings: () => void;
  onStatusChange?: (text: string | null) => void;
  onNotify: (msg: string) => void;
}

type SearchScope = "projects" | "all" | "files";
type ProjectViewMode = "grid" | "timeline" | "list" | "stats";

const VIEW_MODE_STORAGE_KEY = "shibaplan_projects_view_mode_v1";
const LEFT_WIDTH_STORAGE_KEY = "shibaplan_projects_left_w_v1";
const RIGHT_WIDTH_STORAGE_KEY = "shibaplan_projects_right_w_v1";
const EXPLORER_VIEW_STORAGE_KEY = "shibaplan_projects_explorer_view_v1";
const CARD_WIDTH_STORAGE_KEY = "shibaplan_projects_card_w_v1";

export const ProjectsView: React.FC<ProjectsViewProps> = ({
  workspace,
  onUpdate,
  onOpenProjectSettings,
  onStatusChange,
  onNotify,
}) => {
  const archiveDirs = useMemo(
    () => workspace.settings.projectArchiveDirs ?? [],
    [workspace.settings.projectArchiveDirs]
  );

  const enabledRootPaths = useMemo(
    () =>
      archiveDirs
        .filter((d) => d.enabled !== false && d.path.trim())
        .map((d) => d.path.trim()),
    [archiveDirs]
  );

  const initialMemCache = getMemoryArchiveCache(enabledRootPaths);
  const [allItems, setAllItems] = useState<IndexedArchiveItem[]>(
    () => initialMemCache?.items ?? []
  );
  const [indexing, setIndexing] = useState(false);
  const [cacheRestored, setCacheRestored] = useState(Boolean(initialMemCache));
  const [indexError, setIndexError] = useState<string | null>(null);
  const [lastIndexedAt, setLastIndexedAt] = useState<string | null>(() => {
    if (!initialMemCache) return null;
    const d = new Date(initialMemCache.updatedAtMs);
    return `${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes()
    ).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  });

  // Search & Filter states
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("projects");
  const [viewMode, setViewMode] = useState<ProjectViewMode>(() => {
    try {
      const saved = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
      if (
        saved === "grid" ||
        saved === "timeline" ||
        saved === "list" ||
        saved === "stats"
      ) {
        return saved;
      }
    } catch {
      // ignore
    }
    return "grid";
  });
  const [selectedRoot, setSelectedRoot] = useState<string>("all");

  const changeViewMode = (mode: ProjectViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // ignore
    }
  };
  const [selectedYear, setSelectedYear] = useState<
    number | "all" | "unknown" | "starred"
  >("all");
  const [selectedMonth, setSelectedMonth] = useState<number | "all">("all");
  const [expandedYear, setExpandedYear] = useState<number | null>(null);
  const [renderLimit, setRenderLimit] = useState(160);
  const [explorerMenu, setExplorerMenu] = useState<{
    entry: ExplorerEntry;
    x: number;
    y: number;
  } | null>(null);
  const [projectMenu, setProjectMenu] = useState<{
    item: IndexedArchiveItem;
    x: number;
    y: number;
  } | null>(null);

  const starredSet = useMemo(
    () => new Set(workspace.settings.starredProjects ?? []),
    [workspace.settings.starredProjects]
  );

  // Keep the latest workspace in a ref so callbacks below stay referentially
  // stable across workspace edits (lets memoized cards skip re-rendering).
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  const toggleStarProject = useCallback(
    (projectPath: string) => {
      const ws = workspaceRef.current;
      const current = ws.settings.starredProjects ?? [];
      const exists = current.includes(projectPath);
      const next = exists
        ? current.filter((p) => p !== projectPath)
        : [projectPath, ...current];
      onUpdate({
        ...ws,
        settings: {
          ...ws.settings,
          starredProjects: next,
        },
      });
    },
    [onUpdate]
  );

  const sendEntryToKanban = useCallback(
    (entry: ExplorerEntry) => {
      const ws = workspaceRef.current;
      let columns = ws.columns;
      let targetColId = columns[0]?.id;
      if (!targetColId) {
        targetColId = uid("col");
        columns = [
          {
            id: targetColId,
            title: "待办",
            color: COLUMN_COLORS[0],
          },
        ];
      }
      const newTask: TaskItem = {
        id: uid("task"),
        title: entry.name,
        notes: entry.path,
        columnId: targetColId,
        importance: 2,
        effort: "S",
        estimatedMinutes: EFFORT_MINUTES.S,
        actualMinutes: 0,
        status: "todo",
        folderPath: entry.is_dir ? entry.path : undefined,
        filePath: entry.is_dir ? undefined : entry.path,
        createdAt: new Date().toISOString(),
      };
      onUpdate({
        ...ws,
        columns,
        tasks: [newTask, ...ws.tasks],
      });
      onNotify(`已发送到看板：${entry.name}`);
    },
    [onUpdate, onNotify]
  );

  useEffect(() => {
    if (!explorerMenu && !projectMenu) return;
    const close = () => {
      setExplorerMenu(null);
      setProjectMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [explorerMenu, projectMenu]);

  const handleProjectContextMenu = useCallback(
    (e: React.MouseEvent, item: IndexedArchiveItem) => {
      e.preventDefault();
      e.stopPropagation();
      setExplorerMenu(null);
      setSelectedProject(item);
      setProjectMenu({
        item,
        x: Math.min(e.clientX, window.innerWidth - 208),
        y: Math.min(e.clientY, window.innerHeight - 220),
      });
    },
    []
  );

  // Right-side Embedded Project Explorer + Seer Spacebar Preview state
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [explorerViewMode, setExplorerViewMode] = useState<"list" | "icons">(
    () => {
      try {
        return localStorage.getItem(EXPLORER_VIEW_STORAGE_KEY) === "icons"
          ? "icons"
          : "list";
      } catch {
        return "list";
      }
    }
  );
  const [leftWidth, setLeftWidth] = useState<number>(() => {
    try {
      const n = Number(localStorage.getItem(LEFT_WIDTH_STORAGE_KEY));
      if (n >= 112 && n <= 260) return n;
    } catch {
      // ignore
    }
    return 140;
  });
  const [rightWidth, setRightWidth] = useState<number>(() => {
    try {
      const n = Number(localStorage.getItem(RIGHT_WIDTH_STORAGE_KEY));
      if (n >= 240 && n <= 600) return n;
    } catch {
      // ignore
    }
    return 320;
  });
  const [cardWidth, setCardWidth] = useState<number>(() => {
    try {
      const n = Number(localStorage.getItem(CARD_WIDTH_STORAGE_KEY));
      if (n >= 160 && n <= 320) return n;
    } catch {
      // ignore
    }
    return 220;
  });
  const middlePaneRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarWidth, setToolbarWidth] = useState<number>(800);
  const [openDropdown, setOpenDropdown] = useState<
    "scope" | "root" | "more" | null
  >(null);

  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === "number" && w > 0) setToolbarWidth(w);
    });
    ro.observe(el);
    setToolbarWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, [archiveDirs.length]);

  useEffect(() => {
    if (!openDropdown) return;
    const close = () => setOpenDropdown(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [openDropdown]);

  // Ctrl/Cmd + Mouse Wheel zoom for project card size
  useEffect(() => {
    const el = middlePaneRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? 16 : -16;
      setCardWidth((prev) => {
        const next = Math.max(160, Math.min(320, prev + delta));
        try {
          localStorage.setItem(CARD_WIDTH_STORAGE_KEY, String(next));
        } catch {
          // ignore
        }
        return next;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [archiveDirs.length]);
  const [resizingPane, setResizingPane] = useState<"left" | "right" | null>(
    null
  );

  const changeExplorerViewMode = (mode: "list" | "icons") => {
    setExplorerViewMode(mode);
    try {
      localStorage.setItem(EXPLORER_VIEW_STORAGE_KEY, mode);
    } catch {
      // ignore
    }
  };

  const startResizeLeft = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = leftWidth;
    setResizingPane("left");
    let latest = startW;

    const onMove = (ev: MouseEvent) => {
      latest = Math.max(112, Math.min(260, startW + (ev.clientX - startX)));
      setLeftWidth(latest);
    };
    const onUp = () => {
      setResizingPane(null);
      try {
        localStorage.setItem(LEFT_WIDTH_STORAGE_KEY, String(latest));
      } catch {
        // ignore
      }
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startResizeRight = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = rightWidth;
    setResizingPane("right");
    let latest = startW;

    const onMove = (ev: MouseEvent) => {
      latest = Math.max(240, Math.min(600, startW + (startX - ev.clientX)));
      setRightWidth(latest);
    };
    const onUp = () => {
      setResizingPane(null);
      try {
        localStorage.setItem(RIGHT_WIDTH_STORAGE_KEY, String(latest));
      } catch {
        // ignore
      }
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const [selectedProject, setSelectedProject] =
    useState<IndexedArchiveItem | null>(null);
  const [hoveredProject, setHoveredProject] =
    useState<IndexedArchiveItem | null>(null);
  const [hoveredExplorerEntry, setHoveredExplorerEntry] =
    useState<ExplorerEntry | null>(null);
  const [explorerPath, setExplorerPath] = useState<string>("");
  const [explorerEntries, setExplorerEntries] = useState<ExplorerEntry[]>([]);
  const [explorerLoading, setExplorerLoading] = useState(false);
  const [selectedExplorerPath, setSelectedExplorerPath] = useState<
    string | null
  >(null);
  const [selectionFocus, setSelectionFocus] = useState<"project" | "explorer">(
    "project"
  );
  const explorerCacheRef = useRef<Map<string, ExplorerEntry[]>>(new Map());
  const explorerReqIdRef = useRef(0);
  const hoverTimerRef = useRef<number | null>(null);
  const [quickLook, setQuickLook] = useState<{
    entry: ExplorerEntry;
    kind: "image" | "text" | "meta";
    imageUrl?: string | null;
    textContent?: string;
    loading: boolean;
  } | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const autoOpenedSettingsRef = useRef(false);

  const loadExplorerDir = useCallback(async (dirPath: string) => {
    const reqId = ++explorerReqIdRef.current;
    if (!dirPath) {
      setExplorerEntries([]);
      setExplorerLoading(false);
      return;
    }
    const cached = explorerCacheRef.current.get(dirPath);
    if (cached) {
      setExplorerEntries(cached);
      setSelectedExplorerPath(cached[0]?.path ?? null);
      setExplorerLoading(false);
      return;
    }
    setExplorerLoading(true);
    try {
      const entries = await listProjectExplorerEntries(dirPath);
      if (reqId !== explorerReqIdRef.current) return;
      explorerCacheRef.current.set(dirPath, entries);
      setExplorerEntries(entries);
      setSelectedExplorerPath(entries[0]?.path ?? null);
    } catch {
      if (reqId !== explorerReqIdRef.current) return;
      setExplorerEntries([]);
    } finally {
      if (reqId === explorerReqIdRef.current) {
        setExplorerLoading(false);
      }
    }
  }, []);

  const getProjectDir = useCallback((item: IndexedArchiveItem) => {
    return item.is_dir
      ? item.path
      : item.path.replace(/[\\/][^\\/]+$/, "");
  }, []);

  const selectProjectForExplorer = useCallback(
    (item: IndexedArchiveItem) => {
      if (hoverTimerRef.current) {
        window.clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      setHoveredProject(null);
      setSelectedProject(item);
      setSelectionFocus("project");
      const targetDir = getProjectDir(item);
      setExplorerPath(targetDir);
      if (!explorerOpen) setExplorerOpen(true);
      void loadExplorerDir(targetDir);
    },
    [explorerOpen, getProjectDir, loadExplorerDir]
  );

  const handleHoverProject = useCallback(
    (item: IndexedArchiveItem | null) => {
      if (hoverTimerRef.current) {
        window.clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      if (!item) {
        setHoveredProject(null);
        // Restore active selected project in right explorer
        if (selectedProject) {
          const activeDir = getProjectDir(selectedProject);
          setExplorerPath(activeDir);
          void loadExplorerDir(activeDir);
        } else {
          setExplorerPath("");
          setExplorerEntries([]);
        }
        return;
      }
      // Update status bar immediately; debounce disk read slightly while sweeping
      setHoveredProject(item);
      const targetDir = getProjectDir(item);
      if (explorerCacheRef.current.has(targetDir)) {
        setExplorerPath(targetDir);
        void loadExplorerDir(targetDir);
      } else {
        hoverTimerRef.current = window.setTimeout(() => {
          setExplorerPath(targetDir);
          void loadExplorerDir(targetDir);
        }, 120);
      }
    },
    [selectedProject, getProjectDir, loadExplorerDir]
  );

  const displayedProject = hoveredProject ?? selectedProject;

  const handleExplorerGoUp = useCallback(() => {
    if (!selectedProject || !explorerPath) return;
    const rootDir = selectedProject.is_dir
      ? selectedProject.path
      : selectedProject.path.replace(/[\\/][^\\/]+$/, "");
    if (explorerPath.toLowerCase() === rootDir.toLowerCase()) return;
    const parent = explorerPath.replace(/[\\/][^\\/]+$/, "");
    if (parent && parent.length >= rootDir.length) {
      setExplorerPath(parent);
      loadExplorerDir(parent);
    }
  }, [selectedProject, explorerPath, loadExplorerDir]);

  const handleTriggerPreview = useCallback(
    async (entry: ExplorerEntry) => {
      try {
        const mode = await triggerSeerPreview(entry.path);
        if (mode === "seer" || mode === "quicklook") {
          return;
        }
      } catch {
        // fallback to built-in preview
      }

      if (!entry.is_dir && isPreviewableImageExt(entry.ext)) {
        setQuickLook({ entry, kind: "image", loading: true });
        const url = await loadArchiveThumbnail(entry.path);
        setQuickLook({ entry, kind: "image", imageUrl: url, loading: false });
      } else if (!entry.is_dir && isPreviewableTextExt(entry.ext)) {
        setQuickLook({ entry, kind: "text", loading: true });
        try {
          const text = await readFileTextPreview(entry.path);
          setQuickLook({
            entry,
            kind: "text",
            textContent: text,
            loading: false,
          });
        } catch {
          setQuickLook({ entry, kind: "meta", loading: false });
        }
      } else {
        setQuickLook({ entry, kind: "meta", loading: false });
      }
    },
    []
  );

  // First-time open with no archive folders -> jump straight into Settings -> Project Directories tab
  useEffect(() => {
    if (archiveDirs.length === 0 && !autoOpenedSettingsRef.current) {
      autoOpenedSettingsRef.current = true;
      onOpenProjectSettings();
    }
  }, [archiveDirs.length, onOpenProjectSettings]);

  const formatTimeLabel = (ms: number) => {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes()
    ).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  };

  const runIndex = useCallback(
    async (silent = false, full = false) => {
      if (enabledRootPaths.length === 0) {
        setAllItems([]);
        setIndexError(null);
        setCacheRestored(false);
        return;
      }
      setIndexing(true);
      setIndexError(null);
      try {
        const { items: indexed, updatedAtMs } = await scanProjectArchiveRoots(
          enabledRootPaths,
          workspace.settings.customDataDir,
          { full }
        );
        setAllItems(indexed);
        setCacheRestored(false);
        setLastIndexedAt(formatTimeLabel(updatedAtMs));
        if (!silent) {
          const projCount = indexed.filter((i) => i.is_project).length;
          onNotify(`索引已更新并缓存：${projCount} 个项目，共 ${indexed.length} 条记录`);
        }
      } catch (err) {
        setIndexError(
          err instanceof Error ? err.message : "扫描项目目录失败"
        );
      } finally {
        setIndexing(false);
      }
    },
    [enabledRootPaths, workspace.settings.customDataDir, onNotify]
  );

  // Instant load from memory/disk cache, then background revalidate only if stale (>10m) or missing
  useEffect(() => {
    let cancelled = false;
    if (enabledRootPaths.length === 0) {
      setAllItems([]);
      setCacheRestored(false);
      return;
    }

    const hydrate = async () => {
      const cached = await loadCachedProjectArchive(
        enabledRootPaths,
        workspace.settings.customDataDir
      );
      if (cancelled) return;

      if (cached && cached.items.length > 0) {
        setAllItems(cached.items);
        setCacheRestored(true);
        setLastIndexedAt(formatTimeLabel(cached.updatedAtMs));
        const ageMs = Date.now() - cached.updatedAtMs;
        // Silently refresh in background if cache is older than 10 minutes
        if (ageMs > 10 * 60 * 1000) {
          runIndex(true);
        }
      } else {
        runIndex(true);
      }
    };

    hydrate();
    return () => {
      cancelled = true;
    };
  }, [enabledRootPaths, workspace.settings.customDataDir, runIndex]);

  // Quick focus search with `/` or `Ctrl+F`
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      const inInput =
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.isContentEditable);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (!inInput && e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === "Escape") {
        if (quickLook) {
          setQuickLook(null);
        } else if (active === searchInputRef.current) {
          if (query) {
            setQuery("");
          } else {
            searchInputRef.current?.blur();
          }
        }
      } else if (!inInput && e.code === "Space") {
        if (quickLook) {
          e.preventDefault();
          setQuickLook(null);
          return;
        }
        const activeEntry = explorerEntries.find(
          (ent) => ent.path === selectedExplorerPath
        );
        if (activeEntry) {
          e.preventDefault();
          handleTriggerPreview(activeEntry);
        }
      } else if (
        !inInput &&
        explorerOpen &&
        explorerEntries.length > 0 &&
        (e.key === "ArrowDown" || e.key === "ArrowUp")
      ) {
        e.preventDefault();
        const curIdx = explorerEntries.findIndex(
          (ent) => ent.path === selectedExplorerPath
        );
        const nextIdx =
          e.key === "ArrowDown"
            ? Math.min(explorerEntries.length - 1, curIdx + 1)
            : Math.max(0, curIdx <= 0 ? 0 : curIdx - 1);
        setSelectedExplorerPath(explorerEntries[nextIdx].path);
        setSelectionFocus("explorer");
      } else if (!inInput && explorerOpen && e.key === "Enter" && selectedExplorerPath) {
        const activeEntry = explorerEntries.find(
          (ent) => ent.path === selectedExplorerPath
        );
        if (activeEntry) {
          e.preventDefault();
          if (activeEntry.is_dir) {
            setExplorerPath(activeEntry.path);
            loadExplorerDir(activeEntry.path);
          } else {
            openArchivePath(activeEntry.path);
          }
        }
      } else if (!inInput && explorerOpen && e.key === "Backspace") {
        handleExplorerGoUp();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    query,
    quickLook,
    explorerOpen,
    explorerEntries,
    selectedExplorerPath,
    handleTriggerPreview,
    loadExplorerDir,
    handleExplorerGoUp,
  ]);

  // Reset pagination when filters change
  useEffect(() => {
    setRenderLimit(160);
  }, [query, scope, selectedRoot, selectedYear, selectedMonth]);

  // Root map for display labels
  const rootLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of archiveDirs) {
      map.set(d.path.trim(), getFolderLabel(d));
    }
    return map;
  }, [archiveDirs]);

  const dateMode = workspace.settings.projectDateMode ?? "name_first";
  const effectiveItems = useMemo(
    () => reapplyArchiveDateMode(allItems, dateMode),
    [allItems, dateMode]
  );

  // Project-only list for Year/Month timeline counts
  const projectsByRoot = useMemo(() => {
    return effectiveItems.filter(
      (item) =>
        item.is_project &&
        (selectedRoot === "all" || item.root_path === selectedRoot)
    );
  }, [effectiveItems, selectedRoot]);

  const timelineStats = useMemo(() => {
    const yearMap = new Map<number, Map<number, number>>();
    const yearTotals = new Map<number, number>();
    let unknownCount = 0;

    for (const item of projectsByRoot) {
      if (item.year === null) {
        unknownCount++;
        continue;
      }
      yearTotals.set(item.year, (yearTotals.get(item.year) ?? 0) + 1);
      if (!yearMap.has(item.year)) {
        yearMap.set(item.year, new Map());
      }
      if (item.month !== null) {
        const mMap = yearMap.get(item.year)!;
        mMap.set(item.month, (mMap.get(item.month) ?? 0) + 1);
      }
    }

    const years = Array.from(yearMap.entries())
      .map(([year, mMap]) => {
        const total = yearTotals.get(year) ?? 0;
        const months = Array.from(mMap.entries()).sort((a, b) => b[0] - a[0]);
        return { year, total, months };
      })
      .sort((a, b) => b.year - a.year);

    return { years, unknownCount, totalProjects: projectsByRoot.length };
  }, [projectsByRoot]);

  // In Timeline view, always lock to a single year (current calendar year if available, otherwise latest year)
  useEffect(() => {
    if (viewMode !== "timeline") return;
    if (typeof selectedYear === "number") return;
    if (timelineStats.years.length === 0) return;
    const thisYear = new Date().getFullYear();
    const targetYear = timelineStats.years.some((y) => y.year === thisYear)
      ? thisYear
      : timelineStats.years[0].year;
    setSelectedYear(targetYear);
    setSelectedMonth("all");
    setExpandedYear(targetYear);
  }, [viewMode, selectedYear, timelineStats.years]);

  // Effective scope: if user uses ext: or file: syntax, auto-search all items
  const effectiveScope: SearchScope = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.includes("ext:") || q.includes("file:")) return "all";
    return scope;
  }, [query, scope]);

  // Filtered base pool before Everything search
  const filteredPool = useMemo(() => {
    return effectiveItems.filter((item) => {
      if (effectiveScope === "projects" && !item.is_project) return false;
      if (effectiveScope === "files" && item.is_dir) return false;
      if (selectedRoot !== "all" && item.root_path !== selectedRoot) return false;
      if (selectedYear === "starred" && !starredSet.has(item.path)) return false;
      if (selectedYear === "unknown" && item.year !== null) return false;
      if (typeof selectedYear === "number" && item.year !== selectedYear)
        return false;
      if (typeof selectedMonth === "number" && item.month !== selectedMonth)
        return false;
      return true;
    });
  }, [
    effectiveItems,
    effectiveScope,
    selectedRoot,
    selectedYear,
    selectedMonth,
    starredSet,
  ]);

  // Everything-style search
  const { items: matchedItems, highlightTerms } = useMemo(
    () => searchArchiveItems(filteredPool, query),
    [filteredPool, query]
  );

  // Statistics data (computed from current root + year + month filter)
  const statsData = useMemo(() => {
    const scoped = effectiveItems.filter((item) => {
      if (selectedRoot !== "all" && item.root_path !== selectedRoot) return false;
      if (selectedYear === "unknown" && item.year !== null) return false;
      if (typeof selectedYear === "number" && item.year !== selectedYear)
        return false;
      if (typeof selectedMonth === "number" && item.month !== selectedMonth)
        return false;
      return true;
    });

    const projects = scoped.filter((i) => i.is_project);
    const files = scoped.filter((i) => !i.is_dir);
    let totalSize = 0;

    const extMap = new Map<string, { count: number; size: number }>();
    const catDefs: {
      id: string;
      label: string;
      color: string;
      exts: Set<string>;
      count: number;
      size: number;
    }[] = [
      {
        id: "design",
        label: "设计源文件",
        color: "#a78bfa",
        exts: new Set([
          "psd",
          "psb",
          "ai",
          "cdr",
          "indd",
          "fig",
          "sketch",
          "xd",
          "eps",
          "afdesign",
          "afphoto",
        ]),
        count: 0,
        size: 0,
      },
      {
        id: "office",
        label: "PPT / 文档",
        color: "#38bdf8",
        exts: new Set([
          "ppt",
          "pptx",
          "ppam",
          "key",
          "pdf",
          "doc",
          "docx",
          "xls",
          "xlsx",
          "csv",
          "md",
          "txt",
        ]),
        count: 0,
        size: 0,
      },
      {
        id: "image",
        label: "图片素材",
        color: "#34d399",
        exts: new Set([
          "png",
          "jpg",
          "jpeg",
          "webp",
          "gif",
          "bmp",
          "svg",
          "tif",
          "tiff",
          "avif",
          "ico",
        ]),
        count: 0,
        size: 0,
      },
      {
        id: "cad3d",
        label: "3D / CAD",
        color: "#f59e0b",
        exts: new Set([
          "stl",
          "step",
          "stp",
          "dwg",
          "dxf",
          "c4d",
          "blend",
          "obj",
          "fbx",
          "3dm",
          "skp",
          "iges",
          "igs",
          "sldprt",
          "sldasm",
        ]),
        count: 0,
        size: 0,
      },
      {
        id: "media",
        label: "音视频",
        color: "#fb7185",
        exts: new Set([
          "mp4",
          "mov",
          "avi",
          "mkv",
          "wmv",
          "mp3",
          "wav",
          "flac",
          "prproj",
          "aep",
        ]),
        count: 0,
        size: 0,
      },
      {
        id: "other",
        label: "代码 / 压缩 / 其他",
        color: "#94a3b8",
        exts: new Set(),
        count: 0,
        size: 0,
      },
    ];

    for (const f of files) {
      totalSize += f.size;
      const ext = f.ext || "无后缀";
      const cur = extMap.get(ext) ?? { count: 0, size: 0 };
      cur.count += 1;
      cur.size += f.size;
      extMap.set(ext, cur);

      let matched = false;
      for (const cat of catDefs) {
        if (cat.id !== "other" && cat.exts.has(ext)) {
          cat.count += 1;
          cat.size += f.size;
          matched = true;
          break;
        }
      }
      if (!matched) {
        const other = catDefs[catDefs.length - 1];
        other.count += 1;
        other.size += f.size;
      }
    }

    const topExts = Array.from(extMap.entries())
      .map(([ext, info]) => ({ ext, count: info.count, size: info.size }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    // Trend bars: by month when a specific year is selected, else by year
    const trendBars: {
      key: string;
      label: string;
      count: number;
      year?: number;
      month?: number;
    }[] = [];

    if (typeof selectedYear === "number") {
      const mCounts = new Map<number, number>();
      for (const p of projects) {
        if (p.month) mCounts.set(p.month, (mCounts.get(p.month) ?? 0) + 1);
      }
      for (let mo = 1; mo <= 12; mo++) {
        trendBars.push({
          key: `${selectedYear}-${mo}`,
          label: `${mo}月`,
          count: mCounts.get(mo) ?? 0,
          year: selectedYear,
          month: mo,
        });
      }
    } else {
      const yCounts = new Map<number, number>();
      for (const p of projects) {
        if (p.year) yCounts.set(p.year, (yCounts.get(p.year) ?? 0) + 1);
      }
      const sortedYears = Array.from(yCounts.entries()).sort(
        (a, b) => a[0] - b[0]
      );
      for (const [y, cnt] of sortedYears) {
        trendBars.push({
          key: String(y),
          label: String(y),
          count: cnt,
          year: y,
        });
      }
    }

    const maxTrendCount = Math.max(1, ...trendBars.map((b) => b.count));
    const maxExtCount = Math.max(1, ...topExts.map((e) => e.count));

    // Peak month overall
    const ymCounts = new Map<string, number>();
    for (const p of projects) {
      if (p.year && p.month) {
        const k = `${p.year}年${p.month}月`;
        ymCounts.set(k, (ymCounts.get(k) ?? 0) + 1);
      }
    }
    let peakLabel = "-";
    let peakCount = 0;
    for (const [k, v] of ymCounts.entries()) {
      if (v > peakCount) {
        peakCount = v;
        peakLabel = k;
      }
    }

    return {
      projectCount: projects.length,
      fileCount: files.length,
      totalSize,
      categories: catDefs.filter((c) => c.count > 0),
      topExts,
      maxExtCount,
      trendBars,
      maxTrendCount,
      peakLabel,
      peakCount,
    };
  }, [effectiveItems, selectedRoot, selectedYear, selectedMonth]);

  // Group browse items by Year -> Month sections so Year + Month merge cleanly
  // instead of repeating "2026年 11月", "2026年 10月" on every row.
  const groupedByYear = useMemo(() => {
    if (query.trim()) return [];
    const visible = matchedItems.slice(0, renderLimit);

    type MonthBucket = {
      month: number | null;
      monthLabel: string;
      items: IndexedArchiveItem[];
    };
    type YearSection = {
      yearKey: string;
      year: number | null;
      yearLabel: string;
      totalCount: number;
      months: MonthBucket[];
    };

    const yearMap = new Map<string, YearSection>();

    for (const item of visible) {
      const yearKey = item.year !== null ? String(item.year) : "unknown";
      let ySec = yearMap.get(yearKey);
      if (!ySec) {
        ySec = {
          yearKey,
          year: item.year,
          yearLabel: item.year !== null ? String(item.year) : "未归类",
          totalCount: 0,
          months: [],
        };
        yearMap.set(yearKey, ySec);
      }
      ySec.totalCount += 1;

      const mVal = item.month;
      let mBucket = ySec.months.find((b) => b.month === mVal);
      if (!mBucket) {
        mBucket = {
          month: mVal,
          monthLabel:
            mVal !== null
              ? `${String(mVal).padStart(2, "0")}月`
              : item.year !== null
                ? "全年"
                : "其他",
          items: [],
        };
        ySec.months.push(mBucket);
      }
      mBucket.items.push(item);
    }

    return Array.from(yearMap.values());
  }, [matchedItems, query, renderLimit]);

  const isSearching = query.trim().length > 0;

  const gridTemplateStyle = useMemo<React.CSSProperties>(
    () => ({
      gridTemplateColumns: `repeat(auto-fill, minmax(${cardWidth}px, ${Math.min(
        cardWidth + 36,
        340
      )}px))`,
    }),
    [cardWidth]
  );

  // Sync dynamic selection & filter context to the unified bottom status bar
  useEffect(() => {
    if (!onStatusChange) return;
    if (archiveDirs.length === 0) {
      onStatusChange("未配置项目目录");
      return;
    }

    if (hoveredExplorerEntry) {
      onStatusChange(hoveredExplorerEntry.path);
      return;
    }

    if (hoveredProject) {
      onStatusChange(hoveredProject.path);
      return;
    }

    if (selectionFocus === "explorer" && selectedExplorerPath) {
      const ent = explorerEntries.find((e) => e.path === selectedExplorerPath);
      if (ent) {
        onStatusChange(ent.path);
        return;
      }
    }

    if (selectedProject) {
      onStatusChange(selectedProject.path);
      return;
    }

    if (isSearching) {
      onStatusChange(`搜索 "${query.trim()}" · ${matchedItems.length} 条匹配`);
      return;
    }

    const scopePrefix =
      typeof selectedYear === "number"
        ? typeof selectedMonth === "number"
          ? `${selectedYear}年${selectedMonth}月`
          : `${selectedYear}年`
        : selectedYear === "unknown"
          ? "未归类"
          : "全部项目";
    onStatusChange(
      `${scopePrefix} · ${statsData.projectCount} 个项目 · ${statsData.fileCount} 个文件`
    );
  }, [
    onStatusChange,
    archiveDirs.length,
    hoveredExplorerEntry,
    hoveredProject,
    selectionFocus,
    selectedExplorerPath,
    explorerEntries,
    selectedProject,
    isSearching,
    query,
    matchedItems.length,
    selectedYear,
    selectedMonth,
    statsData.projectCount,
    statsData.fileCount,
  ]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Body: Empty State OR Sidebar + Middle Column (with Toolbar) + Right Explorer */}
      {archiveDirs.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-card-rest space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <HardDrive className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-foreground">
                  尚未配置项目归档目录
                </h3>
                <p className="text-xs text-muted-foreground">
                  在“设置 → 项目目录”中添加一个或多个文件夹，即可自动索引与秒搜
                </p>
              </div>
            </div>

            <Button
              type="button"
              onClick={onOpenProjectSettings}
              className="w-full"
            >
              <Settings className="h-3.5 w-3.5" />
              前往设置添加项目文件夹
            </Button>

            <div className="rounded-xl bg-muted/50 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              自动兼容 <span className="font-mono text-foreground">#2025/10月</span>、
              <span className="font-mono text-foreground">2025-10-10_名称</span>、
              <span className="font-mono text-foreground">25-02-19</span>、
              <span className="font-mono text-foreground">20210913</span>、
              <span className="font-mono text-foreground">0103</span> 等多种日期命名格式。
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Left Sidebar: Minimal Right-Aligned Year & Month Timeline */}
          <aside
            style={{ width: leftWidth }}
            className="hidden sm:flex shrink-0 flex-col overflow-hidden select-none"
          >
            {/* Primary Filters: 全部 & 收藏 (h-10 aligned with middle search toolbar) */}
            <div className="flex h-10 shrink-0 items-center justify-end gap-1 border-b border-border/70 px-2.5">
              <button
                type="button"
                onClick={() => {
                  setSelectedYear("all");
                  setSelectedMonth("all");
                  setExpandedYear(null);
                }}
                className={`h-7 rounded-md px-2 text-xs transition-colors ${
                  selectedYear === "all"
                    ? "bg-accent text-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                }`}
              >
                全部
              </button>

              {projectsByRoot.some((p) => starredSet.has(p.path)) && (
                <button
                  type="button"
                  onClick={() => {
                    const next =
                      selectedYear === "starred" ? "all" : "starred";
                    setSelectedYear(next);
                    setSelectedMonth("all");
                    setExpandedYear(null);
                  }}
                  className={`inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs transition-colors ${
                    selectedYear === "starred"
                      ? "bg-accent text-primary font-medium"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  }`}
                  title="只看收藏项目"
                >
                  <Star className="h-3 w-3 fill-current" />
                </button>
              )}
            </div>

            {/* Unified Right-Aligned Vertical Timeline */}
            <div className="no-scrollbar flex-1 overflow-y-auto px-2.5 py-2">
            <div className="relative flex flex-col">
              {/* Continuous Vertical Axis Hairline */}
              <div className="pointer-events-none absolute right-[6.5px] top-3 bottom-3 w-px bg-border/80" />

              {timelineStats.years.map(({ year, total, months }) => {
                const yearActive = selectedYear === year;
                const isExpanded = expandedYear === year;

                return (
                  <div key={year} className="flex flex-col">
                    {/* Year Node */}
                    <button
                      type="button"
                      onClick={() => {
                        if (yearActive && selectedMonth === "all") {
                          setExpandedYear((cur) => (cur === year ? null : year));
                          if (isExpanded) setSelectedYear("all");
                        } else {
                          setSelectedYear(year);
                          setSelectedMonth("all");
                          setExpandedYear(year);
                        }
                      }}
                      title={`${year}年 (${total} 个项目)`}
                      className="group relative flex w-full items-center justify-end gap-2 py-2 text-right transition-colors"
                    >
                      <span
                        className={`font-mono text-[17px] leading-none tracking-tight tabular-nums transition-colors ${
                          yearActive
                            ? "font-semibold text-foreground"
                            : "font-medium text-muted-foreground/65 group-hover:text-foreground/85"
                        }`}
                      >
                        {year}
                      </span>
                      <span
                        className={`relative z-10 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-background transition-colors ${
                          yearActive
                            ? "text-foreground"
                            : "text-muted-foreground/55 group-hover:text-foreground/85"
                        }`}
                      >
                        <ChevronDown
                          className={`h-3 w-3 transition-transform duration-150 ${
                            isExpanded ? "rotate-0" : "-rotate-90"
                          }`}
                        />
                      </span>
                    </button>

                    {/* Expanded Month Nodes along the exact same right-aligned axis */}
                    {isExpanded && months.length > 0 && (
                      <div className="mb-1 flex flex-col">
                        {months.map(([mo, cnt]) => {
                          const mActive = yearActive && selectedMonth === mo;
                          return (
                            <button
                              key={mo}
                              type="button"
                              onClick={() => {
                                setSelectedYear(year);
                                setSelectedMonth(mActive ? "all" : mo);
                              }}
                              title={`${year}年${mo}月 (${cnt} 个项目)`}
                              className="group relative flex w-full items-center justify-end gap-2 py-1 pr-[4px] text-right transition-colors"
                            >
                              <span
                                className={`font-mono text-[13px] leading-none tabular-nums transition-colors ${
                                  mActive
                                    ? "font-semibold text-foreground"
                                    : "text-muted-foreground/60 group-hover:text-foreground/85"
                                }`}
                              >
                                {mo}月
                              </span>
                              <span
                                className={`relative z-10 h-1.5 w-1.5 shrink-0 rounded-full ring-2 ring-background transition-colors ${
                                  mActive
                                    ? "bg-foreground"
                                    : "bg-border group-hover:bg-muted-foreground"
                                }`}
                              />
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Unknown Year Node */}
              {timelineStats.unknownCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedYear(
                      selectedYear === "unknown" ? "all" : "unknown"
                    );
                    setSelectedMonth("all");
                    setExpandedYear(null);
                  }}
                  title={`未归类 (${timelineStats.unknownCount} 个项目)`}
                  className="group relative flex w-full items-center justify-end gap-2 py-1.5 pr-[3px] text-right transition-colors"
                >
                  <span
                    className={`text-xs leading-none transition-colors ${
                      selectedYear === "unknown"
                        ? "font-semibold text-foreground"
                        : "text-muted-foreground/65 group-hover:text-foreground/85"
                    }`}
                  >
                    未归类
                  </span>
                  <span
                    className={`relative z-10 h-2 w-2 shrink-0 rounded-full ring-2 ring-background transition-colors ${
                      selectedYear === "unknown"
                        ? "bg-foreground"
                        : "bg-muted-foreground/40 group-hover:bg-foreground/70"
                    }`}
                  />
                </button>
              )}
            </div>
            </div>
          </aside>

          {/* Subtle Left-Middle Resize Handle (hairline, blends left & center as one canvas) */}
          <div
            onMouseDown={startResizeLeft}
            title="拖动调整左侧年份轴宽度"
            className={`hidden sm:block w-px shrink-0 cursor-col-resize transition-colors ${
              resizingPane === "left"
                ? "bg-primary"
                : "bg-border/35 hover:bg-primary/50"
            }`}
          />

          {/* Middle Column: Toolbar + Project Grid / List */}
          <div className="flex flex-1 min-w-0 flex-col overflow-hidden">
            {/* Middle Column Top Toolbar (Responsive: grouped columns + auto-collapse to dropdowns when narrow) */}
            {(() => {
              const enabledDirs = archiveDirs.filter(
                (d) => d.enabled !== false
              );
              const compactRoots = toolbarWidth < 740;
              const compactScope = toolbarWidth < 560;
              const compactActions = toolbarWidth < 460;
              const scopeOptions = [
                { id: "projects" as const, label: "项目" },
                { id: "all" as const, label: "全部" },
                { id: "files" as const, label: "文件" },
              ];
              const activeScopeLabel =
                scopeOptions.find((s) => s.id === effectiveScope)?.label ??
                "项目";
              const activeRootLabel =
                selectedRoot === "all"
                  ? "全部目录"
                  : rootLabelMap.get(selectedRoot) ?? "目录";

              return (
                <div
                  ref={toolbarRef}
                  className="relative flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border/70 bg-background px-3 sm:px-5"
                >
                  {/* Left Columns: Search | Scope | Directories */}
                  <div className="flex items-center gap-2 min-w-0">
                    {/* Compact Search Input */}
                    <div className="relative w-36 sm:w-40 shrink-0">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <input
                        ref={searchInputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="搜索..."
                        title="支持 Everything 语法：空格=与，|=或，!=排除，ext:psd，folder:，file:"
                        className="h-7 w-full rounded-md border border-border bg-surface/80 pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground/65 focus:border-ring/70 focus:bg-card focus:outline-none focus:ring-1 focus:ring-ring/40 transition-colors"
                      />
                      {query && (
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center">
                          <button
                            type="button"
                            onClick={() => setQuery("")}
                            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                            title="清空搜索"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="h-3.5 w-px shrink-0 bg-border" />

                    {/* Scope: Segmented Pills (wide) OR Dropdown (narrow) */}
                    {compactScope ? (
                      <div
                        className="relative shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setOpenDropdown((cur) =>
                              cur === "scope" ? null : "scope"
                            )
                          }
                          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2 text-xs text-foreground transition-colors hover:bg-accent"
                        >
                          <span>{activeScopeLabel}</span>
                          <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        </button>
                        {openDropdown === "scope" && (
                          <div className="absolute left-0 top-full z-40 mt-1 w-28 rounded-lg border border-border bg-popover p-1 shadow-popover-soft">
                            {scopeOptions.map((s) => (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => {
                                  setScope(s.id);
                                  setOpenDropdown(null);
                                }}
                                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-popover-foreground transition-colors hover:bg-accent"
                              >
                                <span>{s.label}</span>
                                {effectiveScope === s.id && (
                                  <Check className="h-3 w-3 text-primary" />
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex shrink-0 items-center rounded-md border border-border bg-surface p-0.5">
                        {scopeOptions.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => setScope(s.id)}
                            className={`h-6 rounded-[4px] px-2 text-xs transition-colors ${
                              effectiveScope === s.id
                                ? "bg-accent text-foreground font-medium"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Project Root Directories: Inline Pills (wide) OR Dropdown (narrow) */}
                    {enabledDirs.length > 1 && (
                      <>
                        <div className="h-3.5 w-px shrink-0 bg-border" />
                        {compactRoots ? (
                          <div
                            className="relative shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setOpenDropdown((cur) =>
                                  cur === "root" ? null : "root"
                                )
                              }
                              className="inline-flex h-7 max-w-[120px] items-center gap-1 rounded-md border border-border bg-surface px-2 text-xs text-foreground transition-colors hover:bg-accent"
                              title="切换项目目录"
                            >
                              <Folder className="h-3 w-3 shrink-0 text-muted-foreground" />
                              <span className="truncate">{activeRootLabel}</span>
                              <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                            </button>
                            {openDropdown === "root" && (
                              <div className="absolute left-0 top-full z-40 mt-1 w-44 rounded-lg border border-border bg-popover p-1 shadow-popover-soft">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedRoot("all");
                                    setSelectedYear("all");
                                    setSelectedMonth("all");
                                    setExpandedYear(null);
                                    setOpenDropdown(null);
                                  }}
                                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-popover-foreground transition-colors hover:bg-accent"
                                >
                                  <span>全部目录</span>
                                  {selectedRoot === "all" && (
                                    <Check className="h-3 w-3 text-primary" />
                                  )}
                                </button>
                                {enabledDirs.map((dir) => {
                                  const cleanPath = dir.path.trim();
                                  const active = selectedRoot === cleanPath;
                                  return (
                                    <button
                                      key={dir.id}
                                      type="button"
                                      onClick={() => {
                                        setSelectedRoot(cleanPath);
                                        setSelectedYear("all");
                                        setSelectedMonth("all");
                                        setExpandedYear(null);
                                        setOpenDropdown(null);
                                      }}
                                      title={dir.path}
                                      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs text-popover-foreground transition-colors hover:bg-accent"
                                    >
                                      <span className="flex min-w-0 items-center gap-1.5">
                                        <Folder className="h-3 w-3 shrink-0 text-muted-foreground" />
                                        <span className="truncate">
                                          {getFolderLabel(dir)}
                                        </span>
                                      </span>
                                      {active && (
                                        <Check className="h-3 w-3 shrink-0 text-primary" />
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex shrink-0 items-center rounded-md border border-border bg-surface p-0.5">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedRoot("all");
                                setSelectedYear("all");
                                setSelectedMonth("all");
                                setExpandedYear(null);
                              }}
                              className={`h-6 rounded-[4px] px-2 text-xs transition-colors ${
                                selectedRoot === "all"
                                  ? "bg-accent text-foreground font-medium"
                                  : "text-muted-foreground hover:text-foreground"
                              }`}
                              title="显示全部已启用的项目目录"
                            >
                              全部目录
                            </button>
                            {enabledDirs.map((dir) => {
                              const cleanPath = dir.path.trim();
                              const active = selectedRoot === cleanPath;
                              return (
                                <button
                                  key={dir.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedRoot(cleanPath);
                                    setSelectedYear("all");
                                    setSelectedMonth("all");
                                    setExpandedYear(null);
                                  }}
                                  title={dir.path}
                                  className={`inline-flex h-6 items-center gap-1 rounded-[4px] px-2 text-xs transition-colors max-w-[120px] ${
                                    active
                                      ? "bg-accent text-primary font-medium"
                                      : "text-muted-foreground hover:text-foreground"
                                  }`}
                                >
                                  <Folder className="h-3 w-3 shrink-0 opacity-75" />
                                  <span className="truncate">
                                    {getFolderLabel(dir)}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Right Columns: View Switcher (4 buttons) | Utility Actions (3 buttons or More dropdown) */}
                  <div className="flex shrink-0 items-center gap-2">
                    <div
                      className="flex items-center rounded-md border border-border bg-surface p-0.5"
                      title="切换项目视图"
                    >
                      {(
                        [
                          {
                            id: "grid",
                            label: "网格视图",
                            icon: <LayoutGrid className="h-3.5 w-3.5" />,
                          },
                          {
                            id: "timeline",
                            label: "时间轴视图",
                            icon: <Clock className="h-3.5 w-3.5" />,
                          },
                          {
                            id: "list",
                            label: "列表视图",
                            icon: <List className="h-3.5 w-3.5" />,
                          },
                          {
                            id: "stats",
                            label: "统计视图",
                            icon: <BarChart3 className="h-3.5 w-3.5" />,
                          },
                        ] as const
                      ).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => changeViewMode(m.id)}
                          title={m.label}
                          className={`inline-flex h-6 w-6 items-center justify-center rounded-[4px] transition-colors ${
                            viewMode === m.id
                              ? "bg-accent text-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {m.icon}
                        </button>
                      ))}
                    </div>

                    <div className="h-3.5 w-px bg-border" />

                    {compactActions ? (
                      <div
                        className="relative shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            setOpenDropdown((cur) =>
                              cur === "more" ? null : "more"
                            )
                          }
                          title="更多工具"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                        {openDropdown === "more" && (
                          <div className="absolute right-0 top-full z-40 mt-1 w-44 rounded-lg border border-border bg-popover p-1 shadow-popover-soft">
                            <button
                              type="button"
                              disabled={indexing || enabledRootPaths.length === 0}
                              onClick={(e) => {
                                setOpenDropdown(null);
                                runIndex(false, e.shiftKey);
                              }}
                              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-popover-foreground transition-colors hover:bg-accent disabled:opacity-40"
                            >
                              {indexing ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                              ) : (
                                <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                              )}
                              <span>刷新索引</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setOpenDropdown(null);
                                onOpenProjectSettings();
                              }}
                              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-popover-foreground transition-colors hover:bg-accent"
                            >
                              <FolderPlus className="h-3.5 w-3.5 text-muted-foreground" />
                              <span>项目目录设置 ({archiveDirs.length})</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setOpenDropdown(null);
                                setExplorerOpen((v) => !v);
                              }}
                              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-popover-foreground transition-colors hover:bg-accent"
                            >
                              <PanelRight className="h-3.5 w-3.5 text-muted-foreground" />
                              <span>
                                {explorerOpen
                                  ? "隐藏右侧资源管理器"
                                  : "显示右侧资源管理器"}
                              </span>
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={indexing || enabledRootPaths.length === 0}
                          onClick={(e) => runIndex(false, e.shiftKey)}
                          title={
                            lastIndexedAt
                              ? `刷新索引（上次更新 ${lastIndexedAt}）· Shift+单击 完全重建`
                              : "刷新索引 · Shift+单击 完全重建"
                          }
                        >
                          {indexing ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                        </Button>

                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={onOpenProjectSettings}
                          title={`项目目录设置 (${archiveDirs.length})`}
                        >
                          <FolderPlus className="h-3.5 w-3.5" />
                        </Button>

                        <Button
                          type="button"
                          variant={explorerOpen ? "secondary" : "ghost"}
                          size="icon"
                          onClick={() => setExplorerOpen((v) => !v)}
                          className="shrink-0"
                          title={
                            explorerOpen
                              ? "隐藏右侧资源管理器"
                              : "显示右侧资源管理器"
                          }
                        >
                          <PanelRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Main Project Grid / Everything Results List */}
            <div
              ref={middlePaneRef}
              className="flex-1 min-w-0 overflow-y-auto px-3 sm:px-5 py-3.5 space-y-4"
            >
            {indexError && (
              <div className="rounded-xl bg-destructive/12 px-3.5 py-2.5 text-xs text-destructive">
                {indexError}
              </div>
            )}

            {indexing && allItems.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-20 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                正在扫描并建立项目日期索引...
              </div>
            ) : matchedItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-20 text-xs text-muted-foreground">
                <Search className="h-6 w-6 opacity-35" />
                <span>没有匹配的项目或文件</span>
                {query && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setQuery("")}
                  >
                    清空搜索条件
                  </Button>
                )}
              </div>
            ) : viewMode === "stats" && !isSearching ? (
              /* VISUAL STATISTICS DASHBOARD */
              <div className="space-y-5 pb-6">
                {/* Top KPI Summary Cards */}
                <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5">
                  <div className="rounded-xl bg-card p-3.5 shadow-card-rest">
                    <div className="text-xs text-muted-foreground">项目总数</div>
                    <div className="mt-1 font-mono text-xl font-semibold text-foreground">
                      {statsData.projectCount}
                    </div>
                  </div>
                  <div className="rounded-xl bg-card p-3.5 shadow-card-rest">
                    <div className="text-xs text-muted-foreground">索引文件数</div>
                    <div className="mt-1 font-mono text-xl font-semibold text-foreground">
                      {statsData.fileCount}
                    </div>
                  </div>
                  <div className="rounded-xl bg-card p-3.5 shadow-card-rest">
                    <div className="text-xs text-muted-foreground">累计体积</div>
                    <div className="mt-1 font-mono text-xl font-semibold text-foreground">
                      {formatFileSize(statsData.totalSize) || "0 B"}
                    </div>
                  </div>
                  <div className="rounded-xl bg-card p-3.5 shadow-card-rest">
                    <div className="text-xs text-muted-foreground">最高产月份</div>
                    <div className="mt-1 truncate text-sm font-semibold text-primary">
                      {statsData.peakLabel}
                    </div>
                    {statsData.peakCount > 0 && (
                      <div className="font-mono text-xs text-muted-foreground">
                        {statsData.peakCount} 个项目
                      </div>
                    )}
                  </div>
                </div>

                {/* File Category Stacked Bar */}
                <div className="rounded-xl bg-card p-4 shadow-card-rest space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-foreground">
                      文件大类分布
                    </span>
                    <span className="text-xs text-muted-foreground">
                      共 {statsData.fileCount} 个文件
                    </span>
                  </div>

                  {statsData.fileCount === 0 ? (
                    <div className="py-4 text-center text-xs text-muted-foreground">
                      暂无文件数据
                    </div>
                  ) : (
                    <>
                      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted/60">
                        {statsData.categories.map((cat) => (
                          <div
                            key={cat.id}
                            style={{
                              width: `${(cat.count / statsData.fileCount) * 100}%`,
                              backgroundColor: cat.color,
                            }}
                            title={`${cat.label}: ${cat.count} 个 (${Math.round(
                              (cat.count / statsData.fileCount) * 100
                            )}%)`}
                            className="h-full transition-all"
                          />
                        ))}
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
                        {statsData.categories.map((cat) => {
                          const pct = Math.round(
                            (cat.count / statsData.fileCount) * 100
                          );
                          return (
                            <div
                              key={cat.id}
                              className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-2.5 py-2 text-xs"
                            >
                              <span className="flex items-center gap-1.5 truncate text-foreground">
                                <span
                                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                                  style={{ backgroundColor: cat.color }}
                                />
                                <span className="truncate">{cat.label}</span>
                              </span>
                              <span className="shrink-0 font-mono text-muted-foreground">
                                {cat.count} ({pct}%)
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>

                {/* Top File Extensions Horizontal Bar Chart (Clickable!) */}
                <div className="rounded-xl bg-card p-4 shadow-card-rest space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-foreground">
                      文件格式排行（PSD / PPT / PDF / AI 等）
                    </span>
                    <span className="text-xs text-muted-foreground">
                      点击任意格式直接检索文件
                    </span>
                  </div>

                  {statsData.topExts.length === 0 ? (
                    <div className="py-6 text-center text-xs text-muted-foreground">
                      暂无文件统计
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {statsData.topExts.map((item) => {
                        const pct = Math.max(
                          3,
                          Math.round((item.count / statsData.maxExtCount) * 100)
                        );
                        return (
                          <button
                            key={item.ext}
                            type="button"
                            onClick={() => {
                              if (item.ext !== "无后缀") {
                                setScope("files");
                                setQuery(`ext:${item.ext}`);
                              }
                            }}
                            className="group flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent"
                            title={`点击查看全部 .${item.ext} 文件`}
                          >
                            <span className="w-14 shrink-0 font-mono text-xs font-semibold uppercase text-foreground">
                              .{item.ext}
                            </span>
                            <div className="flex-1 h-2.5 overflow-hidden rounded-full bg-muted/60">
                              <div
                                style={{ width: `${pct}%` }}
                                className="h-full rounded-full bg-primary transition-all duration-300 group-hover:opacity-90"
                              />
                            </div>
                            <span className="w-16 shrink-0 text-right font-mono text-xs font-medium text-foreground">
                              {item.count} 个
                            </span>
                            <span className="hidden sm:inline-block w-20 shrink-0 text-right font-mono text-xs text-muted-foreground">
                              {formatFileSize(item.size)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Yearly / Monthly Project Trend Chart */}
                {statsData.trendBars.length > 0 && (
                  <div className="rounded-xl bg-card p-4 shadow-card-rest space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-foreground">
                        {typeof selectedYear === "number"
                          ? `${selectedYear}年 月度项目产出趋势`
                          : "历年项目产出趋势"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        点击柱状条筛选对应时间
                      </span>
                    </div>

                    <div className="flex h-44 items-end gap-2 pt-4">
                      {statsData.trendBars.map((bar) => {
                        const hPct =
                          bar.count === 0
                            ? 4
                            : Math.max(
                                12,
                                Math.round(
                                  (bar.count / statsData.maxTrendCount) * 100
                                )
                              );
                        return (
                          <button
                            key={bar.key}
                            type="button"
                            onClick={() => {
                              if (bar.year !== undefined) {
                                setSelectedYear(bar.year);
                                if (bar.month !== undefined) {
                                  setSelectedMonth(bar.month);
                                  changeViewMode("grid");
                                }
                              }
                            }}
                            className="group flex flex-1 flex-col items-center gap-1.5 h-full justify-end"
                            title={`${bar.label}: ${bar.count} 个项目`}
                          >
                            <span className="font-mono text-xs text-muted-foreground group-hover:text-primary">
                              {bar.count > 0 ? bar.count : ""}
                            </span>
                            <div
                              style={{ height: `${hPct}%` }}
                              className={`w-full max-w-[36px] rounded-t-md transition-all ${
                                bar.count > 0
                                  ? "bg-primary/80 group-hover:bg-primary"
                                  : "bg-muted/50"
                              }`}
                            />
                            <span className="font-mono text-xs text-muted-foreground truncate max-w-full">
                              {bar.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : isSearching ||
              effectiveScope !== "projects" ||
              viewMode === "list" ? (
              /* EVERYTHING-STYLE INSTANT DENSE LIST VIEW (virtualized) */
              <VirtualProjectList
                items={matchedItems}
                scrollElementRef={middlePaneRef}
                selectedPath={selectedProject?.path ?? null}
                isSearching={isSearching}
                highlightTerms={highlightTerms}
                onSelect={selectProjectForExplorer}
                onHover={handleHoverProject}
                onContextMenu={handleProjectContextMenu}
              />
            ) : viewMode === "timeline" ? (
              /* SINGLE-YEAR TIMELINE VIEW (shows only the current/selected year) */
              (() => {
                const thisYear = new Date().getFullYear();
                const targetYear =
                  typeof selectedYear === "number"
                    ? selectedYear
                    : groupedByYear.some((s) => s.year === thisYear)
                      ? thisYear
                      : groupedByYear[0]?.year ?? null;
                const singleYearSections =
                  targetYear !== null
                    ? groupedByYear.filter((s) => s.year === targetYear)
                    : groupedByYear.slice(0, 1);

                return (
              <div className="space-y-7 pb-6">
                {singleYearSections.map((ySec) => (
                  <section key={ySec.yearKey} className="space-y-3">
                    {/* Year Divider Header */}
                    <div className="flex items-center gap-3 px-0.5">
                      <span className="font-mono text-lg font-semibold tracking-tight text-foreground tabular-nums">
                        {ySec.yearLabel}
                      </span>
                      <div className="h-px flex-1 bg-border/45" />
                      <span className="font-mono text-xs text-muted-foreground/75 tabular-nums">
                        {ySec.totalCount} 个项目
                      </span>
                    </div>

                    {/* Month Rows aligned on a single clean left axis */}
                    <div className="space-y-3.5">
                      {ySec.months.map((mBucket) => (
                        <div
                          key={`${ySec.yearKey}-${mBucket.month ?? "none"}`}
                          className="flex items-start gap-3"
                        >
                          {/* Compact Right-Aligned Month Tag */}
                          <button
                            type="button"
                            onClick={() => {
                              if (ySec.year !== null && mBucket.month !== null) {
                                const isSame =
                                  selectedYear === ySec.year &&
                                  selectedMonth === mBucket.month;
                                setSelectedYear(ySec.year);
                                setSelectedMonth(isSame ? "all" : mBucket.month);
                              }
                            }}
                            title="点击筛选该月份"
                            className="group/m shrink-0 w-12 pt-2.5 text-right"
                          >
                            <div className="font-mono text-xs font-medium text-muted-foreground group-hover/m:text-primary transition-colors tabular-nums">
                              {mBucket.monthLabel}
                            </div>
                          </button>

                          {/* Month Cards Column with subtle vertical hairline */}
                          <div className="relative flex-1 min-w-0 space-y-2 border-l border-border/50 pl-3.5">
                            <span className="pointer-events-none absolute -left-[3.5px] top-4 h-1.5 w-1.5 rounded-full bg-primary/70" />
                            {mBucket.items.map((item) => (
                              <ProjectTimelineCard
                                key={item.path}
                                item={item}
                                isSelected={
                                  selectedProject?.path === item.path
                                }
                                rootTag={rootLabelMap.get(item.root_path)}
                                showRootTag={archiveDirs.length > 1}
                                onSelect={selectProjectForExplorer}
                                onHover={handleHoverProject}
                                onContextMenu={handleProjectContextMenu}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}

                {matchedItems.length > renderLimit && (
                  <div className="flex justify-center pt-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setRenderLimit((n) => n + 160)}
                    >
                      加载更多（剩余 {matchedItems.length - renderLimit} 个项目）
                    </Button>
                  </div>
                )}
              </div>
                );
              })()
            ) : (
              /* UNIFIED YEAR-GROUPED ADAPTIVE GRID CARDS VIEW */
              <div className="space-y-6 pb-4">
                {groupedByYear.map((ySec) => (
                  <section key={ySec.yearKey} className="space-y-2.5">
                    {/* Minimal Year Divider Header: Year on left, count on far right */}
                    <div className="flex items-center gap-3 px-0.5">
                      <span className="font-mono text-base font-semibold tracking-tight text-foreground tabular-nums">
                        {ySec.yearLabel}
                      </span>
                      <div className="h-px flex-1 bg-border/45" />
                      <span className="font-mono text-xs text-muted-foreground/75 tabular-nums">
                        {ySec.totalCount}
                      </span>
                    </div>

                    <div
                      style={gridTemplateStyle}
                      className="grid gap-2.5 items-stretch"
                    >
                      {ySec.months.flatMap((mBucket) =>
                        mBucket.items.map((item) => (
                          <ProjectGridCard
                            key={item.path}
                            item={item}
                            isSelected={selectedProject?.path === item.path}
                            isStarred={starredSet.has(item.path)}
                            rootTag={rootLabelMap.get(item.root_path)}
                            showRootTag={archiveDirs.length > 1}
                            cardWidth={cardWidth}
                            onSelect={selectProjectForExplorer}
                            onHover={handleHoverProject}
                            onToggleStar={toggleStarProject}
                            onContextMenu={handleProjectContextMenu}
                          />
                        ))
                      )}
                    </div>
                  </section>
                ))}

                {matchedItems.length > renderLimit && (
                  <div className="flex justify-center pt-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setRenderLimit((n) => n + 160)}
                    >
                      加载更多（剩余 {matchedItems.length - renderLimit} 个项目）
                    </Button>
                  </div>
                )}
              </div>
            )}
            </div>
          </div>

          {/* Right Column: Embedded Project File Explorer + Seer Spacebar Preview */}
          {explorerOpen && (
            <>
              {/* Middle-Right Resize Handle */}
              <div
                onMouseDown={startResizeRight}
                title="拖动调整右侧资源管理器宽度"
                className={`hidden lg:block w-1 shrink-0 cursor-col-resize transition-colors ${
                  resizingPane === "right"
                    ? "bg-primary/60"
                    : "bg-border/40 hover:bg-primary/40"
                }`}
              />
              <aside
                style={{ width: rightWidth }}
                className="hidden lg:flex shrink-0 flex-col bg-surface/40 overflow-hidden"
              >
                {/* Explorer Top Toolbar (h-10 aligned with middle column toolbar) */}
                <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border/70 px-3">
                  {/* List / Icons View Switcher */}
                  <div className="flex items-center rounded-md border border-border bg-surface p-0.5">
                    <button
                      type="button"
                      onClick={() => changeExplorerViewMode("list")}
                      title="列表视图"
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-[4px] transition-colors ${
                        explorerViewMode === "list"
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <List className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => changeExplorerViewMode("icons")}
                      title="图标视图"
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-[4px] transition-colors ${
                        explorerViewMode === "icons"
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <LayoutGrid className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {displayedProject && (
                    <div className="flex items-center gap-0.5">
                      {selectedProject &&
                        !hoveredProject &&
                        explorerPath.toLowerCase() !==
                          (selectedProject.is_dir
                            ? selectedProject.path
                            : selectedProject.path.replace(/[\\/][^\\/]+$/, "")
                          ).toLowerCase() && (
                          <button
                            type="button"
                            onClick={handleExplorerGoUp}
                            className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                            title="返回上级目录 (Backspace)"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                        )}
                      <button
                        type="button"
                        onClick={() => {
                          explorerCacheRef.current.delete(explorerPath);
                          void loadExplorerDir(explorerPath);
                        }}
                        className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                        title="刷新目录"
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${
                            explorerLoading ? "animate-spin" : ""
                          }`}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => openArchivePath(explorerPath)}
                        className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                        title="在系统资源管理器中打开"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Project Title Row (full-width dedicated row below toolbar) */}
                <div
                  className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3 py-1.5"
                  title={
                    displayedProject
                      ? explorerPath || displayedProject.path
                      : "点击或悬停左侧项目查看内部文件"
                  }
                >
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium tracking-[-0.01em] text-foreground">
                    {displayedProject
                      ? displayedProject.displayTitle
                      : "项目资源管理器"}
                  </span>
                  {hoveredProject &&
                    hoveredProject.path !== selectedProject?.path && (
                      <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-normal text-primary">
                        预览
                      </span>
                    )}
                </div>

                {/* Explorer Entries (List or Icons Grid) */}
                <div className="flex-1 overflow-y-auto p-2">
                  {!displayedProject ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-xs text-muted-foreground">
                      <FolderOpen className="h-6 w-6 opacity-35" />
                      <span>悬停或点击中间任意项目即可在此浏览文件条目</span>
                      <span>选中文件后按空格键支持 Seer 预览</span>
                    </div>
                  ) : explorerLoading ? (
                    <div className="flex h-32 items-center justify-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                      正在读取文件...
                    </div>
                  ) : explorerEntries.length === 0 ? (
                    <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
                      此文件夹为空
                    </div>
                  ) : explorerViewMode === "icons" ? (
                    <div
                      style={{
                        gridTemplateColumns:
                          "repeat(auto-fill, minmax(96px, 1fr))",
                      }}
                      className="grid gap-2"
                    >
                      {explorerEntries.map((entry) => {
                        const active = selectedExplorerPath === entry.path;
                        const isImg =
                          !entry.is_dir && isPreviewableImageExt(entry.ext);
                        return (
                          <div
                            key={entry.path}
                            onMouseEnter={() => setHoveredExplorerEntry(entry)}
                            onMouseLeave={() => setHoveredExplorerEntry(null)}
                            onClick={() => {
                              setSelectedExplorerPath(entry.path);
                              setSelectionFocus("explorer");
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setSelectedExplorerPath(entry.path);
                              setSelectionFocus("explorer");
                              setExplorerMenu({
                                entry,
                                x: Math.min(e.clientX, window.innerWidth - 210),
                                y: Math.min(e.clientY, window.innerHeight - 190),
                              });
                            }}
                            onDoubleClick={() => {
                              if (entry.is_dir) {
                                setExplorerPath(entry.path);
                                loadExplorerDir(entry.path);
                              } else {
                                openArchivePath(entry.path);
                              }
                            }}
                            title={entry.name}
                            className={`group relative flex flex-col items-center gap-1.5 rounded-xl p-2 text-center transition-all cursor-pointer ${
                              active
                                ? "bg-primary/15 ring-1 ring-primary/50"
                                : "bg-card/60 hover:bg-card shadow-card-rest"
                            }`}
                          >
                            <div className="flex h-16 w-full items-center justify-center overflow-hidden rounded-lg bg-muted/40 p-1">
                              {isImg ? (
                                <ProjectThumbnail
                                  thumbPath={entry.path}
                                  alt={entry.name}
                                  variant="compact"
                                />
                              ) : entry.is_dir ? (
                                <Folder className="h-8 w-8 text-primary" />
                              ) : (
                                <div className="flex flex-col items-center gap-0.5">
                                  <FileText className="h-6 w-6 text-muted-foreground" />
                                  {entry.ext && (
                                    <span className="rounded bg-muted px-1 font-mono text-xs font-semibold uppercase text-foreground/80">
                                      {entry.ext.slice(0, 5)}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>

                            <div className="w-full line-clamp-2 break-all text-xs leading-tight text-foreground">
                              {entry.name}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {explorerEntries.map((entry) => {
                        const active = selectedExplorerPath === entry.path;
                        return (
                          <div
                            key={entry.path}
                            onMouseEnter={() => setHoveredExplorerEntry(entry)}
                            onMouseLeave={() => setHoveredExplorerEntry(null)}
                            onClick={() => {
                              setSelectedExplorerPath(entry.path);
                              setSelectionFocus("explorer");
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setSelectedExplorerPath(entry.path);
                              setSelectionFocus("explorer");
                              setExplorerMenu({
                                entry,
                                x: Math.min(e.clientX, window.innerWidth - 210),
                                y: Math.min(e.clientY, window.innerHeight - 190),
                              });
                            }}
                            onDoubleClick={() => {
                              if (entry.is_dir) {
                                setExplorerPath(entry.path);
                                loadExplorerDir(entry.path);
                              } else {
                                openArchivePath(entry.path);
                              }
                            }}
                            className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors cursor-pointer ${
                              active
                                ? "bg-primary/15 text-foreground font-medium"
                                : "text-foreground/85 hover:bg-accent"
                            }`}
                          >
                            {entry.is_dir ? (
                              <Folder className="h-3.5 w-3.5 shrink-0 text-primary" />
                            ) : isPreviewableImageExt(entry.ext) ? (
                              <ImageIcon className="h-3.5 w-3.5 shrink-0 text-primary/80" />
                            ) : (
                              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            )}

                            <div className="min-w-0 flex-1">
                              <div className="truncate" title={entry.name}>
                                {entry.name}
                              </div>
                              {!entry.is_dir && entry.size > 0 && (
                                <div className="font-mono text-xs text-muted-foreground">
                                  {formatFileSize(entry.size)}
                                </div>
                              )}
                            </div>

                            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedExplorerPath(entry.path);
                                  handleTriggerPreview(entry);
                                }}
                                className="rounded p-1 text-muted-foreground hover:bg-card hover:text-foreground"
                                title="Seer / 快速预览 (Space)"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openArchivePath(entry.path);
                                }}
                                className="rounded p-1 text-muted-foreground hover:bg-card hover:text-foreground"
                                title="打开"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </aside>
            </>
          )}
        </div>
      )}

      {/* Project Card Context Menu */}
      {projectMenu && (
        <div
          style={{ left: projectMenu.x, top: projectMenu.y }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-48 rounded-lg border border-border bg-popover p-1 text-xs text-popover-foreground shadow-popover-soft"
        >
          <button
            type="button"
            onClick={() => {
              const target = projectMenu.item;
              setProjectMenu(null);
              openArchivePath(target.path);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
          >
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
            <span>{projectMenu.item.is_dir ? "打开项目文件夹" : "用默认程序打开"}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              const target = projectMenu.item;
              setProjectMenu(null);
              revealPathInOs(target.path).catch(() => {});
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
          >
            <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
            <span>在资源管理器中定位</span>
          </button>
          <button
            type="button"
            onClick={() => {
              const target = projectMenu.item;
              setProjectMenu(null);
              toggleStarProject(target.path);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
          >
            <Star
              className={`h-3.5 w-3.5 ${
                starredSet.has(projectMenu.item.path)
                  ? "text-primary fill-current"
                  : "text-muted-foreground"
              }`}
            />
            <span>
              {starredSet.has(projectMenu.item.path) ? "取消收藏" : "收藏项目"}
            </span>
          </button>
          <button
            type="button"
            onClick={async () => {
              const target = projectMenu.item;
              setProjectMenu(null);
              await navigator.clipboard.writeText(target.path).catch(() => {});
              onNotify("已复制完整路径");
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
          >
            <Copy className="h-3.5 w-3.5 text-muted-foreground" />
            <span>复制完整路径</span>
          </button>
          <div className="my-1 h-px bg-border/60" />
          <button
            type="button"
            onClick={() => {
              const target = projectMenu.item;
              setProjectMenu(null);
              sendEntryToKanban({
                name: target.displayTitle || target.name,
                path: target.path,
                is_dir: target.is_dir,
                ext: target.ext,
                size: target.size,
                modified_ms: target.modified_ms,
              });
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-primary transition-colors hover:bg-accent"
          >
            <Kanban className="h-3.5 w-3.5" />
            <span>发送到看板作为任务</span>
          </button>
        </div>
      )}

      {/* Right Explorer File Context Menu */}
      {explorerMenu && (
        <div
          style={{ left: explorerMenu.x, top: explorerMenu.y }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-48 rounded-lg border border-border bg-popover p-1 text-xs text-popover-foreground shadow-popover-soft"
        >
          <button
            type="button"
            onClick={() => {
              const ent = explorerMenu.entry;
              setExplorerMenu(null);
              handleTriggerPreview(ent);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-accent"
          >
            <Eye className="h-3.5 w-3.5 text-primary" />
            <span>Seer / 快速预览</span>
          </button>
          <button
            type="button"
            onClick={() => {
              const ent = explorerMenu.entry;
              setExplorerMenu(null);
              openArchivePath(ent.path);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-accent"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span>用默认程序打开</span>
          </button>
          <button
            type="button"
            onClick={() => {
              const ent = explorerMenu.entry;
              setExplorerMenu(null);
              revealPathInOs(ent.path).catch(() => {});
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-accent"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            <span>在资源管理器中定位</span>
          </button>
          <button
            type="button"
            onClick={async () => {
              const ent = explorerMenu.entry;
              setExplorerMenu(null);
              await navigator.clipboard.writeText(ent.path).catch(() => {});
              onNotify("已复制完整路径");
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-accent"
          >
            <Copy className="h-3.5 w-3.5" />
            <span>复制完整路径</span>
          </button>
          <div className="my-1 h-px bg-border/60" />
          <button
            type="button"
            onClick={() => {
              const ent = explorerMenu.entry;
              setExplorerMenu(null);
              sendEntryToKanban(ent);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-primary hover:bg-accent"
          >
            <Kanban className="h-3.5 w-3.5" />
            <span>发送到看板作为任务</span>
          </button>
        </div>
      )}

      {/* Built-in QuickLook / Seer Fallback Modal */}
      {quickLook && (
        <div
          onClick={() => setQuickLook(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-popover text-popover-foreground shadow-popover-soft"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-foreground">
                  {quickLook.entry.name}
                </div>
                <div className="truncate font-mono text-xs text-muted-foreground">
                  {quickLook.entry.path}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => openArchivePath(quickLook.entry.path)}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  默认程序打开
                </Button>
                <button
                  type="button"
                  onClick={() => setQuickLook(null)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  title="关闭预览 (Space / Esc)"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4">
              {quickLook.loading ? (
                <div className="flex h-48 items-center justify-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  正在加载预览...
                </div>
              ) : quickLook.kind === "image" && quickLook.imageUrl ? (
                <div className="flex items-center justify-center">
                  <img
                    src={quickLook.imageUrl}
                    alt={quickLook.entry.name}
                    className="max-h-[68vh] max-w-full rounded-lg object-contain"
                  />
                </div>
              ) : quickLook.kind === "text" ? (
                <pre className="whitespace-pre-wrap break-words rounded-xl bg-muted/50 p-3.5 font-mono text-xs leading-relaxed text-foreground/90 select-text">
                  {quickLook.textContent || "(空文件)"}
                </pre>
              ) : (
                <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                  {quickLook.entry.is_dir ? (
                    <Folder className="h-10 w-10 text-primary" />
                  ) : (
                    <FileText className="h-10 w-10 text-muted-foreground" />
                  )}
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div className="text-sm font-medium text-foreground">
                      {quickLook.entry.name}
                    </div>
                    {!quickLook.entry.is_dir && quickLook.entry.size > 0 && (
                      <div className="font-mono">
                        大小：{formatFileSize(quickLook.entry.size)}
                      </div>
                    )}
                    <div>
                      本机未检测到 Seer / QuickLook，已使用内置预览模式
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Multi-Folder Archive Management moved to Settings -> Project Directories tab */}
    </div>
  );
};
