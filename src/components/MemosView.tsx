import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Bold,
  BookOpen,
  CalendarClock,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Code,
  Columns2,
  Copy,
  Download,
  Eye,
  FileCode2,
  Folder,
  FolderOpen,
  FolderPlus,
  Heading2,
  Italic,
  Link2,
  List,
  Pencil,
  Pin,
  Plus,
  Quote,
  RefreshCw,
  Search,
  StickyNote,
  Strikethrough,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import { MemoFolder, MemoItem, WorkspaceData } from "../types";
import { uid } from "../lib/storage";
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
import { MarkdownPreview } from "./MarkdownPreview";
import { Button } from "./ui/button";
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

const EDITOR_MODE_KEY = "shibaplan_memo_editor_mode";
const UNGROUPED_DROP_KEY = "__ungrouped__";

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

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [editorMode, setEditorMode] = useState<EditorMode>(getInitialEditorMode);
  const [deleteTarget, setDeleteTarget] = useState<MemoItem | null>(null);

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
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  const renameFolderInputRef = useRef<HTMLInputElement>(null);

  const changeEditorMode = (next: EditorMode) => {
    setEditorMode(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(EDITOR_MODE_KEY, next);
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

  const activeMemo = useMemo(() => {
    if (selectedMemoId) {
      const found = memos.find((m) => m.id === selectedMemoId);
      if (found) return found;
    }
    return filteredMemos[0] ?? null;
  }, [memos, selectedMemoId, filteredMemos]);

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

  // Markdown formatting insertion helpers
  const applyWrapOrInsert = (
    prefix: string,
    suffix = "",
    placeholder = ""
  ) => {
    if (!activeMemo) return;
    const ta = textareaRef.current;
    const value = activeMemo.content;
    if (!ta) {
      patchMemo(activeMemo.id, {
        content: value + prefix + placeholder + suffix,
      });
      return;
    }

    const start = ta.selectionStart ?? value.length;
    const end = ta.selectionEnd ?? value.length;
    const selected = value.slice(start, end);
    const inner = selected || placeholder;
    const next =
      value.slice(0, start) + prefix + inner + suffix + value.slice(end);
    patchMemo(activeMemo.id, { content: next });

    const selStart = start + prefix.length;
    const selEnd = selStart + inner.length;
    window.requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(selStart, selEnd);
    });
  };

  const applyLinePrefix = (prefix: string) => {
    if (!activeMemo) return;
    const ta = textareaRef.current;
    const value = activeMemo.content;
    if (!ta) {
      patchMemo(activeMemo.id, {
        content: value ? `${value}\n${prefix}` : prefix,
      });
      return;
    }

    const start = ta.selectionStart ?? value.length;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const next =
      value.slice(0, lineStart) + prefix + value.slice(lineStart);
    patchMemo(activeMemo.id, { content: next });

    const nextCursor = start + prefix.length;
    window.requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const insertTableTemplate = () => {
    if (!activeMemo) return;
    const ta = textareaRef.current;
    const value = activeMemo.content;
    const pos = ta?.selectionStart ?? value.length;
    const needsLeadingNewline = pos > 0 && value[pos - 1] !== "\n";
    const tableSnippet = `${needsLeadingNewline ? "\n" : ""}| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |\n`;
    const next = value.slice(0, pos) + tableSnippet + value.slice(pos);
    patchMemo(activeMemo.id, { content: next });
    const nextPos = pos + tableSnippet.length;
    window.requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(nextPos, nextPos);
    });
  };

  const handleTextareaKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (!activeMemo) return;
    const ta = e.currentTarget;
    const value = activeMemo.content;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;

    if (e.key === "Tab") {
      e.preventDefault();
      const next = value.slice(0, start) + "  " + value.slice(end);
      patchMemo(activeMemo.id, { content: next });
      window.requestAnimationFrame(() => {
        ta.setSelectionRange(start + 2, start + 2);
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
          patchMemo(activeMemo.id, { content: next });
          window.requestAnimationFrame(() => {
            ta.setSelectionRange(lineStart, lineStart);
          });
        } else {
          const prefix = `\n${taskMatch[1]} ${taskMatch[2]}`;
          const next = value.slice(0, start) + prefix + value.slice(end);
          patchMemo(activeMemo.id, { content: next });
          const nextPos = start + prefix.length;
          window.requestAnimationFrame(() => {
            ta.setSelectionRange(nextPos, nextPos);
          });
        }
        return;
      }

      const ulMatch = /^(\s*[-*+]\s+)(.*)$/.exec(fullLine);
      if (ulMatch && lineToCursor.length >= ulMatch[1].length) {
        e.preventDefault();
        if (!ulMatch[2].trim() && start === lineStart + fullLine.length) {
          const next = value.slice(0, lineStart) + value.slice(start);
          patchMemo(activeMemo.id, { content: next });
          window.requestAnimationFrame(() => {
            ta.setSelectionRange(lineStart, lineStart);
          });
        } else {
          const prefix = `\n${ulMatch[1]}`;
          const next = value.slice(0, start) + prefix + value.slice(end);
          patchMemo(activeMemo.id, { content: next });
          const nextPos = start + prefix.length;
          window.requestAnimationFrame(() => {
            ta.setSelectionRange(nextPos, nextPos);
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
          patchMemo(activeMemo.id, { content: next });
          window.requestAnimationFrame(() => {
            ta.setSelectionRange(lineStart, lineStart);
          });
        } else {
          const nextNum = Number(olMatch[2]) + 1;
          const prefix = `\n${olMatch[1]}${nextNum}${olMatch[3]}`;
          const next = value.slice(0, start) + prefix + value.slice(end);
          patchMemo(activeMemo.id, { content: next });
          const nextPos = start + prefix.length;
          window.requestAnimationFrame(() => {
            ta.setSelectionRange(nextPos, nextPos);
          });
        }
      }
    }
  };

  const renderMemoRow = (memo: MemoItem) => {
    const isSelected = activeMemo?.id === memo.id;
    const daysLeft = getDaysUntilExpiry(memo.expiresAt);
    const urgency = getExpiryUrgency(daysLeft);
    const badgeClass = getExpiryBadgeClass(urgency);
    const preview = stripMarkdownPreview(memo.content);

    return (
      <button
        key={memo.id}
        type="button"
        draggable
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
        className={`flex w-full flex-col gap-1.5 rounded-md border px-3 py-2 text-left transition-colors ${
          isSelected
            ? "border-primary/40 bg-card shadow-card-rest"
            : "border-transparent hover:border-border/70 hover:bg-card/60"
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
          {daysLeft !== null && (
            <span
              className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[11px] leading-none ${badgeClass}`}
            >
              {formatExpiryLabel(daysLeft)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            {memo.tag.trim() || "备忘"}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {preview || "暂无正文..."}
          </span>
        </div>
      </button>
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

          {/* Filter Pills */}
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-0.5">
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

            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setFilter(tag)}
                className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                  filter === tag
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-accent/70 hover:text-foreground"
                }`}
              >
                {tag}
              </button>
            ))}
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
      <div className="flex flex-1 flex-col md:flex-row overflow-hidden">
        {/* Left List & Folder Pane */}
        <aside className="flex max-h-[38vh] md:max-h-none w-full md:w-[290px] lg:w-[320px] shrink-0 flex-col border-b md:border-b-0 md:border-r border-border/70 bg-surface/35 overflow-hidden">
          {/* Sidebar Top Micro-Bar */}
          <div className="flex h-8 shrink-0 items-center justify-between border-b border-border/50 px-2.5">
            <span className="text-[11px] font-medium text-muted-foreground">
              {folders.length > 0 ? `文件夹 ${folders.length}` : "备忘分组"}
            </span>
            <button
              type="button"
              onClick={startCreateFolder}
              className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              <span>新建文件夹</span>
            </button>
          </div>

          {/* Inline Folder Creation Row */}
          {creatingFolder && (
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

          {/* Scrollable List / Folder Tree */}
          <div className="flex-1 overflow-y-auto">
            {folders.length === 0 ? (
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

        {/* Right Detail / Markdown Page Pane */}
        <section className="flex flex-1 flex-col overflow-hidden bg-background">
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
                      onClick={() => handleCopyMemo(activeMemo)}
                      title="复制 Markdown 原文"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleExportMarkdown(activeMemo)}
                      title="导出为 .md 文件"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteTarget(activeMemo)}
                      title="删除备忘"
                      className="hover:bg-destructive/15 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* Compact Metadata Bar */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/50 bg-surface/25 px-5 py-2 text-xs">
                {/* Folder Picker */}
                {folders.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">文件夹</span>
                    <select
                      value={activeFolderValue}
                      onChange={(e) =>
                        moveMemoToFolder(
                          activeMemo.id,
                          e.target.value || undefined
                        )
                      }
                      className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:border-ring/70 focus:outline-none"
                    >
                      <option value="">未分组</option>
                      {folders.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Tag */}
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">标签</span>
                  <input
                    type="text"
                    value={activeMemo.tag}
                    onChange={(e) =>
                      patchMemo(activeMemo.id, { tag: e.target.value })
                    }
                    placeholder="分类"
                    className="h-7 w-20 rounded-md border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-ring/70 focus:outline-none"
                  />
                  <div className="hidden sm:flex items-center gap-1">
                    {PRESET_MEMO_TAGS.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => patchMemo(activeMemo.id, { tag })}
                        className={`rounded px-1.5 py-0.5 text-[11px] transition-colors ${
                          activeMemo.tag.trim() === tag
                            ? "bg-primary/15 font-medium text-primary"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground"
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Expiry Date */}
                <div className="flex items-center gap-1.5">
                  <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">到期日</span>
                  <input
                    type="date"
                    value={activeMemo.expiresAt ?? ""}
                    onChange={(e) =>
                      patchMemo(activeMemo.id, {
                        expiresAt: e.target.value || undefined,
                      })
                    }
                    className="h-7 rounded-md border border-border bg-background px-2 font-mono text-xs text-foreground focus:border-ring/70 focus:outline-none"
                  />
                  {activeMemo.expiresAt && (
                    <button
                      type="button"
                      onClick={() =>
                        patchMemo(activeMemo.id, { expiresAt: undefined })
                      }
                      title="清除到期日"
                      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                  {activeDaysLeft !== null && (
                    <span
                      className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${getExpiryBadgeClass(
                        activeUrgency
                      )}`}
                    >
                      {formatExpiryLabel(activeDaysLeft)}
                    </span>
                  )}
                </div>

                {/* Renewal Cycle & One-Click Renew */}
                {activeMemo.expiresAt && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">周期</span>
                    <select
                      value={activeMemo.renewDays ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        patchMemo(activeMemo.id, {
                          renewDays: val ? Number(val) : undefined,
                        });
                      }}
                      className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:border-ring/70 focus:outline-none"
                    >
                      <option value="">不自动续期</option>
                      {RENEW_DAY_PRESETS.map((p) => (
                        <option key={p.days} value={p.days}>
                          {p.label}
                        </option>
                      ))}
                    </select>

                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => handleRenewMemo(activeMemo)}
                      className="h-7 px-2 text-xs"
                    >
                      <RefreshCw className="h-3 w-3" />
                      已续期 +{activeMemo.renewDays || 365}天
                    </Button>
                  </div>
                )}
              </div>

              {/* Markdown Formatting Toolbar (edit & split modes) */}
              {editorMode !== "preview" && (
                <div className="flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/50 bg-surface/20 px-4">
                  <button
                    type="button"
                    onClick={() => applyLinePrefix("## ")}
                    title="二级标题 (##)"
                    className="inline-flex h-6 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Heading2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyWrapOrInsert("**", "**", "加粗文本")}
                    title="加粗 (**text**)"
                    className="inline-flex h-6 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Bold className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyWrapOrInsert("*", "*", "斜体文本")}
                    title="斜体 (*text*)"
                    className="inline-flex h-6 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Italic className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyWrapOrInsert("~~", "~~", "删除线")}
                    title="删除线 (~~text~~)"
                    className="inline-flex h-6 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Strikethrough className="h-3.5 w-3.5" />
                  </button>

                  <div className="mx-1 h-3.5 w-px bg-border/80" />

                  <button
                    type="button"
                    onClick={() => applyWrapOrInsert("`", "`", "code")}
                    title="行内代码 (`code`)"
                    className="inline-flex h-6 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Code className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      applyWrapOrInsert("```\n", "\n```", "# 命令或配置")
                    }
                    title="代码块 (```)"
                    className="inline-flex h-6 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <FileCode2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyLinePrefix("> ")}
                    title="引用 (>)"
                    className="inline-flex h-6 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Quote className="h-3.5 w-3.5" />
                  </button>

                  <div className="mx-1 h-3.5 w-px bg-border/80" />

                  <button
                    type="button"
                    onClick={() => applyLinePrefix("- ")}
                    title="无序列表 (- )"
                    className="inline-flex h-6 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <List className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyLinePrefix("- [ ] ")}
                    title="待办复选框 (- [ ] )"
                    className="inline-flex h-6 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <CheckSquare className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={insertTableTemplate}
                    title="插入 Markdown 表格"
                    className="inline-flex h-6 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Table2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      applyWrapOrInsert("[", "](https://)", "链接文字")
                    }
                    title="插入链接 ([text](url))"
                    className="inline-flex h-6 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {/* Editor / Split / Preview Body */}
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {editorMode === "edit" && (
                  <div className="flex min-h-0 flex-1 flex-col px-5 py-3">
                    <textarea
                      ref={textareaRef}
                      value={activeMemo.content}
                      onChange={(e) =>
                        patchMemo(activeMemo.id, { content: e.target.value })
                      }
                      onKeyDown={handleTextareaKeyDown}
                      placeholder={`支持 Markdown 语法：\n## 今日重点 / 运维记录\n- [ ] 待办事项\n- 腾讯云 A (10.0.0.2) -> B (10.0.0.8:8080)\n\n| 字段 | 值 |\n| --- | --- |\n| 域名 | example.com |`}
                      className="min-h-0 flex-1 w-full resize-none overflow-y-auto bg-transparent font-mono text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground/45 select-text focus:outline-none"
                    />
                  </div>
                )}

                {editorMode === "preview" && (
                  <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
                    <MarkdownPreview
                      content={activeMemo.content}
                      onToggleCheckbox={(lineIdx) =>
                        patchMemo(activeMemo.id, {
                          content: toggleMarkdownCheckbox(
                            activeMemo.content,
                            lineIdx
                          ),
                        })
                      }
                      onNotify={onNotify}
                      className="mx-auto max-w-3xl"
                    />
                  </div>
                )}

                {editorMode === "split" && (
                  <div className="flex min-h-0 flex-1 flex-col lg:flex-row overflow-hidden">
                    <div className="flex min-h-0 flex-1 flex-col border-b lg:border-b-0 lg:border-r border-border/60 px-5 py-3">
                      <textarea
                        ref={textareaRef}
                        value={activeMemo.content}
                        onChange={(e) =>
                          patchMemo(activeMemo.id, { content: e.target.value })
                        }
                        onKeyDown={handleTextareaKeyDown}
                        placeholder={`支持 Markdown 语法：\n## 今日重点 / 运维记录\n- [ ] 待办事项\n- 腾讯云 A -> B 反代配置`}
                        className="min-h-0 flex-1 w-full resize-none overflow-y-auto bg-transparent font-mono text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground/45 select-text focus:outline-none"
                      />
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto bg-surface/15 px-5 py-3">
                      <MarkdownPreview
                        content={activeMemo.content}
                        onToggleCheckbox={(lineIdx) =>
                          patchMemo(activeMemo.id, {
                            content: toggleMarkdownCheckbox(
                              activeMemo.content,
                              lineIdx
                            ),
                          })
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
