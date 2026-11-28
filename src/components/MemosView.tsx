import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bold,
  BookOpen,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Code,
  Columns2,
  Copy,
  Download,
  Eye,
  FileCode2,
  Folder,
  FolderOpen,
  FolderPlus,
  Heading,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Keyboard,
  Link2,
  List,
  ListCollapse,
  ListOrdered,
  ListTodo,
  Minus,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Quote,
  Redo2,
  RefreshCw,
  Search,
  StickyNote,
  Strikethrough,
  Table2,
  Tag,
  Trash2,
  Underline,
  Undo2,
  X,
} from "lucide-react";
import { MemoFolder, MemoItem, WorkspaceData } from "../types";
import { saveMemoImage, uid } from "../lib/storage";
import {
  computeRenewedDate,
  DAILY_NOTE_TEMPLATE,
  EXPIRY_SOON_DAYS,
  formatDailyNoteTitle,
  formatExpiryLabel,
  getDaysUntilExpiry,
  getExpiryBadgeClass,
  getExpiryUrgency,
  getTodayDateKey,
  PRESET_MEMO_TAGS,
  RENEW_DAY_PRESETS,
  sortMemos,
  stripMarkdownPreview,
  toggleMarkdownCheckbox,
} from "../lib/memo";
import {
  computeLineRangeFromOffsets,
  lineRangeToCharOffsets,
} from "../lib/markdownEdit";
import {
  LineRange,
  MarkdownPreview,
  MarkdownPreviewHandle,
} from "./MarkdownPreview";
import { Button } from "./ui/button";
import { CustomSelect } from "./ui/custom-select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Separator } from "./ui/separator";

interface MemosViewProps {
  workspace: WorkspaceData;
  onUpdate: (next: WorkspaceData) => void;
  selectedMemoId: string | null;
  onSelectMemo: (id: string | null) => void;
  onNotify: (msg: string) => void;
}

type FilterMode = "all" | "expiring" | string;
type EditorMode = "edit" | "split" | "preview";
type SidebarViewMode = "folder" | "timeline";

const EDITOR_MODE_KEY = "shibaplan_memo_editor_mode";
const SIDEBAR_MODE_KEY = "shibaplan_memo_sidebar_mode";
const SIDEBAR_WIDTH_KEY = "shibaplan_memo_sidebar_width";
const SPLIT_RATIO_KEY = "shibaplan_memo_split_ratio";
const DEFAULT_SIDEBAR_WIDTH = 300;
const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 520;
const DEFAULT_SPLIT_RATIO = 0.5;
const MIN_SPLIT_RATIO = 0.2;
const MAX_SPLIT_RATIO = 0.8;
const TIMELINE_BATCH_SIZE = 24;
const UNGROUPED_DROP_KEY = "__ungrouped__";

const TIMELINE_WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

function getInitialSidebarMode(): SidebarViewMode {
  if (typeof window !== "undefined") {
    const saved = window.localStorage.getItem(SIDEBAR_MODE_KEY);
    if (saved === "folder" || saved === "timeline") return saved;
  }
  return "folder";
}

function getLocalDateKeyFromIso(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "unknown";
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatShortTime(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  return `${String(dt.getHours()).padStart(2, "0")}:${String(
    dt.getMinutes()
  ).padStart(2, "0")}`;
}

function formatTimelineDateLabel(dateKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return "更早";
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const dt = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((today.getTime() - dt.getTime()) / 86_400_000);
  const md = `${match[2]}-${match[3]}`;
  if (diffDays === 0) return `今天 · ${md}`;
  if (diffDays === 1) return `昨天 · ${md}`;
  if (y === now.getFullYear()) {
    return `${md} ${TIMELINE_WEEKDAYS[dt.getDay()]}`;
  }
  return dateKey;
}

function getInitialEditorMode(): EditorMode {
  if (typeof window !== "undefined") {
    const saved = window.localStorage.getItem(EDITOR_MODE_KEY);
    if (saved === "edit" || saved === "split" || saved === "preview") {
      return saved;
    }
    return window.innerWidth >= 1100 ? "split" : "edit";
  }
  return "split";
}

function getInitialSidebarWidth(): number {
  if (typeof window !== "undefined") {
    const raw = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
    if (Number.isFinite(raw) && raw >= MIN_SIDEBAR_WIDTH && raw <= MAX_SIDEBAR_WIDTH) {
      return Math.round(raw);
    }
  }
  return DEFAULT_SIDEBAR_WIDTH;
}

function getInitialSplitRatio(): number {
  if (typeof window !== "undefined") {
    const raw = Number(window.localStorage.getItem(SPLIT_RATIO_KEY));
    if (Number.isFinite(raw) && raw >= MIN_SPLIT_RATIO && raw <= MAX_SPLIT_RATIO) {
      return raw;
    }
  }
  return DEFAULT_SPLIT_RATIO;
}

function extractImageFilesFromTransfer(
  dt: DataTransfer | null | undefined
): File[] {
  if (!dt) return [];
  const files: File[] = [];
  const seen = new Set<string>();
  if (dt.items) {
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          const sig = `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
          if (!seen.has(sig)) {
            seen.add(sig);
            files.push(file);
          }
        }
      }
    }
  }
  if (files.length === 0 && dt.files) {
    for (let i = 0; i < dt.files.length; i++) {
      const file = dt.files[i];
      if (
        file.type.startsWith("image/") ||
        /\.(png|jpe?g|webp|gif|bmp|svg|avif)$/i.test(file.name)
      ) {
        const sig = `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
        if (!seen.has(sig)) {
          seen.add(sig);
          files.push(file);
        }
      }
    }
  }
  return files;
}

function readFileAsDataUrl(
  file: File
): Promise<{ dataUrl: string; ext: string }> {
  const mimeExt = file.type.split("/")[1]?.split("+")[0] || "";
  const nameExt = file.name.includes(".")
    ? file.name.split(".").pop() || ""
    : "";
  const ext = (mimeExt || nameExt || "png").toLowerCase();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve({ dataUrl: reader.result, ext });
      } else {
        reject(new Error("Invalid image data"));
      }
    };
    reader.onerror = () => reject(reader.error || new Error("Read failed"));
    reader.readAsDataURL(file);
  });
}

const QUICK_TEMPLATES: {
  tag: (typeof PRESET_MEMO_TAGS)[number];
  label: string;
  renewDays?: number;
}[] = [
  { tag: "软件", label: "+ 软件摘要" },
  { tag: "证书", label: "+ 网站证书", renewDays: 90 },
  { tag: "会员", label: "+ 会员订阅", renewDays: 365 },
  { tag: "服务器", label: "+ 服务器记录", renewDays: 365 },
];

const CALLOUT_PRESETS = [
  { kind: "NOTE", label: "备注 Note", dotClass: "bg-sky-500", defaultBody: "补充说明内容" },
  { kind: "TIP", label: "技巧 Tip", dotClass: "bg-emerald-500", defaultBody: "实用操作技巧" },
  { kind: "IMPORTANT", label: "重要 Important", dotClass: "bg-primary", defaultBody: "关键配置或注意事项" },
  { kind: "WARNING", label: "注意 Warning", dotClass: "bg-amber-500", defaultBody: "潜在风险提示" },
  { kind: "CAUTION", label: "警告 Caution", dotClass: "bg-rose-500", defaultBody: "高危操作警示" },
] as const;

interface MemoHistoryEntry {
  content: string;
  selStart: number;
  selEnd: number;
}

interface MemoHistoryState {
  stack: MemoHistoryEntry[];
  index: number;
  lastPushAt: number;
}

const MAX_HISTORY_ENTRIES = 80;

function formatUpdatedAt(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  const hh = String(dt.getHours()).padStart(2, "0");
  const mm = String(dt.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function sanitizeFilename(name: string): string {
  return (
    name
      .trim()
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, "-")
      .slice(0, 64) || "memo"
  );
}

export const MemosView: React.FC<MemosViewProps> = ({
  workspace,
  onUpdate,
  selectedMemoId,
  onSelectMemo,
  onNotify,
}) => {
  const memos = workspace.memos ?? [];
  const folders = workspace.memoFolders ?? [];

  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [editorMode, setEditorMode] = useState<EditorMode>(getInitialEditorMode);
  const [sidebarMode, setSidebarMode] = useState<SidebarViewMode>(
    getInitialSidebarMode
  );
  const [visibleTimelineCount, setVisibleTimelineCount] =
    useState<number>(TIMELINE_BATCH_SIZE);
  const sidebarScrollRef = useRef<HTMLDivElement>(null);
  const timelineSentinelRef = useRef<HTMLDivElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<MemoItem | null>(null);
  const [savingImage, setSavingImage] = useState(false);
  const [editorDragOver, setEditorDragOver] = useState(false);
  const [openMenu, setOpenMenu] = useState<{
    kind: "filterTag" | "memoTag" | "memoMore" | "heading" | "insert";
    left: number;
    top: number;
  } | null>(null);
  const [customTagInput, setCustomTagInput] = useState("");
  const [editingExpiry, setEditingExpiry] = useState(false);
  const [toolbarTip, setToolbarTip] = useState<{
    label: string;
    kbd?: string;
    x: number;
    y: number;
  } | null>(null);
  const [historyRev, setHistoryRev] = useState(0);
  const historyMapRef = useRef<Map<string, MemoHistoryState>>(new Map());
  const expiryInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<MarkdownPreviewHandle>(null);
  const editorBackdropRef = useRef<HTMLDivElement>(null);

  // Bidirectional highlight & active editing surface ("editor" vs "preview")
  const [activePane, setActivePane] = useState<"editor" | "preview">(() =>
    getInitialEditorMode() === "preview" ? "preview" : "editor"
  );
  const [activeLineRange, setActiveLineRange] = useState<LineRange | null>(
    null
  );
  const [hoveredLineRange, setHoveredLineRange] = useState<LineRange | null>(
    null
  );

  // Resizable pane state (left sidebar width & editor/preview split ratio)
  const [isMdUp, setIsMdUp] = useState(() =>
    typeof window === "undefined" ? true : window.innerWidth >= 768
  );
  const [sidebarWidth, setSidebarWidth] = useState<number>(getInitialSidebarWidth);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const [splitRatio, setSplitRatio] = useState<number>(getInitialSplitRatio);
  const [resizingSplit, setResizingSplit] = useState(false);

  // Folder grouping state
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renamingFolderName, setRenamingFolderName] = useState("");
  const [ungroupedCollapsed, setUngroupedCollapsed] = useState(false);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [draggingMemoId, setDraggingMemoId] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  const renameFolderInputRef = useRef<HTMLInputElement>(null);
  const workspaceSplitRef = useRef<HTMLDivElement>(null);
  const editorSplitRef = useRef<HTMLDivElement>(null);

  const updateSidebarWidth = useCallback((next: number) => {
    const clamped = Math.round(
      Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, next))
    );
    setSidebarWidth(clamped);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clamped));
    }
  }, []);

  const updateSplitRatio = useCallback((next: number) => {
    const clamped = Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, next));
    setSplitRatio(clamped);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SPLIT_RATIO_KEY, clamped.toFixed(4));
    }
  }, []);

  useEffect(() => {
    const onResize = () => setIsMdUp(window.innerWidth >= 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!openMenu) return;
    const close = () => setOpenMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [openMenu]);

  const toggleAnchoredMenu = (
    kind: "filterTag" | "memoTag" | "memoMore" | "heading" | "insert",
    el: HTMLElement,
    menuWidth = 184,
    alignRight = false
  ) => {
    setToolbarTip(null);
    if (openMenu?.kind === kind) {
      setOpenMenu(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    const rawLeft = alignRight ? rect.right - menuWidth : rect.left;
    const left = Math.max(12, Math.min(rawLeft, window.innerWidth - menuWidth - 12));
    const top = Math.min(rect.bottom + 5, window.innerHeight - 240);
    setOpenMenu({ kind, left, top });
  };

  useEffect(() => {
    if (!resizingSidebar && !resizingSplit) return;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (e: MouseEvent) => {
      if (resizingSidebar && workspaceSplitRef.current) {
        const rect = workspaceSplitRef.current.getBoundingClientRect();
        const maxAllowed = Math.max(
          MIN_SIDEBAR_WIDTH,
          Math.min(MAX_SIDEBAR_WIDTH, rect.width - 320)
        );
        const raw = e.clientX - rect.left;
        updateSidebarWidth(Math.min(maxAllowed, Math.max(MIN_SIDEBAR_WIDTH, raw)));
      } else if (resizingSplit && editorSplitRef.current) {
        const rect = editorSplitRef.current.getBoundingClientRect();
        if (rect.width > 0) {
          const ratio = (e.clientX - rect.left) / rect.width;
          updateSplitRatio(ratio);
        }
      }
    };

    const stopResize = () => {
      setResizingSidebar(false);
      setResizingSplit(false);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", stopResize);
    window.addEventListener("blur", stopResize);
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", stopResize);
      window.removeEventListener("blur", stopResize);
    };
  }, [resizingSidebar, resizingSplit, updateSidebarWidth, updateSplitRatio]);

  const changeEditorMode = (next: EditorMode) => {
    setEditorMode(next);
    if (next === "preview") setActivePane("preview");
    else if (next === "edit") setActivePane("editor");
    if (typeof window !== "undefined") {
      window.localStorage.setItem(EDITOR_MODE_KEY, next);
    }
  };

  const changeSidebarMode = (next: SidebarViewMode) => {
    setSidebarMode(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SIDEBAR_MODE_KEY, next);
    }
  };

  // Focus search on `/` or `Ctrl+F` when not typing in an editable control
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const active = document.activeElement;
        if (
          active &&
          (active.tagName === "INPUT" ||
            active.tagName === "TEXTAREA" ||
            active.tagName === "SELECT" ||
            (active as HTMLElement).isContentEditable)
        ) {
          return;
        }
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const folderIdSet = useMemo(
    () => new Set(folders.map((f) => f.id)),
    [folders]
  );

  const folderNameMap = useMemo(
    () => new Map(folders.map((f) => [f.id, f.name])),
    [folders]
  );

  const allTags = useMemo(() => {
    const seen = new Set<string>(PRESET_MEMO_TAGS);
    memos.forEach((m) => {
      const tag = m.tag.trim();
      if (tag) seen.add(tag);
    });
    return Array.from(seen);
  }, [memos]);

  const expiringCount = useMemo(
    () =>
      memos.filter((m) => {
        const d = getDaysUntilExpiry(m.expiresAt);
        return d !== null && d <= EXPIRY_SOON_DAYS;
      }).length,
    [memos]
  );

  const isFiltering = Boolean(query.trim()) || filter !== "all";

  const filteredMemos = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = memos.filter((m) => {
      if (filter === "expiring") {
        const d = getDaysUntilExpiry(m.expiresAt);
        if (d === null || d > EXPIRY_SOON_DAYS) return false;
      } else if (filter !== "all") {
        if (m.tag.trim() !== filter) return false;
      }

      if (!q) return true;
      const folderName = m.folderId ? folderNameMap.get(m.folderId) ?? "" : "";
      const hay = `${m.title} ${m.tag} ${folderName} ${m.content} ${
        m.expiresAt ?? ""
      } ${m.dailyDate ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
    return sortMemos(list);
  }, [memos, filter, query, folderNameMap]);

  const { groupedByFolder, ungroupedMemos } = useMemo(() => {
    const grouped = new Map<string, MemoItem[]>();
    const ungrouped: MemoItem[] = [];
    filteredMemos.forEach((m) => {
      if (m.folderId && folderIdSet.has(m.folderId)) {
        const arr = grouped.get(m.folderId) ?? [];
        arr.push(m);
        grouped.set(m.folderId, arr);
      } else {
        ungrouped.push(m);
      }
    });
    return { groupedByFolder: grouped, ungroupedMemos: ungrouped };
  }, [filteredMemos, folderIdSet]);

  // Chronological timeline memos + lazy-loaded date groups
  const timelineSortedMemos = useMemo(() => {
    return [...filteredMemos].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
  }, [filteredMemos]);

  const timelineGroups = useMemo(() => {
    const slice = timelineSortedMemos.slice(0, visibleTimelineCount);
    const map = new Map<string, MemoItem[]>();
    slice.forEach((m) => {
      const key = getLocalDateKeyFromIso(m.updatedAt || m.createdAt);
      const arr = map.get(key) ?? [];
      arr.push(m);
      map.set(key, arr);
    });
    return Array.from(map.entries()).map(([dateKey, items]) => ({
      dateKey,
      label: formatTimelineDateLabel(dateKey),
      items,
    }));
  }, [timelineSortedMemos, visibleTimelineCount]);

  // Reset lazy-load window when filter / search / sidebar view changes
  useEffect(() => {
    setVisibleTimelineCount(TIMELINE_BATCH_SIZE);
  }, [query, filter, sidebarMode]);

  // Ensure selected memo (e.g. from Ctrl+K or Calendar) is within loaded timeline window
  useEffect(() => {
    if (sidebarMode !== "timeline" || !selectedMemoId) return;
    const idx = timelineSortedMemos.findIndex((m) => m.id === selectedMemoId);
    if (idx >= visibleTimelineCount) {
      setVisibleTimelineCount(idx + TIMELINE_BATCH_SIZE);
    }
  }, [sidebarMode, selectedMemoId, timelineSortedMemos, visibleTimelineCount]);

  // IntersectionObserver for automatic lazy loading in timeline view
  useEffect(() => {
    if (
      sidebarMode !== "timeline" ||
      visibleTimelineCount >= timelineSortedMemos.length
    ) {
      return;
    }
    const sentinel = timelineSentinelRef.current;
    const scrollRoot = sidebarScrollRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleTimelineCount((prev) =>
            Math.min(prev + TIMELINE_BATCH_SIZE, timelineSortedMemos.length)
          );
        }
      },
      { root: scrollRoot, rootMargin: "160px 0px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sidebarMode, visibleTimelineCount, timelineSortedMemos.length]);

  const activeMemo = useMemo(() => {
    if (selectedMemoId) {
      const found = memos.find((m) => m.id === selectedMemoId);
      if (found) return found;
    }
    return filteredMemos[0] ?? null;
  }, [memos, selectedMemoId, filteredMemos]);

  useEffect(() => {
    setActiveLineRange(null);
    setHoveredLineRange(null);
    setEditingExpiry(false);
    setOpenMenu(null);
  }, [activeMemo?.id]);

  // Keep textarea mirror backdrop width & scroll synced for pixel-accurate line highlight
  useEffect(() => {
    const ta = textareaRef.current;
    const bd = editorBackdropRef.current;
    if (!ta || !bd) return;
    const syncLayout = () => {
      bd.style.width = `${ta.clientWidth}px`;
      bd.scrollTop = ta.scrollTop;
    };
    syncLayout();
    const ro = new ResizeObserver(syncLayout);
    ro.observe(ta);
    return () => ro.disconnect();
  }, [editorMode, activeMemo?.id, splitRatio, sidebarWidth]);

  // Scroll left textarea to reveal line highlighted from Preview without stealing focus
  useEffect(() => {
    if (editorMode !== "split" || activePane !== "preview" || !activeLineRange) {
      return;
    }
    const ta = textareaRef.current;
    const bd = editorBackdropRef.current;
    if (!ta || !bd) return;
    const lineEl = bd.querySelector<HTMLElement>(
      `[data-editor-line="${activeLineRange.startLine}"]`
    );
    if (!lineEl) return;
    const top = lineEl.offsetTop;
    const bottom = top + lineEl.offsetHeight;
    const viewTop = ta.scrollTop;
    const viewBottom = viewTop + ta.clientHeight;
    if (top < viewTop + 24) {
      ta.scrollTo({ top: Math.max(0, top - 36), behavior: "smooth" });
    } else if (bottom > viewBottom - 24) {
      ta.scrollTo({
        top: Math.max(0, bottom - ta.clientHeight + 48),
        behavior: "smooth",
      });
    }
  }, [editorMode, activePane, activeLineRange?.startLine, activeLineRange?.endLine]);

  const syncEditorSelectionRange = useCallback(
    (ta: HTMLTextAreaElement, textOverride?: string) => {
      const txt = textOverride ?? ta.value;
      const range = computeLineRangeFromOffsets(
        txt,
        ta.selectionStart ?? 0,
        ta.selectionEnd ?? 0
      );
      setActivePane("editor");
      setActiveLineRange(range);
    },
    []
  );

  // Folder CRUD helpers
  const startCreateFolder = () => {
    setCreatingFolder(true);
    setNewFolderName("");
    setTimeout(() => newFolderInputRef.current?.focus(), 20);
  };

  const handleCreateFolder = () => {
    const name = newFolderName.trim();
    if (!name) {
      setCreatingFolder(false);
      setNewFolderName("");
      return;
    }
    const newFolder: MemoFolder = {
      id: uid("mfolder"),
      name,
      collapsed: false,
      createdAt: new Date().toISOString(),
    };
    onUpdate({
      ...workspace,
      memoFolders: [...folders, newFolder],
    });
    setCreatingFolder(false);
    setNewFolderName("");
    onNotify(`已新建文件夹「${name}」`);
  };

  const toggleFolderCollapsed = (folderId: string) => {
    onUpdate({
      ...workspace,
      memoFolders: folders.map((f) =>
        f.id === folderId ? { ...f, collapsed: !f.collapsed } : f
      ),
    });
  };

  const startRenameFolder = (folder: MemoFolder) => {
    setRenamingFolderId(folder.id);
    setRenamingFolderName(folder.name);
    setTimeout(() => {
      renameFolderInputRef.current?.focus();
      renameFolderInputRef.current?.select();
    }, 20);
  };

  const handleCommitRenameFolder = () => {
    if (!renamingFolderId) return;
    const trimmed = renamingFolderName.trim();
    if (trimmed) {
      onUpdate({
        ...workspace,
        memoFolders: folders.map((f) =>
          f.id === renamingFolderId ? { ...f, name: trimmed } : f
        ),
      });
    }
    setRenamingFolderId(null);
    setRenamingFolderName("");
  };

  const handleDeleteFolder = (folderId: string) => {
    const now = new Date().toISOString();
    onUpdate({
      ...workspace,
      memoFolders: folders.filter((f) => f.id !== folderId),
      memos: memos.map((m) =>
        m.folderId === folderId
          ? { ...m, folderId: undefined, updatedAt: now }
          : m
      ),
    });
    onNotify("已删除文件夹，其中备忘已移至未分组");
  };

  const moveMemoToFolder = (
    memoId: string,
    targetFolderId: string | undefined
  ) => {
    const memo = memos.find((m) => m.id === memoId);
    if (!memo) return;
    const currentFolderId =
      memo.folderId && folderIdSet.has(memo.folderId)
        ? memo.folderId
        : undefined;
    if (currentFolderId === targetFolderId) return;

    const now = new Date().toISOString();
    onUpdate({
      ...workspace,
      memos: memos.map((m) =>
        m.id === memoId
          ? { ...m, folderId: targetFolderId, updatedAt: now }
          : m
      ),
      memoFolders: targetFolderId
        ? folders.map((f) =>
            f.id === targetFolderId && f.collapsed
              ? { ...f, collapsed: false }
              : f
          )
        : folders,
    });
    if (targetFolderId) {
      const targetName = folderNameMap.get(targetFolderId) ?? "文件夹";
      onNotify(`已移动到「${targetName}」`);
    } else {
      onNotify("已移至未分组");
    }
  };

  const createMemo = (
    presetTag?: string,
    presetRenewDays?: number,
    folderId?: string
  ) => {
    const now = new Date().toISOString();
    const activeFilterTag =
      filter !== "all" && filter !== "expiring" ? filter : "软件";
    const resolvedFolderId =
      folderId && folderIdSet.has(folderId) ? folderId : undefined;
    const newMemo: MemoItem = {
      id: uid("memo"),
      title: "",
      tag: presetTag ?? activeFilterTag,
      folderId: resolvedFolderId,
      renewDays: presetRenewDays,
      content: "",
      createdAt: now,
      updatedAt: now,
    };
    onUpdate({
      ...workspace,
      memos: [newMemo, ...memos],
      memoFolders: resolvedFolderId
        ? folders.map((f) =>
            f.id === resolvedFolderId && f.collapsed
              ? { ...f, collapsed: false }
              : f
          )
        : folders,
    });
    onSelectMemo(newMemo.id);
    if (editorMode === "preview") {
      changeEditorMode("edit");
    }
    if (
      filter === "expiring" ||
      (filter !== "all" && filter !== newMemo.tag)
    ) {
      setFilter("all");
    }
    setTimeout(() => {
      titleInputRef.current?.focus();
    }, 20);
  };

  const openOrCreateTodayNote = () => {
    const todayKey = getTodayDateKey();
    const existing = memos.find(
      (m) =>
        m.dailyDate === todayKey ||
        (m.tag.trim() === "笔记" && m.title.startsWith(todayKey))
    );

    if (existing) {
      onSelectMemo(existing.id);
      if (
        filter === "expiring" ||
        (filter !== "all" && filter !== existing.tag.trim())
      ) {
        setFilter("all");
      }
      if (query) setQuery("");
      onNotify("已打开今日笔记");
      return;
    }

    const now = new Date().toISOString();
    const dailyMemo: MemoItem = {
      id: uid("memo"),
      title: formatDailyNoteTitle(todayKey),
      tag: "笔记",
      dailyDate: todayKey,
      content: DAILY_NOTE_TEMPLATE,
      createdAt: now,
      updatedAt: now,
    };
    onUpdate({
      ...workspace,
      memos: [dailyMemo, ...memos],
    });
    onSelectMemo(dailyMemo.id);
    if (filter === "expiring" || (filter !== "all" && filter !== "笔记")) {
      setFilter("all");
    }
    if (query) setQuery("");
    if (editorMode === "preview") {
      changeEditorMode(
        typeof window !== "undefined" && window.innerWidth >= 1100
          ? "split"
          : "edit"
      );
    }
    setTimeout(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        const marker = "- [ ] ";
        const idx = DAILY_NOTE_TEMPLATE.indexOf(marker);
        if (idx >= 0) {
          const pos = idx + marker.length;
          ta.setSelectionRange(pos, pos);
        }
      }
    }, 25);
    onNotify("已创建今日笔记");
  };

  const patchMemo = (id: string, patch: Partial<MemoItem>) => {
    const now = new Date().toISOString();
    onUpdate({
      ...workspace,
      memos: memos.map((m) =>
        m.id === id ? { ...m, ...patch, updatedAt: now } : m
      ),
    });
  };

  const handleRenewMemo = (memo: MemoItem) => {
    if (!memo.expiresAt) return;
    const days = memo.renewDays || 365;
    const nextDate = computeRenewedDate(memo.expiresAt, days);
    patchMemo(memo.id, { expiresAt: nextDate });
    onNotify(`已续期至 ${nextDate}`);
  };

  const handleCopyMemo = (memo: MemoItem) => {
    const text = memo.title.trim()
      ? `# ${memo.title.trim()}\n\n${memo.content}`
      : memo.content;
    navigator.clipboard.writeText(text).catch(() => {});
    onNotify("已复制备忘内容");
  };

  const handleExportMarkdown = (memo: MemoItem) => {
    const heading = memo.title.trim() || "未命名备忘";
    const metaLines: string[] = [];
    if (memo.tag.trim()) metaLines.push(`标签: ${memo.tag.trim()}`);
    if (memo.dailyDate) metaLines.push(`日期: ${memo.dailyDate}`);
    if (memo.expiresAt) metaLines.push(`到期日: ${memo.expiresAt}`);
    const metaBlock =
      metaLines.length > 0 ? `> ${metaLines.join(" · ")}\n\n` : "";
    const md = `# ${heading}\n\n${metaBlock}${memo.content}`;

    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sanitizeFilename(heading)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    onNotify("已导出 Markdown 文件");
  };

  const handleConfirmDelete = () => {
    if (!deleteTarget) return;
    const nextMemos = memos.filter((m) => m.id !== deleteTarget.id);
    onUpdate({
      ...workspace,
      memos: nextMemos,
    });
    if (selectedMemoId === deleteTarget.id) {
      onSelectMemo(nextMemos[0]?.id ?? null);
    }
    setDeleteTarget(null);
    onNotify("已删除备忘");
  };

  // Per-memo undo/redo content helper
  const ensureMemoHistory = useCallback(
    (memo: MemoItem): MemoHistoryState => {
      let st = historyMapRef.current.get(memo.id);
      if (!st) {
        st = {
          stack: [
            {
              content: memo.content,
              selStart: memo.content.length,
              selEnd: memo.content.length,
            },
          ],
          index: 0,
          lastPushAt: 0,
        };
        historyMapRef.current.set(memo.id, st);
      }
      return st;
    },
    []
  );

  const commitMemoContent = useCallback(
    (
      memo: MemoItem,
      nextContent: string,
      opts?: {
        selStart?: number;
        selEnd?: number;
        coalesce?: boolean;
        focusEditor?: boolean;
      }
    ) => {
      const st = ensureMemoHistory(memo);
      const curEntry = st.stack[st.index];
      // Sync baseline if external change modified memo.content outside editor
      if (curEntry && curEntry.content !== memo.content) {
        st.stack = st.stack.slice(0, st.index + 1);
        st.stack.push({
          content: memo.content,
          selStart: memo.content.length,
          selEnd: memo.content.length,
        });
        st.index = st.stack.length - 1;
      }

      const selStart = opts?.selStart ?? nextContent.length;
      const selEnd = opts?.selEnd ?? selStart;
      const nowMs = Date.now();

      if (
        opts?.coalesce &&
        st.index > 0 &&
        nowMs - st.lastPushAt < 650 &&
        Math.abs(nextContent.length - st.stack[st.index].content.length) <= 4 &&
        !nextContent.slice(Math.max(0, selStart - 1), selStart).includes("\n")
      ) {
        st.stack[st.index] = { content: nextContent, selStart, selEnd };
      } else {
        st.stack = st.stack.slice(0, st.index + 1);
        st.stack.push({ content: nextContent, selStart, selEnd });
        if (st.stack.length > MAX_HISTORY_ENTRIES) {
          st.stack.shift();
        }
        st.index = st.stack.length - 1;
      }
      st.lastPushAt = opts?.coalesce ? nowMs : 0;
      setHistoryRev((r) => r + 1);

      const nowIso = new Date().toISOString();
      const latestWs = workspaceRef.current;
      onUpdateRef.current({
        ...latestWs,
        memos: (latestWs.memos ?? []).map((m) =>
          m.id === memo.id
            ? { ...m, content: nextContent, updatedAt: nowIso }
            : m
        ),
      });

      if (opts?.focusEditor) {
        window.requestAnimationFrame(() => {
          const ta = textareaRef.current;
          if (ta) {
            ta.focus();
            ta.setSelectionRange(selStart, selEnd);
          }
        });
      }
    },
    [ensureMemoHistory]
  );

  const canUndo = useMemo(() => {
    void historyRev;
    if (!activeMemo) return false;
    const st = historyMapRef.current.get(activeMemo.id);
    return Boolean(st && st.index > 0);
  }, [activeMemo, historyRev]);

  const canRedo = useMemo(() => {
    void historyRev;
    if (!activeMemo) return false;
    const st = historyMapRef.current.get(activeMemo.id);
    return Boolean(st && st.index < st.stack.length - 1);
  }, [activeMemo, historyRev]);

  const isPreviewTarget =
    editorMode === "preview" ||
    (editorMode === "split" && activePane === "preview");

  const handleUndo = useCallback(() => {
    if (!activeMemo) return;
    const st = historyMapRef.current.get(activeMemo.id);
    if (!st || st.index <= 0) return;
    st.index -= 1;
    st.lastPushAt = 0;
    const target = st.stack[st.index];
    setHistoryRev((r) => r + 1);
    patchMemo(activeMemo.id, { content: target.content });
    const range = computeLineRangeFromOffsets(
      target.content,
      target.selStart,
      target.selEnd
    );
    setActiveLineRange(range);
    if (!isPreviewTarget) {
      window.requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.focus();
          const s = Math.min(target.selStart, target.content.length);
          const e = Math.min(target.selEnd, target.content.length);
          ta.setSelectionRange(s, e);
        }
      });
    }
  }, [activeMemo, isPreviewTarget]);

  const handleRedo = useCallback(() => {
    if (!activeMemo) return;
    const st = historyMapRef.current.get(activeMemo.id);
    if (!st || st.index >= st.stack.length - 1) return;
    st.index += 1;
    st.lastPushAt = 0;
    const target = st.stack[st.index];
    setHistoryRev((r) => r + 1);
    patchMemo(activeMemo.id, { content: target.content });
    const range = computeLineRangeFromOffsets(
      target.content,
      target.selStart,
      target.selEnd
    );
    setActiveLineRange(range);
    if (!isPreviewTarget) {
      window.requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.focus();
          const s = Math.min(target.selStart, target.content.length);
          const e = Math.min(target.selEnd, target.content.length);
          ta.setSelectionRange(s, e);
        }
      });
    }
  }, [activeMemo, isPreviewTarget]);

  const handlePreviewReplaceLines = useCallback(
    (
      startLine: number,
      endLine: number,
      nextLinesText: string,
      opts?: {
        coalesce?: boolean;
        nextFocusLine?: number;
        focusAtStart?: boolean;
      }
    ) => {
      const latestWs = workspaceRef.current;
      const memo = (latestWs.memos ?? []).find((m) => m.id === activeMemo?.id);
      if (!memo) return;
      const lines = memo.content.replace(/\r\n?/g, "\n").split("\n");
      const safeStart = Math.max(0, Math.min(startLine, lines.length - 1));
      const safeEnd = Math.max(safeStart, Math.min(endLine, lines.length - 1));
      const replacementLines = nextLinesText.replace(/\r\n?/g, "\n").split("\n");
      const nextLines = [
        ...lines.slice(0, safeStart),
        ...replacementLines,
        ...lines.slice(safeEnd + 1),
      ];
      const nextContent = nextLines.join("\n");
      const newEndLine = safeStart + Math.max(0, replacementLines.length - 1);
      const { blockEnd } = lineRangeToCharOffsets(
        nextContent,
        safeStart,
        newEndLine
      );
      commitMemoContent(memo, nextContent, {
        selStart: blockEnd,
        selEnd: blockEnd,
        coalesce: opts?.coalesce,
      });
      const nextRange =
        opts?.nextFocusLine !== undefined
          ? { startLine: opts.nextFocusLine, endLine: opts.nextFocusLine }
          : { startLine: safeStart, endLine: newEndLine };
      setActivePane("preview");
      setActiveLineRange(nextRange);
    },
    [activeMemo?.id, commitMemoContent]
  );

  const getTargetCharSpan = (
    value: string
  ): { start: number; end: number; targetLine: number } => {
    if (!isPreviewTarget && textareaRef.current) {
      const s = textareaRef.current.selectionStart ?? value.length;
      const e = textareaRef.current.selectionEnd ?? s;
      const r = computeLineRangeFromOffsets(value, s, e);
      return { start: s, end: e, targetLine: r.startLine };
    }
    const lines = value.replace(/\r\n?/g, "\n").split("\n");
    const r = activeLineRange ?? {
      startLine: Math.max(0, lines.length - 1),
      endLine: Math.max(0, lines.length - 1),
    };
    const { blockStart, blockEnd } = lineRangeToCharOffsets(
      value,
      r.startLine,
      r.endLine
    );
    return { start: blockStart, end: blockEnd, targetLine: r.startLine };
  };

  // Markdown formatting insertion helpers (work seamlessly in both Editor & Preview)
  const applyWrapOrInsert = (
    prefix: string,
    suffix = "",
    placeholder = ""
  ) => {
    if (!activeMemo) return;
    if (isPreviewTarget) {
      if (previewRef.current?.applyInlineWrap(prefix, suffix, placeholder)) {
        return;
      }
      const value = activeMemo.content;
      const lines = value.replace(/\r\n?/g, "\n").split("\n");
      const targetIdx = Math.min(
        activeLineRange?.endLine ?? Math.max(0, lines.length - 1),
        lines.length - 1
      );
      const snippet = `${prefix}${placeholder}${suffix}`;
      lines[targetIdx] = lines[targetIdx]
        ? `${lines[targetIdx]} ${snippet}`
        : snippet;
      const next = lines.join("\n");
      commitMemoContent(activeMemo, next);
      setActivePane("preview");
      setActiveLineRange({ startLine: targetIdx, endLine: targetIdx });
      window.requestAnimationFrame(() =>
        previewRef.current?.focusLine(targetIdx)
      );
      return;
    }

    const ta = textareaRef.current;
    const value = activeMemo.content;
    if (!ta) {
      const next = value + prefix + placeholder + suffix;
      commitMemoContent(activeMemo, next);
      return;
    }

    const start = ta.selectionStart ?? value.length;
    const end = ta.selectionEnd ?? value.length;
    const selected = value.slice(start, end);

    if (
      suffix &&
      start >= prefix.length &&
      value.slice(start - prefix.length, start) === prefix &&
      value.slice(end, end + suffix.length) === suffix
    ) {
      const next =
        value.slice(0, start - prefix.length) +
        selected +
        value.slice(end + suffix.length);
      const nextStart = start - prefix.length;
      const nextEnd = nextStart + selected.length;
      commitMemoContent(activeMemo, next, {
        selStart: nextStart,
        selEnd: nextEnd,
        focusEditor: true,
      });
      setActiveLineRange(
        computeLineRangeFromOffsets(next, nextStart, nextEnd)
      );
      return;
    }

    if (
      suffix &&
      selected.length >= prefix.length + suffix.length &&
      selected.startsWith(prefix) &&
      selected.endsWith(suffix)
    ) {
      const unwrapped = selected.slice(
        prefix.length,
        selected.length - suffix.length
      );
      const next = value.slice(0, start) + unwrapped + value.slice(end);
      commitMemoContent(activeMemo, next, {
        selStart: start,
        selEnd: start + unwrapped.length,
        focusEditor: true,
      });
      setActiveLineRange(
        computeLineRangeFromOffsets(next, start, start + unwrapped.length)
      );
      return;
    }

    const inner = selected || placeholder;
    const next =
      value.slice(0, start) + prefix + inner + suffix + value.slice(end);
    const selStart = start + prefix.length;
    const selEnd = selStart + inner.length;
    commitMemoContent(activeMemo, next, {
      selStart,
      selEnd,
      focusEditor: true,
    });
    setActiveLineRange(computeLineRangeFromOffsets(next, selStart, selEnd));
  };

  const insertCodeBlock = () => {
    if (!activeMemo) return;
    if (isPreviewTarget) {
      const value = activeMemo.content.replace(/\r\n?/g, "\n");
      const lines = value.split("\n");
      const afterLine = Math.min(
        activeLineRange?.endLine ?? lines.length - 1,
        lines.length - 1
      );
      const { blockEnd } = lineRangeToCharOffsets(value, afterLine, afterLine);
      const lead = blockEnd > 0 && value[blockEnd - 1] !== "\n" ? "\n" : "";
      const snippet = `${lead}\`\`\`\n# 命令或配置\n\`\`\`\n`;
      const next = value.slice(0, blockEnd) + snippet + value.slice(blockEnd);
      const codeStartLine = afterLine + (lead ? 1 : 0);
      commitMemoContent(activeMemo, next);
      setActivePane("preview");
      setActiveLineRange({
        startLine: codeStartLine,
        endLine: codeStartLine + 2,
      });
      return;
    }
    applyWrapOrInsert("```\n", "\n```", "# 命令或配置");
  };

  const applyHeading = (level: 1 | 2 | 3 | 4) => {
    if (!activeMemo) return;
    const targetPrefix = `${"#".repeat(level)} `;
    const value = activeMemo.content.replace(/\r\n?/g, "\n");
    const { start, end, targetLine } = getTargetCharSpan(value);

    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const lineEndIdx = value.indexOf("\n", lineStart);
    const line =
      lineEndIdx === -1
        ? value.slice(lineStart)
        : value.slice(lineStart, lineEndIdx);

    // Strip list/quote marker too when converting a preview block into a heading
    const existingHeading = /^(#{1,6}\s+)+/.exec(line);
    const existingListOrQuote =
      !existingHeading && isPreviewTarget
        ? /^(\s*(?:[-*+]\s+\[[ xX]\]\s*|[-*+]\s+|\d+\.\s+|>\s?))/.exec(line)
        : null;
    const oldPrefix = existingHeading
      ? existingHeading[0]
      : existingListOrQuote
      ? existingListOrQuote[0]
      : "";
    const newPrefix =
      existingHeading && existingHeading[0] === targetPrefix
        ? ""
        : targetPrefix;

    const next =
      value.slice(0, lineStart) +
      newPrefix +
      value.slice(lineStart + oldPrefix.length);
    const delta = newPrefix.length - oldPrefix.length;
    const nextStart = Math.max(lineStart, start + delta);
    const nextEnd = Math.max(lineStart, end + delta);
    commitMemoContent(activeMemo, next, {
      selStart: nextStart,
      selEnd: nextEnd,
      focusEditor: !isPreviewTarget,
    });
    setActiveLineRange({ startLine: targetLine, endLine: targetLine });
    if (isPreviewTarget) {
      window.requestAnimationFrame(() =>
        previewRef.current?.focusLine(targetLine)
      );
    }
  };

  const applyLinePrefix = (prefix: "- " | "- [ ] " | "> ") => {
    if (!activeMemo) return;
    const value = activeMemo.content.replace(/\r\n?/g, "\n");
    const { start, end, targetLine } = getTargetCharSpan(value);

    const effectiveEnd = end > start && value[end - 1] === "\n" ? end - 1 : end;
    const blockStart = value.lastIndexOf("\n", start - 1) + 1;
    const blockEndIdx = value.indexOf("\n", effectiveEnd);
    const blockEnd = blockEndIdx === -1 ? value.length : blockEndIdx;
    const rawLines = value.slice(blockStart, blockEnd).split("\n");

    const allHaveTarget = rawLines.every((l) =>
      prefix === "- [ ] "
        ? /^\s*[-*+]\s+\[[ xX]\]\s*/.test(l)
        : prefix === "- "
        ? /^\s*[-*+]\s+(?!\[[ xX]\])/.test(l)
        : /^\s*>\s?/.test(l)
    );

    let firstDelta = 0;
    let totalDelta = 0;
    const transformed = rawLines.map((line, idx) => {
      let nextLine = line;
      if (allHaveTarget) {
        if (prefix === "- [ ] ") {
          nextLine = line.replace(/^(\s*)[-*+]\s+\[[ xX]\]\s*/, "$1");
        } else if (prefix === "- ") {
          nextLine = line.replace(/^(\s*)[-*+]\s+/, "$1");
        } else {
          nextLine = line.replace(/^(\s*)>\s?/, "$1");
        }
      } else {
        const cleanHeading =
          prefix !== "> " ? line.replace(/^#{1,6}\s+/, "") : line;
        if (prefix === "- [ ] ") {
          if (/^(\s*)[-*+]\s+\[[ xX]\]\s*/.test(cleanHeading)) {
            nextLine = cleanHeading;
          } else if (/^(\s*)(?:[-*+]\s+|\d+\.\s+)/.test(cleanHeading)) {
            nextLine = cleanHeading.replace(
              /^(\s*)(?:[-*+]\s+|\d+\.\s+)/,
              "$1- [ ] "
            );
          } else {
            nextLine = cleanHeading.replace(/^(\s*)/, "$1- [ ] ");
          }
        } else if (prefix === "- ") {
          if (/^(\s*)[-*+]\s+\[[ xX]\]\s*/.test(cleanHeading)) {
            nextLine = cleanHeading.replace(
              /^(\s*)[-*+]\s+\[[ xX]\]\s*/,
              "$1- "
            );
          } else if (/^(\s*)\d+\.\s+/.test(cleanHeading)) {
            nextLine = cleanHeading.replace(/^(\s*)\d+\.\s+/, "$1- ");
          } else if (!/^(\s*)[-*+]\s+/.test(cleanHeading)) {
            nextLine = cleanHeading.replace(/^(\s*)/, "$1- ");
          } else {
            nextLine = cleanHeading;
          }
        } else {
          nextLine = `> ${cleanHeading}`;
        }
      }
      const d = nextLine.length - line.length;
      if (idx === 0) firstDelta = d;
      totalDelta += d;
      return nextLine;
    });

    const next =
      value.slice(0, blockStart) +
      transformed.join("\n") +
      value.slice(blockEnd);
    const nextStart = Math.max(blockStart, start + firstDelta);
    const nextEnd =
      start === end ? nextStart : Math.max(nextStart, end + totalDelta);
    commitMemoContent(activeMemo, next, {
      selStart: nextStart,
      selEnd: nextEnd,
      focusEditor: !isPreviewTarget,
    });
    if (isPreviewTarget) {
      window.requestAnimationFrame(() =>
        previewRef.current?.focusLine(targetLine)
      );
    }
  };

  const applyOrderedList = () => {
    if (!activeMemo) return;
    const value = activeMemo.content.replace(/\r\n?/g, "\n");
    const { start, end, targetLine } = getTargetCharSpan(value);

    const effectiveEnd = end > start && value[end - 1] === "\n" ? end - 1 : end;
    const blockStart = value.lastIndexOf("\n", start - 1) + 1;
    const blockEndIdx = value.indexOf("\n", effectiveEnd);
    const blockEnd = blockEndIdx === -1 ? value.length : blockEndIdx;
    const rawLines = value.slice(blockStart, blockEnd).split("\n");

    const allOrdered = rawLines.every((l) => /^\s*\d+\.\s+/.test(l));
    let firstDelta = 0;
    let totalDelta = 0;
    let num = 1;

    const transformed = rawLines.map((line, idx) => {
      let nextLine: string;
      if (allOrdered) {
        nextLine = line.replace(/^(\s*)\d+\.\s+/, "$1");
      } else if (rawLines.length > 1 && !line.trim()) {
        nextLine = line;
      } else {
        const cleanHeading = line.replace(/^#{1,6}\s+/, "");
        const prefixNum = `${num++}. `;
        if (
          /^(\s*)(?:[-*+]\s+\[[ xX]\]\s*|[-*+]\s+|\d+\.\s+)/.test(cleanHeading)
        ) {
          nextLine = cleanHeading.replace(
            /^(\s*)(?:[-*+]\s+\[[ xX]\]\s*|[-*+]\s+|\d+\.\s+)/,
            `$1${prefixNum}`
          );
        } else {
          nextLine = cleanHeading.replace(/^(\s*)/, `$1${prefixNum}`);
        }
      }
      const d = nextLine.length - line.length;
      if (idx === 0) firstDelta = d;
      totalDelta += d;
      return nextLine;
    });

    const next =
      value.slice(0, blockStart) +
      transformed.join("\n") +
      value.slice(blockEnd);
    const nextStart = Math.max(blockStart, start + firstDelta);
    const nextEnd =
      start === end ? nextStart : Math.max(nextStart, end + totalDelta);
    commitMemoContent(activeMemo, next, {
      selStart: nextStart,
      selEnd: nextEnd,
      focusEditor: !isPreviewTarget,
    });
    if (isPreviewTarget) {
      window.requestAnimationFrame(() =>
        previewRef.current?.focusLine(targetLine)
      );
    }
  };

  const adjustLineIndent = (direction: 1 | -1, explicitRange?: LineRange) => {
    if (!activeMemo) return;
    const value = activeMemo.content.replace(/\r\n?/g, "\n");
    const span = explicitRange
      ? (() => {
          const { blockStart, blockEnd } = lineRangeToCharOffsets(
            value,
            explicitRange.startLine,
            explicitRange.endLine
          );
          return {
            start: blockStart,
            end: blockEnd,
            targetLine: explicitRange.startLine,
          };
        })()
      : getTargetCharSpan(value);
    const { start, end, targetLine } = span;

    const effectiveEnd = end > start && value[end - 1] === "\n" ? end - 1 : end;
    const blockStart = value.lastIndexOf("\n", start - 1) + 1;
    const blockEndIdx = value.indexOf("\n", effectiveEnd);
    const blockEnd = blockEndIdx === -1 ? value.length : blockEndIdx;
    const rawLines = value.slice(blockStart, blockEnd).split("\n");

    let firstDelta = 0;
    let totalDelta = 0;
    const transformed = rawLines.map((line, idx) => {
      let nextLine = line;
      if (direction === 1) {
        nextLine = `  ${line}`;
      } else if (line.startsWith("  ")) {
        nextLine = line.slice(2);
      } else if (line.startsWith("\t") || line.startsWith(" ")) {
        nextLine = line.slice(1);
      }
      const d = nextLine.length - line.length;
      if (idx === 0) firstDelta = d;
      totalDelta += d;
      return nextLine;
    });

    if (totalDelta === 0) return;
    const next =
      value.slice(0, blockStart) +
      transformed.join("\n") +
      value.slice(blockEnd);
    const nextStart = Math.max(blockStart, start + firstDelta);
    const nextEnd =
      start === end ? nextStart : Math.max(nextStart, end + totalDelta);
    commitMemoContent(activeMemo, next, {
      selStart: nextStart,
      selEnd: nextEnd,
      focusEditor: !isPreviewTarget && !explicitRange,
    });
    if (isPreviewTarget || explicitRange) {
      window.requestAnimationFrame(() =>
        previewRef.current?.focusLine(targetLine)
      );
    }
  };

  const insertLinkSmart = () => {
    if (!activeMemo) return;
    if (isPreviewTarget && previewRef.current?.insertSmartLink()) {
      return;
    }
    const ta = textareaRef.current;
    const value = activeMemo.content;
    const start = ta?.selectionStart ?? value.length;
    const end = ta?.selectionEnd ?? start;
    const selected = value.slice(start, end).trim();

    if (/^https?:\/\/\S+$/i.test(selected)) {
      const label = "链接文字";
      const snippet = `[${label}](${selected})`;
      const next = value.slice(0, start) + snippet + value.slice(end);
      commitMemoContent(activeMemo, next, {
        selStart: start + 1,
        selEnd: start + 1 + label.length,
        focusEditor: !isPreviewTarget,
      });
      return;
    }

    if (selected) {
      const urlPlaceholder = "https://";
      const snippet = `[${selected}](${urlPlaceholder})`;
      const next = value.slice(0, start) + snippet + value.slice(end);
      const urlStart = start + selected.length + 3;
      commitMemoContent(activeMemo, next, {
        selStart: urlStart,
        selEnd: urlStart + urlPlaceholder.length,
        focusEditor: !isPreviewTarget,
      });
      return;
    }

    applyWrapOrInsert("[", "](https://)", "链接文字");
  };

  const getBlockInsertOffset = (value: string): number => {
    if (!isPreviewTarget && textareaRef.current) {
      return textareaRef.current.selectionStart ?? value.length;
    }
    if (activeLineRange) {
      const { blockEnd } = lineRangeToCharOffsets(
        value,
        activeLineRange.endLine,
        activeLineRange.endLine
      );
      return blockEnd;
    }
    return value.length;
  };

  const insertHorizontalRule = () => {
    if (!activeMemo) return;
    const value = activeMemo.content.replace(/\r\n?/g, "\n");
    const pos = getBlockInsertOffset(value);
    const lead =
      pos === 0
        ? ""
        : value.slice(Math.max(0, pos - 2), pos) === "\n\n"
        ? ""
        : value[pos - 1] === "\n"
        ? "\n"
        : "\n\n";
    const trail = value[pos] === "\n" ? "\n" : "\n\n";
    const snippet = `${lead}---${trail}`;
    const next = value.slice(0, pos) + snippet + value.slice(pos);
    const nextPos = pos + snippet.length;
    commitMemoContent(activeMemo, next, {
      selStart: nextPos,
      selEnd: nextPos,
      focusEditor: !isPreviewTarget,
    });
    setActiveLineRange(computeLineRangeFromOffsets(next, pos + lead.length, pos + lead.length + 3));
  };

  const insertDetailsBlock = () => {
    if (!activeMemo) return;
    const ta = textareaRef.current;
    const value = activeMemo.content.replace(/\r\n?/g, "\n");
    const start = !isPreviewTarget && ta ? ta.selectionStart ?? value.length : getBlockInsertOffset(value);
    const end = !isPreviewTarget && ta ? ta.selectionEnd ?? start : start;
    const selected = value.slice(start, end).trim();
    const lead = start > 0 && value[start - 1] !== "\n" ? "\n" : "";
    const summaryLabel = "点击展开详情";
    const bodyText = selected || "折叠隐藏的详细内容、密钥或长配置...";
    const prefix = `${lead}<details open>\n<summary>`;
    const middle = `</summary>\n\n${bodyText}\n</details>\n`;
    const snippet = `${prefix}${summaryLabel}${middle}`;
    const next = value.slice(0, start) + snippet + value.slice(end);
    const sumStart = start + prefix.length;
    commitMemoContent(activeMemo, next, {
      selStart: sumStart,
      selEnd: sumStart + summaryLabel.length,
      focusEditor: !isPreviewTarget,
    });
    const insertedRange = computeLineRangeFromOffsets(
      next,
      start + lead.length,
      start + snippet.length - 1
    );
    setActiveLineRange(insertedRange);
  };

  const insertCalloutBlock = (
    kind: (typeof CALLOUT_PRESETS)[number]["kind"],
    defaultBody: string
  ) => {
    setOpenMenu(null);
    if (!activeMemo) return;
    const ta = textareaRef.current;
    const value = activeMemo.content.replace(/\r\n?/g, "\n");
    const start = !isPreviewTarget && ta ? ta.selectionStart ?? value.length : getBlockInsertOffset(value);
    const end = !isPreviewTarget && ta ? ta.selectionEnd ?? start : start;
    const selected = value.slice(start, end).trim();
    const lead = start > 0 && value[start - 1] !== "\n" ? "\n" : "";
    const body = selected
      ? selected
          .split("\n")
          .map((l) => `> ${l}`)
          .join("\n")
      : `> ${defaultBody}`;
    const header = `${lead}> [!${kind}]\n`;
    const snippet = `${header}${body}\n`;
    const next = value.slice(0, start) + snippet + value.slice(end);
    const bodySelStart = start + header.length + 2;
    const bodySelEnd = start + header.length + body.length;
    commitMemoContent(activeMemo, next, {
      selStart: bodySelStart,
      selEnd: bodySelEnd,
      focusEditor: !isPreviewTarget,
    });
    const insertedRange = computeLineRangeFromOffsets(
      next,
      start + lead.length,
      start + snippet.length - 1
    );
    setActiveLineRange(insertedRange);
    if (isPreviewTarget) {
      window.requestAnimationFrame(() =>
        previewRef.current?.focusLine(insertedRange.startLine + 1)
      );
    }
  };

  const insertTimestamp = () => {
    if (!activeMemo) return;
    const stamp = formatUpdatedAt(new Date().toISOString());
    if (isPreviewTarget && previewRef.current?.insertInlineSnippet(stamp)) {
      return;
    }
    const ta = textareaRef.current;
    const value = activeMemo.content;
    const start = !isPreviewTarget && ta ? ta.selectionStart ?? value.length : getBlockInsertOffset(value);
    const end = !isPreviewTarget && ta ? ta.selectionEnd ?? start : start;
    const next = value.slice(0, start) + stamp + value.slice(end);
    const nextPos = start + stamp.length;
    commitMemoContent(activeMemo, next, {
      selStart: nextPos,
      selEnd: nextPos,
      focusEditor: !isPreviewTarget,
    });
  };

  const insertTableTemplate = () => {
    if (!activeMemo) return;
    const value = activeMemo.content.replace(/\r\n?/g, "\n");
    const pos = getBlockInsertOffset(value);
    const needsLeadingNewline = pos > 0 && value[pos - 1] !== "\n";
    const tableSnippet = `${needsLeadingNewline ? "\n" : ""}| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n`;
    const next = value.slice(0, pos) + tableSnippet + value.slice(pos);
    const nextPos = pos + tableSnippet.length;
    commitMemoContent(activeMemo, next, {
      selStart: nextPos,
      selEnd: nextPos,
      focusEditor: !isPreviewTarget,
    });
    const insertedRange = computeLineRangeFromOffsets(
      next,
      pos + (needsLeadingNewline ? 1 : 0),
      nextPos - 1
    );
    setActiveLineRange(insertedRange);
  };

  const insertImageFiles = useCallback(
    async (
      files: File[],
      opts?: {
        memoId?: string;
        selectionStart?: number;
        selectionEnd?: number;
        appendMode?: boolean;
        actionLabel?: string;
      }
    ) => {
      if (files.length === 0) return;
      setSavingImage(true);
      try {
        const customDir = workspaceRef.current.settings.customDataDir;
        const savedUrls: string[] = [];
        for (const file of files) {
          const { dataUrl, ext } = await readFileAsDataUrl(file);
          const url = await saveMemoImage(dataUrl, ext, customDir);
          savedUrls.push(url);
        }
        if (savedUrls.length === 0) return;

        const mdBlock = savedUrls.map((u) => `![图片](${u})`).join("\n");
        const latestWs = workspaceRef.current;
        const latestMemos = latestWs.memos ?? [];
        const now = new Date().toISOString();
        const targetId = opts?.memoId;
        const targetMemo = targetId
          ? latestMemos.find((m) => m.id === targetId)
          : undefined;

        if (targetMemo) {
          let nextContent: string;
          let nextCursorPos: number | null = null;

          if (opts?.appendMode) {
            const sep =
              targetMemo.content && !targetMemo.content.endsWith("\n")
                ? "\n\n"
                : targetMemo.content
                ? "\n"
                : "";
            nextContent = `${targetMemo.content}${sep}${mdBlock}\n`;
          } else {
            const val = targetMemo.content;
            const start = Math.min(opts?.selectionStart ?? val.length, val.length);
            const end = Math.min(opts?.selectionEnd ?? start, val.length);
            nextContent = val.slice(0, start) + mdBlock + val.slice(end);
            nextCursorPos = start + mdBlock.length;
          }

          commitMemoContent(targetMemo, nextContent, {
            selStart: nextCursorPos ?? nextContent.length,
            selEnd: nextCursorPos ?? nextContent.length,
            focusEditor: nextCursorPos !== null,
          });
        } else {
          const activeFilterTag =
            filter !== "all" && filter !== "expiring" ? filter : "笔记";
          const created: MemoItem = {
            id: uid("memo"),
            title: "图片备忘",
            tag: activeFilterTag,
            content: `${mdBlock}\n`,
            createdAt: now,
            updatedAt: now,
          };
          onUpdateRef.current({
            ...latestWs,
            memos: [created, ...latestMemos],
          });
          onSelectMemo(created.id);
        }

        const verb = opts?.actionLabel ?? "已粘贴图片";
        onNotify(
          savedUrls.length > 1 ? `已插入 ${savedUrls.length} 张图片` : verb
        );
      } catch {
        onNotify("插入图片失败");
      } finally {
        setSavingImage(false);
      }
    },
    [commitMemoContent, filter, onNotify, onSelectMemo]
  );

  // Support Ctrl+V image paste in preview editable blocks or when no input is focused
  useEffect(() => {
    const onWindowPaste = (e: ClipboardEvent) => {
      if (deleteTarget) return;
      const active = document.activeElement;
      if (
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.tagName === "SELECT")
      ) {
        return;
      }
      const files = extractImageFilesFromTransfer(e.clipboardData);
      if (files.length === 0) return;
      e.preventDefault();
      if (activeMemo && activeLineRange) {
        const { blockEnd } = lineRangeToCharOffsets(
          activeMemo.content,
          activeLineRange.endLine,
          activeLineRange.endLine
        );
        const prefixNewline =
          blockEnd > 0 && activeMemo.content[blockEnd - 1] !== "\n"
            ? true
            : false;
        if (prefixNewline) {
          const val = activeMemo.content;
          const customDir = workspaceRef.current.settings.customDataDir;
          setSavingImage(true);
          (async () => {
            try {
              const urls: string[] = [];
              for (const f of files) {
                const { dataUrl, ext } = await readFileAsDataUrl(f);
                urls.push(await saveMemoImage(dataUrl, ext, customDir));
              }
              const md = `\n${urls.map((u) => `![图片](${u})`).join("\n")}`;
              const next = val.slice(0, blockEnd) + md + val.slice(blockEnd);
              commitMemoContent(activeMemo, next);
              onNotify(
                urls.length > 1 ? `已插入 ${urls.length} 张图片` : "已粘贴图片"
              );
            } catch {
              onNotify("插入图片失败");
            } finally {
              setSavingImage(false);
            }
          })();
          return;
        }
      }
      void insertImageFiles(files, {
        memoId: activeMemo?.id,
        appendMode: true,
      });
    };
    window.addEventListener("paste", onWindowPaste);
    return () => window.removeEventListener("paste", onWindowPaste);
  }, [
    activeMemo,
    activeLineRange,
    commitMemoContent,
    deleteTarget,
    insertImageFiles,
    onNotify,
  ]);

  const handleTextareaPaste = (
    e: React.ClipboardEvent<HTMLTextAreaElement>
  ) => {
    if (!activeMemo) return;
    const files = extractImageFilesFromTransfer(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    const ta = e.currentTarget;
    void insertImageFiles(files, {
      memoId: activeMemo.id,
      selectionStart: ta.selectionStart ?? activeMemo.content.length,
      selectionEnd: ta.selectionEnd ?? activeMemo.content.length,
      actionLabel: "已粘贴图片",
    });
  };

  const handleEditorDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (
      e.dataTransfer.types.includes("application/x-shibaplan-memo") ||
      !e.dataTransfer.types.includes("Files")
    ) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!editorDragOver) setEditorDragOver(true);
  };

  const handleEditorDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setEditorDragOver(false);
    }
  };

  const handleEditorDrop = (e: React.DragEvent<HTMLDivElement>) => {
    setEditorDragOver(false);
    if (!activeMemo) return;
    if (e.dataTransfer.types.includes("application/x-shibaplan-memo")) return;
    const files = extractImageFilesFromTransfer(e.dataTransfer);
    if (files.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const ta = textareaRef.current;
    void insertImageFiles(files, {
      memoId: activeMemo.id,
      selectionStart: ta?.selectionStart ?? activeMemo.content.length,
      selectionEnd: ta?.selectionEnd ?? activeMemo.content.length,
      actionLabel: "已插入图片",
    });
  };

  const handlePickImageFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0 || !activeMemo) return;
    const files = Array.from(fileList).filter(
      (f) =>
        f.type.startsWith("image/") ||
        /\.(png|jpe?g|webp|gif|bmp|svg|avif)$/i.test(f.name)
    );
    const ta = textareaRef.current;
    void insertImageFiles(files, {
      memoId: activeMemo.id,
      selectionStart: ta?.selectionStart ?? activeMemo.content.length,
      selectionEnd: ta?.selectionEnd ?? activeMemo.content.length,
      actionLabel: "已插入图片",
    });
    e.target.value = "";
  };

  const handleTextareaKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (!activeMemo) return;
    if (e.nativeEvent.isComposing) return;
    const ta = e.currentTarget;
    const value = activeMemo.content;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const mod = e.ctrlKey || e.metaKey;
    const keyLower = e.key.toLowerCase();

    // Undo / Redo & Formatting Shortcuts
    if (mod && !e.altKey) {
      if (keyLower === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }
      if (keyLower === "y" || (keyLower === "z" && e.shiftKey)) {
        e.preventDefault();
        handleRedo();
        return;
      }
      if (!e.shiftKey && keyLower === "b") {
        e.preventDefault();
        applyWrapOrInsert("**", "**", "加粗文本");
        return;
      }
      if (!e.shiftKey && keyLower === "i") {
        e.preventDefault();
        applyWrapOrInsert("*", "*", "斜体文本");
        return;
      }
      if (!e.shiftKey && keyLower === "u") {
        e.preventDefault();
        applyWrapOrInsert("<u>", "</u>", "下划线文本");
        return;
      }
      if (!e.shiftKey && keyLower === "e") {
        e.preventDefault();
        applyWrapOrInsert("`", "`", "code");
        return;
      }
      if (!e.shiftKey && keyLower === "k") {
        e.preventDefault();
        insertLinkSmart();
        return;
      }
      if (e.shiftKey && keyLower === "x") {
        e.preventDefault();
        applyWrapOrInsert("~~", "~~", "删除线");
        return;
      }
      if (e.shiftKey && keyLower === "h") {
        e.preventDefault();
        applyWrapOrInsert("==", "==", "高亮文本");
        return;
      }
    }

    if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) {
        adjustLineIndent(-1);
        return;
      }
      if (start !== end && value.slice(start, end).includes("\n")) {
        adjustLineIndent(1);
        return;
      }
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const lineEndIdx = value.indexOf("\n", lineStart);
      const curLine =
        lineEndIdx === -1
          ? value.slice(lineStart)
          : value.slice(lineStart, lineEndIdx);
      if (/^\s*(?:[-*+]|\d+\.)\s+/.test(curLine)) {
        adjustLineIndent(1);
        return;
      }
      const next = value.slice(0, start) + "  " + value.slice(end);
      commitMemoContent(activeMemo, next, {
        selStart: start + 2,
        selEnd: start + 2,
        focusEditor: true,
      });
      return;
    }

    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (start !== end) return;
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const lineToCursor = value.slice(lineStart, start);
      const lineEndIdx = value.indexOf("\n", start);
      const fullLine =
        lineEndIdx === -1
          ? value.slice(lineStart)
          : value.slice(lineStart, lineEndIdx);

      const taskMatch = /^(\s*[-*+]\s+\[)[ xX](\]\s*)(.*)$/.exec(fullLine);
      if (taskMatch) {
        e.preventDefault();
        if (!taskMatch[3].trim() && start === lineStart + fullLine.length) {
          const next = value.slice(0, lineStart) + value.slice(start);
          commitMemoContent(activeMemo, next, {
            selStart: lineStart,
            selEnd: lineStart,
            focusEditor: true,
          });
        } else {
          const prefix = `\n${taskMatch[1]} ${taskMatch[2]}`;
          const next = value.slice(0, start) + prefix + value.slice(end);
          const nextPos = start + prefix.length;
          commitMemoContent(activeMemo, next, {
            selStart: nextPos,
            selEnd: nextPos,
            focusEditor: true,
          });
        }
        return;
      }

      const ulMatch = /^(\s*[-*+]\s+)(.*)$/.exec(fullLine);
      if (ulMatch && lineToCursor.length >= ulMatch[1].length) {
        e.preventDefault();
        if (!ulMatch[2].trim() && start === lineStart + fullLine.length) {
          const next = value.slice(0, lineStart) + value.slice(start);
          commitMemoContent(activeMemo, next, {
            selStart: lineStart,
            selEnd: lineStart,
            focusEditor: true,
          });
        } else {
          const prefix = `\n${ulMatch[1]}`;
          const next = value.slice(0, start) + prefix + value.slice(end);
          const nextPos = start + prefix.length;
          commitMemoContent(activeMemo, next, {
            selStart: nextPos,
            selEnd: nextPos,
            focusEditor: true,
          });
        }
        return;
      }

      const olMatch = /^(\s*)(\d+)(\.\s+)(.*)$/.exec(fullLine);
      if (
        olMatch &&
        lineToCursor.length >=
          olMatch[1].length + olMatch[2].length + olMatch[3].length
      ) {
        e.preventDefault();
        if (!olMatch[4].trim() && start === lineStart + fullLine.length) {
          const next = value.slice(0, lineStart) + value.slice(start);
          commitMemoContent(activeMemo, next, {
            selStart: lineStart,
            selEnd: lineStart,
            focusEditor: true,
          });
        } else {
          const nextNum = Number(olMatch[2]) + 1;
          const prefix = `\n${olMatch[1]}${nextNum}${olMatch[3]}`;
          const next = value.slice(0, start) + prefix + value.slice(end);
          const nextPos = start + prefix.length;
          commitMemoContent(activeMemo, next, {
            selStart: nextPos,
            selEnd: nextPos,
            focusEditor: true,
          });
        }
      }
    }
  };

  const renderMemoRow = (memo: MemoItem, opts?: { showTime?: boolean }) => {
    const isSelected = activeMemo?.id === memo.id;
    const daysLeft = getDaysUntilExpiry(memo.expiresAt);
    const urgency = getExpiryUrgency(daysLeft);
    const badgeClass = getExpiryBadgeClass(urgency);
    const preview = stripMarkdownPreview(memo.content);
    const timeStr = opts?.showTime ? formatShortTime(memo.updatedAt) : "";

    return (
      <button
        key={memo.id}
        type="button"
        draggable={sidebarMode === "folder"}
        onDragStart={(e) => {
          e.dataTransfer.setData("application/x-shibaplan-memo", memo.id);
          e.dataTransfer.effectAllowed = "move";
          setDraggingMemoId(memo.id);
        }}
        onDragEnd={() => {
          setDraggingMemoId(null);
          setDragOverFolderId(null);
        }}
        onClick={() => onSelectMemo(memo.id)}
        className={`flex w-full flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left transition-colors ${
          isSelected
            ? "bg-foreground/[0.07] text-foreground"
            : "text-foreground/90 hover:bg-foreground/[0.035]"
        } ${draggingMemoId === memo.id ? "opacity-55" : ""}`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {memo.pinned && (
              <Pin className="h-3 w-3 shrink-0 text-primary" />
            )}
            {memo.dailyDate && (
              <BookOpen className="h-3 w-3 shrink-0 text-primary/80" />
            )}
            <span className="truncate text-[13px] font-medium text-foreground">
              {memo.title.trim() || "未命名备忘"}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {daysLeft !== null && (
              <span
                className={`rounded border px-1.5 py-0.5 font-mono text-[10.5px] leading-none ${badgeClass}`}
              >
                {formatExpiryLabel(daysLeft)}
              </span>
            )}
            {timeStr && (
              <span className="font-mono text-[10.5px] text-muted-foreground/70 tabular-nums">
                {timeStr}
              </span>
            )}
          </div>
        </div>

        <span className="truncate text-[11.5px] text-muted-foreground/80">
          {preview || "暂无正文..."}
        </span>
      </button>
    );
  };

  const effectiveHighlightRange = hoveredLineRange ?? activeLineRange;
  const activeMemoLines = useMemo(
    () => (activeMemo ? activeMemo.content.replace(/\r\n?/g, "\n").split("\n") : []),
    [activeMemo?.content]
  );

  const activeLineFormats = useMemo(() => {
    const idx = activeLineRange?.startLine ?? -1;
    const line = idx >= 0 && idx < activeMemoLines.length ? activeMemoLines[idx] : "";
    const headingM = /^(#{1,6})\s+/.exec(line);
    const isTask = /^\s*[-*+]\s+\[[ xX]\]/.test(line);
    return {
      heading: headingM ? headingM[1].length : 0,
      isTask,
      isUl: !isTask && /^\s*[-*+]\s+/.test(line),
      isOl: /^\s*\d+\.\s+/.test(line),
      isQuote: /^\s*>\s?/.test(line),
    };
  }, [activeLineRange?.startLine, activeMemoLines]);

  const toolbarBtnCls = (active = false) =>
    `inline-flex h-6 w-7 items-center justify-center rounded transition-colors ${
      active
        ? "bg-primary/15 text-primary font-medium"
        : "text-muted-foreground hover:bg-accent hover:text-foreground"
    }`;

  const renderMirroredEditor = (placeholderText: string) => {
    if (!activeMemo) return null;
    return (
      <div
        onDragOver={handleEditorDragOver}
        onDragLeave={handleEditorDragLeave}
        onDrop={handleEditorDrop}
        className={`relative flex min-h-0 flex-1 overflow-hidden transition-colors ${
          editorDragOver ? "bg-primary/5 ring-1 ring-inset ring-primary/40" : ""
        }`}
      >
        {/* Synchronized Line-Highlight Backdrop */}
        <div
          ref={editorBackdropRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 overflow-hidden px-5 py-3 font-mono text-[13px] leading-relaxed whitespace-pre-wrap break-words text-transparent select-none"
        >
          {activeMemoLines.map((ln, idx) => {
            const isHl =
              effectiveHighlightRange !== null &&
              idx >= effectiveHighlightRange.startLine &&
              idx <= effectiveHighlightRange.endLine;
            return (
              <div
                key={idx}
                data-editor-line={idx}
                data-editor-hl={isHl ? "true" : undefined}
                className={
                  isHl
                    ? "-mx-2 rounded-[4px] bg-foreground/[0.05] px-2"
                    : undefined
                }
              >
                {ln || "\u200B"}
              </div>
            );
          })}
        </div>

        <textarea
          ref={textareaRef}
          value={activeMemo.content}
          onScroll={(e) => {
            if (editorBackdropRef.current) {
              editorBackdropRef.current.scrollTop = e.currentTarget.scrollTop;
            }
          }}
          onFocus={(e) => syncEditorSelectionRange(e.currentTarget)}
          onClick={(e) => syncEditorSelectionRange(e.currentTarget)}
          onSelect={(e) => syncEditorSelectionRange(e.currentTarget)}
          onKeyUp={(e) => syncEditorSelectionRange(e.currentTarget)}
          onChange={(e) => {
            const nextVal = e.target.value;
            commitMemoContent(activeMemo, nextVal, {
              selStart: e.target.selectionStart,
              selEnd: e.target.selectionEnd,
              coalesce: true,
            });
            syncEditorSelectionRange(e.target, nextVal);
          }}
          onPaste={handleTextareaPaste}
          onKeyDown={handleTextareaKeyDown}
          placeholder={placeholderText}
          className="relative z-10 min-h-0 flex-1 w-full resize-none overflow-y-auto bg-transparent px-5 py-3 font-mono text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground/45 select-text focus:outline-none"
        />
      </div>
    );
  };

  const activeDaysLeft = activeMemo
    ? getDaysUntilExpiry(activeMemo.expiresAt)
    : null;
  const activeUrgency = getExpiryUrgency(activeDaysLeft);
  const activeFolderValue =
    activeMemo?.folderId && folderIdSet.has(activeMemo.folderId)
      ? activeMemo.folderId
      : "";

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Sub-Toolbar */}
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border/70 bg-background px-3 sm:px-5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {/* Search Input */}
          <div className="relative flex w-40 sm:w-56 shrink-0 items-center">
            <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索标题、标签或正文..."
              className="h-7 w-full rounded-md border border-border bg-surface/60 pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground/65 transition-colors focus:border-ring/70 focus:bg-background focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                title="清除搜索"
                className="absolute right-1.5 flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Compact Filter Pills + Tag Dropdown */}
          <div className="flex min-w-0 flex-1 items-center gap-1 py-0.5">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                filter === "all"
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-accent/70 hover:text-foreground"
              }`}
            >
              全部
              <span className="ml-1 font-mono text-[11px] opacity-75">
                {memos.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setFilter("expiring")}
              className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                filter === "expiring"
                  ? "bg-amber-500/15 text-amber-500"
                  : expiringCount > 0
                  ? "text-amber-500/90 hover:bg-amber-500/10"
                  : "text-muted-foreground hover:bg-accent/70 hover:text-foreground"
              }`}
            >
              临期
              {expiringCount > 0 && (
                <span className="ml-1 font-mono text-[11px]">
                  {expiringCount}
                </span>
              )}
            </button>

            <div className="mx-0.5 h-3.5 w-px shrink-0 bg-border/80" />

            <div className="inline-flex shrink-0 items-center">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleAnchoredMenu("filterTag", e.currentTarget, 176);
                }}
                className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors ${
                  filter !== "all" && filter !== "expiring"
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-accent/70 hover:text-foreground"
                }`}
              >
                <Tag className="h-3 w-3" />
                <span>
                  {filter !== "all" && filter !== "expiring" ? filter : "按标签"}
                </span>
                <ChevronDown className="h-3 w-3 opacity-70" />
              </button>
              {filter !== "all" && filter !== "expiring" && (
                <button
                  type="button"
                  onClick={() => setFilter("all")}
                  aria-label="清除标签筛选"
                  className="ml-0.5 flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="secondary"
            size="default"
            onClick={openOrCreateTodayNote}
            title="打开或创建今天的日常笔记"
          >
            <BookOpen className="h-3.5 w-3.5 text-primary" />
            <span className="hidden sm:inline">今日笔记</span>
          </Button>
          <Button
            type="button"
            size="default"
            onClick={() => createMemo()}
          >
            <Plus className="h-3.5 w-3.5" />
            新建备忘
          </Button>
        </div>
      </div>

      {/* Split Workspace */}
      <div
        ref={workspaceSplitRef}
        className="flex flex-1 flex-col md:flex-row overflow-hidden"
      >
        {/* Left List & Folder Pane */}
        <aside
          style={isMdUp ? { width: sidebarWidth } : undefined}
          className="flex max-h-[38vh] md:max-h-none w-full shrink-0 flex-col border-b md:border-b-0 bg-surface/35 overflow-hidden"
        >
          {/* Sidebar Top Micro-Bar */}
          <div className="flex h-8 shrink-0 items-center justify-between border-b border-border/50 px-2">
            <div className="flex items-center gap-0.5 rounded-md bg-muted/50 p-0.5">
              <button
                type="button"
                onClick={() => changeSidebarMode("folder")}
                title="目录视图"
                aria-label="目录视图"
                className={`inline-flex h-5 items-center gap-1 rounded px-1.5 text-[11px] font-medium transition-colors ${
                  sidebarMode === "folder"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Folder className="h-3 w-3" />
                <span>目录</span>
              </button>
              <button
                type="button"
                onClick={() => changeSidebarMode("timeline")}
                title="时间轴视图（懒加载）"
                aria-label="时间轴视图"
                className={`inline-flex h-5 items-center gap-1 rounded px-1.5 text-[11px] font-medium transition-colors ${
                  sidebarMode === "timeline"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Clock className="h-3 w-3" />
                <span>时间轴</span>
              </button>
            </div>
            <div className="flex items-center gap-0.5">
              {sidebarMode === "folder" && (
                <button
                  type="button"
                  onClick={startCreateFolder}
                  title="新建文件夹"
                  aria-label="新建文件夹"
                  className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => createMemo()}
                title="新建备忘"
                aria-label="新建备忘"
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Inline Folder Creation Row */}
          {sidebarMode === "folder" && creatingFolder && (
            <div className="flex shrink-0 items-center gap-1 border-b border-border/50 bg-surface/60 px-2.5 py-1.5">
              <Folder className="h-3.5 w-3.5 shrink-0 text-primary" />
              <input
                ref={newFolderInputRef}
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleCreateFolder();
                  } else if (e.key === "Escape") {
                    setCreatingFolder(false);
                    setNewFolderName("");
                  }
                }}
                placeholder="输入文件夹名称，回车创建..."
                className="h-6 min-w-0 flex-1 rounded border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-ring/70 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCreateFolder}
                title="确认创建"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-primary hover:bg-primary/15"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreatingFolder(false);
                  setNewFolderName("");
                }}
                title="取消"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Scrollable List / Folder Tree / Lazy Timeline */}
          <div ref={sidebarScrollRef} className="flex-1 overflow-y-auto">
            {sidebarMode === "timeline" ? (
              memos.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-5 py-8 text-center">
                  <Clock className="mb-2.5 h-6 w-6 text-muted-foreground/45" />
                  <p className="text-xs font-medium text-foreground/85">
                    时间轴暂无记录
                  </p>
                  <p className="mt-1 text-[11.5px] text-muted-foreground">
                    新建备忘或今日笔记后将按时间顺序自动归档
                  </p>
                </div>
              ) : timelineSortedMemos.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-5 py-8 text-center">
                  <p className="text-xs text-muted-foreground">
                    没有匹配的备忘记录
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setQuery("");
                      setFilter("all");
                    }}
                    className="mt-3"
                  >
                    重置筛选
                  </Button>
                </div>
              ) : (
                <div className="space-y-3 px-2 py-2.5">
                  {timelineGroups.map((group) => (
                    <div key={group.dateKey} className="space-y-1">
                      <div className="flex items-center justify-between px-1.5 text-[11px] font-medium text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-primary/70" />
                          <span>{group.label}</span>
                        </span>
                        <span className="font-mono text-[10.5px] opacity-70">
                          {group.items.length}
                        </span>
                      </div>
                      <div className="ml-2 space-y-0.5 border-l border-border/60 pl-2">
                        {group.items.map((memo) =>
                          renderMemoRow(memo, { showTime: true })
                        )}
                      </div>
                    </div>
                  ))}

                  {visibleTimelineCount < timelineSortedMemos.length ? (
                    <div
                      ref={timelineSentinelRef}
                      onClick={() =>
                        setVisibleTimelineCount((c) =>
                          Math.min(
                            c + TIMELINE_BATCH_SIZE,
                            timelineSortedMemos.length
                          )
                        )
                      }
                      className="cursor-pointer py-2 text-center text-[11px] text-muted-foreground/75 hover:text-foreground"
                    >
                      已显示 {visibleTimelineCount} / {timelineSortedMemos.length} · 下滑或点击加载更多
                    </div>
                  ) : (
                    timelineSortedMemos.length > TIMELINE_BATCH_SIZE && (
                      <div className="py-1.5 text-center text-[10.5px] text-muted-foreground/60">
                        已加载全部 {timelineSortedMemos.length} 条记录
                      </div>
                    )
                  )}
                </div>
              )
            ) : folders.length === 0 ? (
              memos.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-5 py-8 text-center">
                  <StickyNote className="mb-2.5 h-7 w-7 text-muted-foreground/50" />
                  <p className="text-xs font-medium text-foreground/85">
                    还没有备忘或笔记
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    支持 Markdown 排版、文件夹分组与证书/会员到期提醒
                  </p>
                  <div className="mt-4 grid w-full grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={openOrCreateTodayNote}
                      className="col-span-2 rounded-md border border-primary/35 bg-primary/10 px-2.5 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
                    >
                      + 今日日常笔记
                    </button>
                    {QUICK_TEMPLATES.map((tpl) => (
                      <button
                        key={tpl.tag}
                        type="button"
                        onClick={() => createMemo(tpl.tag, tpl.renewDays)}
                        className="rounded-md border border-border bg-card px-2.5 py-2 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-accent/60"
                      >
                        {tpl.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : filteredMemos.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-5 py-8 text-center">
                  <p className="text-xs text-muted-foreground">
                    没有匹配的备忘记录
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setQuery("");
                      setFilter("all");
                    }}
                    className="mt-3"
                  >
                    重置筛选
                  </Button>
                </div>
              ) : (
                <div className="space-y-1 p-1.5">
                  {filteredMemos.map((memo) => renderMemoRow(memo))}
                </div>
              )
            ) : isFiltering && filteredMemos.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-5 py-8 text-center">
                <p className="text-xs text-muted-foreground">
                  没有匹配的备忘记录
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setQuery("");
                    setFilter("all");
                  }}
                  className="mt-3"
                >
                  重置筛选
                </Button>
              </div>
            ) : (
              <div className="space-y-2 p-1.5">
                {folders.map((folder) => {
                  const items = groupedByFolder.get(folder.id) ?? [];
                  if (isFiltering && items.length === 0) return null;
                  const isCollapsed = isFiltering
                    ? false
                    : Boolean(folder.collapsed);
                  const isDropTarget = dragOverFolderId === folder.id;
                  const isRenaming = renamingFolderId === folder.id;

                  return (
                    <div key={folder.id} className="space-y-1">
                      <div
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDragOverFolderId(folder.id);
                        }}
                        onDragLeave={() => {
                          if (dragOverFolderId === folder.id) {
                            setDragOverFolderId(null);
                          }
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDragOverFolderId(null);
                          setDraggingMemoId(null);
                          const memoId = e.dataTransfer.getData(
                            "application/x-shibaplan-memo"
                          );
                          if (memoId) {
                            moveMemoToFolder(memoId, folder.id);
                          }
                        }}
                        onClick={() => {
                          if (!isRenaming) toggleFolderCollapsed(folder.id);
                        }}
                        className={`group flex h-7 cursor-pointer items-center justify-between gap-1.5 rounded-md border px-2 text-xs transition-colors ${
                          isDropTarget
                            ? "border-primary/45 bg-primary/10 text-foreground"
                            : "border-transparent text-muted-foreground hover:bg-accent/55 hover:text-foreground"
                        }`}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-1.5">
                          {isCollapsed ? (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                          )}
                          {isCollapsed ? (
                            <Folder className="h-3.5 w-3.5 shrink-0 text-primary/80" />
                          ) : (
                            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
                          )}
                          {isRenaming ? (
                            <input
                              ref={renameFolderInputRef}
                              type="text"
                              value={renamingFolderName}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) =>
                                setRenamingFolderName(e.target.value)
                              }
                              onBlur={handleCommitRenameFolder}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  handleCommitRenameFolder();
                                } else if (e.key === "Escape") {
                                  setRenamingFolderId(null);
                                  setRenamingFolderName("");
                                }
                              }}
                              className="h-5 min-w-0 flex-1 rounded border border-border bg-background px-1.5 text-xs text-foreground focus:border-ring/70 focus:outline-none"
                            />
                          ) : (
                            <span
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                startRenameFolder(folder);
                              }}
                              title="双击重命名文件夹"
                              className="truncate font-medium text-foreground/90"
                            >
                              {folder.name}
                            </span>
                          )}
                          <span className="shrink-0 font-mono text-[11px] text-muted-foreground/75">
                            {items.length}
                          </span>
                        </div>

                        {!isRenaming && (
                          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                createMemo(undefined, undefined, folder.id);
                              }}
                              title="在此文件夹新建备忘"
                              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                startRenameFolder(folder);
                              }}
                              title="重命名文件夹"
                              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteFolder(folder.id);
                              }}
                              title="删除文件夹（备忘将移至未分组）"
                              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </div>

                      {!isCollapsed && (
                        <div className="ml-2.5 space-y-1 border-l border-border/60 pl-2">
                          {items.length === 0 ? (
                            <div className="px-2 py-1.5 text-[11px] text-muted-foreground/75">
                              空文件夹 · 拖入备忘或点 + 新建
                            </div>
                          ) : (
                            items.map((memo) => renderMemoRow(memo))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Ungrouped Section */}
                {(ungroupedMemos.length > 0 ||
                  draggingMemoId !== null ||
                  !isFiltering) && (
                  <div className="space-y-1 pt-0.5">
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOverFolderId(UNGROUPED_DROP_KEY);
                      }}
                      onDragLeave={() => {
                        if (dragOverFolderId === UNGROUPED_DROP_KEY) {
                          setDragOverFolderId(null);
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOverFolderId(null);
                        setDraggingMemoId(null);
                        const memoId = e.dataTransfer.getData(
                          "application/x-shibaplan-memo"
                        );
                        if (memoId) {
                          moveMemoToFolder(memoId, undefined);
                        }
                      }}
                      onClick={() => setUngroupedCollapsed((c) => !c)}
                      className={`flex h-7 cursor-pointer items-center justify-between rounded-md border px-2 text-xs transition-colors ${
                        dragOverFolderId === UNGROUPED_DROP_KEY
                          ? "border-primary/45 bg-primary/10 text-foreground"
                          : "border-transparent text-muted-foreground hover:bg-accent/55 hover:text-foreground"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        {(!isFiltering && ungroupedCollapsed) ? (
                          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                        )}
                        <span className="font-medium">未分组</span>
                        <span className="font-mono text-[11px] text-muted-foreground/75">
                          {ungroupedMemos.length}
                        </span>
                      </div>
                    </div>

                    {(isFiltering || !ungroupedCollapsed) &&
                      (ungroupedMemos.length > 0 ? (
                        <div className="space-y-1">
                          {ungroupedMemos.map((memo) => renderMemoRow(memo))}
                        </div>
                      ) : draggingMemoId !== null ? (
                        <div className="mx-2 rounded border border-dashed border-border px-2 py-2 text-center text-[11px] text-muted-foreground">
                          拖放到此处移至未分组
                        </div>
                      ) : null)}
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>

        {/* Resizable Handle between Sidebar and Detail Pane */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="拖拽调整备忘列表宽度"
          title="左右拖拽调整列表栏宽度 · 双击恢复默认"
          onMouseDown={(e) => {
            e.preventDefault();
            setResizingSidebar(true);
          }}
          onDoubleClick={() => updateSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
          className={`group relative hidden md:flex w-px shrink-0 cursor-col-resize select-none items-center justify-center transition-colors ${
            resizingSidebar
              ? "bg-primary"
              : "bg-border/70 hover:bg-primary/65"
          }`}
        >
          <div className="absolute inset-y-0 -left-1.5 -right-1.5 z-20" />
          <div
            className={`pointer-events-none z-10 h-8 w-1 rounded-full transition-opacity ${
              resizingSidebar
                ? "bg-primary opacity-100"
                : "bg-primary/70 opacity-0 group-hover:opacity-100"
            }`}
          />
        </div>

        {/* Right Detail / Markdown Page Pane */}
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
          {!activeMemo ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-xs text-muted-foreground">
              <p>选择左侧备忘查看，或点击右上角「今日笔记」/「新建备忘」</p>
            </div>
          ) : (
            <>
              {/* Title Header + Mode Switch + Actions */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-5 py-2.5">
                <input
                  ref={titleInputRef}
                  type="text"
                  value={activeMemo.title}
                  onChange={(e) =>
                    patchMemo(activeMemo.id, { title: e.target.value })
                  }
                  placeholder="输入备忘或笔记标题..."
                  className="min-w-[180px] flex-1 bg-transparent text-base font-semibold tracking-[-0.01em] text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
                />

                <div className="flex shrink-0 items-center gap-2">
                  {/* 3-way Markdown Mode Segmented Control */}
                  <div className="flex items-center rounded-md border border-border bg-surface p-0.5">
                    {(
                      [
                        { id: "edit", label: "编辑", icon: Pencil },
                        { id: "split", label: "分栏", icon: Columns2 },
                        { id: "preview", label: "预览", icon: Eye },
                      ] as const
                    ).map((m) => {
                      const Icon = m.icon;
                      const isActive = editorMode === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => changeEditorMode(m.id)}
                          className={`inline-flex h-6 items-center gap-1 rounded-[4px] px-2 text-xs font-medium transition-colors ${
                            isActive
                              ? "bg-card text-foreground shadow-card-rest"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <Icon className="h-3 w-3" />
                          <span>{m.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="h-3.5 w-px bg-border" />

                  <div className="flex items-center gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        patchMemo(activeMemo.id, {
                          pinned: !activeMemo.pinned,
                        })
                      }
                      title={activeMemo.pinned ? "取消置顶" : "置顶备忘"}
                      className={
                        activeMemo.pinned
                          ? "bg-primary/12 text-primary hover:bg-primary/18 hover:text-primary"
                          : undefined
                      }
                    >
                      <Pin className="h-3.5 w-3.5" />
                    </Button>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleAnchoredMenu(
                          "memoMore",
                          e.currentTarget,
                          164,
                          true
                        );
                      }}
                      title="更多操作"
                      className={
                        openMenu?.kind === "memoMore"
                          ? "bg-accent text-foreground"
                          : undefined
                      }
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* Minimal Capsule Properties Row */}
              <div className="flex flex-wrap items-center gap-1.5 border-b border-border/50 bg-surface/20 px-5 py-1.5 text-xs">
                {/* Folder Capsule */}
                {folders.length > 0 && (
                  <div className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/80 pl-2 pr-0.5">
                    <Folder className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <CustomSelect
                      value={activeFolderValue}
                      onChange={(val) =>
                        moveMemoToFolder(activeMemo.id, val || undefined)
                      }
                      options={[
                        { value: "", label: "未分组" },
                        ...folders.map((f) => ({ value: f.id, label: f.name })),
                      ]}
                      className="h-6 min-w-[72px] border-0 bg-transparent px-1 text-xs shadow-none"
                      ariaLabel="选择文件夹"
                    />
                  </div>
                )}

                {/* Tag Capsule (click to pick or type custom tag) */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCustomTagInput(activeMemo.tag);
                    toggleAnchoredMenu("memoTag", e.currentTarget, 196);
                  }}
                  className={`inline-flex h-6 items-center gap-1 rounded-md border px-2 text-xs transition-colors ${
                    activeMemo.tag.trim()
                      ? "border-border/70 bg-background/80 text-foreground hover:border-primary/40 hover:bg-accent/50"
                      : "border-dashed border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                  }`}
                >
                  <Tag className="h-3 w-3 text-muted-foreground" />
                  <span>{activeMemo.tag.trim() || "添加标签"}</span>
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </button>

                {/* On-demand Expiry Capsule */}
                {!activeMemo.expiresAt && !editingExpiry ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingExpiry(true);
                      setTimeout(() => expiryInputRef.current?.focus(), 20);
                    }}
                    className="inline-flex h-6 items-center gap-1 rounded-md border border-dashed border-border/80 px-2 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-accent/40 hover:text-foreground"
                  >
                    <CalendarClock className="h-3 w-3" />
                    <span>+ 到期提醒</span>
                  </button>
                ) : (
                  <div className="inline-flex flex-wrap items-center gap-1.5">
                    <div className="inline-flex h-6 items-center gap-1 rounded-md border border-border/70 bg-background/80 px-2">
                      <CalendarClock className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <input
                        ref={expiryInputRef}
                        type="date"
                        value={activeMemo.expiresAt ?? ""}
                        onChange={(e) => {
                          const val = e.target.value || undefined;
                          patchMemo(activeMemo.id, { expiresAt: val });
                          if (!val) setEditingExpiry(false);
                        }}
                        onBlur={() => {
                          if (!activeMemo.expiresAt) setEditingExpiry(false);
                        }}
                        className="h-5 bg-transparent font-mono text-xs text-foreground focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          patchMemo(activeMemo.id, {
                            expiresAt: undefined,
                            renewDays: undefined,
                          });
                          setEditingExpiry(false);
                        }}
                        aria-label="清除到期日"
                        className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>

                    {activeDaysLeft !== null && (
                      <span
                        className={`rounded border px-1.5 py-0.5 font-mono text-[11px] leading-none ${getExpiryBadgeClass(
                          activeUrgency
                        )}`}
                      >
                        {formatExpiryLabel(activeDaysLeft)}
                      </span>
                    )}

                    {activeMemo.expiresAt && (
                      <>
                        <CustomSelect
                          value={
                            activeMemo.renewDays !== undefined
                              ? String(activeMemo.renewDays)
                              : ""
                          }
                          onChange={(val) => {
                            patchMemo(activeMemo.id, {
                              renewDays: val ? Number(val) : undefined,
                            });
                          }}
                          options={[
                            { value: "", label: "不自动续期" },
                            ...RENEW_DAY_PRESETS.map((p) => ({
                              value: String(p.days),
                              label: p.label,
                            })),
                          ]}
                          className="h-6 min-w-[96px] border-border/70 bg-background/80 px-2 text-xs"
                          ariaLabel="自动续期周期"
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => handleRenewMemo(activeMemo)}
                          className="h-6 px-2 text-[11px]"
                        >
                          <RefreshCw className="h-3 w-3" />
                          续期 +{activeMemo.renewDays || 365}天
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Streamlined Markdown Formatting Toolbar */}
              <div
                onMouseDown={(e) => {
                  if ((e.target as HTMLElement).tagName !== "INPUT") {
                    e.preventDefault();
                  }
                  setToolbarTip(null);
                }}
                onMouseOver={(e) => {
                  const btn = (e.target as HTMLElement).closest<HTMLElement>(
                    "[data-tip]"
                  );
                  if (!btn) {
                    setToolbarTip(null);
                    return;
                  }
                  const label = btn.getAttribute("data-tip");
                  if (!label) return;
                  const kbd = btn.getAttribute("data-kbd") || undefined;
                  const rect = btn.getBoundingClientRect();
                  const centerX = Math.max(
                    64,
                    Math.min(rect.left + rect.width / 2, window.innerWidth - 64)
                  );
                  setToolbarTip({
                    label,
                    kbd,
                    x: centerX,
                    y: rect.bottom + 6,
                  });
                }}
                onMouseLeave={() => setToolbarTip(null)}
                className="flex min-h-8 shrink-0 flex-wrap items-center gap-0.5 border-b border-border/50 bg-surface/15 px-4 py-1"
              >
                {/* Undo / Redo */}
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={!canUndo}
                  aria-label="撤销"
                  data-tip="撤销"
                  data-kbd="Ctrl+Z"
                  className="inline-flex h-6 w-6.5 items-center justify-center rounded px-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-35"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleRedo}
                  disabled={!canRedo}
                  aria-label="重做"
                  data-tip="重做"
                  data-kbd="Ctrl+Y"
                  className="inline-flex h-6 w-6.5 items-center justify-center rounded px-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-35"
                >
                  <Redo2 className="h-3.5 w-3.5" />
                </button>

                <div className="mx-1 h-3.5 w-px bg-border/80" />

                {/* Heading Dropdown (H1 - H4) */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleAnchoredMenu("heading", e.currentTarget, 168);
                  }}
                  aria-label="标题层级"
                  data-tip="标题层级"
                  data-kbd="H1–H4"
                  className={`inline-flex h-6 items-center gap-0.5 rounded px-1.5 transition-colors ${
                    activeLineFormats.heading > 0 || openMenu?.kind === "heading"
                      ? "bg-primary/15 text-primary font-medium"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  {activeLineFormats.heading === 1 ? (
                    <Heading1 className="h-3.5 w-3.5" />
                  ) : activeLineFormats.heading === 2 ? (
                    <Heading2 className="h-3.5 w-3.5" />
                  ) : activeLineFormats.heading === 3 ? (
                    <Heading3 className="h-3.5 w-3.5" />
                  ) : activeLineFormats.heading === 4 ? (
                    <Heading4 className="h-3.5 w-3.5" />
                  ) : (
                    <Heading className="h-3.5 w-3.5" />
                  )}
                  <ChevronDown className="h-2.5 w-2.5 opacity-70" />
                </button>

                <div className="mx-1 h-3.5 w-px bg-border/80" />

                {/* High-Frequency Inline Styles */}
                <button
                  type="button"
                  onClick={() => applyWrapOrInsert("**", "**", "加粗文本")}
                  aria-label="加粗"
                  data-tip="加粗"
                  data-kbd="Ctrl+B"
                  className={toolbarBtnCls()}
                >
                  <Bold className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => applyWrapOrInsert("*", "*", "斜体文本")}
                  aria-label="斜体"
                  data-tip="斜体"
                  data-kbd="Ctrl+I"
                  className={toolbarBtnCls()}
                >
                  <Italic className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => applyWrapOrInsert("~~", "~~", "删除线")}
                  aria-label="删除线"
                  data-tip="删除线"
                  data-kbd="Ctrl+Shift+X"
                  className={toolbarBtnCls()}
                >
                  <Strikethrough className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => applyWrapOrInsert("==", "==", "高亮内容")}
                  aria-label="高亮标记"
                  data-tip="高亮标记"
                  data-kbd="Ctrl+Shift+H"
                  className={toolbarBtnCls()}
                >
                  <Highlighter className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => applyWrapOrInsert("`", "`", "code")}
                  aria-label="行内代码"
                  data-tip="行内代码"
                  data-kbd="Ctrl+E"
                  className={toolbarBtnCls()}
                >
                  <Code className="h-3.5 w-3.5" />
                </button>

                <div className="mx-1 h-3.5 w-px bg-border/80" />

                {/* High-Frequency Lists & Quote */}
                <button
                  type="button"
                  onClick={() => applyLinePrefix("- ")}
                  aria-label="无序列表"
                  data-tip="无序列表"
                  data-kbd="- "
                  className={toolbarBtnCls(activeLineFormats.isUl)}
                >
                  <List className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={applyOrderedList}
                  aria-label="有序列表"
                  data-tip="有序列表"
                  data-kbd="1. "
                  className={toolbarBtnCls(activeLineFormats.isOl)}
                >
                  <ListOrdered className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => applyLinePrefix("- [ ] ")}
                  aria-label="待办任务列表"
                  data-tip="待办任务列表"
                  data-kbd="- [ ]"
                  className={toolbarBtnCls(activeLineFormats.isTask)}
                >
                  <ListTodo className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => applyLinePrefix("> ")}
                  aria-label="引用"
                  data-tip="引用"
                  data-kbd="> "
                  className={toolbarBtnCls(activeLineFormats.isQuote)}
                >
                  <Quote className="h-3.5 w-3.5" />
                </button>

                <div className="mx-1 h-3.5 w-px bg-border/80" />

                {/* Link, Image & + Insert Menu */}
                <button
                  type="button"
                  onClick={insertLinkSmart}
                  aria-label="插入链接"
                  data-tip="插入链接"
                  data-kbd="Ctrl+K"
                  className={toolbarBtnCls()}
                >
                  <Link2 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => imageFileInputRef.current?.click()}
                  disabled={savingImage}
                  aria-label="插入图片"
                  data-tip="插入图片（支持 Ctrl+V 贴图）"
                  data-kbd="Ctrl+V"
                  className="inline-flex h-6 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-45"
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleAnchoredMenu("insert", e.currentTarget, 224);
                  }}
                  aria-label="插入更多块与格式"
                  data-tip="插入代码块、表格、提示块等"
                  className={`inline-flex h-6 items-center gap-1 rounded px-2 text-xs font-medium transition-colors ${
                    openMenu?.kind === "insert"
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  <Plus className="h-3 w-3" />
                  <span>插入</span>
                  <ChevronDown className="h-2.5 w-2.5 opacity-70" />
                </button>
                <input
                  ref={imageFileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handlePickImageFiles}
                  className="hidden"
                />

                {savingImage && (
                  <span className="ml-auto shrink-0 pl-2 text-[11px] text-primary">
                    正在保存图片...
                  </span>
                )}
              </div>

              {toolbarTip &&
                !openMenu &&
                typeof document !== "undefined" &&
                createPortal(
                  <div
                    style={{ left: toolbarTip.x, top: toolbarTip.y }}
                    className="pointer-events-none fixed z-[9999] flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[11px] font-medium text-popover-foreground shadow-popover-soft"
                  >
                    <span>{toolbarTip.label}</span>
                    {toolbarTip.kbd && (
                      <span className="rounded bg-muted px-1 py-px font-mono text-[10px] font-normal text-muted-foreground">
                        {toolbarTip.kbd}
                      </span>
                    )}
                  </div>,
                  document.body
                )}

              {/* Unified Anchored Portal Menus (memo-scoped) */}
              {openMenu &&
                openMenu.kind !== "filterTag" &&
                typeof document !== "undefined" &&
                createPortal(
                  <div
                    onMouseDown={(e) => {
                      if (
                        openMenu.kind === "heading" ||
                        openMenu.kind === "insert"
                      ) {
                        e.preventDefault();
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    style={{ left: openMenu.left, top: openMenu.top }}
                    className="fixed z-[9999] rounded-lg border border-border bg-popover p-1 shadow-popover-soft"
                  >
                    {openMenu.kind === "memoTag" && activeMemo && (
                      <div className="w-48 space-y-1 p-1">
                        <input
                          type="text"
                          autoFocus
                          value={customTagInput}
                          onChange={(e) => setCustomTagInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              patchMemo(activeMemo.id, {
                                tag: customTagInput.trim(),
                              });
                              setOpenMenu(null);
                            }
                          }}
                          placeholder="输入标签，回车确认..."
                          className="h-7 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-ring/70 focus:outline-none"
                        />
                        <div className="max-h-48 overflow-y-auto pt-0.5">
                          {allTags.map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => {
                                patchMemo(activeMemo.id, { tag });
                                setOpenMenu(null);
                              }}
                              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-popover-foreground hover:bg-accent"
                            >
                              <span>{tag}</span>
                              {activeMemo.tag.trim() === tag && (
                                <Check className="h-3.5 w-3.5 text-primary" />
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {openMenu.kind === "memoMore" && activeMemo && (
                      <div className="w-40">
                        <button
                          type="button"
                          onClick={() => {
                            handleCopyMemo(activeMemo);
                            setOpenMenu(null);
                          }}
                          className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-popover-foreground hover:bg-accent"
                        >
                          <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>复制 Markdown</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            handleExportMarkdown(activeMemo);
                            setOpenMenu(null);
                          }}
                          className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-popover-foreground hover:bg-accent"
                        >
                          <Download className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>导出为 .md</span>
                        </button>
                        <div className="my-1 h-px bg-border/60" />
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteTarget(activeMemo);
                            setOpenMenu(null);
                          }}
                          className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-destructive hover:bg-destructive/12"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>删除备忘</span>
                        </button>
                      </div>
                    )}

                    {openMenu.kind === "heading" && (
                      <div className="w-40">
                        {(
                          [
                            { level: 1 as const, label: "一级标题", kbd: "#", Icon: Heading1 },
                            { level: 2 as const, label: "二级标题", kbd: "##", Icon: Heading2 },
                            { level: 3 as const, label: "三级标题", kbd: "###", Icon: Heading3 },
                            { level: 4 as const, label: "四级标题", kbd: "####", Icon: Heading4 },
                          ]
                        ).map(({ level, label, kbd, Icon }) => (
                          <button
                            key={level}
                            type="button"
                            onClick={() => {
                              applyHeading(level);
                              setOpenMenu(null);
                            }}
                            className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-popover-foreground hover:bg-accent"
                          >
                            <span className="flex items-center gap-2">
                              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                              <span>{label}</span>
                            </span>
                            <span className="flex items-center gap-1 font-mono text-[10.5px] text-muted-foreground">
                              {kbd}
                              {activeLineFormats.heading === level && (
                                <Check className="h-3 w-3 text-primary" />
                              )}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    {openMenu.kind === "insert" && (
                      <div className="w-56 space-y-1">
                        <div className="px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
                          结构块
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            insertCodeBlock();
                            setOpenMenu(null);
                          }}
                          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-popover-foreground hover:bg-accent"
                        >
                          <span className="flex items-center gap-2">
                            <FileCode2 className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>代码块</span>
                          </span>
                          <span className="font-mono text-[10.5px] text-muted-foreground">
                            ```
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            insertTableTemplate();
                            setOpenMenu(null);
                          }}
                          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-popover-foreground hover:bg-accent"
                        >
                          <span className="flex items-center gap-2">
                            <Table2 className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>Markdown 表格</span>
                          </span>
                          <span className="font-mono text-[10.5px] text-muted-foreground">
                            Table
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            insertDetailsBlock();
                            setOpenMenu(null);
                          }}
                          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-popover-foreground hover:bg-accent"
                        >
                          <span className="flex items-center gap-2">
                            <ListCollapse className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>折叠详情块</span>
                          </span>
                          <span className="font-mono text-[10.5px] text-muted-foreground">
                            &lt;details&gt;
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            insertHorizontalRule();
                            setOpenMenu(null);
                          }}
                          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-popover-foreground hover:bg-accent"
                        >
                          <span className="flex items-center gap-2">
                            <Minus className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>水平分割线</span>
                          </span>
                          <span className="font-mono text-[10.5px] text-muted-foreground">
                            ---
                          </span>
                        </button>

                        <div className="my-1 h-px bg-border/60" />
                        <div className="px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
                          提示块 Callout
                        </div>
                        <div className="grid grid-cols-5 gap-1 px-1.5 py-0.5">
                          {CALLOUT_PRESETS.map((preset) => (
                            <button
                              key={preset.kind}
                              type="button"
                              onClick={() =>
                                insertCalloutBlock(
                                  preset.kind,
                                  preset.defaultBody
                                )
                              }
                              className="flex flex-col items-center gap-1 rounded-md py-1.5 text-[10.5px] text-popover-foreground transition-colors hover:bg-accent"
                            >
                              <span
                                className={`h-2 w-2 rounded-full ${preset.dotClass}`}
                              />
                              <span>{preset.label.split(" ")[0]}</span>
                            </button>
                          ))}
                        </div>

                        <div className="my-1 h-px bg-border/60" />
                        <div className="px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
                          更多格式与排版
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            applyWrapOrInsert("<u>", "</u>", "下划线");
                            setOpenMenu(null);
                          }}
                          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-popover-foreground hover:bg-accent"
                        >
                          <span className="flex items-center gap-2">
                            <Underline className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>下划线</span>
                          </span>
                          <span className="font-mono text-[10.5px] text-muted-foreground">
                            Ctrl+U
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            applyWrapOrInsert("<kbd>", "</kbd>", "Ctrl+K");
                            setOpenMenu(null);
                          }}
                          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-popover-foreground hover:bg-accent"
                        >
                          <span className="flex items-center gap-2">
                            <Keyboard className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>快捷键按键标签</span>
                          </span>
                          <span className="font-mono text-[10.5px] text-muted-foreground">
                            &lt;kbd&gt;
                          </span>
                        </button>
                        <div className="grid grid-cols-2 gap-1 px-1">
                          <button
                            type="button"
                            onClick={() => {
                              adjustLineIndent(1);
                              setOpenMenu(null);
                            }}
                            className="flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs text-popover-foreground hover:bg-accent"
                          >
                            <IndentIncrease className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>缩进</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              adjustLineIndent(-1);
                              setOpenMenu(null);
                            }}
                            className="flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs text-popover-foreground hover:bg-accent"
                          >
                            <IndentDecrease className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>反缩进</span>
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            insertTimestamp();
                            setOpenMenu(null);
                          }}
                          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-popover-foreground hover:bg-accent"
                        >
                          <span className="flex items-center gap-2">
                            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>插入当前时间</span>
                          </span>
                        </button>
                      </div>
                    )}
                  </div>,
                  document.body
                )}

              {/* Editor / Split / Preview Body */}
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {editorMode === "edit" &&
                  renderMirroredEditor(
                    `支持 Markdown 语法（可直接 Ctrl+V 粘贴截图或拖入图片）：\n## 今日重点 / 运维记录\n- [ ] 待办事项\n- 腾讯云 A (10.0.0.2) -> B (10.0.0.8:8080)\n\n| 字段 | 值 |\n| --- | --- |\n| 域名 | example.com |`
                  )}

                {editorMode === "preview" && (
                  <div
                    onDragOver={handleEditorDragOver}
                    onDragLeave={handleEditorDragLeave}
                    onDrop={handleEditorDrop}
                    className={`min-h-0 flex-1 overflow-y-auto px-6 py-4 transition-colors ${
                      editorDragOver
                        ? "bg-primary/5 ring-1 ring-inset ring-primary/40"
                        : ""
                    }`}
                  >
                    <MarkdownPreview
                      editorHandleRef={previewRef}
                      editable
                      content={activeMemo.content}
                      customDataDir={workspace.settings.customDataDir}
                      highlightRange={effectiveHighlightRange}
                      onActiveRangeChange={(range) => {
                        setActivePane("preview");
                        setActiveLineRange(range);
                      }}
                      onHoverRangeChange={setHoveredLineRange}
                      onReplaceLines={handlePreviewReplaceLines}
                      onToggleCheckbox={(lineIdx) =>
                        commitMemoContent(
                          activeMemo,
                          toggleMarkdownCheckbox(activeMemo.content, lineIdx)
                        )
                      }
                      onUndo={handleUndo}
                      onRedo={handleRedo}
                      onIndentLines={(range, dir) => adjustLineIndent(dir, range)}
                      onNotify={onNotify}
                      className="mx-auto max-w-3xl"
                    />
                  </div>
                )}

                {editorMode === "split" && (
                  <div
                    ref={editorSplitRef}
                    className="flex min-h-0 flex-1 flex-col md:flex-row overflow-hidden"
                  >
                    <div
                      style={
                        isMdUp
                          ? { width: `${(splitRatio * 100).toFixed(2)}%` }
                          : undefined
                      }
                      className="flex min-h-0 min-w-0 flex-1 md:flex-none shrink-0 flex-col border-b md:border-b-0 border-border/60"
                    >
                      {renderMirroredEditor(
                        `支持 Markdown 语法（可直接 Ctrl+V 粘贴截图或拖入图片）：\n## 今日重点 / 运维记录\n- [ ] 待办事项\n- 腾讯云 A -> B 反代配置`
                      )}
                    </div>

                    {/* Resizable Handle between Editor and Preview */}
                    <div
                      role="separator"
                      aria-orientation="vertical"
                      aria-label="拖拽调整编辑与预览分栏宽度"
                      title="左右拖拽调整编辑/预览宽度 · 双击恢复等宽"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setResizingSplit(true);
                      }}
                      onDoubleClick={() => updateSplitRatio(DEFAULT_SPLIT_RATIO)}
                      className={`group relative hidden md:flex w-px shrink-0 cursor-col-resize select-none items-center justify-center transition-colors ${
                        resizingSplit
                          ? "bg-primary"
                          : "bg-border/60 hover:bg-primary/65"
                      }`}
                    >
                      <div className="absolute inset-y-0 -left-2 -right-2 z-20" />
                      <div
                        className={`pointer-events-none z-10 h-8 w-1 rounded-full transition-opacity ${
                          resizingSplit
                            ? "bg-primary opacity-100"
                            : "bg-primary/70 opacity-0 group-hover:opacity-100"
                        }`}
                      />
                    </div>

                    <div
                      onDragOver={handleEditorDragOver}
                      onDragLeave={handleEditorDragLeave}
                      onDrop={handleEditorDrop}
                      className={`min-h-0 min-w-0 flex-1 overflow-y-auto bg-surface/15 px-5 py-3 transition-colors ${
                        editorDragOver
                          ? "bg-primary/5 ring-1 ring-inset ring-primary/40"
                          : ""
                      }`}
                    >
                      <MarkdownPreview
                        editorHandleRef={previewRef}
                        editable
                        content={activeMemo.content}
                        customDataDir={workspace.settings.customDataDir}
                        highlightRange={effectiveHighlightRange}
                        autoScrollHighlight={activePane === "editor"}
                        onActiveRangeChange={(range) => {
                          setActivePane("preview");
                          setActiveLineRange(range);
                        }}
                        onHoverRangeChange={setHoveredLineRange}
                        onReplaceLines={handlePreviewReplaceLines}
                        onToggleCheckbox={(lineIdx) =>
                          commitMemoContent(
                            activeMemo,
                            toggleMarkdownCheckbox(activeMemo.content, lineIdx)
                          )
                        }
                        onUndo={handleUndo}
                        onRedo={handleRedo}
                        onIndentLines={(range, dir) =>
                          adjustLineIndent(dir, range)
                        }
                        onNotify={onNotify}
                      />
                    </div>
                  </div>
                )}

                <div className="flex shrink-0 items-center justify-between border-t border-border/40 px-5 py-2 text-[11px] text-muted-foreground tabular-nums">
                  <span>
                    {activeMemo.dailyDate
                      ? `日常笔记 · ${activeMemo.dailyDate} · `
                      : ""}
                    更新于 {formatUpdatedAt(activeMemo.updatedAt)}
                  </span>
                  <span>{activeMemo.content.length} 字 · Markdown</span>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {/* Global Tag Filter Popover (available even when no memo is active) */}
      {openMenu?.kind === "filterTag" &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ left: openMenu.left, top: openMenu.top }}
            className="fixed z-[9999] w-40 rounded-lg border border-border bg-popover p-1 shadow-popover-soft"
          >
            <button
              type="button"
              onClick={() => {
                setFilter("all");
                setOpenMenu(null);
              }}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-popover-foreground hover:bg-accent"
            >
              <span>全部标签</span>
              {filter === "all" && <Check className="h-3.5 w-3.5 text-primary" />}
            </button>
            <div className="my-1 h-px bg-border/60" />
            {allTags.map((tag) => {
              const cnt = memos.filter((m) => m.tag.trim() === tag).length;
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => {
                    setFilter(tag);
                    setOpenMenu(null);
                  }}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-popover-foreground hover:bg-accent"
                >
                  <span className="truncate">{tag}</span>
                  <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                    {cnt > 0 && <span>{cnt}</span>}
                    {filter === tag && (
                      <Check className="h-3 w-3 text-primary" />
                    )}
                  </span>
                </button>
              );
            })}
          </div>,
          document.body
        )}

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>确认删除备忘</DialogTitle>
          </DialogHeader>
          <Separator className="my-2.5" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            确定要删除「{deleteTarget?.title.trim() || "未命名备忘"}」吗？
          </p>
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDeleteTarget(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleConfirmDelete}
            >
              删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
