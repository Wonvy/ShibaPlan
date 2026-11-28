import { isTauriRuntime } from "./storage";
import { InfoScriptLang, InfoSourceKind } from "../types";

export interface InfoRunRequest {
  widgetId: string;
  widgetTitle: string;
  trigger: "manual" | "schedule" | "startup" | "test";
  kind: InfoSourceKind;
  scriptPath?: string;
  inlineCode?: string;
  scriptLang?: InfoScriptLang;
  interpreter?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  useShell?: boolean;
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  env?: Record<string, string>;
  params?: Record<string, string>;
  timeoutSec?: number;
  lastRunAt?: string;
  customDir?: string;
}

export interface InfoRunResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
  httpStatus?: number;
  error?: string;
  ranAt: string;
}

export interface InfoRunHistoryEntry {
  ranAt: string;
  trigger: string;
  ok: boolean;
  exitCode: number;
  durationMs: number;
  httpStatus?: number;
  error?: string;
  stdoutPreview: string;
  stderrPreview: string;
}

export interface InfoWidgetRuntimeState {
  running: boolean;
  lastResult?: InfoRunResult;
  lastSuccessAt?: string;
  history: InfoRunHistoryEntry[];
}

export type InfoCacheFile = Record<
  string,
  {
    lastResult?: InfoRunResult;
    lastSuccessAt?: string;
    history?: InfoRunHistoryEntry[];
  }
>;

const BROWSER_CACHE_KEY = "shibaplan_info_cache_v1";

export async function runInfoSource(req: InfoRunRequest): Promise<InfoRunResult> {
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<InfoRunResult>("run_info_source", { req });
  }

  // Browser / LAN preview fallback
  const started = performance.now();
  const ranAt = new Date().toISOString();
  if (req.kind !== "http") {
    return {
      ok: false,
      exitCode: -1,
      stdout: "",
      stderr: "",
      durationMs: Math.round(performance.now() - started),
      timedOut: false,
      cancelled: false,
      error: "浏览器预览模式仅支持 HTTP 接口数据源，本地脚本与命令请在桌面端运行",
      ranAt,
    };
  }

  const url = (req.url ?? "").trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return {
      ok: false,
      exitCode: -1,
      stdout: "",
      stderr: "",
      durationMs: Math.round(performance.now() - started),
      timedOut: false,
      cancelled: false,
      error: "无效的 HTTP URL",
      ranAt,
    };
  }

  try {
    const method = (req.method ?? "GET").toUpperCase();
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => controller.abort(),
      Math.max(2, req.timeoutSec ?? 30) * 1000
    );
    const res = await fetch(url, {
      method,
      headers: req.headers,
      body:
        ["POST", "PUT", "PATCH", "DELETE"].includes(method) && req.body
          ? req.body
          : undefined,
      signal: controller.signal,
    });
    window.clearTimeout(timer);
    const text = await res.text();
    return {
      ok: res.ok,
      exitCode: res.ok ? 0 : 1,
      stdout: text,
      stderr: "",
      durationMs: Math.round(performance.now() - started),
      timedOut: false,
      cancelled: false,
      httpStatus: res.status,
      error: res.ok ? undefined : `HTTP ${res.status}`,
      ranAt,
    };
  } catch (err) {
    return {
      ok: false,
      exitCode: -1,
      stdout: "",
      stderr: "",
      durationMs: Math.round(performance.now() - started),
      timedOut: false,
      cancelled: false,
      error: err instanceof Error ? err.message : "网络请求失败",
      ranAt,
    };
  }
}

export async function cancelInfoRun(widgetId: string): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<boolean>("cancel_info_run", { widgetId });
  } catch {
    return false;
  }
}

export async function loadInfoCache(customDir?: string): Promise<InfoCacheFile> {
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const raw = await invoke<string>("load_info_cache", {
        customDir: customDir?.trim() || null,
      });
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as InfoCacheFile) : {};
    } catch {
      return {};
    }
  }
  try {
    const raw = localStorage.getItem(BROWSER_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as InfoCacheFile) : {};
  } catch {
    return {};
  }
}

export async function saveInfoCache(
  cache: InfoCacheFile,
  customDir?: string
): Promise<void> {
  const json = JSON.stringify(cache);
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_info_cache", {
        cacheJson: json,
        customDir: customDir?.trim() || null,
      });
    } catch {
      // ignore
    }
    return;
  }
  try {
    localStorage.setItem(BROWSER_CACHE_KEY, json);
  } catch {
    // ignore
  }
}

export async function getInfoScriptsDir(customDir?: string): Promise<string> {
  if (!isTauriRuntime()) return "~/Documents/ShibaPlan/scripts";
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<string>("get_info_scripts_dir", {
    customDir: customDir?.trim() || null,
  });
}

export async function readScriptFile(path: string): Promise<string> {
  if (!isTauriRuntime()) {
    throw new Error("仅桌面端支持读取本地脚本文件");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<string>("read_script_file", { path });
}

export async function writeScriptFile(
  path: string,
  content: string,
  customDir?: string
): Promise<string> {
  if (!isTauriRuntime()) {
    throw new Error("仅桌面端支持保存本地脚本文件");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<string>("write_script_file", {
    path,
    content,
    customDir: customDir?.trim() || null,
  });
}

export async function pickScriptFile(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<string | null>("pick_script_file");
}

export async function openInCodeEditor(path: string): Promise<void> {
  if (!isTauriRuntime()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_in_code_editor", { path });
}

// ============================================================================
// External Push Receiver IPC & Helpers
// ============================================================================

export interface InfoPushServerStatus {
  running: boolean;
  port: number;
  allowLan: boolean;
  autoCreate: boolean;
  baseUrl: string;
  lanUrl?: string;
  error?: string;
}

export interface InfoPushRule {
  key: string;
  token?: string;
}

export interface InfoPushEventPayload {
  key: string;
  title?: string;
  contentType: string;
  body: string;
  remoteAddr: string;
  receivedAt: string;
}

export async function getInfoPushServerStatus(): Promise<InfoPushServerStatus | null> {
  if (!isTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<InfoPushServerStatus>("get_info_push_server_status");
}

export async function startInfoPushServer(
  port?: number,
  allowLan?: boolean,
  autoCreate?: boolean
): Promise<InfoPushServerStatus | null> {
  if (!isTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<InfoPushServerStatus>("start_info_push_server", {
    port: port ?? null,
    allowLan: allowLan ?? null,
    autoCreate: autoCreate ?? null,
  });
}

export async function stopInfoPushServer(): Promise<InfoPushServerStatus | null> {
  if (!isTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<InfoPushServerStatus>("stop_info_push_server");
}

export async function syncInfoPushRules(
  rules: InfoPushRule[],
  autoCreate: boolean
): Promise<void> {
  if (!isTauriRuntime()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("sync_info_push_rules", { rules, autoCreate });
}

export async function sendTestPush(
  url: string,
  body: string,
  token?: string
): Promise<InfoRunResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };
  if (token && token.trim()) {
    headers["Authorization"] = `Bearer ${token.trim()}`;
  }
  return await runInfoSource({
    widgetId: "test-push",
    widgetTitle: "模拟推送",
    trigger: "test",
    kind: "http",
    method: "POST",
    url,
    headers,
    body,
    timeoutSec: 10,
  });
}

export interface WebMetadataResult {
  url: string;
  title?: string;
  faviconDataUrl?: string;
  faviconUrl?: string;
}

export function normalizeWebUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;

  let candidate = trimmed;
  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(candidate)) {
    // Allow clean bare domains such as "github.com/Wonvy/ShibaPlan" or "localhost:5173"
    if (
      /^(localhost(:\d+)?|(\d{1,3}\.){3}\d{1,3}(:\d+)?|([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(:\d+)?)([/?#].*)?$/.test(
        candidate
      )
    ) {
      candidate = /^localhost|^(\d{1,3}\.){3}\d{1,3}/.test(candidate)
        ? `http://${candidate}`
        : `https://${candidate}`;
    } else {
      return null;
    }
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (!parsed.hostname) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function extractWebUrlsFromText(text: string): string[] {
  const parts = text
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.length > 8) return [];
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const normalized = normalizeWebUrl(part);
    if (!normalized) {
      return [];
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      urls.push(normalized);
    }
  }
  return urls;
}

export function getHostnameLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "") || url;
  } catch {
    return url;
  }
}

export function getFallbackFaviconUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(
      parsed.hostname
    )}&sz=64`;
  } catch {
    return "";
  }
}

export async function fetchWebMetadata(
  rawUrl: string
): Promise<WebMetadataResult> {
  const normalized = normalizeWebUrl(rawUrl) ?? rawUrl.trim();
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<WebMetadataResult>("fetch_web_metadata", {
        url: normalized,
      });
    } catch {
      // Fall back gracefully
    }
  }
  return {
    url: normalized,
    title: getHostnameLabel(normalized),
    faviconUrl: getFallbackFaviconUrl(normalized),
  };
}

export async function getBundledExtensionDir(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("get_bundled_extension_dir");
  } catch {
    return null;
  }
}
