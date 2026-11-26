import { EFFORT_MINUTES, TaskAttachment, TaskItem } from "../../types";
import { FolderEntry, isTauriRuntime, PathInfo, uid } from "../../lib/storage";

export interface ResolvedDropItem {
  name: string;
  path: string;
  is_dir: boolean;
  imagePreview?: string;
  cachedFiles?: FolderEntry[];
}

export type TextSegment =
  | { kind: "text"; text: string }
  | { kind: "folder"; path: string; name: string };

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|svg|avif)$/i;

function isImageFile(file: File | null | undefined, name?: string): boolean {
  if (file && file.type.startsWith("image/")) return true;
  if (name && IMAGE_EXT_RE.test(name)) return true;
  if (file && IMAGE_EXT_RE.test(file.name)) return true;
  return false;
}

const readAsDataUrl = (file: File) =>
  new Promise<string | undefined>((resolve) => {
    const r = new FileReader();
    r.onload = () =>
      resolve(typeof r.result === "string" ? r.result : undefined);
    r.onerror = () => resolve(undefined);
    r.readAsDataURL(file);
  });

const readAllDirectoryEntries = (
  dirEntry: FileSystemDirectoryEntry
): Promise<FolderEntry[]> =>
  new Promise((resolve) => {
    const reader = dirEntry.createReader();
    const collected: FileSystemEntry[] = [];

    const readBatch = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            const mapped = collected
              .filter(
                (c) =>
                  c.name !== ".DS_Store" &&
                  c.name !== "Thumbs.db" &&
                  c.name !== "desktop.ini"
              )
              .map((c) => ({
                name: c.name,
                path: c.fullPath || c.name,
                is_dir: c.isDirectory,
              }))
              .sort((a, b) =>
                a.is_dir === b.is_dir
                  ? a.name.localeCompare(b.name)
                  : a.is_dir
                  ? -1
                  : 1
              );
            resolve(mapped);
          } else {
            collected.push(...batch);
            readBatch();
          }
        },
        () => resolve([])
      );
    };

    readBatch();
  });

// ---- WebView2 native path bridge (postMessageWithAdditionalObjects) --------

interface WebView2Bridge {
  postMessageWithAdditionalObjects?: (
    message: unknown,
    additionalObjects: unknown[]
  ) => void;
}

function getWebView2Bridge(): WebView2Bridge | null {
  if (typeof window === "undefined") return null;
  const chromeObj = (window as unknown as { chrome?: { webview?: WebView2Bridge } })
    .chrome;
  if (
    chromeObj?.webview &&
    typeof chromeObj.webview.postMessageWithAdditionalObjects === "function"
  ) {
    return chromeObj.webview;
  }
  return null;
}

const pendingDropResolvers = new Map<string, (items: PathInfo[]) => void>();
let dropListenerInitialized = false;

function ensureWebView2DropListener(): void {
  if (dropListenerInitialized || !isTauriRuntime()) return;
  dropListenerInitialized = true;
  void import("@tauri-apps/api/event").then(({ listen }) => {
    void listen<{ requestId: string; items: PathInfo[] }>(
      "shiba-resolved-drop-paths",
      (event) => {
        const { requestId, items } = event.payload;
        const resolver = pendingDropResolvers.get(requestId);
        if (resolver) {
          pendingDropResolvers.delete(requestId);
          resolver(Array.isArray(items) ? items : []);
        }
      }
    );
  });
}

// Pre-warm the Tauri event listener so synchronous drop calls never race it.
if (typeof window !== "undefined" && isTauriRuntime()) {
  ensureWebView2DropListener();
}

function resolveFilesViaWebView2(files: File[]): Promise<PathInfo[] | null> {
  const bridge = getWebView2Bridge();
  if (!bridge?.postMessageWithAdditionalObjects || !isTauriRuntime() || files.length === 0) {
    return Promise.resolve(null);
  }
  ensureWebView2DropListener();
  const requestId = uid("drop");
  return new Promise<PathInfo[] | null>((resolve) => {
    const timer = setTimeout(() => {
      pendingDropResolvers.delete(requestId);
      resolve(null);
    }, 1500);

    pendingDropResolvers.set(requestId, (items) => {
      clearTimeout(timer);
      resolve(items.length > 0 ? items : null);
    });

    try {
      bridge.postMessageWithAdditionalObjects!(
        { __shibaResolvePaths: requestId },
        files
      );
    } catch {
      clearTimeout(timer);
      pendingDropResolvers.delete(requestId);
      resolve(null);
    }
  });
}

/**
 * Returns true if the DataTransfer represents an OS file/folder drag
 * rather than an internal ShibaPlan card/column/idea drag.
 */
export function isOsFileDrag(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  const types = Array.from(dt.types || []);
  if (
    types.includes("application/x-shibaplan-task") ||
    types.includes("application/x-shibaplan-column") ||
    types.includes("application/x-shibaplan-idea")
  ) {
    return false;
  }
  return types.includes("Files");
}

/**
 * Resolves dropped OS files/folders from an HTML5 DataTransfer.
 * Must be invoked synchronously inside the `onDrop` event handler before any `await`.
 */
export function resolveDroppedOsItems(
  dt: DataTransfer
): Promise<ResolvedDropItem[]> {
  // Snapshot synchronously before the browser clears DataTransfer after drop
  const fileList = Array.from(dt.files || []);
  const entries: FileSystemEntry[] = [];
  if (dt.items) {
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i];
      if (
        item.kind === "file" &&
        typeof item.webkitGetAsEntry === "function"
      ) {
        const entry = item.webkitGetAsEntry();
        if (entry) entries.push(entry);
      }
    }
  }

  // Trigger WebView2 native path resolution synchronously while File objects are fresh
  const nativePromise = resolveFilesViaWebView2(fileList);

  return (async () => {
    const nativeItems = await nativePromise;
    if (nativeItems && nativeItems.length > 0) {
      const resolved: ResolvedDropItem[] = [];
      for (let i = 0; i < nativeItems.length; i++) {
        const info = nativeItems[i];
        const rawFile = fileList[i];
        let imagePreview: string | undefined;
        if (!info.is_dir && rawFile && isImageFile(rawFile, info.name)) {
          imagePreview = await readAsDataUrl(rawFile);
        }
        resolved.push({
          name: info.name,
          path: info.path,
          is_dir: info.is_dir,
          imagePreview,
        });
      }
      return resolved;
    }

    // Fallback: HTML5 FileSystemEntry / File list (browser mode)
    const fallback: ResolvedDropItem[] = [];
    if (entries.length > 0) {
      for (const entry of entries) {
        if (entry.isDirectory) {
          const dirEntry = entry as FileSystemDirectoryEntry;
          const childEntries = await readAllDirectoryEntries(dirEntry);
          fallback.push({
            name: entry.name,
            path: entry.fullPath || entry.name,
            is_dir: true,
            cachedFiles: childEntries,
          });
        } else {
          const fileEntry = entry as FileSystemFileEntry;
          const fileObj = await new Promise<File | null>((resolve) =>
            fileEntry.file(
              (f) => resolve(f),
              () => resolve(null)
            )
          );
          let imagePreview: string | undefined;
          if (fileObj && isImageFile(fileObj, entry.name)) {
            imagePreview = await readAsDataUrl(fileObj);
          }
          fallback.push({
            name: entry.name,
            path: entry.fullPath || entry.name,
            is_dir: false,
            imagePreview,
          });
        }
      }
    } else if (fileList.length > 0) {
      for (const f of fileList) {
        let imagePreview: string | undefined;
        if (isImageFile(f)) {
          imagePreview = await readAsDataUrl(f);
        }
        fallback.push({
          name: f.name,
          path: f.name,
          is_dir: false,
          imagePreview,
        });
      }
    }
    return fallback;
  })();
}

// ---- Inline folder link token helpers (`[[C:\path\to\folder]]`) ------------

const FOLDER_TOKEN_RE = /\[\[([^\[\]\r\n]+)\]\]/g;

export function isPathLike(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  return (
    /^[a-zA-Z]:[\\/]/.test(s) ||
    s.startsWith("\\\\") ||
    s.startsWith("/") ||
    s.startsWith("~/")
  );
}

export function formatFolderToken(path: string): string {
  return `[[${path.trim()}]]`;
}

export function extractFolderDisplayName(path: string): string {
  const clean = path.trim().replace(/[\\/]+$/, "");
  if (!clean) return path.trim();
  const parts = clean.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || clean;
}

export function parseTextWithFolderLinks(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let lastIndex = 0;
  FOLDER_TOKEN_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = FOLDER_TOKEN_RE.exec(text)) !== null) {
    const inner = match[1].trim();
    if (!isPathLike(inner)) continue;

    if (match.index > lastIndex) {
      segments.push({ kind: "text", text: text.slice(lastIndex, match.index) });
    }
    segments.push({
      kind: "folder",
      path: inner,
      name: extractFolderDisplayName(inner),
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ kind: "text", text: text.slice(lastIndex) });
  }
  return segments;
}

export function hasFolderTokens(text?: string): boolean {
  if (!text) return false;
  return parseTextWithFolderLinks(text).some((s) => s.kind === "folder");
}

/**
 * Inserts folder/file path tokens into an input/textarea value at the current
 * selection/cursor, adding spaces cleanly when adjacent to non-whitespace text.
 */
export function insertTokensIntoText(
  el: HTMLInputElement | HTMLTextAreaElement | null,
  currentValue: string,
  tokens: string[]
): { nextValue: string; nextCursor: number } {
  const insertion = tokens.join(" ");
  const start = el?.selectionStart ?? currentValue.length;
  const end = el?.selectionEnd ?? currentValue.length;
  const before = currentValue.slice(0, start);
  const after = currentValue.slice(end);
  const needSpaceBefore = before.length > 0 && !/\s$/.test(before);
  const needSpaceAfter = after.length > 0 && !/^\s/.test(after);
  const prefix = needSpaceBefore ? " " : "";
  const suffix = needSpaceAfter ? " " : "";
  const nextValue = `${before}${prefix}${insertion}${suffix}${after}`;
  const nextCursor = before.length + prefix.length + insertion.length + suffix.length;
  return { nextValue, nextCursor };
}

export function appendFolderTokensToText(
  existing: string | undefined,
  folderPaths: string[]
): string {
  const tokens = folderPaths
    .map((p) => formatFolderToken(p))
    .filter((tok) => !existing || !existing.includes(tok));
  if (tokens.length === 0) return existing ?? "";
  const joined = tokens.join(" ");
  if (!existing || !existing.trim()) return joined;
  return `${existing.trimEnd()}\n${joined}`;
}

export function mergeTaskAttachments(
  existing: TaskAttachment[] | undefined,
  incoming: TaskAttachment[]
): TaskAttachment[] {
  const result: TaskAttachment[] = existing ? [...existing] : [];
  const seen = new Set(result.map((a) => a.path.toLowerCase()));
  for (const item of incoming) {
    const key = item.path.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

/**
 * Returns the unified list of file/folder attachments on a task, including
 * backward-compatible extraction from legacy `folderPath` / `filePath` fields
 * or `[[path]]` tokens.
 */
export function getTaskAttachments(task: TaskItem): TaskAttachment[] {
  const list: TaskAttachment[] = [];
  const seen = new Set<string>();
  const add = (att: TaskAttachment) => {
    const key = att.path.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    list.push({
      path: att.path.trim(),
      name: att.name.trim() || extractFolderDisplayName(att.path),
      is_dir: att.is_dir,
    });
  };

  if (Array.isArray(task.attachments)) {
    for (const att of task.attachments) add(att);
  }
  if (task.folderPath) {
    add({
      path: task.folderPath,
      name: extractFolderDisplayName(task.folderPath),
      is_dir: true,
    });
  }
  if (task.filePath) {
    add({
      path: task.filePath,
      name: extractFolderDisplayName(task.filePath),
      is_dir: false,
    });
  }

  for (const field of [task.title, task.notes]) {
    if (!field) continue;
    for (const seg of parseTextWithFolderLinks(field)) {
      if (seg.kind === "folder") {
        add({ path: seg.path, name: seg.name, is_dir: true });
      }
    }
  }
  return list;
}

/**
 * Removes legacy `[[path]]` tokens from display text so paths don't clutter
 * task titles or notes.
 */
export function stripLegacyFolderTokens(text: string): string {
  return text
    .replace(FOLDER_TOKEN_RE, (_m, inner: string) =>
      isPathLike(inner) ? extractFolderDisplayName(inner) : _m
    )
    .trim();
}

/**
 * Converts resolved OS items dropped onto a column's empty area into standard tasks
 * with clean titles and structured `attachments` (shown as footer icons).
 */
export function buildTasksFromResolvedItems(
  items: ResolvedDropItem[],
  targetColId: string
): TaskItem[] {
  const now = new Date().toISOString();
  return items.map((item) => ({
    id: uid("task"),
    title: item.name,
    columnId: targetColId,
    attachments: [
      {
        path: item.path,
        name: item.name,
        is_dir: item.is_dir,
      },
    ],
    imagePreview: item.imagePreview,
    cachedFiles: item.cachedFiles,
    importance: 2,
    effort: "S",
    estimatedMinutes: EFFORT_MINUTES.S,
    actualMinutes: 0,
    status: "todo",
    createdAt: now,
  }));
}
