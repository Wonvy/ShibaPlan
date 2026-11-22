import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
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
  RefreshCw,
  Search,
  Settings,
  X,
} from "lucide-react";
import { ProjectArchiveDir, WorkspaceData } from "../types";
import {
  getMemoryArchiveCache,
  IndexedArchiveItem,
  loadArchiveThumbnail,
  loadCachedProjectArchive,
  openArchivePath,
  scanProjectArchiveRoots,
  searchArchiveItems,
} from "../lib/archive";
import { Button } from "./ui/button";

interface ProjectsViewProps {
  workspace: WorkspaceData;
  onOpenProjectSettings: () => void;
  onNotify: (msg: string) => void;
}

type SearchScope = "projects" | "all" | "files";
type ProjectViewMode = "grid" | "timeline" | "list";

const VIEW_MODE_STORAGE_KEY = "shibaplan_projects_view_mode_v1";

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
  onPreview?: (src: string, title: string) => void;
}> = ({ thumbPath, alt, variant = "card", onPreview }) => {
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

  if (!thumbPath || failed) return null;

  const handleClick = (e: React.MouseEvent) => {
    if (!src || !onPreview) return;
    e.stopPropagation();
    onPreview(src, alt);
  };

  if (variant === "compact") {
    return (
      <div
        ref={containerRef}
        onClick={handleClick}
        className={`flex h-10 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/50 p-0.5 ${
          src && onPreview ? "cursor-zoom-in" : ""
        }`}
        title={src && onPreview ? "点击查看大图" : undefined}
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
        onClick={handleClick}
        className={`flex w-36 sm:w-48 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/40 p-1.5 ${
          src && onPreview ? "cursor-zoom-in" : ""
        }`}
        title={src && onPreview ? "点击查看大图" : undefined}
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
      onClick={handleClick}
      className={`mb-2.5 flex w-full items-center justify-center overflow-hidden rounded-lg bg-muted/40 p-1.5 ${
        src && onPreview ? "cursor-zoom-in" : ""
      }`}
      title={src && onPreview ? "点击查看大图" : undefined}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
          className="max-h-52 w-full h-auto object-contain rounded transition-transform duration-300 group-hover:scale-[1.02]"
        />
      ) : (
        <div className="flex h-28 w-full items-center justify-center text-muted-foreground/35">
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
      if (saved === "grid" || saved === "timeline" || saved === "list") {
        return saved;
      }
    } catch {
      // ignore
    }
    return "grid";
  });
  const [lightbox, setLightbox] = useState<{
    src: string;
    title: string;
  } | null>(null);
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

  const searchInputRef = useRef<HTMLInputElement>(null);
  const autoOpenedSettingsRef = useRef(false);

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
      } else if (e.key === "Escape" && active === searchInputRef.current) {
        if (query) {
          setQuery("");
        } else {
          searchInputRef.current?.blur();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [query]);

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

  // Project-only list for Year/Month timeline counts
  const projectsByRoot = useMemo(() => {
    return allItems.filter(
      (item) =>
        item.is_project &&
        (selectedRoot === "all" || item.root_path === selectedRoot)
    );
  }, [allItems, selectedRoot]);

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
    return allItems.filter((item) => {
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
  }, [allItems, effectiveScope, selectedRoot, selectedYear, selectedMonth]);

  // Everything-style search
  const { items: matchedItems, highlightTerms } = useMemo(
    () => searchArchiveItems(filteredPool, query),
    [filteredPool, query]
  );

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
      <div className="flex flex-wrap items-center gap-2 px-3 sm:px-5 py-2.5 bg-surface/60 shrink-0">
        {/* Everything Search Input */}
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="快捷搜索项目与文件（空格=与  |=或  !=排除  ext:pdf  folder:  file:）"
            className="h-9 w-full rounded-lg bg-card pl-8 pr-20 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring shadow-card-rest"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
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

        {/* View Mode Switcher: Grid / Timeline / List */}
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
          <aside className="hidden sm:flex w-44 shrink-0 flex-col overflow-y-auto bg-surface/40 p-2.5 space-y-4">
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

          {/* Main Project Grid / Everything Results List */}
          <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-3.5 space-y-4">
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
            ) : isSearching ||
              effectiveScope !== "projects" ||
              viewMode === "list" ? (
              /* EVERYTHING-STYLE INSTANT DENSE LIST VIEW */
              <div className="space-y-1.5">
                {visibleItems.map((item) => (
                  <div
                    key={item.path}
                    onDoubleClick={() => openArchivePath(item.path)}
                    className="group flex items-center gap-2.5 rounded-xl bg-card/80 px-3 py-2 text-xs transition-all hover:bg-card shadow-card-rest"
                  >
                    {item.thumbnail_path ? (
                      <ProjectThumbnail
                        thumbPath={item.thumbnail_path}
                        alt={item.name}
                        variant="compact"
                        onPreview={(src, title) => setLightbox({ src, title })}
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
                      onClick={() => openArchivePath(item.path)}
                      className="shrink-0 rounded-lg p-1.5 text-muted-foreground opacity-70 transition hover:bg-accent hover:text-foreground group-hover:opacity-100"
                      title="在资源管理器中打开"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}

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
                        const rootTag = rootLabelMap.get(item.root_path);
                        return (
                          <div
                            key={item.path}
                            onDoubleClick={() => openArchivePath(item.path)}
                            className="group relative rounded-xl bg-card p-3 transition-all shadow-card-rest hover:shadow-card-hover"
                          >
                            {/* Connector dot on spine */}
                            <span className="absolute -left-[18px] sm:-left-[22px] top-5 h-1.5 w-1.5 rounded-full bg-border group-hover:bg-primary transition-colors" />

                            <div className="flex flex-col sm:flex-row items-start gap-3">
                              <ProjectThumbnail
                                thumbPath={item.thumbnail_path}
                                alt={item.displayTitle}
                                variant="timeline"
                                onPreview={(src, title) =>
                                  setLightbox({ src, title })
                                }
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

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5 items-start">
                      {groupItems.map((item) => {
                        const isExpanded = expandedProjectPath === item.path;
                        const rootTag = rootLabelMap.get(item.root_path);
                        return (
                          <div
                            key={item.path}
                            onDoubleClick={() => openArchivePath(item.path)}
                            className="group flex flex-col rounded-xl bg-card p-3 transition-all shadow-card-rest hover:shadow-card-hover"
                          >
                            <ProjectThumbnail
                              thumbPath={item.thumbnail_path}
                              alt={item.displayTitle}
                              variant="card"
                              onPreview={(src, title) =>
                                setLightbox({ src, title })
                              }
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
        </div>
      )}

      {/* Full-Size Adaptive Image Lightbox */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/75 p-6 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative flex max-h-[88vh] max-w-[90vw] flex-col items-center gap-3"
          >
            <img
              src={lightbox.src}
              alt={lightbox.title}
              className="max-h-[80vh] max-w-[88vw] rounded-xl object-contain shadow-2xl"
            />
            <div className="flex items-center gap-3 rounded-full bg-popover/90 px-4 py-1.5 text-xs text-popover-foreground shadow-popover-soft">
              <span className="max-w-[60vw] truncate font-medium">
                {lightbox.title}
              </span>
              <button
                type="button"
                onClick={() => setLightbox(null)}
                className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                title="关闭预览"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Multi-Folder Archive Management moved to Settings -> Project Directories tab */}
    </div>
  );
};
