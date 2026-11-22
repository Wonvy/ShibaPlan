import { IdeaItem, WorkspaceData } from "../types";

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
    focusLogs: [],
    settings: {
      customDataDir: "",
      shortcutLabel: "Ctrl + Shift + Space",
      locale: detectSystemLocale(),
      customLocales: [],
      theme: "dark",
      paperGrain: true,
      accentColor: undefined,
      enterToSave: true,
      columnGap: 16,
      ai: {
        baseUrl: "https://api.openai.com/v1",
        apiKey: "",
        model: "gpt-4o-mini",
      },
      projectArchiveDirs: [],
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
    focusLogs: Array.isArray(raw.focusLogs) ? raw.focusLogs : [],
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
        baseUrl: raw.settings?.ai?.baseUrl ?? "https://api.openai.com/v1",
        apiKey: raw.settings?.ai?.apiKey ?? "",
        model: raw.settings?.ai?.model ?? "gpt-4o-mini",
      },
      projectArchiveDirs: Array.isArray(raw.settings?.projectArchiveDirs)
        ? raw.settings.projectArchiveDirs
        : [],
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

export interface LanServerInfo {
  running: boolean;
  ip: string;
  port: number;
  url: string;
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
