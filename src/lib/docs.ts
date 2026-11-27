import { isTauriRuntime } from "./storage";
import { openExternalUrl } from "./updater";

export const ONLINE_DOCS_BASE_URL = "https://wonvy.github.io/ShibaPlan";

export type DocSection =
  | "home"
  | "guide"
  | "api-overview"
  | "api-webhook"
  | "api-protocol"
  | "api-lan";

const SECTION_PATHS: Record<DocSection, string> = {
  home: "index.html",
  guide: "guide/getting-started.html",
  "api-overview": "api/overview.html",
  "api-webhook": "api/push-webhook.html",
  "api-protocol": "api/info-protocol.html",
  "api-lan": "api/lan-workspace-api.html",
};

export function resolveDocSubpath(
  section: DocSection = "home",
  locale = "zh-CN"
): string {
  const isZh = locale.toLowerCase().startsWith("zh");
  const rel = SECTION_PATHS[section] ?? "index.html";
  return isZh ? rel : `en/${rel}`;
}

export function getOnlineDocsUrl(
  section: DocSection = "home",
  locale = "zh-CN"
): string {
  const sub = resolveDocSubpath(section, locale);
  return `${ONLINE_DOCS_BASE_URL}/${sub}`;
}

export async function openOfflineDocs(
  section: DocSection = "home",
  locale = "zh-CN"
): Promise<void> {
  const subpath = resolveDocSubpath(section, locale);
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_docs_window", { subpath });
    return;
  }
  window.open(`/docs/${subpath}`, "_blank", "noopener,noreferrer");
}

export async function openOnlineDocs(
  section: DocSection = "home",
  locale = "zh-CN"
): Promise<void> {
  await openExternalUrl(getOnlineDocsUrl(section, locale));
}
