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
}

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

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = await getCurrentAppVersion();
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
  };
}
