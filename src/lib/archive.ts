import { ProjectDateMode } from "../types";
import { isTauriRuntime, openPathInOs } from "./storage";

export interface ArchiveScanEntry {
  name: string;
  path: string;
  root_path: string;
  relative_path: string;
  is_dir: boolean;
  is_project: boolean;
  ext: string;
  size: number;
  modified_ms: number;
  context_year: number | null;
  context_month: number | null;
  child_count: number;
  thumbnail_path: string | null;
  real_date_ms?: number | null;
}

export interface ParsedArchiveDate {
  year: number | null;
  month: number | null;
  day: number | null;
  dateLabel: string; // e.g. "2025-10-10", "2025-10", "2021", or ""
  sortKey: number; // YYYYMMDD integer for fast descending sort
  displayTitle: string; // cleaned title without leading date prefix
  source: "name" | "files" | "folder" | "mtime" | "none";
}

export interface IndexedArchiveItem extends ArchiveScanEntry {
  year: number | null;
  month: number | null;
  day: number | null;
  dateLabel: string;
  sortKey: number;
  displayTitle: string;
  dateSource: "name" | "files" | "folder" | "mtime" | "none";
  searchNameLower: string;
  searchPathLower: string;
  searchDateLower: string;
}

function isValidYMD(y: number, m: number, d: number): boolean {
  return y >= 1990 && y <= 2099 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function cleanTitleAfterDate(rawName: string, matchedPrefix: string): string {
  const rest = rawName
    .slice(matchedPrefix.length)
    .replace(/^[\s_\-—·.、:：]+/, "")
    .trim();
  return rest || rawName;
}

/**
 * Parses a wide variety of Chinese & international date naming conventions:
 * - 2025-10-10_xxx / 2025.10.10 xxx / 2025/10/10 / 2025_10_10
 * - 2025年10月10日 / 2025年10月
 * - 20210913_xxx (YYYYMMDD)
 * - 25-02-19 xxx / 25.02.19 (YY-MM-DD)
 * - 250219 xxx (YYMMDD)
 * - 0103 xxx (MMDD with contextYear from parent folder like #2025)
 * - 3月19日 / 03-19 / 3.19 (with contextYear)
 * - Falls back to parent year/month container folder, then file modified time.
 */
function dateFromMs(
  ms: number | null | undefined,
  displayTitle: string,
  source: "files" | "mtime"
): ParsedArchiveDate | null {
  if (!ms || ms <= 0) return null;
  const dt = new Date(ms);
  if (Number.isNaN(dt.getTime())) return null;
  const y = dt.getFullYear();
  const mo = dt.getMonth() + 1;
  const d = dt.getDate();
  if (!isValidYMD(y, mo, d)) return null;
  return {
    year: y,
    month: mo,
    day: d,
    dateLabel: `${y}-${pad2(mo)}-${pad2(d)}`,
    sortKey: y * 10000 + mo * 100 + d,
    displayTitle,
    source,
  };
}

export function parseArchiveDate(
  name: string,
  contextYear: number | null,
  contextMonth: number | null,
  modifiedMs: number,
  realDateMs?: number | null,
  dateMode: ProjectDateMode = "name_first"
): ParsedArchiveDate {
  const trimmed = name.trim();
  const baseNoExt = trimmed.replace(/\.[^./\\]{1,8}$/, "");

  const parseFromName = (): ParsedArchiveDate | null => {
    // 1. YYYY[-./_]M[-./_]D at start
    let m = trimmed.match(
      /^#?((?:19|20)\d{2})[-./_年](\d{1,2})[-./_月](\d{1,2})日?/
    );
    if (m) {
      const y = +m[1],
        mo = +m[2],
        d = +m[3];
      if (isValidYMD(y, mo, d)) {
        return {
          year: y,
          month: mo,
          day: d,
          dateLabel: `${y}-${pad2(mo)}-${pad2(d)}`,
          sortKey: y * 10000 + mo * 100 + d,
          displayTitle: cleanTitleAfterDate(trimmed, m[0]),
          source: "name",
        };
      }
    }

    // 2. YYYYMMDD at start (8 digits)
    m = trimmed.match(/^#?((?:19|20)\d{2})(\d{2})(\d{2})(?!\d)/);
    if (m) {
      const y = +m[1],
        mo = +m[2],
        d = +m[3];
      if (isValidYMD(y, mo, d)) {
        return {
          year: y,
          month: mo,
          day: d,
          dateLabel: `${y}-${pad2(mo)}-${pad2(d)}`,
          sortKey: y * 10000 + mo * 100 + d,
          displayTitle: cleanTitleAfterDate(trimmed, m[0]),
          source: "name",
        };
      }
    }

    // 3. YY[-./_]MM[-./_]DD at start
    m = trimmed.match(/^#?(\d{2})[-./_](\d{1,2})[-./_](\d{1,2})(?!\d)/);
    if (m) {
      const y = 2000 + +m[1],
        mo = +m[2],
        d = +m[3];
      if (isValidYMD(y, mo, d)) {
        return {
          year: y,
          month: mo,
          day: d,
          dateLabel: `${y}-${pad2(mo)}-${pad2(d)}`,
          sortKey: y * 10000 + mo * 100 + d,
          displayTitle: cleanTitleAfterDate(trimmed, m[0]),
          source: "name",
        };
      }
    }

    // 4. YYMMDD at start (6 digits)
    m = trimmed.match(/^#?(\d{2})(\d{2})(\d{2})(?!\d)/);
    if (m) {
      const y = 2000 + +m[1],
        mo = +m[2],
        d = +m[3];
      if (isValidYMD(y, mo, d)) {
        return {
          year: y,
          month: mo,
          day: d,
          dateLabel: `${y}-${pad2(mo)}-${pad2(d)}`,
          sortKey: y * 10000 + mo * 100 + d,
          displayTitle: cleanTitleAfterDate(trimmed, m[0]),
          source: "name",
        };
      }
    }

    // 5. MMDD at start (4 digits like "0103 宁炮-CAD图") with contextYear
    m = trimmed.match(/^(\d{2})(\d{2})(?=[\s_\-—·\u4e00-\u9fa5a-zA-Z]|$)/);
    if (m && contextYear) {
      const mo = +m[1],
        d = +m[2];
      if (isValidYMD(contextYear, mo, d)) {
        return {
          year: contextYear,
          month: mo,
          day: d,
          dateLabel: `${contextYear}-${pad2(mo)}-${pad2(d)}`,
          sortKey: contextYear * 10000 + mo * 100 + d,
          displayTitle: cleanTitleAfterDate(trimmed, m[0]),
          source: "name",
        };
      }
    }

    // 6. M月D日 or M.D or M-D at start with contextYear
    m = trimmed.match(
      /^(\d{1,2})[月.-](\d{1,2})日?(?=[\s_\-—·\u4e00-\u9fa5a-zA-Z]|$)/
    );
    if (m && contextYear) {
      const mo = +m[1],
        d = +m[2];
      if (isValidYMD(contextYear, mo, d)) {
        return {
          year: contextYear,
          month: mo,
          day: d,
          dateLabel: `${contextYear}-${pad2(mo)}-${pad2(d)}`,
          sortKey: contextYear * 10000 + mo * 100 + d,
          displayTitle: cleanTitleAfterDate(trimmed, m[0]),
          source: "name",
        };
      }
    }

    // 7. YYYY-MM / YYYY.MM / YYYY年M月 at start
    m = trimmed.match(/^#?((?:19|20)\d{2})[-./_年](\d{1,2})月?(?!\d)/);
    if (m) {
      const y = +m[1],
        mo = +m[2];
      if (y >= 1990 && y <= 2099 && mo >= 1 && mo <= 12) {
        return {
          year: y,
          month: mo,
          day: null,
          dateLabel: `${y}-${pad2(mo)}`,
          sortKey: y * 10000 + mo * 100,
          displayTitle: cleanTitleAfterDate(trimmed, m[0]),
          source: "name",
        };
      }
    }

    // 8. Embedded YYYY-MM-DD or YYYYMMDD anywhere in name
    m = baseNoExt.match(/((?:19|20)\d{2})[-./_]?(\d{2})[-./_]?(\d{2})(?!\d)/);
    if (m) {
      const y = +m[1],
        mo = +m[2],
        d = +m[3];
      if (isValidYMD(y, mo, d)) {
        return {
          year: y,
          month: mo,
          day: d,
          dateLabel: `${y}-${pad2(mo)}-${pad2(d)}`,
          sortKey: y * 10000 + mo * 100 + d,
          displayTitle: trimmed,
          source: "name",
        };
      }
    }

    return null;
  };

  const nameParsed = parseFromName();
  const cleanTitle = nameParsed?.displayTitle ?? trimmed;

  // Mode 1: Prefer weighted real file modification date cluster
  if (dateMode === "files_first") {
    const byFiles = dateFromMs(realDateMs, cleanTitle, "files");
    if (byFiles) return byFiles;
  }

  // Explicit date in folder/file name
  if (nameParsed) return nameParsed;

  // Mode 2 (default "name_first"): when name has no date, infer real date from inner files before parent folder / mtime
  if (dateMode === "name_first") {
    const byFiles = dateFromMs(realDateMs, trimmed, "files");
    if (byFiles) return byFiles;
  }

  // Fallback: inherit from parent Year / Month container folder
  if (contextYear) {
    const mo = contextMonth ?? null;
    return {
      year: contextYear,
      month: mo,
      day: null,
      dateLabel: mo ? `${contextYear}-${pad2(mo)}` : `${contextYear}`,
      sortKey: contextYear * 10000 + (mo ?? 0) * 100,
      displayTitle: trimmed,
      source: "folder",
    };
  }

  // Final fallback: folder/file own modification timestamp
  const byMtime = dateFromMs(modifiedMs, trimmed, "mtime");
  if (byMtime) return byMtime;

  return {
    year: null,
    month: null,
    day: null,
    dateLabel: "",
    sortKey: 0,
    displayTitle: trimmed,
    source: "none",
  };
}

export function buildArchiveIndex(
  rawEntries: ArchiveScanEntry[],
  dateMode: ProjectDateMode = "name_first"
): IndexedArchiveItem[] {
  const items: IndexedArchiveItem[] = rawEntries.map((entry) => {
    const parsed = parseArchiveDate(
      entry.name,
      entry.context_year,
      entry.context_month,
      entry.modified_ms,
      entry.real_date_ms,
      dateMode
    );
    return {
      ...entry,
      year: parsed.year,
      month: parsed.month,
      day: parsed.day,
      dateLabel: parsed.dateLabel,
      sortKey: parsed.sortKey,
      displayTitle: parsed.displayTitle,
      dateSource: parsed.source,
      searchNameLower: entry.name.toLowerCase(),
      searchPathLower: entry.relative_path.toLowerCase(),
      searchDateLower: parsed.dateLabel.toLowerCase(),
    };
  });

  items.sort((a, b) => {
    if (b.sortKey !== a.sortKey) return b.sortKey - a.sortKey;
    return (b.real_date_ms ?? b.modified_ms) - (a.real_date_ms ?? a.modified_ms);
  });

  return items;
}

export function reapplyArchiveDateMode(
  items: IndexedArchiveItem[],
  dateMode: ProjectDateMode
): IndexedArchiveItem[] {
  return buildArchiveIndex(items, dateMode);
}

interface ArchiveIndexCachePayload {
  roots: string[];
  updated_at_ms: number;
  entries: ArchiveScanEntry[];
}

interface MemoryArchiveCache {
  rootsKey: string;
  updatedAtMs: number;
  items: IndexedArchiveItem[];
}

const BROWSER_ARCHIVE_CACHE_KEY = "shibaplan_project_archive_cache_v1";
let memoryArchiveCache: MemoryArchiveCache | null = null;

function makeRootsKey(roots: string[]): string {
  return roots
    .map((r) => r.trim().replace(/^"|"$/g, "").toLowerCase())
    .filter(Boolean)
    .sort()
    .join("|");
}

export function getMemoryArchiveCache(
  roots: string[]
): { items: IndexedArchiveItem[]; updatedAtMs: number } | null {
  const key = makeRootsKey(roots);
  if (!key || !memoryArchiveCache || memoryArchiveCache.rootsKey !== key) {
    return null;
  }
  return {
    items: memoryArchiveCache.items,
    updatedAtMs: memoryArchiveCache.updatedAtMs,
  };
}

export async function loadCachedProjectArchive(
  roots: string[],
  customDataDir?: string
): Promise<{ items: IndexedArchiveItem[]; updatedAtMs: number } | null> {
  const key = makeRootsKey(roots);
  if (!key) return null;

  const mem = getMemoryArchiveCache(roots);
  if (mem) return mem;

  try {
    let payload: ArchiveIndexCachePayload | null = null;
    if (isTauriRuntime()) {
      const { invoke } = await import("@tauri-apps/api/core");
      payload = await invoke<ArchiveIndexCachePayload | null>(
        "load_project_archive_cache",
        { customDir: customDataDir?.trim() || null }
      );
    } else {
      const raw = localStorage.getItem(BROWSER_ARCHIVE_CACHE_KEY);
      if (raw) payload = JSON.parse(raw) as ArchiveIndexCachePayload;
    }

    if (!payload || !Array.isArray(payload.entries)) return null;
    if (makeRootsKey(payload.roots || []) !== key) return null;

    const items = buildArchiveIndex(payload.entries);
    memoryArchiveCache = {
      rootsKey: key,
      updatedAtMs: payload.updated_at_ms || Date.now(),
      items,
    };
    return { items, updatedAtMs: memoryArchiveCache.updatedAtMs };
  } catch {
    return null;
  }
}

export async function scanProjectArchiveRoots(
  roots: string[],
  customDataDir?: string
): Promise<{ items: IndexedArchiveItem[]; updatedAtMs: number }> {
  const cleanRoots = roots.map((r) => r.trim()).filter(Boolean);
  if (cleanRoots.length === 0) {
    memoryArchiveCache = null;
    return { items: [], updatedAtMs: Date.now() };
  }

  let raw: ArchiveScanEntry[];
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    raw = await invoke<ArchiveScanEntry[]>("scan_project_archive_roots", {
      roots: cleanRoots,
      customDir: customDataDir?.trim() || null,
    });
  } else {
    // Vite dev server local fallback so testing in browser tab works seamlessly
    const res = await fetch("/api/dev-archive/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roots: cleanRoots }),
    });
    if (!res.ok) {
      throw new Error("请在桌面端或本地开发环境下索引本地文件夹");
    }
    raw = (await res.json()) as ArchiveScanEntry[];
    try {
      const cacheObj: ArchiveIndexCachePayload = {
        roots: cleanRoots,
        updated_at_ms: Date.now(),
        entries: raw,
      };
      localStorage.setItem(BROWSER_ARCHIVE_CACHE_KEY, JSON.stringify(cacheObj));
    } catch {
      // Ignore quota errors in browser mode
    }
  }

  const items = buildArchiveIndex(raw);
  const updatedAtMs = Date.now();
  memoryArchiveCache = {
    rootsKey: makeRootsKey(cleanRoots),
    updatedAtMs,
    items,
  };
  return { items, updatedAtMs };
}

export async function openArchivePath(targetPath: string): Promise<void> {
  if (isTauriRuntime()) {
    await openPathInOs(targetPath);
    return;
  }
  await fetch("/api/dev-archive/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: targetPath }),
  }).catch(() => {});
}

export interface ExplorerEntry {
  name: string;
  path: string;
  is_dir: boolean;
  ext: string;
  size: number;
  modified_ms: number;
}

const IMAGE_EXTS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "bmp",
  "svg",
  "avif",
]);

const TEXT_EXTS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "xml",
  "yaml",
  "yml",
  "toml",
  "ini",
  "csv",
  "log",
  "ts",
  "tsx",
  "js",
  "jsx",
  "css",
  "html",
  "py",
  "rs",
  "c",
  "cpp",
  "h",
  "ino",
  "iss",
  "bat",
  "ps1",
  "sh",
  "sql",
]);

export function isPreviewableImageExt(ext: string): boolean {
  return IMAGE_EXTS.has(ext.toLowerCase());
}

export function isPreviewableTextExt(ext: string): boolean {
  return TEXT_EXTS.has(ext.toLowerCase());
}

export async function listProjectExplorerEntries(
  folderPath: string
): Promise<ExplorerEntry[]> {
  if (!folderPath.trim()) return [];
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<ExplorerEntry[]>("list_project_explorer_entries", {
      folderPath,
    });
  }
  return [];
}

export async function readFileTextPreview(path: string): Promise<string> {
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("read_file_text_preview", { path });
  }
  return "";
}

export async function triggerSeerPreview(
  targetPath: string
): Promise<"seer" | "quicklook" | "builtin"> {
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const res = await invoke<string>("trigger_seer_preview", { targetPath });
    if (res === "seer" || res === "quicklook") return res;
  }
  return "builtin";
}

export async function pickArchiveFolder(): Promise<string | null> {
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string | null>("pick_folder_path");
  }
  return null;
}

const thumbnailCache = new Map<string, string | null>();
const thumbnailInflight = new Map<string, Promise<string | null>>();
let activeThumbLoads = 0;
const thumbQueue: (() => void)[] = [];

function acquireThumbSlot(): Promise<void> {
  if (activeThumbLoads < 4) {
    activeThumbLoads++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    thumbQueue.push(() => {
      activeThumbLoads++;
      resolve();
    });
  });
}

function releaseThumbSlot(): void {
  activeThumbLoads = Math.max(0, activeThumbLoads - 1);
  const next = thumbQueue.shift();
  if (next) next();
}

export async function loadArchiveThumbnail(
  filePath: string,
  customDataDir?: string
): Promise<string | null> {
  if (!filePath) return null;
  if (thumbnailCache.has(filePath)) {
    return thumbnailCache.get(filePath) ?? null;
  }
  const existing = thumbnailInflight.get(filePath);
  if (existing) return existing;

  const task = (async () => {
    await acquireThumbSlot();
    try {
      if (isTauriRuntime()) {
        const { invoke } = await import("@tauri-apps/api/core");
        const dataUrl = await invoke<string>("read_archive_thumbnail", {
          path: filePath,
          customDir: customDataDir?.trim() || null,
        });
        thumbnailCache.set(filePath, dataUrl);
        return dataUrl;
      }
      const url = `/api/dev-archive/thumb?path=${encodeURIComponent(filePath)}`;
      thumbnailCache.set(filePath, url);
      return url;
    } catch {
      thumbnailCache.set(filePath, null);
      return null;
    } finally {
      releaseThumbSlot();
      thumbnailInflight.delete(filePath);
    }
  })();

  thumbnailInflight.set(filePath, task);
  return task;
}

function wildcardToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(escaped, "i");
}

function matchSingleAtom(item: IndexedArchiveItem, atom: string): number {
  const lower = atom.toLowerCase();
  if (!lower) return 1;

  if (lower === "folder:" || lower === "dir:") {
    return item.is_dir ? 10 : 0;
  }
  if (lower === "file:") {
    return !item.is_dir ? 10 : 0;
  }
  if (lower.startsWith("ext:")) {
    const exts = lower
      .slice(4)
      .split(/[;,]/)
      .map((e) => e.replace(/^\./, "").trim())
      .filter(Boolean);
    if (exts.length === 0) return 1;
    return !item.is_dir && exts.includes(item.ext) ? 15 : 0;
  }
  if (lower.startsWith("year:")) {
    const y = lower.slice(5).trim();
    if (!y) return 1;
    return item.year !== null && String(item.year) === y ? 12 : 0;
  }
  if (lower.startsWith("date:")) {
    const d = lower.slice(5).trim();
    if (!d) return 1;
    return item.searchDateLower.includes(d) ? 12 : 0;
  }

  // Wildcard matching (* or ?)
  if (lower.includes("*") || lower.includes("?")) {
    const re = wildcardToRegex(lower);
    if (re.test(item.name)) return 20;
    if (re.test(item.relative_path)) return 8;
    return 0;
  }

  // Fast substring scoring (Everything-style: filename > date > path)
  const nameIdx = item.searchNameLower.indexOf(lower);
  if (nameIdx === 0) return 30;
  if (nameIdx > 0) return 22;
  if (item.searchDateLower && item.searchDateLower.includes(lower)) return 16;
  if (item.searchPathLower.includes(lower)) return 10;

  return 0;
}

export interface SearchHighlightInfo {
  items: IndexedArchiveItem[];
  highlightTerms: string[];
}

/**
 * Everything-style instant search:
 * - Space-separated tokens = AND
 * - `|` = OR (e.g. `海报|画册|logo`)
 * - `!term` = NOT / exclude
 * - `ext:pdf;psd`, `folder:`, `file:`, `year:2025`, `date:2025-10`, `*` / `?`
 */
export function searchArchiveItems(
  allItems: IndexedArchiveItem[],
  query: string
): SearchHighlightInfo {
  const trimmed = query.trim();
  if (!trimmed) {
    return { items: allItems, highlightTerms: [] };
  }

  const rawTokens = trimmed.split(/\s+/).filter(Boolean);
  const highlightTerms: string[] = [];

  for (const tok of rawTokens) {
    if (tok.startsWith("!")) continue;
    for (const part of tok.split("|")) {
      const clean = part.trim();
      if (
        clean &&
        !clean.includes(":") &&
        !clean.includes("*") &&
        !clean.includes("?")
      ) {
        highlightTerms.push(clean);
      }
    }
  }

  const scored: { item: IndexedArchiveItem; score: number }[] = [];

  for (const item of allItems) {
    let totalScore = 0;
    let matchedAll = true;

    for (const tok of rawTokens) {
      if (tok.startsWith("!") && tok.length > 1) {
        const neg = tok.slice(1);
        const negParts = neg.split("|").filter(Boolean);
        const anyNegMatch = negParts.some((p) => matchSingleAtom(item, p) > 0);
        if (anyNegMatch) {
          matchedAll = false;
          break;
        }
        continue;
      }

      const orParts = tok.split("|").filter(Boolean);
      let bestOr = 0;
      for (const part of orParts) {
        const s = matchSingleAtom(item, part);
        if (s > bestOr) bestOr = s;
      }
      if (bestOr === 0) {
        matchedAll = false;
        break;
      }
      totalScore += bestOr;
    }

    if (matchedAll) {
      // Slightly boost top-level projects over nested files on tie
      if (item.is_project) totalScore += 4;
      scored.push({ item, score: totalScore });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.item.sortKey !== a.item.sortKey) return b.item.sortKey - a.item.sortKey;
    return b.item.modified_ms - a.item.modified_ms;
  });

  return {
    items: scored.map((s) => s.item),
    highlightTerms,
  };
}
