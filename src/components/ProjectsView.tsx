import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  BarChart3,
  Calendar,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  Eye,
  File,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Loader2,
  PanelRight,
  RefreshCw,
  Search,
  Settings,
  X,
} from "lucide-react";
import { ProjectArchiveDir, WorkspaceData } from "../types";
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

interface ProjectsViewProps {
  workspace: WorkspaceData;
  onOpenProjectSettings: () => void;
  onNotify: (msg: string) => void;
}

type SearchScope = "projects" | "all" | "files";
type ProjectViewMode = "grid" | "timeline" | "list" | "stats";

const VIEW_MODE_STORAGE_KEY = "shibaplan_projects_view_mode_v1";
const LEFT_WIDTH_STORAGE_KEY = "shibaplan_projects_left_w_v1";
const RIGHT_WIDTH_STORAGE_KEY = "shibaplan_projects_right_w_v1";
const EXPLORER_VIEW_STORAGE_KEY = "shibaplan_projects_explorer_view_v1";
const CARD_WIDTH_STORAGE_KEY = "shibaplan_projects_card_w_v1";

function formatFileSize(bytes: number): string {
  if (bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getFolderLabel(dir: ProjectArchiveDir): string {
  if (dir.label?.trim()) return dir.label.trim();
  const clean = dir.path.replace(/[\\/]+$/, "");
  const parts = clean.split(/[\\/]/);
  return parts[parts.length - 1] || clean;
}

function renderHighlightedText(text: string, terms: string[]): React.ReactNode {
  if (!terms.length || !text) return text;
  const escaped = terms
    .filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (escaped.length === 0) return text;

  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, idx) =>
    idx % 2 === 1 ? (
      <mark
        key={idx}
        className="rounded bg-primary/20 px-0.5 font-medium text-primary"
      >
        {part}
      </mark>
    ) : (
      <React.Fragment key={idx}>{part}</React.Fragment>
    )
  );
}

const ProjectThumbnail: React.FC<{
  thumbPath: string | null;
  alt: string;
  variant?: "card" | "timeline" | "compact";
  fixedHeight?: number;
  showPlaceholder?: boolean;
}> = ({
  thumbPath,
  alt,
  variant = "card",
  fixedHeight = 128,
  showPlaceholder = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!thumbPath) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "180px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [thumbPath]);

  useEffect(() => {
    if (!visible || !thumbPath) return;
    let cancelled = false;
    loadArchiveThumbnail(thumbPath).then((url) => {
      if (!cancelled) {
        if (url) setSrc(url);
        else setFailed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [visible, thumbPath]);

  if (!thumbPath || failed) {
    if (variant === "card" && showPlaceholder) {
      return (
        <div
          style={{ height: fixedHeight }}
          className="mb-2.5 flex w-full items-center justify-center rounded-lg bg-muted/35 text-muted-foreground/30"
        >
          <Folder className="h-7 w-7" />
        </div>
      );
    }
    return null;
  }

  if (variant === "compact") {
    return (
      <div
        ref={containerRef}
        className="flex h-10 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/50 p-0.5"
      >
        {src ? (
          <img
            src={src}
            alt={alt}
            loading="lazy"
            onError={() => setFailed(true)}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <ImageIcon className="h-3.5 w-3.5 text-muted-foreground/50" />
        )}
      </div>
    );
  }

  if (variant === "timeline") {
    return (
      <div
        ref={containerRef}
        className="flex w-36 sm:w-48 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/40 p-1.5"
      >
        {src ? (
          <img
            src={src}
            alt={alt}
            loading="lazy"
            onError={() => setFailed(true)}
            className="max-h-36 w-full h-auto object-contain rounded transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-24 w-full items-center justify-center text-muted-foreground/35">
            <ImageIcon className="h-5 w-5" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ height: fixedHeight }}
      className="mb-2.5 flex w-full items-center justify-center overflow-hidden rounded-lg bg-muted/40 p-1.5"
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
          className="max-h-full max-w-full object-contain rounded transition-transform duration-300 group-hover:scale-[1.02]"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground/35">
          <ImageIcon className="h-5 w-5" />
        </div>
      )}
    </div>
  );
};

export const ProjectsView: React.FC<ProjectsViewProps> = ({
  workspace,
  onOpenProjectSettings,
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
  const [selectedYear, setSelectedYear] = useState<number | "all" | "unknown">(
    "all"
  );
  const [selectedMonth, setSelectedMonth] = useState<number | "all">("all");
  const [renderLimit, setRenderLimit] = useState(160);
  const [expandedProjectPath, setExpandedProjectPath] = useState<string | null>(
    null
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
      if (n >= 140 && n <= 340) return n;
    } catch {
      // ignore
    }
    return 184;
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
      latest = Math.max(140, Math.min(340, startW + (ev.clientX - startX)));
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
  const [explorerPath, setExplorerPath] = useState<string>("");
  const [explorerEntries, setExplorerEntries] = useState<ExplorerEntry[]>([]);
  const [explorerLoading, setExplorerLoading] = useState(false);
  const [selectedExplorerPath, setSelectedExplorerPath] = useState<
    string | null
  >(null);
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
    if (!dirPath) {
      setExplorerEntries([]);
      return;
    }
    setExplorerLoading(true);
    try {
      const entries = await listProjectExplorerEntries(dirPath);
      setExplorerEntries(entries);
      setSelectedExplorerPath(entries[0]?.path ?? null);
    } catch {
      setExplorerEntries([]);
    } finally {
      setExplorerLoading(false);
    }
  }, []);

  const selectProjectForExplorer = useCallback(
    (item: IndexedArchiveItem) => {
      setSelectedProject(item);
      const targetDir = item.is_dir
        ? item.path
        : item.path.replace(/[\\/][^\\/]+$/, "");
      setExplorerPath(targetDir);
      if (!explorerOpen) setExplorerOpen(true);
      loadExplorerDir(targetDir);
    },
    [explorerOpen, loadExplorerDir]
  );

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
    async (silent = false) => {
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
          workspace.settings.customDataDir
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
    let unknownCount = 0;

    for (const item of projectsByRoot) {
      if (item.year === null) {
        unknownCount++;
        continue;
      }
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
        const total = projectsByRoot.filter((i) => i.year === year).length;
        const months = Array.from(mMap.entries()).sort((a, b) => b[0] - a[0]);
        return { year, total, months };
      })
      .sort((a, b) => b.year - a.year);

    return { years, unknownCount, totalProjects: projectsByRoot.length };
  }, [projectsByRoot]);

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
      if (selectedYear === "unknown" && item.year !== null) return false;
      if (typeof selectedYear === "number" && item.year !== selectedYear)
        return false;
      if (typeof selectedMonth === "number" && item.month !== selectedMonth)
        return false;
      return true;
    });
  }, [effectiveItems, effectiveScope, selectedRoot, selectedYear, selectedMonth]);

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

  // Nested children lookup for inline project preview
  const expandedChildren = useMemo(() => {
    if (!expandedProjectPath) return [];
    const prefix = expandedProjectPath.endsWith("\\") || expandedProjectPath.endsWith("/")
      ? expandedProjectPath
      : expandedProjectPath + "\\";
    const altPrefix = expandedProjectPath + "/";
    return allItems
      .filter(
        (item) =>
          item.path !== expandedProjectPath &&
          (item.path.startsWith(prefix) || item.path.startsWith(altPrefix))
      )
      .slice(0, 40);
  }, [allItems, expandedProjectPath]);

  // Group browse items by YYYY年M月 when not searching
  const groupedBrowse = useMemo(() => {
    if (query.trim()) return [];
    const visible = matchedItems.slice(0, renderLimit);
    const groups = new Map<string, IndexedArchiveItem[]>();

    for (const item of visible) {
      const label =
        item.year && item.month
          ? `${item.year}年 ${item.month}月`
          : item.year
            ? `${item.year}年`
            : "其他未归类";
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(item);
    }

    return Array.from(groups.entries());
  }, [matchedItems, query, renderLimit]);

  const isSearching = query.trim().length > 0;
  const visibleItems = matchedItems.slice(0, renderLimit);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Top Everything-style Search & Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-5 py-2.5 bg-surface/60 shrink-0">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {/* Compact Everything Search Input */}
          <div className="relative w-64 sm:w-72 md:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索项目或文件（空格 / | / ! / ext:psd）"
              title="支持 Everything 语法：空格=与，|=或，!=排除，ext:pdf，folder:，file:"
              className="h-9 w-full rounded-lg bg-card pl-8 pr-16 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring shadow-card-rest"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                  title="清空搜索"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                {matchedItems.length}
              </span>
            </div>
          </div>

          {/* Scope Segmented Pills */}
          <div className="flex items-center rounded-lg bg-muted/70 p-0.5">
            {(
              [
                { id: "projects", label: "项目" },
                { id: "all", label: "全部" },
                { id: "files", label: "文件" },
              ] as const
            ).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setScope(s.id)}
                className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                  effectiveScope === s.id
                    ? "bg-card text-foreground font-medium shadow-card-rest"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
        {/* View Mode Switcher: Grid / Timeline / List / Stats */}
        <div
          className="flex items-center rounded-lg bg-muted/70 p-0.5"
          title="切换项目视图"
        >
          {(
            [
              {
                id: "grid",
                label: "网格",
                icon: <LayoutGrid className="h-3.5 w-3.5" />,
              },
              {
                id: "timeline",
                label: "时间轴",
                icon: <Clock className="h-3.5 w-3.5" />,
              },
              {
                id: "list",
                label: "列表",
                icon: <List className="h-3.5 w-3.5" />,
              },
              {
                id: "stats",
                label: "统计",
                icon: <BarChart3 className="h-3.5 w-3.5" />,
              },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => changeViewMode(m.id)}
              title={`${m.label}视图`}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
                viewMode === m.id
                  ? "bg-card text-foreground font-medium shadow-card-rest"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m.icon}
              <span className="hidden lg:inline">{m.label}</span>
            </button>
          ))}
        </div>

        {/* Re-index & Directory Settings */}
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={indexing || enabledRootPaths.length === 0}
            onClick={() => runIndex(false)}
            className="h-8 px-2.5 text-xs"
            title={
              lastIndexedAt
                ? `${cacheRestored ? "已命中本地缓存" : "已完成扫描"} · 更新于 ${lastIndexedAt}`
                : "重新扫描并更新缓存"
            }
          >
            {indexing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            <span className="hidden md:inline">
              {indexing
                ? allItems.length > 0
                  ? "同步中..."
                  : "索引中..."
                : "刷新索引"}
            </span>
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onOpenProjectSettings}
            className="h-8 px-2.5 text-xs"
          >
            <FolderPlus className="h-3.5 w-3.5 text-primary" />
            <span>项目目录</span>
            {archiveDirs.length > 0 && (
              <span className="rounded bg-primary/15 px-1 font-mono text-xs text-primary">
                {archiveDirs.length}
              </span>
            )}
          </Button>

          <Button
            type="button"
            variant={explorerOpen ? "default" : "secondary"}
            size="icon"
            onClick={() => setExplorerOpen((v) => !v)}
            className="h-8 w-8 shrink-0"
            title={explorerOpen ? "隐藏右侧资源管理器" : "显示右侧资源管理器"}
          >
            <PanelRight className="h-3.5 w-3.5" />
          </Button>
        </div>
        </div>
      </div>

      {/* Body: Empty State OR Sidebar + Results */}
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
          {/* Left Year / Month & Root Rail */}
          <aside
            style={{ width: leftWidth }}
            className="hidden sm:flex shrink-0 flex-col overflow-y-auto bg-surface/40 p-2.5 space-y-4"
          >
            {/* Multi-Root Filter */}
            {archiveDirs.length > 1 && (
              <div className="space-y-1">
                <div className="px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  项目目录
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRoot("all");
                    setSelectedYear("all");
                    setSelectedMonth("all");
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors ${
                    selectedRoot === "all"
                      ? "bg-primary text-primary-foreground font-medium"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  <span className="truncate">全部目录</span>
                  <span className="font-mono text-xs opacity-80">
                    {archiveDirs.filter((d) => d.enabled !== false).length}
                  </span>
                </button>
                {archiveDirs
                  .filter((d) => d.enabled !== false)
                  .map((dir) => {
                    const active = selectedRoot === dir.path.trim();
                    return (
                      <button
                        key={dir.id}
                        type="button"
                        onClick={() => {
                          setSelectedRoot(dir.path.trim());
                          setSelectedYear("all");
                          setSelectedMonth("all");
                        }}
                        title={dir.path}
                        className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition-colors ${
                          active
                            ? "bg-primary text-primary-foreground font-medium"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground"
                        }`}
                      >
                        <Folder className="h-3 w-3 shrink-0" />
                        <span className="truncate">{getFolderLabel(dir)}</span>
                      </button>
                    );
                  })}
              </div>
            )}

            {/* Year / Month Timeline */}
            <div className="space-y-1">
              <div className="px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                时间归档
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedYear("all");
                  setSelectedMonth("all");
                }}
                className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors ${
                  selectedYear === "all"
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3 w-3" />
                  全部年份
                </span>
                <span className="font-mono text-xs opacity-80">
                  {timelineStats.totalProjects}
                </span>
              </button>

              {timelineStats.years.map(({ year, total, months }) => {
                const yearActive = selectedYear === year;
                return (
                  <div key={year} className="space-y-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        if (yearActive && selectedMonth === "all") {
                          setSelectedYear("all");
                        } else {
                          setSelectedYear(year);
                          setSelectedMonth("all");
                        }
                      }}
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors ${
                        yearActive && selectedMonth === "all"
                          ? "bg-primary text-primary-foreground font-medium"
                          : yearActive
                            ? "bg-accent text-foreground font-medium"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                    >
                      <span className="flex items-center gap-1 font-mono">
                        {yearActive ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3 opacity-60" />
                        )}
                        {year}
                      </span>
                      <span className="font-mono text-xs opacity-75">
                        {total}
                      </span>
                    </button>

                    {yearActive && months.length > 0 && (
                      <div className="ml-3.5 space-y-0.5 border-l border-border/60 pl-2 py-0.5">
                        {months.map(([mo, cnt]) => {
                          const mActive = selectedMonth === mo;
                          return (
                            <button
                              key={mo}
                              type="button"
                              onClick={() =>
                                setSelectedMonth(mActive ? "all" : mo)
                              }
                              className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-xs transition-colors ${
                                mActive
                                  ? "bg-primary text-primary-foreground font-medium"
                                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
                              }`}
                            >
                              <span>{mo}月</span>
                              <span className="font-mono text-xs opacity-75">
                                {cnt}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {timelineStats.unknownCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedYear("unknown");
                    setSelectedMonth("all");
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors ${
                    selectedYear === "unknown"
                      ? "bg-primary text-primary-foreground font-medium"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  <span>未归类</span>
                  <span className="font-mono text-xs opacity-75">
                    {timelineStats.unknownCount}
                  </span>
                </button>
              )}
            </div>
          </aside>

          {/* Left-Middle Resize Handle */}
          <div
            onMouseDown={startResizeLeft}
            title="拖动调整左侧栏宽度"
            className={`hidden sm:block w-1 shrink-0 cursor-col-resize transition-colors ${
              resizingPane === "left"
                ? "bg-primary/60"
                : "bg-border/40 hover:bg-primary/40"
            }`}
          />

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
              /* EVERYTHING-STYLE INSTANT DENSE LIST VIEW */
              <div className="space-y-1.5">
                {visibleItems.map((item) => {
                  const isSelected = selectedProject?.path === item.path;
                  return (
                  <div
                    key={item.path}
                    onClick={() => selectProjectForExplorer(item)}
                    onDoubleClick={() => openArchivePath(item.path)}
                    className={`group flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs transition-all cursor-pointer shadow-card-rest ${
                      isSelected
                        ? "bg-card ring-1 ring-primary/50"
                        : "bg-card/80 hover:bg-card"
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
                        {renderHighlightedText(
                          item.relative_path,
                          highlightTerms
                        )}
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
                })}

                {matchedItems.length > renderLimit && (
                  <div className="flex justify-center pt-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setRenderLimit((n) => n + 200)}
                    >
                      加载更多（剩余 {matchedItems.length - renderLimit} 条）
                    </Button>
                  </div>
                )}
              </div>
            ) : viewMode === "timeline" ? (
              /* VISUAL VERTICAL TIMELINE VIEW */
              <div className="space-y-6 pb-4">
                {groupedBrowse.map(([groupLabel, groupItems]) => (
                  <section key={groupLabel} className="relative pl-5 sm:pl-6">
                    {/* Vertical timeline spine */}
                    <div className="absolute left-2 top-3 bottom-0 w-px bg-border/70" />

                    {/* Group milestone dot + header */}
                    <div className="relative mb-3 flex items-center gap-2">
                      <span className="absolute -left-[21px] sm:-left-[25px] flex h-3 w-3 items-center justify-center rounded-full bg-primary/20">
                        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                      </span>
                      <span className="text-sm font-semibold text-foreground">
                        {groupLabel}
                      </span>
                      <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                        {groupItems.length}
                      </span>
                    </div>

                    <div className="space-y-2.5">
                      {groupItems.map((item) => {
                        const isExpanded = expandedProjectPath === item.path;
                        const isSelected = selectedProject?.path === item.path;
                        const rootTag = rootLabelMap.get(item.root_path);
                        return (
                          <div
                            key={item.path}
                            onClick={() => selectProjectForExplorer(item)}
                            onDoubleClick={() => openArchivePath(item.path)}
                            className={`group relative rounded-xl bg-card p-3 transition-all cursor-pointer shadow-card-rest hover:shadow-card-hover ${
                              isSelected ? "ring-1 ring-primary/50" : ""
                            }`}
                          >
                            {/* Connector dot on spine */}
                            <span className="absolute -left-[18px] sm:-left-[22px] top-5 h-1.5 w-1.5 rounded-full bg-border group-hover:bg-primary transition-colors" />

                            <div className="flex flex-col sm:flex-row items-start gap-3">
                              <ProjectThumbnail
                                thumbPath={item.thumbnail_path}
                                alt={item.displayTitle}
                                variant="timeline"
                              />

                              <div className="min-w-0 flex-1 space-y-1.5 w-full">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1 space-y-1">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      {item.dateLabel && (
                                        <span className="shrink-0 rounded-md bg-primary/15 px-1.5 py-0.5 font-mono text-xs font-medium text-primary">
                                          {item.dateLabel}
                                        </span>
                                      )}
                                      {archiveDirs.length > 1 && rootTag && (
                                        <span className="truncate rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                                          {rootTag}
                                        </span>
                                      )}
                                      <span className="font-mono text-xs text-muted-foreground">
                                        {item.is_dir
                                          ? `${item.child_count} 个子项`
                                          : item.ext.toUpperCase() || "文件"}
                                      </span>
                                    </div>

                                    <div
                                      className="text-sm font-medium text-foreground"
                                      title={item.name}
                                    >
                                      {item.displayTitle}
                                    </div>

                                    <div className="truncate font-mono text-xs text-muted-foreground/80">
                                      {item.relative_path}
                                    </div>
                                  </div>

                                  <div className="flex shrink-0 items-center gap-1">
                                    {item.is_dir && item.child_count > 0 && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setExpandedProjectPath(
                                            isExpanded ? null : item.path
                                          )
                                        }
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
                                      expandedChildren
                                        .slice(0, 10)
                                        .map((child) => (
                                          <button
                                            key={child.path}
                                            type="button"
                                            onClick={() =>
                                              openArchivePath(child.path)
                                            }
                                            className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
                                          >
                                            {child.is_dir ? (
                                              <Folder className="h-3 w-3 shrink-0 text-primary/80" />
                                            ) : (
                                              <File className="h-3 w-3 shrink-0" />
                                            )}
                                            <span className="truncate">
                                              {child.name}
                                            </span>
                                          </button>
                                        ))
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
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
            ) : (
              /* GROUPED ADAPTIVE GRID CARDS VIEW */
              <div className="space-y-5">
                {groupedBrowse.map(([groupLabel, groupItems]) => (
                  <section key={groupLabel} className="space-y-2.5">
                    <div className="flex items-center gap-2 px-1">
                      <span className="text-sm font-semibold text-foreground">
                        {groupLabel}
                      </span>
                      <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                        {groupItems.length}
                      </span>
                    </div>

                    <div
                      style={{
                        gridTemplateColumns: `repeat(auto-fill, minmax(${cardWidth}px, ${Math.min(
                          cardWidth + 36,
                          340
                        )}px))`,
                      }}
                      className="grid gap-2.5 items-stretch"
                    >
                      {groupItems.map((item) => {
                        const isExpanded = expandedProjectPath === item.path;
                        const isSelected = selectedProject?.path === item.path;
                        const rootTag = rootLabelMap.get(item.root_path);
                        const thumbH = Math.round(cardWidth * 0.58);
                        return (
                          <div
                            key={item.path}
                            onClick={() => selectProjectForExplorer(item)}
                            onDoubleClick={() => openArchivePath(item.path)}
                            className={`group flex flex-col rounded-xl bg-card p-3 transition-all cursor-pointer shadow-card-rest hover:shadow-card-hover ${
                              isSelected ? "ring-1 ring-primary/50" : ""
                            }`}
                          >
                            <ProjectThumbnail
                              thumbPath={item.thumbnail_path}
                              alt={item.displayTitle}
                              variant="card"
                              fixedHeight={thumbH}
                              showPlaceholder
                            />

                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex items-center gap-1.5">
                                  {item.dateLabel && (
                                    <span className="shrink-0 rounded-md bg-primary/15 px-1.5 py-0.5 font-mono text-xs font-medium text-primary">
                                      {item.dateLabel}
                                    </span>
                                  )}
                                  {archiveDirs.length > 1 && rootTag && (
                                    <span className="truncate rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                                      {rootTag}
                                    </span>
                                  )}
                                </div>
                                <div
                                  className="truncate text-[13px] font-medium text-foreground"
                                  title={item.name}
                                >
                                  {item.displayTitle}
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => openArchivePath(item.path)}
                                className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                                title="打开项目文件夹"
                              >
                                <FolderOpen className="h-3.5 w-3.5" />
                              </button>
                            </div>

                            <div className="mt-2.5 flex items-center justify-between text-xs text-muted-foreground">
                              <span className="truncate font-mono opacity-80">
                                {item.is_dir
                                  ? `${item.child_count} 个子项`
                                  : item.ext.toUpperCase() || "文件"}
                              </span>
                              {item.is_dir && item.child_count > 0 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedProjectPath(
                                      isExpanded ? null : item.path
                                    )
                                  }
                                  className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 transition hover:bg-accent hover:text-foreground"
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="h-3 w-3" />
                                  ) : (
                                    <ChevronRight className="h-3 w-3" />
                                  )}
                                  <span>{isExpanded ? "收起" : "预览"}</span>
                                </button>
                              )}
                            </div>

                            {isExpanded && (
                              <div className="mt-2.5 space-y-1 border-t border-border/60 pt-2">
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
                                      <span className="truncate">
                                        {child.name}
                                      </span>
                                    </button>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
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
                {/* Explorer Header */}
                <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5 shrink-0">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-foreground">
                      {selectedProject
                        ? selectedProject.displayTitle
                        : "项目资源管理器"}
                    </div>
                    <div
                      className="truncate font-mono text-xs text-muted-foreground"
                      title={explorerPath || ""}
                    >
                      {selectedProject
                        ? explorerPath.replace(selectedProject.root_path, "") ||
                          "\\"
                        : "点击左侧项目查看内部文件"}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {/* List / Icons View Switcher */}
                    <div className="flex items-center rounded-md bg-muted/70 p-0.5">
                      <button
                        type="button"
                        onClick={() => changeExplorerViewMode("list")}
                        title="列表视图"
                        className={`rounded p-1 transition-colors ${
                          explorerViewMode === "list"
                            ? "bg-card text-foreground shadow-card-rest"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <List className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => changeExplorerViewMode("icons")}
                        title="图标视图"
                        className={`rounded p-1 transition-colors ${
                          explorerViewMode === "icons"
                            ? "bg-card text-foreground shadow-card-rest"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <LayoutGrid className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {selectedProject && (
                      <div className="flex items-center gap-0.5">
                        {explorerPath.toLowerCase() !==
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
                          onClick={() => loadExplorerDir(explorerPath)}
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
                </div>

                {/* Explorer Entries (List or Icons Grid) */}
                <div className="flex-1 overflow-y-auto p-2">
                  {!selectedProject ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-xs text-muted-foreground">
                      <FolderOpen className="h-6 w-6 opacity-35" />
                      <span>点击中间任意项目即可在此浏览文件条目</span>
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
                            onClick={() => setSelectedExplorerPath(entry.path)}
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
                            onClick={() => setSelectedExplorerPath(entry.path)}
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

                {/* Explorer Footer Hint */}
                <div className="border-t border-border/60 px-3 py-1.5 text-xs text-muted-foreground shrink-0">
                  空格键 Seer / 快速预览 · 双击进入或打开
                </div>
              </aside>
            </>
          )}
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
