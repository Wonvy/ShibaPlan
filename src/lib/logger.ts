import { isTauriRuntime } from "./storage";

export type LogLevel = "INFO" | "WARN" | "ERROR";

const LOCAL_LOG_KEY = "shibaplan_error_logs_v1";
const MAX_LOCAL_LINES = 250;

let activeCustomDataDir: string | undefined;
let handlersInstalled = false;
let isLoggingConsole = false;

export function setLoggerCustomDataDir(customDir?: string): void {
  activeCustomDataDir = customDir?.trim() || undefined;
}

function formatTimestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours()
  )}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function appendLocalStorageLog(line: string): void {
  try {
    const raw = localStorage.getItem(LOCAL_LOG_KEY);
    const lines = raw ? raw.split("\n").filter(Boolean) : [];
    lines.push(line);
    const trimmed =
      lines.length > MAX_LOCAL_LINES
        ? lines.slice(lines.length - MAX_LOCAL_LINES)
        : lines;
    localStorage.setItem(LOCAL_LOG_KEY, trimmed.join("\n"));
  } catch {
    // ignore storage quota errors
  }
}

export function writeAppLog(
  level: LogLevel,
  source: string,
  message: string,
  detail?: string
): void {
  const cleanMsg = (message || "").trim().slice(0, 1000);
  const cleanDetail = detail?.trim().slice(0, 4000);
  const formatted = `[${formatTimestamp()}] [${level}] [${source}] ${cleanMsg}${
    cleanDetail ? `\n  ${cleanDetail.replace(/\n/g, "\n  ")}` : ""
  }`;

  appendLocalStorageLog(formatted);

  if (isTauriRuntime()) {
    import("@tauri-apps/api/core")
      .then(({ invoke }) =>
        invoke("append_app_log", {
          level,
          source,
          message: cleanMsg,
          detail: cleanDetail ?? null,
          customDir: activeCustomDataDir ?? null,
        })
      )
      .catch(() => {});
  }
}

export function logError(source: string, message: string, detail?: string): void {
  writeAppLog("ERROR", source, message, detail);
}

export function logWarn(source: string, message: string, detail?: string): void {
  writeAppLog("WARN", source, message, detail);
}

export function logInfo(source: string, message: string, detail?: string): void {
  writeAppLog("INFO", source, message, detail);
}

export async function readAppLogs(
  customDataDir?: string,
  limit = 300
): Promise<string> {
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("read_app_logs", {
      limit,
      customDir: customDataDir?.trim() || activeCustomDataDir || null,
    });
  }
  return localStorage.getItem(LOCAL_LOG_KEY) || "";
}

export async function clearAppLogs(customDataDir?: string): Promise<void> {
  try {
    localStorage.removeItem(LOCAL_LOG_KEY);
  } catch {
    // ignore
  }
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("clear_app_logs", {
      customDir: customDataDir?.trim() || activeCustomDataDir || null,
    });
  }
}

export async function getLogFilePath(
  customDataDir?: string
): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("get_log_file_path", {
      customDir: customDataDir?.trim() || activeCustomDataDir || null,
    });
  } catch {
    return null;
  }
}

function serializeArg(arg: unknown): string {
  if (arg instanceof Error) {
    return arg.stack || arg.message;
  }
  if (typeof arg === "string") return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

export function installGlobalErrorHandlers(): void {
  if (handlersInstalled || typeof window === "undefined") return;
  handlersInstalled = true;

  window.addEventListener("error", (event) => {
    const msg = event.message || "Uncaught window error";
    const loc = event.filename
      ? `${event.filename}:${event.lineno}:${event.colno}`
      : "";
    const stack = event.error instanceof Error ? event.error.stack : undefined;
    logError("window.error", msg, [loc, stack].filter(Boolean).join("\n"));
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const msg =
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : "Unhandled Promise rejection";
    const detail = reason instanceof Error ? reason.stack : serializeArg(reason);
    logError("unhandledrejection", msg, detail);
  });

  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    origError(...args);
    if (isLoggingConsole) return;
    isLoggingConsole = true;
    try {
      const joined = args.map(serializeArg).join(" ");
      if (joined.trim()) {
        logError("console.error", joined.slice(0, 600));
      }
    } finally {
      isLoggingConsole = false;
    }
  };
}
