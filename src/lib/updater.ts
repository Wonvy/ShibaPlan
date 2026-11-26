import pkg from "../../package.json";
import { isTauriRuntime } from "./storage";

export const REPO_OWNER = "Wonvy";
export const REPO_NAME = "ShibaPlan";

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  releaseNotes: string;
  publishedAt?: string;
  downloadUrl?: string;
  assetName?: string;
  canAutoUpdate?: boolean;
}

export interface UpdateDownloadProgress {
  phase: "downloading" | "installing" | "restarting";
  downloadedBytes: number;
  totalBytes?: number;
  percent?: number;
}

type TauriUpdateHandle = {
  version: string;
  body?: string;
  date?: string;
  downloadAndInstall: (
    onEvent?: (event: {
      event: string;
      data?: { contentLength?: number; chunkLength?: number };
    }) => void
  ) => Promise<void>;
};

let pendingTauriUpdate: TauriUpdateHandle | null = null;

export async function getCurrentAppVersion(): Promise<string> {
  if (isTauriRuntime()) {
    try {
      const { getVersion } = await import("@tauri-apps/api/app");
      return await getVersion();
    } catch {
      // fallback to package.json
    }
  }
  return pkg.version;
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!url) return;
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_external_url", { url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function pickPlatformAsset(
  assets: { name: string; browser_download_url: string }[]
): { name: string; url: string } | undefined {
  if (!Array.isArray(assets) || assets.length === 0) return undefined;
  const ua = (typeof navigator !== "undefined" ? navigator.userAgent : "").toLowerCase();

  const findBy = (pred: (name: string) => boolean) =>
    assets.find((a) => pred(a.name.toLowerCase()));

  let match;
  if (ua.includes("win")) {
    match =
      findBy((n) => n.endsWith("-setup.exe") || n.endsWith(".exe")) ??
      findBy((n) => n.endsWith(".msi"));
  } else if (ua.includes("mac")) {
    match = findBy((n) => n.endsWith(".dmg"));
  } else {
    match =
      findBy((n) => n.endsWith(".appimage")) ?? findBy((n) => n.endsWith(".deb"));
  }

  return match
    ? { name: match.name, url: match.browser_download_url }
    : undefined;
}

async function checkViaGithubReleases(
  currentVersion: string
): Promise<UpdateCheckResult> {
  const res = await fetch(
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`,
    {
      headers: {
        Accept: "application/vnd.github+json",
      },
    }
  );

  if (res.status === 404) {
    return {
      hasUpdate: false,
      currentVersion,
      latestVersion: currentVersion,
      releaseUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`,
      releaseNotes: "",
      canAutoUpdate: false,
    };
  }

  if (!res.ok) {
    throw new Error(`检查更新失败 (${res.status})`);
  }

  const data = await res.json();
  const latestTag: string = data?.tag_name || currentVersion;
  const latestVersion = latestTag.replace(/^v/i, "");
  const hasUpdate = compareSemver(latestVersion, currentVersion) > 0;
  const asset = pickPlatformAsset(data?.assets ?? []);

  return {
    hasUpdate,
    currentVersion,
    latestVersion,
    releaseUrl:
      data?.html_url ||
      `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`,
    releaseNotes: data?.body || "",
    publishedAt: data?.published_at,
    downloadUrl: asset?.url,
    assetName: asset?.name,
    canAutoUpdate: false,
  };
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = await getCurrentAppVersion();
  pendingTauriUpdate = null;

  if (isTauriRuntime()) {
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update) {
        pendingTauriUpdate = update as unknown as TauriUpdateHandle;
        const latestVersion = update.version.replace(/^v/i, "");
        return {
          hasUpdate: true,
          currentVersion,
          latestVersion,
          releaseUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/v${latestVersion}`,
          releaseNotes: update.body || "",
          publishedAt: update.date,
          canAutoUpdate: true,
        };
      }
      return {
        hasUpdate: false,
        currentVersion,
        latestVersion: currentVersion,
        releaseUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`,
        releaseNotes: "",
        canAutoUpdate: true,
      };
    } catch {
      // Fallback to GitHub Releases API (e.g., if latest release predates latest.json)
    }
  }

  return checkViaGithubReleases(currentVersion);
}

export async function installPendingUpdate(
  onProgress?: (progress: UpdateDownloadProgress) => void
): Promise<void> {
  if (!isTauriRuntime() || !pendingTauriUpdate) {
    throw new Error("当前版本不支持应用内自动更新，请前往发布页手动下载安装");
  }

  let totalBytes: number | undefined;
  let downloadedBytes = 0;

  onProgress?.({
    phase: "downloading",
    downloadedBytes: 0,
    percent: 0,
  });

  await pendingTauriUpdate.downloadAndInstall((event) => {
    if (event.event === "Started") {
      totalBytes = event.data?.contentLength;
      downloadedBytes = 0;
      onProgress?.({
        phase: "downloading",
        downloadedBytes,
        totalBytes,
        percent: totalBytes ? 0 : undefined,
      });
    } else if (event.event === "Progress") {
      downloadedBytes += event.data?.chunkLength ?? 0;
      const percent =
        totalBytes && totalBytes > 0
          ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
          : undefined;
      onProgress?.({
        phase: "downloading",
        downloadedBytes,
        totalBytes,
        percent,
      });
    } else if (event.event === "Finished") {
      onProgress?.({
        phase: "installing",
        downloadedBytes,
        totalBytes,
        percent: 100,
      });
    }
  });

  onProgress?.({
    phase: "restarting",
    downloadedBytes,
    totalBytes,
    percent: 100,
  });

  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
