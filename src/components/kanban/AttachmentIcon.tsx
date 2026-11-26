import React, { useEffect, useState } from "react";
import {
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
} from "lucide-react";
import {
  getCachedFileIconSync,
  getFileIconDataUrl,
  isTauriRuntime,
} from "../../lib/storage";

function getExt(pathOrName: string): string {
  const lower = pathOrName.trim().toLowerCase();
  const dot = lower.lastIndexOf(".");
  const slash = Math.max(lower.lastIndexOf("/"), lower.lastIndexOf("\\"));
  return dot > slash ? lower.slice(dot + 1) : "";
}

const FallbackFileIcon: React.FC<{
  path: string;
  isDir: boolean;
  className?: string;
}> = ({ path, isDir, className = "h-3.5 w-3.5" }) => {
  if (isDir) {
    return <Folder className={`${className} shrink-0 text-shiba-400`} />;
  }
  const ext = getExt(path);
  if (
    [
      "png",
      "jpg",
      "jpeg",
      "webp",
      "gif",
      "bmp",
      "svg",
      "psd",
      "ai",
      "cdr",
      "fig",
      "sketch",
      "tif",
      "tiff",
    ].includes(ext)
  ) {
    return <FileImage className={`${className} shrink-0 text-sky-400`} />;
  }
  if (["xls", "xlsx", "csv", "numbers"].includes(ext)) {
    return (
      <FileSpreadsheet className={`${className} shrink-0 text-emerald-400`} />
    );
  }
  if (["mp4", "mov", "avi", "mkv", "webm", "prproj", "aep"].includes(ext)) {
    return <FileVideo className={`${className} shrink-0 text-violet-400`} />;
  }
  if (["mp3", "wav", "flac", "aac", "ogg", "m4a"].includes(ext)) {
    return <FileAudio className={`${className} shrink-0 text-pink-400`} />;
  }
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) {
    return <FileArchive className={`${className} shrink-0 text-amber-400`} />;
  }
  if (
    [
      "ts",
      "tsx",
      "js",
      "jsx",
      "py",
      "rs",
      "go",
      "java",
      "c",
      "cpp",
      "h",
      "json",
      "html",
      "css",
      "sh",
      "bat",
      "ps1",
    ].includes(ext)
  ) {
    return <FileCode className={`${className} shrink-0 text-cyan-400`} />;
  }
  if (ext === "pdf") {
    return <FileText className={`${className} shrink-0 text-rose-400`} />;
  }
  if (["doc", "docx"].includes(ext)) {
    return <FileText className={`${className} shrink-0 text-blue-400`} />;
  }
  if (["ppt", "pptx"].includes(ext)) {
    return <FileText className={`${className} shrink-0 text-orange-400`} />;
  }
  return <FileText className={`${className} shrink-0 text-shiba-400`} />;
};

/**
 * Displays the real OS shell icon for a file/folder in Tauri desktop runtime
 * (via Windows SHGetFileInfoW), falling back to a color-coded file-type icon
 * while loading or in browser mode.
 */
export const AttachmentIcon: React.FC<{
  path: string;
  isDir: boolean;
  className?: string;
}> = ({ path, isDir, className = "h-3.5 w-3.5" }) => {
  const [iconUrl, setIconUrl] = useState<string | null>(() => {
    const cached = getCachedFileIconSync(path, isDir);
    return cached ?? null;
  });

  useEffect(() => {
    if (!isTauriRuntime() || !path.trim()) return;
    const cached = getCachedFileIconSync(path, isDir);
    if (cached !== undefined) {
      setIconUrl(cached);
      return;
    }
    let cancelled = false;
    void getFileIconDataUrl(path, isDir).then((url) => {
      if (!cancelled && url) setIconUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [path, isDir]);

  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt=""
        draggable={false}
        className={`${className} shrink-0 object-contain`}
      />
    );
  }

  return <FallbackFileIcon path={path} isDir={isDir} className={className} />;
};
