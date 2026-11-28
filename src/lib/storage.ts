import { IdeaItem, InfoBoard, WorkspaceData } from "../types";

export function createDefaultInfoBoards(): InfoBoard[] {
  return [
    {
      id: "board-default",
      name: "默认画布",
      layoutMode: "free",
      showGrid: true,
      locked: false,
      cols: 12,
      rowHeight: 52,
    },
  ];
}

const LOCAL_STORAGE_KEY = "shibaplan_workspace_v2";

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function detectSystemLocale(): string {
  if (typeof navigator !== "undefined" && navigator.language) {
    return navigator.language.toLowerCase().startsWith("zh")
      ? "zh-CN"
      : "en-US";
  }
  return "zh-CN";
}

export function createDefaultWorkspace(): WorkspaceData {
  const now = new Date().toISOString();
  return {
    columns: [],
    projects: [],
    tasks: [],
    ideas: [
      {
        id: "idea-seed-1",
        content:
          "评测过程中发现频繁切换窗口会打断思路，可以用全局快捷键随手记录灵感与截图，之后再整理成 AI Prompt。",
        tag: "评测",
        createdAt: now,
      },
      {
        id: "idea-seed-2",
        content:
          "视觉规范需要统一留白与层级，减少多余边框，突出当前正在推进的核心任务。",
        tag: "设计",
        createdAt: now,
      },
      {
        id: "idea-seed-3",
        content:
          "把本地数据存成 Markdown 与 JSON，方便后续直接让 AI 编程助手读取上下文并完善功能。",
        tag: "开发",
        createdAt: now,
      },
    ],
    trashedIdeas: [],
    memos: [],
    trashedMemos: [],
    memoFolders: [],
    focusLogs: [],
    infoBoards: createDefaultInfoBoards(),
    infoWidgets: [],
    settings: {
      customDataDir: "",
      shortcutLabel: "Ctrl + Shift + Space",
      locale: detectSystemLocale(),
      customLocales: [],
      theme: "dark",
      paperGrain: true,
      riverAtmosphere: true,
      accentColor: undefined,
      enterToSave: true,
      columnGap: 16,
      ai: {
        providerId: "zhipu",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        apiKey: "",
        model: "glm-4-flash",
        profiles: {},
      },
      projectArchiveDirs: [],
      projectDateMode: "name_first",
      starredProjects: [],
      infoPush: {
        enabled: true,
        port: 18421,
        allowLan: false,
        autoCreate: true,
      },
    },
  };
}

function normalizeWorkspace(raw: Partial<WorkspaceData>): WorkspaceData {
  const fallback = createDefaultWorkspace();
  return {
    columns: Array.isArray(raw.columns) ? raw.columns : [],
    projects: Array.isArray(raw.projects) ? raw.projects : [],
    tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
    ideas: Array.isArray(raw.ideas) ? raw.ideas : fallback.ideas,
    trashedIdeas: Array.isArray(raw.trashedIdeas) ? raw.trashedIdeas : [],
    memos: Array.isArray(raw.memos) ? raw.memos : [],
    trashedMemos: Array.isArray(raw.trashedMemos) ? raw.trashedMemos : [],
    memoFolders: Array.isArray(raw.memoFolders) ? raw.memoFolders : [],
    focusLogs: Array.isArray(raw.focusLogs) ? raw.focusLogs : [],
    infoBoards:
      Array.isArray(raw.infoBoards) && raw.infoBoards.length > 0
        ? raw.infoBoards
        : createDefaultInfoBoards(),
    infoWidgets: Array.isArray(raw.infoWidgets) ? raw.infoWidgets : [],
    settings: {
      ...(raw.settings ?? {}),
      customDataDir: raw.settings?.customDataDir ?? "",
      shortcutLabel: raw.settings?.shortcutLabel ?? "Ctrl + Shift + Space",
      locale: raw.settings?.locale ?? "zh-CN",
      customLocales: Array.isArray(raw.settings?.customLocales)
        ? raw.settings.customLocales
        : [],
      theme:
        raw.settings?.theme === "light" || raw.settings?.theme === "paper"
          ? raw.settings.theme
          : "dark",
      paperGrain: raw.settings?.paperGrain ?? true,
      riverAtmosphere: raw.settings?.riverAtmosphere ?? true,
      accentColor:
        typeof raw.settings?.accentColor === "string" &&
        raw.settings.accentColor.trim()
          ? raw.settings.accentColor.trim()
          : undefined,
      enterToSave: raw.settings?.enterToSave ?? true,
      columnGap:
        typeof raw.settings?.columnGap === "number"
          ? raw.settings.columnGap
          : 16,
      ai: {
        providerId: raw.settings?.ai?.providerId,
        baseUrl:
          raw.settings?.ai?.baseUrl ?? "https://open.bigmodel.cn/api/paas/v4",
        apiKey: raw.settings?.ai?.apiKey ?? "",
        model: raw.settings?.ai?.model ?? "glm-4-flash",
        profiles:
          raw.settings?.ai?.profiles &&
          typeof raw.settings.ai.profiles === "object"
            ? raw.settings.ai.profiles
            : {},
      },
      projectArchiveDirs: Array.isArray(raw.settings?.projectArchiveDirs)
        ? raw.settings.projectArchiveDirs
        : [],
      projectDateMode:
        raw.settings?.projectDateMode === "files_first" ||
        raw.settings?.projectDateMode === "name_only"
          ? raw.settings.projectDateMode
          : "name_first",
      starredProjects: Array.isArray(raw.settings?.starredProjects)
        ? raw.settings.starredProjects
        : [],
      infoPush: {
        enabled: raw.settings?.infoPush?.enabled ?? true,
        port:
          typeof raw.settings?.infoPush?.port === "number" &&
          raw.settings.infoPush.port >= 1024 &&
          raw.settings.infoPush.port <= 65535
            ? raw.settings.infoPush.port
            : 18421,
        allowLan: raw.settings?.infoPush?.allowLan ?? false,
        autoCreate: raw.settings?.infoPush?.autoCreate ?? true,
      },
    },
  };
}

export async function getDefaultDataDir(): Promise<string> {
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("get_default_data_dir");
  }
  return "~/Documents/ShibaPlan";
}

export interface WorkspaceSnapshotInfo {
  name: string;
  date: string;
  size: number;
  path: string;
}

export async function listWorkspaceSnapshots(
  customDataDir?: string
): Promise<WorkspaceSnapshotInfo[]> {
  if (!isTauriRuntime()) return [];
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<WorkspaceSnapshotInfo[]>("list_workspace_snapshots", {
      customDir: customDataDir?.trim() || null,
    });
  } catch {
    return [];
  }
}

export async function restoreWorkspaceSnapshot(
  snapshotPath: string
): Promise<WorkspaceData> {
  const { invoke } = await import("@tauri-apps/api/core");
  const raw = await invoke<string>("restore_workspace_snapshot", {
    snapshotPath,
  });
  return normalizeWorkspace(JSON.parse(raw) as Partial<WorkspaceData>);
}

export async function revealPathInOs(targetPath: string): Promise<void> {
  if (!isTauriRuntime()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("reveal_path_in_os", { targetPath });
}

export interface LanInterface {
  name: string;
  ip: string;
}

export interface LanServerInfo {
  running: boolean;
  ip: string;
  port: number;
  url: string;
  interfaces?: LanInterface[];
}

let lanApiAvailable: boolean | null = null;

export async function getLanServerInfo(): Promise<LanServerInfo | null> {
  if (!isTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<LanServerInfo>("get_lan_server_info");
}

export async function startLanServer(
  port?: number,
  customDir?: string
): Promise<LanServerInfo> {
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<LanServerInfo>("start_lan_server", {
    port: port ?? null,
    customDir: customDir || null,
  });
}

export async function stopLanServer(): Promise<LanServerInfo> {
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<LanServerInfo>("stop_lan_server");
}

export async function loadWorkspace(customDir?: string): Promise<WorkspaceData> {
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const raw = await invoke<string | null>("load_workspace_data", {
        customDir: customDir || null,
      });
      if (raw) {
        return normalizeWorkspace(JSON.parse(raw));
      }
    } catch (err) {
      console.error("Failed to load from Tauri:", err);
    }
  } else {
    // Try LAN API first when opened from mobile browser via ShibaPlan LAN server
    if (lanApiAvailable !== false) {
      try {
        const res = await fetch("/api/workspace", { cache: "no-store" });
        const ct = res.headers.get("content-type") || "";
        if (res.ok && ct.includes("application/json")) {
          lanApiAvailable = true;
          const parsed = await res.json();
          if (parsed && typeof parsed === "object") {
            return normalizeWorkspace(parsed);
          }
        } else {
          lanApiAvailable = false;
        }
      } catch {
        lanApiAvailable = false;
      }
    }

    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      try {
        return normalizeWorkspace(JSON.parse(raw));
      } catch {
        // fallback
      }
    }
  }
  return createDefaultWorkspace();
}

export async function saveWorkspace(data: WorkspaceData): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  lastSavedJson = json;
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke<string>("save_workspace_data", {
      dataJson: json,
      customDir: data.settings.customDataDir || null,
    });
  } else {
    localStorage.setItem(LOCAL_STORAGE_KEY, json);
    if (lanApiAvailable) {
      await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: json,
      }).catch(() => {});
    }
  }
}

// ---- Debounced, serialized saving ----------------------------------------
// Rapid edits (typing, dragging) are coalesced into one write, and writes are
// chained so an older snapshot can never land on disk after a newer one.

let lastSavedJson: string | null = null;
let pendingSave: WorkspaceData | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveChain: Promise<void> = Promise.resolve();
const SAVE_DEBOUNCE_MS = 400;

/** True when a `workspace-updated` payload is just the echo of our own save. */
export function isOwnSaveEcho(payload: string): boolean {
  return lastSavedJson !== null && payload === lastSavedJson;
}

/** True while there are local edits that have not been written yet. */
export function hasPendingSave(): boolean {
  return pendingSave !== null;
}

export function flushPendingSave(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const data = pendingSave;
  pendingSave = null;
  if (data) {
    saveChain = saveChain
      .then(() => saveWorkspace(data))
      .catch((err) => console.error("Failed to save workspace:", err));
  }
  return saveChain;
}

export function scheduleSaveWorkspace(data: WorkspaceData): void {
  pendingSave = data;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void flushPendingSave();
  }, SAVE_DEBOUNCE_MS);
}

if (typeof window !== "undefined") {
  const flush = () => {
    void flushPendingSave();
  };
  window.addEventListener("beforeunload", flush);
  window.addEventListener("pagehide", flush);
  window.addEventListener("blur", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

export async function savePastedImage(
  base64Data: string,
  ext: string,
  customDir?: string
): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<string>("save_pasted_image", {
    base64Data,
    ext,
    customDir: customDir || null,
  });
}

const MEMO_IMAGE_CACHE_MAX = 200;
const memoImageInstantCache = new Map<string, string>();
const memoImageResolvedCache = new Map<string, string | null>();
const memoImageInflight = new Map<string, Promise<string | null>>();
let memoAssetProtocolWorks: boolean | null = null;

function setBoundedMap<V>(map: Map<string, V>, key: string, val: V, max: number) {
  map.delete(key);
  map.set(key, val);
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

function cleanMarkdownImageTarget(raw: string): string {
  return raw
    .trim()
    .replace(/^<+|>+$/g, "")
    .trim();
}

function extractMemoAssetFileName(cleanSrc: string): string | null {
  const norm = cleanSrc.replace(/\\/g, "/");
  const rel = norm.startsWith("./assets/")
    ? norm.slice("./assets/".length)
    : norm.startsWith("assets/")
    ? norm.slice("assets/".length)
    : null;
  if (!rel) return null;
  const decoded = (() => {
    try {
      return decodeURIComponent(rel).trim();
    } catch {
      return rel.trim();
    }
  })();
  if (
    !decoded ||
    decoded.includes("/") ||
    decoded.includes("\\") ||
    decoded.includes("..")
  ) {
    return null;
  }
  return decoded;
}

function probeImageLoad(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

/**
 * Saves a pasted/dropped image for Memos into `<dataDir>/assets/shot_...`
 * and returns a portable relative Markdown path (`assets/shot_...`) when backed
 * by Tauri, Vite dev server, or LAN server; falls back to `base64Data` in
 * standalone offline browser mode.
 */
export async function saveMemoImage(
  base64Data: string,
  ext: string,
  customDir?: string
): Promise<string> {
  const safeExt =
    ext
      .replace(/^image\//i, "")
      .replace(/[^a-zA-Z0-9]/g, "")
      .toLowerCase() || "png";

  if (isTauriRuntime()) {
    try {
      const savedPath = await savePastedImage(base64Data, safeExt, customDir);
      if (savedPath) {
        const parts = savedPath.split(/[/\\]/);
        const fileName = parts[parts.length - 1];
        if (fileName) {
          const rel = `assets/${fileName}`;
          setBoundedMap(
            memoImageInstantCache,
            rel,
            base64Data,
            MEMO_IMAGE_CACHE_MAX
          );
          return rel;
        }
      }
    } catch (err) {
      console.error("Failed to save memo image via Tauri:", err);
    }
  } else {
    try {
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base64Data,
          ext: safeExt,
          customDir: customDir || undefined,
        }),
      });
      const ct = res.headers.get("content-type") || "";
      if (res.ok && ct.includes("application/json")) {
        const data = (await res.json()) as {
          ok?: boolean;
          relativePath?: string;
        };
        if (data.ok && data.relativePath) {
          setBoundedMap(
            memoImageInstantCache,
            data.relativePath,
            base64Data,
            MEMO_IMAGE_CACHE_MAX
          );
          return data.relativePath;
        }
      }
    } catch {
      // Fall through to inline data URL in standalone browser mode
    }
  }

  return base64Data;
}

/**
 * Synchronous fast-path for resolving a Markdown image `src` when already
 * cached or directly addressable over HTTP / data / blob URLs.
 */
export function getImmediateMemoImageSrc(
  rawSrc: string,
  customDir?: string
): string | null {
  const clean = cleanMarkdownImageTarget(rawSrc);
  if (!clean) return null;
  const lower = clean.toLowerCase();
  if (
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("data:image/") ||
    lower.startsWith("blob:") ||
    lower.startsWith("asset://")
  ) {
    return clean;
  }

  const assetName = extractMemoAssetFileName(clean);
  if (assetName) {
    const canonical = `assets/${assetName}`;
    const instant = memoImageInstantCache.get(canonical);
    if (instant) return instant;
    if (!isTauriRuntime()) {
      return `/api/assets/${encodeURIComponent(assetName)}`;
    }
  }

  if (isTauriRuntime()) {
    const cacheKey = `${customDir?.trim() || ""}::${clean}`;
    const resolved = memoImageResolvedCache.get(cacheKey);
    if (resolved !== undefined) return resolved;
    return null;
  }

  if (/^[a-zA-Z]:[\\/]/.test(clean)) {
    return `/api/dev-archive/thumb?path=${encodeURIComponent(clean)}`;
  }
  if (clean.startsWith("/")) {
    return clean;
  }
  return clean;
}

export async function resolveMemoImageSrc(
  rawSrc: string,
  customDir?: string
): Promise<string | null> {
  const immediate = getImmediateMemoImageSrc(rawSrc, customDir);
  if (immediate !== null) return immediate;

  const clean = cleanMarkdownImageTarget(rawSrc);
  if (!clean || !isTauriRuntime()) return immediate;

  const cacheKey = `${customDir?.trim() || ""}::${clean}`;
  if (memoImageResolvedCache.has(cacheKey)) {
    return memoImageResolvedCache.get(cacheKey) ?? null;
  }
  const existing = memoImageInflight.get(cacheKey);
  if (existing) return existing;

  const task = (async () => {
    try {
      const { invoke, convertFileSrc } = await import("@tauri-apps/api/core");
      const dirArg = customDir?.trim() || null;

      if (memoAssetProtocolWorks !== false) {
        try {
          const absPath = await invoke<string>("resolve_memo_image_path", {
            src: clean,
            customDir: dirArg,
          });
          const assetUrl = convertFileSrc(absPath);
          if (
            memoAssetProtocolWorks === true ||
            (await probeImageLoad(assetUrl))
          ) {
            memoAssetProtocolWorks = true;
            setBoundedMap(
              memoImageResolvedCache,
              cacheKey,
              assetUrl,
              MEMO_IMAGE_CACHE_MAX
            );
            return assetUrl;
          }
          if (memoAssetProtocolWorks === null) {
            memoAssetProtocolWorks = false;
          }
        } catch {
          // Fall through to full-resolution data URL
        }
      }

      const dataUrl = await invoke<string>("read_memo_image_data_url", {
        src: clean,
        customDir: dirArg,
      });
      setBoundedMap(
        memoImageResolvedCache,
        cacheKey,
        dataUrl,
        MEMO_IMAGE_CACHE_MAX
      );
      return dataUrl;
    } catch {
      setBoundedMap(memoImageResolvedCache, cacheKey, null, MEMO_IMAGE_CACHE_MAX);
      return null;
    } finally {
      memoImageInflight.delete(cacheKey);
    }
  })();

  memoImageInflight.set(cacheKey, task);
  return task;
}

export async function exportIdeaToMarkdown(
  filename: string,
  content: string,
  customDir?: string
): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<string>("export_idea_markdown", {
    filename,
    content,
    customDir: customDir || null,
  });
}

export interface PathInfo {
  path: string;
  name: string;
  is_dir: boolean;
}

export interface FolderEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export async function inspectPath(path: string): Promise<PathInfo | null> {
  if (!isTauriRuntime()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<PathInfo>("inspect_path", { path });
  } catch {
    return null;
  }
}

export async function listFolderEntries(
  folderPath: string
): Promise<FolderEntry[]> {
  if (!isTauriRuntime()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<FolderEntry[]>("list_folder_entries", { folderPath });
}

export async function openPathInOs(targetPath: string): Promise<void> {
  if (!isTauriRuntime()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_path_in_os", { targetPath });
}

const fileIconCache = new Map<string, string | null>();
const fileIconInflight = new Map<string, Promise<string | null>>();

function getIconCacheKey(path: string, isDir: boolean): string {
  const lower = path.trim().toLowerCase();
  if (isDir) return `dir:${lower}`;
  const dot = lower.lastIndexOf(".");
  const slash = Math.max(lower.lastIndexOf("/"), lower.lastIndexOf("\\"));
  const ext = dot > slash ? lower.slice(dot) : "";
  if (
    !ext ||
    ext === ".exe" ||
    ext === ".lnk" ||
    ext === ".ico" ||
    ext === ".url"
  ) {
    return `file:${lower}`;
  }
  return `ext:${ext}`;
}

export function getCachedFileIconSync(
  path: string,
  isDir: boolean
): string | null | undefined {
  return fileIconCache.get(getIconCacheKey(path, isDir));
}

export async function getFileIconDataUrl(
  path: string,
  isDir: boolean
): Promise<string | null> {
  if (!isTauriRuntime() || !path.trim()) return null;
  const key = getIconCacheKey(path, isDir);
  if (fileIconCache.has(key)) {
    return fileIconCache.get(key) ?? null;
  }
  const existing = fileIconInflight.get(key);
  if (existing) return existing;

  const task = import("@tauri-apps/api/core")
    .then(({ invoke }) =>
      invoke<string | null>("get_file_icon_data_url", { path, isDir })
    )
    .then((url) => {
      const normalized = url && url.startsWith("data:") ? url : null;
      fileIconCache.set(key, normalized);
      return normalized;
    })
    .catch(() => {
      fileIconCache.set(key, null);
      return null;
    })
    .finally(() => {
      fileIconInflight.delete(key);
    });

  fileIconInflight.set(key, task);
  return task;
}

export async function hideCaptureWindow(): Promise<void> {
  if (!isTauriRuntime()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("hide_capture_window");
}

export async function openCaptureWindow(): Promise<void> {
  if (!isTauriRuntime()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_capture_window");
}

export function generateAISpec(idea: IdeaItem): string {
  const tagLabel = idea.tag || "未分类";
  const dateStr = new Date(idea.createdAt).toLocaleString("zh-CN");
  const imageSection = idea.imagePath
    ? `\n## 参考截图\n- 本地路径: \`${idea.imagePath}\`\n`
    : "";

  return `# [ShibaPlan 灵感需求] ${tagLabel}

> 记录时间: ${dateStr}  
> 标签: ${tagLabel}

## 1. 原始灵感 / 观察记录
${idea.content}
${imageSection}
## 2. 请 AI 协助完善的目标
请基于上述灵感，帮我完善功能设计与实现方案：
1. **需求拆解**：明确核心用户场景、边界条件与交互细节。
2. **技术与设计方案**：给出可落地的实现步骤或组件结构。
3. **验收标准**：列出 3 条清晰的可测试验收点。

## 3. 约束与偏好
- 保持实现简洁、可维护，优先给出最小可用改动（MVP）。
- 如有不明确的细节，请先列出关键假设再给方案。
`;
}

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}
