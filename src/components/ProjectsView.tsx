import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  File,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  HardDrive,
  Image as ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { ProjectArchiveDir, WorkspaceData } from "../types";
import { isTauriRuntime, uid } from "../lib/storage";
import {
  IndexedArchiveItem,
  loadArchiveThumbnail,
  openArchivePath,
  pickArchiveFolder,
  scanProjectArchiveRoots,
  searchArchiveItems,
} from "../lib/archive";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Separator } from "./ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";

interface ProjectsViewProps {
  workspace: WorkspaceData;
  onUpdate: (next: WorkspaceData) => void;
  onNotify: (msg: string) => void;
}

type SearchScope = "projects" | "all" | "files";

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
  compact?: boolean;
}> = ({ thumbPath, alt, compact = false }) => {
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

  if (compact) {
    return (
      <div
        ref={containerRef}
        className="h-8 w-8 shrink-0 overflow-hidden rounded-md bg-muted/60"
      >
        {src ? (
          <img
            src={src}
            alt={alt}
            loading="lazy"
            onError={() => setFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground/50">
            <ImageIcon className="h-3.5 w-3.5" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative mb-2.5 aspect-[16/9] w-full overflow-hidden rounded-lg bg-muted/50"
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
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
  onUpdate,
  onNotify,
}) => {
  const archiveDirs = useMemo(
    () => workspace.settings.projectArchiveDirs ?? [],
    [workspace.settings.projectArchiveDirs]
  );

  const [allItems, setAllItems] = useState<IndexedArchiveItem[]>([]);
  const [indexing, setIndexing] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [lastIndexedAt, setLastIndexedAt] = useState<string | null>(null);

  // Search & Filter states
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("projects");
  const [selectedRoot, setSelectedRoot] = useState<string>("all");
  const [selectedYear, setSelectedYear] = useState<number | "all" | "unknown">(
    "all"
  );
  const [selectedMonth, setSelectedMonth] = useState<number | "all">("all");
  const [renderLimit, setRenderLimit] = useState(160);
  const [expandedProjectPath, setExpandedProjectPath] = useState<string | null>(
    null
  );

  // Folder manager dialog state
  const [dirsDialogOpen, setDirsDialogOpen] = useState(false);
  const [newDirPath, setNewDirPath] = useState("");
  const [newDirLabel, setNewDirLabel] = useState("");

  const searchInputRef = useRef<HTMLInputElement>(null);

  const enabledRootPaths = useMemo(
    () =>
      archiveDirs
        .filter((d) => d.enabled !== false && d.path.trim())
        .map((d) => d.path.trim()),
    [archiveDirs]
  );

  const runIndex = useCallback(
    async (silent = false) => {
      if (enabledRootPaths.length === 0) {
        setAllItems([]);
        setIndexError(null);
        return;
      }
      setIndexing(true);
      setIndexError(null);
      try {
        const indexed = await scanProjectArchiveRoots(enabledRootPaths);
        setAllItems(indexed);
        const now = new Date();
        setLastIndexedAt(
          `${String(now.getHours()).padStart(2, "0")}:${String(
            now.getMinutes()
          ).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`
        );
        if (!silent) {
          const projCount = indexed.filter((i) => i.is_project).length;
          onNotify(`索引完成：${projCount} 个项目，共 ${indexed.length} 条记录`);
        }
      } catch (err) {
        setIndexError(
          err instanceof Error ? err.message : "扫描项目目录失败"
        );
      } finally {
        setIndexing(false);
      }
    },
    [enabledRootPaths, onNotify]
  );

  // Auto-index whenever configured archive directories change
  useEffect(() => {
    runIndex(true);
  }, [runIndex]);

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

  const addArchivePathDirect = (rawPath: string, alias?: string) => {
    const cleanPath = rawPath.trim().replace(/^"|"$/g, "");
    if (!cleanPath) return;

    if (
      archiveDirs.some(
        (d) => d.path.trim().toLowerCase() === cleanPath.toLowerCase()
      )
    ) {
      onNotify("该文件夹已在项目索引列表中");
      return;
    }

    const nextDir: ProjectArchiveDir = {
      id: uid("arch"),
      path: cleanPath,
      label: alias?.trim() || undefined,
      enabled: true,
    };

    onUpdate({
      ...workspace,
      settings: {
        ...workspace.settings,
        projectArchiveDirs: [...archiveDirs, nextDir],
      },
    });
    setNewDirPath("");
    setNewDirLabel("");
    onNotify("已添加项目目录，正在自动索引...");
  };

  const handleAddArchiveDir = (e: React.FormEvent) => {
    e.preventDefault();
    addArchivePathDirect(newDirPath, newDirLabel);
  };

  const handlePickFolder = async () => {
    try {
      const picked = await pickArchiveFolder();
      if (picked) {
        addArchivePathDirect(picked, newDirLabel);
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "选择文件夹失败");
    }
  };

  const handleToggleDir = (id: string) => {
    onUpdate({
      ...workspace,
      settings: {
        ...workspace.settings,
        projectArchiveDirs: archiveDirs.map((d) =>
          d.id === id ? { ...d, enabled: d.enabled === false } : d
        ),
      },
    });
  };

  const handleRemoveDir = (id: string) => {
    onUpdate({
      ...workspace,
      settings: {
        ...workspace.settings,
        projectArchiveDirs: archiveDirs.filter((d) => d.id !== id),
      },
    });
  };

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
            className="h-8 w-full rounded-lg bg-card pl-8 pr-20 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring shadow-card-rest"
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
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
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
              className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                effectiveScope === s.id
                  ? "bg-card text-foreground font-medium shadow-card-rest"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s.label}
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
            className="h-8 px-2.5 text-[11px]"
            title={lastIndexedAt ? `上次索引 ${lastIndexedAt}` : "重新索引"}
          >
            {indexing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            <span className="hidden md:inline">
              {indexing ? "索引中..." : "刷新索引"}
            </span>
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setDirsDialogOpen(true)}
            className="h-8 px-2.5 text-[11px]"
          >
            <FolderPlus className="h-3.5 w-3.5 text-primary" />
            <span>项目目录</span>
            {archiveDirs.length > 0 && (
              <span className="rounded bg-primary/15 px-1 font-mono text-[10px] text-primary">
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
                <h3 className="text-sm font-semibold text-foreground">
                  添加过往项目归档目录
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  支持多目录自动索引、多种日期格式识别与 Everything 级秒搜
                </p>
              </div>
            </div>

            <form onSubmit={handleAddArchiveDir} className="space-y-2.5">
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  value={newDirPath}
                  onChange={(e) => setNewDirPath(e.target.value)}
                  placeholder="例如 W:\#完成项目 或 D:\设计归档"
                  className="flex-1 font-mono text-xs"
                />
                {isTauriRuntime() && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handlePickFolder}
                    className="h-9 shrink-0 px-3"
                  >
                    <FolderSearch className="h-3.5 w-3.5" />
                    选择文件夹
                  </Button>
                )}
              </div>
              <Input
                type="text"
                value={newDirLabel}
                onChange={(e) => setNewDirLabel(e.target.value)}
                placeholder="显示别名（可选，如：完成项目）"
                className="text-xs"
              />
              <Button type="submit" className="w-full" size="sm">
                <Plus className="h-3.5 w-3.5" />
                添加文件夹并自动索引
              </Button>
            </form>

            <div className="rounded-xl bg-muted/50 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
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
                <div className="px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
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
                  <span className="font-mono text-[10px] opacity-80">
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
              <div className="px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
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
                <span className="font-mono text-[10px] opacity-80">
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
                      <span className="font-mono text-[10px] opacity-75">
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
                              className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-[11px] transition-colors ${
                                mActive
                                  ? "bg-primary text-primary-foreground font-medium"
                                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
                              }`}
                            >
                              <span>{mo}月</span>
                              <span className="font-mono text-[10px] opacity-75">
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
                  <span className="font-mono text-[10px] opacity-75">
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
            ) : isSearching || effectiveScope !== "projects" ? (
              /* EVERYTHING-STYLE INSTANT DENSE LIST */
              <div className="space-y-1">
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
                        compact
                      />
                    ) : item.is_dir ? (
                      <Folder className="h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-foreground">
                          {renderHighlightedText(item.name, highlightTerms)}
                        </span>
                        {item.ext && (
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                            {item.ext}
                          </span>
                        )}
                      </div>
                      <div className="truncate font-mono text-[10px] text-muted-foreground">
                        {renderHighlightedText(
                          item.relative_path,
                          highlightTerms
                        )}
                      </div>
                    </div>

                    {item.dateLabel && (
                      <span className="hidden sm:inline-block shrink-0 rounded-md bg-muted/70 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {item.dateLabel}
                      </span>
                    )}

                    {!item.is_dir && item.size > 0 && (
                      <span className="hidden md:inline-block w-16 text-right font-mono text-[10px] text-muted-foreground">
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
            ) : (
              /* GROUPED DATE TIMELINE PROJECT CARDS */
              <div className="space-y-5">
                {groupedBrowse.map(([groupLabel, groupItems]) => (
                  <section key={groupLabel} className="space-y-2.5">
                    <div className="flex items-center gap-2 px-1">
                      <span className="text-xs font-semibold text-foreground">
                        {groupLabel}
                      </span>
                      <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {groupItems.length}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
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
                            />

                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex items-center gap-1.5">
                                  {item.dateLabel && (
                                    <span className="shrink-0 rounded-md bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-medium text-primary">
                                      {item.dateLabel}
                                    </span>
                                  )}
                                  {archiveDirs.length > 1 && rootTag && (
                                    <span className="truncate rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                      {rootTag}
                                    </span>
                                  )}
                                </div>
                                <div
                                  className="truncate text-xs font-medium text-foreground"
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

                            <div className="mt-2.5 flex items-center justify-between text-[10px] text-muted-foreground">
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
                                  <div className="text-[10px] text-muted-foreground">
                                    暂无可预览子文件
                                  </div>
                                ) : (
                                  expandedChildren.slice(0, 10).map((child) => (
                                    <button
                                      key={child.path}
                                      type="button"
                                      onClick={() => openArchivePath(child.path)}
                                      className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] text-muted-foreground transition hover:bg-accent hover:text-foreground"
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

      {/* Multi-Folder Archive Management Dialog */}
      <Dialog open={dirsDialogOpen} onOpenChange={setDirsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderPlus className="h-4 w-4 text-primary" />
              项目归档文件夹设置
            </DialogTitle>
          </DialogHeader>

          <Separator className="my-3" />

          <div className="space-y-4">
            <form onSubmit={handleAddArchiveDir} className="space-y-2.5">
              <div className="text-xs font-medium text-foreground">
                添加新文件夹（支持添加多个目录自动索引）
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  value={newDirPath}
                  onChange={(e) => setNewDirPath(e.target.value)}
                  placeholder="文件夹绝对路径，如 W:\#完成项目"
                  className="flex-1 font-mono text-xs"
                />
                {isTauriRuntime() && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handlePickFolder}
                    className="h-9 shrink-0 px-3"
                  >
                    <FolderSearch className="h-3.5 w-3.5" />
                    浏览选择
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  value={newDirLabel}
                  onChange={(e) => setNewDirLabel(e.target.value)}
                  placeholder="显示别名（可选）"
                  className="flex-1 text-xs"
                />
                <Button type="submit" size="sm" className="h-9 shrink-0">
                  <Plus className="h-3.5 w-3.5" />
                  添加
                </Button>
              </div>
            </form>

            <Separator />

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">
                  已配置目录 ({archiveDirs.length})
                </span>
                <span className="text-[10px] text-muted-foreground">
                  已索引 {allItems.length} 条记录
                </span>
              </div>

              {archiveDirs.length === 0 ? (
                <div className="rounded-xl bg-muted/50 py-6 text-center text-xs text-muted-foreground">
                  暂未添加任何项目目录
                </div>
              ) : (
                <div className="max-h-56 space-y-1.5 overflow-y-auto">
                  {archiveDirs.map((dir) => {
                    const enabled = dir.enabled !== false;
                    return (
                      <div
                        key={dir.id}
                        className="flex items-center justify-between gap-2 rounded-xl bg-muted/50 px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium text-foreground">
                            {getFolderLabel(dir)}
                          </div>
                          <div className="truncate font-mono text-[10px] text-muted-foreground">
                            {dir.path}
                          </div>
                        </div>

                        <button
                          type="button"
                          role="switch"
                          aria-checked={enabled}
                          onClick={() => handleToggleDir(dir.id)}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                            enabled ? "bg-primary" : "bg-input"
                          }`}
                          title={enabled ? "点击停用此目录" : "点击启用此目录"}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-background shadow transition-transform ${
                              enabled ? "translate-x-4" : "translate-x-1"
                            }`}
                          />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleRemoveDir(dir.id)}
                          className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-destructive/12 hover:text-destructive"
                          title="移除目录"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
