import React, { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Folder, Image as ImageIcon } from "lucide-react";
import { loadArchiveThumbnail } from "../../lib/archive";

export interface ProjectThumbnailProps {
  thumbPath: string | null;
  alt: string;
  variant?: "card" | "timeline" | "compact";
  fixedHeight?: number;
  showPlaceholder?: boolean;
}

/**
 * Lazily loads a project thumbnail once it scrolls near the viewport.
 * Thumbnails are served through the Tauri asset protocol (see archive.ts).
 */
export const ProjectThumbnail = memo(function ProjectThumbnail({
  thumbPath,
  alt,
  variant = "card",
  fixedHeight = 128,
  showPlaceholder = false,
}: ProjectThumbnailProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [hoverPreview, setHoverPreview] = useState<{
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    if (!thumbPath) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "180px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [thumbPath]);

  useEffect(() => {
    if (!visible || !thumbPath) return;
    let cancelled = false;
    loadArchiveThumbnail(thumbPath).then((url) => {
      if (!cancelled) {
        if (url) setSrc(url);
        else setFailed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [visible, thumbPath]);

  if (!thumbPath || failed) {
    if (variant === "timeline") {
      return (
        <div className="flex h-[81px] w-36 sm:h-[90px] sm:w-40 shrink-0 items-center justify-center rounded-lg bg-muted/35 text-muted-foreground/25">
          <Folder className="h-6 w-6" />
        </div>
      );
    }
    if (variant === "card" && showPlaceholder) {
      return (
        <div
          style={{ height: fixedHeight }}
          className="mb-2 flex w-full items-center justify-center text-muted-foreground/25"
        >
          <Folder className="h-7 w-7" />
        </div>
      );
    }
    return null;
  }

  if (variant === "compact") {
    return (
      <>
        <div
          ref={containerRef}
          onMouseEnter={(e) => {
            if (!src) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const previewW = 460;
            const previewH = 380;
            let x = rect.right + 12;
            if (x + previewW > window.innerWidth - 16) {
              x = Math.max(16, rect.left - previewW - 12);
            }
            let y = Math.max(16, rect.top - 24);
            if (y + previewH > window.innerHeight - 16) {
              y = Math.max(16, window.innerHeight - previewH - 16);
            }
            setHoverPreview({ x, y });
          }}
          onMouseLeave={() => setHoverPreview(null)}
          className="flex h-8 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/50 p-0.5"
        >
          {src ? (
            <img
              src={src}
              alt={alt}
              loading="lazy"
              decoding="async"
              onError={() => setFailed(true)}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <ImageIcon className="h-3.5 w-3.5 text-muted-foreground/50" />
          )}
        </div>
        {src &&
          hoverPreview &&
          createPortal(
            <div
              style={{ left: hoverPreview.x, top: hoverPreview.y }}
              className="pointer-events-none fixed z-[9999] rounded-xl border border-border bg-popover/95 p-2 shadow-popover-soft backdrop-blur-md"
            >
              <img
                src={src}
                alt={alt}
                className="max-h-[420px] max-w-[480px] rounded-lg object-contain"
              />
            </div>,
            document.body
          )}
      </>
    );
  }

  if (variant === "timeline") {
    return (
      <>
        <div
          ref={containerRef}
          onMouseEnter={(e) => {
            if (!src) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const previewW = 460;
            const previewH = 380;
            let x = rect.right + 12;
            if (x + previewW > window.innerWidth - 16) {
              x = Math.max(16, rect.left - previewW - 12);
            }
            let y = Math.max(16, rect.top - 24);
            if (y + previewH > window.innerHeight - 16) {
              y = Math.max(16, window.innerHeight - previewH - 16);
            }
            setHoverPreview({ x, y });
          }}
          onMouseLeave={() => setHoverPreview(null)}
          className="flex h-[81px] w-36 sm:h-[90px] sm:w-40 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/40 p-1"
        >
          {src ? (
            <img
              src={src}
              alt={alt}
              loading="lazy"
              decoding="async"
              onError={() => setFailed(true)}
              className="max-h-full max-w-full object-contain rounded"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground/35">
              <ImageIcon className="h-5 w-5" />
            </div>
          )}
        </div>
        {src &&
          hoverPreview &&
          createPortal(
            <div
              style={{ left: hoverPreview.x, top: hoverPreview.y }}
              className="pointer-events-none fixed z-[9999] rounded-xl border border-border bg-popover/95 p-2 shadow-popover-soft backdrop-blur-md"
            >
              <img
                src={src}
                alt={alt}
                className="max-h-[420px] max-w-[480px] rounded-lg object-contain"
              />
            </div>,
            document.body
          )}
      </>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ height: fixedHeight }}
      className="mb-2 flex w-full items-center justify-center overflow-hidden rounded-md"
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="max-h-full max-w-full object-contain rounded transition-transform duration-200 group-hover:scale-[1.02]"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground/25">
          <ImageIcon className="h-5 w-5" />
        </div>
      )}
    </div>
  );
});
