import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  Frame,
  Globe,
  Loader2,
  Monitor,
  MonitorSmartphone,
  MoreVertical,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Smartphone,
  Square,
  Tablet,
} from "lucide-react";
import { InfoCardStatus, InfoWebDeviceMode, InfoWidget } from "../../types";
import {
  getFallbackFaviconUrl,
  getHostnameLabel,
  InfoWidgetRuntimeState,
} from "../../lib/infoRunner";
import {
  getWebDevicePreset,
  PixelRect,
  WEB_DEVICE_PRESETS,
} from "../../lib/infoGrid";
import {
  buildPushUrl,
  describeSchedule,
  parseInfoOutput,
} from "../../lib/infoProtocol";
import { renderControlIcon } from "./controlIcons";
import { InfoContentRenderer } from "./InfoContentRenderer";

export const WebFavicon: React.FC<{
  url?: string;
  favicon?: string;
  className?: string;
  iconClassName?: string;
}> = ({ url = "", favicon, className = "h-5 w-5", iconClassName = "h-4 w-4" }) => {
  const candidates = useMemo(() => {
    const list: string[] = [];
    if (favicon?.trim()) list.push(favicon.trim());
    try {
      if (url) {
        const parsed = new URL(url);
        const ico = `${parsed.origin}/favicon.ico`;
        if (!list.includes(ico)) list.push(ico);
        const s2 = getFallbackFaviconUrl(url);
        if (s2 && !list.includes(s2)) list.push(s2);
      }
    } catch {
      // ignore invalid url
    }
    return list;
  }, [url, favicon]);

  const [step, setStep] = useState(0);

  useEffect(() => {
    setStep(0);
  }, [url, favicon]);

  const src = candidates[step];
  if (!src) {
    return <Globe className={`${iconClassName} shrink-0 text-primary`} />;
  }

  return (
    <img
      src={src}
      alt=""
      draggable={false}
      onError={() => setStep((s) => s + 1)}
      className={`${className} shrink-0 rounded object-contain`}
    />
  );
};

export function renderWebDeviceIcon(
  mode: InfoWebDeviceMode,
  className = "h-3 w-3"
) {
  switch (mode) {
    case "mobile":
      return <Smartphone className={className} />;
    case "tablet":
      return <Tablet className={className} />;
    case "desktop":
      return <Monitor className={className} />;
    default:
      return <MonitorSmartphone className={className} />;
  }
}

export const WebEmbedViewport: React.FC<{
  url: string;
  title: string;
  deviceMode?: InfoWebDeviceMode;
  embedKey?: number;
  interactive?: boolean;
  fallbackWidth?: number;
  fallbackHeight?: number;
  emptyText?: string;
}> = ({
  url,
  title,
  deviceMode = "auto",
  embedKey = 0,
  interactive = true,
  fallbackWidth = 460,
  fallbackHeight = 300,
  emptyText = "未配置网页链接",
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({
    w: fallbackWidth,
    h: fallbackHeight,
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const updateSize = (width: number, height: number) => {
      const nw = Math.round(width);
      const nh = Math.round(height);
      if (nw <= 20 || nh <= 20) return;
      setSize((prev) =>
        prev.w === nw && prev.h === nh ? prev : { w: nw, h: nh }
      );
    };
    updateSize(el.clientWidth, el.clientHeight);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        updateSize(entry.contentRect.width, entry.contentRect.height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!url) {
    return (
      <div
        ref={containerRef}
        className="flex h-full min-h-0 flex-1 items-center justify-center bg-background text-xs text-muted-foreground"
      >
        {emptyText}
      </div>
    );
  }

  const preset = getWebDevicePreset(deviceMode);
  if (preset.width == null) {
    return (
      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 bg-background"
      >
        <iframe
          key={`${embedKey}-${url}`}
          src={url}
          title={title}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          className={`h-full w-full border-0 bg-white ${
            interactive ? "" : "pointer-events-none"
          }`}
        />
      </div>
    );
  }

  const vpW = preset.width;
  const scale = Math.max(0.15, Math.min(1, size.w / vpW));
  const frameW = Math.min(size.w, Math.round(vpW * scale));
  const vpH = Math.max(120, Math.ceil(size.h / scale));
  const isFramed = frameW < size.w - 2;

  return (
    <div
      ref={containerRef}
      className={`relative flex min-h-0 flex-1 items-start justify-center overflow-hidden ${
        isFramed ? "bg-muted/35" : "bg-background"
      }`}
    >
      <div
        style={{ width: frameW, height: size.h }}
        className={`relative overflow-hidden bg-white ${
          isFramed ? "border-x border-border/70 shadow-sm" : ""
        }`}
      >
        <iframe
          key={`${embedKey}-${url}`}
          src={url}
          title={title}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          style={{
            width: vpW,
            height: vpH,
            transform: `scale(${scale})`,
            transformOrigin: "0 0",
          }}
          className={`block border-0 bg-white ${
            interactive ? "" : "pointer-events-none"
          }`}
        />
      </div>
    </div>
  );
};

export type ResizeEdge = "se" | "e" | "s" | "w" | "n";

interface InfoWidgetCardProps {
  widget: InfoWidget;
  pixelRect: PixelRect;
  panMode?: boolean;
  isDropTarget?: boolean;
  childCount?: number;
  runtime?: InfoWidgetRuntimeState;
  locked: boolean;
  pushBaseUrl?: string;
  isDragging: boolean;
  isGroupMoving?: boolean;
  isResizing: boolean;
  anyInteracting: boolean;
  isRenaming?: boolean;
  onCommitRename?: (widget: InfoWidget, nextTitle: string) => void;
  onCancelRename?: () => void;
  onToggleCollapse?: (widget: InfoWidget) => void;
  onOpenWebUrl?: (widget: InfoWidget) => void;
  onChangeWebDeviceMode?: (
    widget: InfoWidget,
    mode: InfoWebDeviceMode,
    resizeCard?: boolean
  ) => void;
  onStartDrag: (e: React.PointerEvent, widget: InfoWidget) => void;
  onStartResize: (
    e: React.PointerEvent,
    widget: InfoWidget,
    edge: ResizeEdge
  ) => void;
  onToggleControl?: (widget: InfoWidget) => void;
  onTriggerControl?: (widget: InfoWidget) => void;
  onRun: (widget: InfoWidget) => void;
  onCancel: (widget: InfoWidget) => void;
  onEdit: (widget: InfoWidget) => void;
  onViewLogs: (widget: InfoWidget) => void;
  onContextMenu: (e: React.MouseEvent, widget: InfoWidget) => void;
  onSendItemToKanban: (title: string, notes?: string) => void;
  onSendItemToIdea: (content: string) => void;
  onNotify: (msg: string) => void;
}

const STATUS_DOT_CLS: Record<InfoCardStatus, string> = {
  ok: "bg-emerald-500",
  info: "bg-sky-500",
  warn: "bg-amber-500",
  error: "bg-rose-500",
};

function formatRelativeTime(iso?: string): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 10) return "刚刚";
  if (diffSec < 60) return `${diffSec}s 前`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m 前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h 前`;
  return new Date(ms).toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
  });
}

export const InfoWidgetCard: React.FC<InfoWidgetCardProps> = ({
  widget,
  pixelRect,
  panMode = false,
  isDropTarget = false,
  childCount = 0,
  runtime,
  locked,
  pushBaseUrl,
  isDragging,
  isGroupMoving = false,
  isResizing,
  anyInteracting,
  isRenaming = false,
  onCommitRename,
  onCancelRename,
  onToggleCollapse,
  onOpenWebUrl,
  onChangeWebDeviceMode,
  onStartDrag,
  onStartResize,
  onToggleControl,
  onTriggerControl,
  onRun,
  onCancel,
  onEdit,
  onViewLogs,
  onContextMenu,
  onSendItemToKanban,
  onSendItemToIdea,
  onNotify,
}) => {
  const parsed = useMemo(() => {
    if (!runtime?.lastResult) return null;
    return parseInfoOutput(
      runtime.lastResult,
      widget.source.jsonPath,
      widget.appearance?.displayView
    );
  }, [
    runtime?.lastResult,
    widget.source.jsonPath,
    widget.appearance?.displayView,
  ]);

  const isContainer = widget.source.kind === "container";
  const isControl = widget.source.kind === "control";
  const isWeb = widget.source.kind === "web";
  const isWebEmbed = isWeb && widget.source.webDisplayMode === "embed";
  const webDeviceMode: InfoWebDeviceMode = widget.source.webDeviceMode ?? "auto";
  const activeDevicePreset = getWebDevicePreset(webDeviceMode);
  const webUrl = widget.source.url?.trim() ?? "";
  const webHost = webUrl ? getHostnameLabel(webUrl) : "未设置网址";
  const webTitle = widget.title.trim() || webHost;

  const isRunning = Boolean(runtime?.running);
  const status: InfoCardStatus = parsed?.status ?? "info";
  const accent = widget.appearance?.accentColor;
  const controlDisplayLabel =
    widget.title.trim() || widget.source.controlLabel?.trim() || "";
  const hasVisibleTitle = Boolean(
    isWebEmbed ||
      (!isContainer && !isControl && !isWeb && parsed?.title?.trim()) ||
      widget.title.trim()
  );
  const isCollapsed = Boolean(widget.appearance?.collapsed);
  const effectiveHideHeader =
    !isCollapsed &&
    (isControl ||
      (isWeb && !isWebEmbed) ||
      (!isRenaming && (Boolean(widget.appearance?.hideHeader) || !hasVisibleTitle)));
  const activeTransform = isDragging || isResizing;

  const [renameDraft, setRenameDraft] = useState(widget.title);
  const [embedKey, setEmbedKey] = useState(0);
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);
  const [syncCardSize, setSyncCardSize] = useState<boolean>(() => {
    try {
      const saved = window.localStorage.getItem(
        "shibaplan:info:web-device-sync-size"
      );
      return saved === null ? true : saved === "true";
    } catch {
      return true;
    }
  });
  const [deviceMenuPos, setDeviceMenuPos] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const deviceBtnRef = useRef<HTMLButtonElement>(null);
  const deviceMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!deviceMenuOpen) return;
    const onPointerDown = (ev: PointerEvent) => {
      const target = ev.target as Node | null;
      if (
        (target && deviceBtnRef.current?.contains(target)) ||
        (target && deviceMenuRef.current?.contains(target))
      ) {
        return;
      }
      setDeviceMenuOpen(false);
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setDeviceMenuOpen(false);
    };
    const closeMenu = () => setDeviceMenuOpen(false);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("wheel", closeMenu, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("wheel", closeMenu, true);
    };
  }, [deviceMenuOpen]);

  useEffect(() => {
    if (isRenaming) {
      setRenameDraft(
        widget.title ||
          (isControl ? widget.source.controlLabel ?? "" : isWeb ? webHost : "")
      );
      window.requestAnimationFrame(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      });
    }
  }, [isRenaming, widget.title, isControl, widget.source.controlLabel, isWeb, webHost]);

  const submitRename = () => {
    onCommitRename?.(widget, renameDraft);
  };

  const renderInlineRenameInput = (extraCls = "") => (
    <input
      ref={renameInputRef}
      value={renameDraft}
      onChange={(e) => setRenameDraft(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={submitRename}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          submitRename();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancelRename?.();
        }
      }}
      placeholder="输入卡片名称..."
      className={`h-6 w-full min-w-0 rounded border border-primary/70 bg-background px-1.5 text-xs font-medium text-foreground focus:outline-none ${extraCls}`}
    />
  );

  const isPush = widget.source.kind === "push";
  const pushEndpoint = isPush
    ? buildPushUrl(pushBaseUrl, widget.source.pushKey?.trim() || widget.id)
    : "";
  const isStalePush = useMemo(() => {
    if (!isPush || !widget.source.staleAfterMinutes || !runtime?.lastResult?.ranAt) {
      return false;
    }
    const ms = Date.parse(runtime.lastResult.ranAt);
    if (Number.isNaN(ms)) return false;
    return Date.now() - ms > widget.source.staleAfterMinutes * 60_000;
  }, [isPush, widget.source.staleAfterMinutes, runtime?.lastResult?.ranAt]);

  const scheduleDesc = describeSchedule(widget.schedule, widget.source.kind);
  const lastTimeLabel = formatRelativeTime(runtime?.lastResult?.ranAt);

  const outerZAndSurfaceCls = isContainer
    ? isDropTarget
      ? "z-0 border-primary bg-primary/8 ring-2 ring-primary/45 shadow-card-hover transition-colors"
      : activeTransform
        ? "z-20 border-primary/80 bg-surface/55 shadow-popover-soft ring-1 ring-primary/35 select-none transition-none"
        : anyInteracting
          ? "z-0 border-border/80 bg-surface/40 backdrop-blur-[2px] shadow-card-rest transition-[left,top,width,height] duration-100 ease-out"
          : `z-0 border-border/80 bg-surface/40 backdrop-blur-[2px] shadow-card-rest transition-[left,top,width,height,box-shadow] duration-150 ease-out ${
              !locked ? "hover:border-primary/50" : "hover:border-border"
            }`
    : activeTransform
      ? "z-30 border-primary/80 bg-card shadow-popover-soft ring-1 ring-primary/35 select-none transition-none"
      : isGroupMoving
        ? "z-30 border-border bg-card shadow-card-rest select-none transition-none"
        : anyInteracting
          ? "z-10 border-border bg-card shadow-card-rest transition-[left,top,width,height] duration-100 ease-out"
          : `z-10 border-border bg-card shadow-card-rest transition-[left,top,width,height,box-shadow] duration-150 ease-out hover:shadow-card-hover ${
              !locked ? "hover:border-primary/45" : ""
            }`;

  return (
    <div
      data-info-widget={widget.id}
      onDoubleClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("button, a, input, select, pre, code, table")) return;
        if (locked && !panMode && isCollapsed && onToggleCollapse) {
          e.stopPropagation();
          onToggleCollapse(widget);
          return;
        }
        if (!locked && !panMode) {
          e.stopPropagation();
          onEdit(widget);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e, widget);
      }}
      style={{
        left: pixelRect.x,
        top: pixelRect.y,
        width: pixelRect.w,
        height: pixelRect.h,
      }}
      className={`group absolute flex flex-col overflow-hidden rounded-xl border text-card-foreground ${outerZAndSurfaceCls}`}
    >
      {/* Optional Top Accent Bar */}
      {accent && (
        <div
          className="h-[2.5px] w-full shrink-0"
          style={{ backgroundColor: accent }}
        />
      )}

      {/* Header (always shown when collapsed; hidden when titleless or hideHeader is enabled while expanded) */}
      {!effectiveHideHeader ? (
        <div
          onPointerDown={(e) => {
            if (!locked && !panMode) onStartDrag(e, widget);
          }}
          className={`flex items-center justify-between gap-2 bg-surface/55 px-2.5 select-none ${
            isCollapsed
              ? "min-h-0 flex-1"
              : "h-9 shrink-0 border-b border-border/60"
          } ${
            locked || panMode ? "cursor-default" : "cursor-grab active:cursor-grabbing"
          }`}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {onToggleCollapse && (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleCollapse(widget);
                }}
                title={isCollapsed ? "展开卡片" : "折叠卡片"}
                aria-label={isCollapsed ? "展开卡片" : "折叠卡片"}
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
            )}
            {isWeb ? (
              <WebFavicon
                url={webUrl}
                favicon={widget.source.webFavicon}
                className="h-3.5 w-3.5"
                iconClassName="h-3.5 w-3.5"
              />
            ) : isContainer ? (
              <Frame className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : isControl ? (
              <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-primary">
                {renderControlIcon(widget.source.controlIcon, "h-3.5 w-3.5")}
              </span>
            ) : (
              isRunning ? (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
              ) : (
                <span
                  title={parsed ? `状态: ${status}` : "尚未运行"}
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    parsed ? STATUS_DOT_CLS[status] : "bg-muted-foreground/45"
                  }`}
                />
              )
            )}
            {isRenaming ? (
              renderInlineRenameInput()
            ) : (
              <span className="truncate text-[12.5px] font-semibold text-foreground">
                {isWeb
                  ? webTitle
                  : isContainer
                    ? widget.title.trim() || "空白卡片"
                    : isControl
                      ? controlDisplayLabel ||
                        (widget.source.controlType === "icon" ? "图标" : "开关")
                      : parsed?.title || widget.title || "未命名卡片"}
              </span>
            )}
            {isContainer && childCount > 0 && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                {childCount} 项
              </span>
            )}
            {!isContainer && !isControl && !isWeb && parsed?.badge && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                {parsed.badge}
              </span>
            )}
          </div>

          <div
            className="flex shrink-0 items-center gap-1"
            onPointerDown={(e) => e.stopPropagation()}
          >
            {isWebEmbed && !isCollapsed && (
              <>
                <button
                  ref={deviceBtnRef}
                  type="button"
                  onClick={() => {
                    if (deviceMenuOpen) {
                      setDeviceMenuOpen(false);
                      return;
                    }
                    const rect = deviceBtnRef.current?.getBoundingClientRect();
                    if (rect) {
                      const menuW = 192;
                      const left = Math.max(
                        8,
                        Math.min(rect.right - menuW, window.innerWidth - menuW - 8)
                      );
                      const top = Math.max(
                        8,
                        Math.min(rect.bottom + 4, window.innerHeight - 210)
                      );
                      setDeviceMenuPos({ left, top });
                    }
                    setDeviceMenuOpen(true);
                  }}
                  title={`模拟设备：${activeDevicePreset.label}${
                    activeDevicePreset.width
                      ? ` (${activeDevicePreset.width}px)`
                      : ""
                  }`}
                  className={`inline-flex h-6 items-center justify-center rounded-md transition-colors ${
                    webDeviceMode !== "auto"
                      ? "gap-1 bg-primary/10 px-1.5 text-[10.5px] font-medium text-primary hover:bg-primary/15"
                      : "w-6 text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  {renderWebDeviceIcon(webDeviceMode, "h-3 w-3")}
                  {webDeviceMode !== "auto" && (
                    <span>{activeDevicePreset.shortLabel}</span>
                  )}
                </button>
                {deviceMenuOpen &&
                  deviceMenuPos &&
                  typeof document !== "undefined" &&
                  createPortal(
                    <div
                      ref={deviceMenuRef}
                      style={{
                        left: deviceMenuPos.left,
                        top: deviceMenuPos.top,
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      className="fixed z-50 w-48 rounded-lg border border-border bg-popover p-1 shadow-popover-soft"
                    >
                      <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground">
                        模拟设备视口
                      </div>
                      {WEB_DEVICE_PRESETS.map((preset) => {
                        const selected = webDeviceMode === preset.id;
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => {
                              onChangeWebDeviceMode?.(
                                widget,
                                preset.id,
                                syncCardSize && preset.id !== "auto"
                              );
                              setDeviceMenuOpen(false);
                            }}
                            className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                              selected
                                ? "bg-primary/10 font-medium text-primary"
                                : "text-popover-foreground hover:bg-accent"
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              {renderWebDeviceIcon(preset.id, "h-3.5 w-3.5")}
                              <span>{preset.label}</span>
                            </span>
                            <span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                              <span>
                                {preset.width ? `${preset.width}px` : "默认"}
                              </span>
                              {selected && <Check className="h-3 w-3 text-primary" />}
                            </span>
                          </button>
                        );
                      })}
                      <label
                        title="切换为手机 / iPad / 桌面模式时自动匹配对应卡片尺寸，之后仍可自由拖拽缩放"
                        className="mt-1 flex cursor-pointer items-center gap-2 border-t border-border/60 px-2 pt-1.5 pb-1 text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        <input
                          type="checkbox"
                          checked={syncCardSize}
                          onChange={(e) => {
                            const next = e.target.checked;
                            setSyncCardSize(next);
                            try {
                              window.localStorage.setItem(
                                "shibaplan:info:web-device-sync-size",
                                String(next)
                              );
                            } catch {
                              // ignore storage errors
                            }
                          }}
                          className="h-3 w-3 rounded accent-primary"
                        />
                        <span>同步调整卡片尺寸</span>
                      </label>
                    </div>,
                    document.body
                  )}
                <button
                  type="button"
                  onClick={() => setEmbedKey((k) => k + 1)}
                  title="重新加载网页"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <RefreshCw className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => onOpenWebUrl?.(widget)}
                  title="在浏览器中打开"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <ExternalLink className="h-3 w-3" />
                </button>
              </>
            )}
            {isStalePush && (
              <span
                title={`超过 ${widget.source.staleAfterMinutes} 分钟未收到推送`}
                className="rounded bg-amber-500/15 px-1 py-px text-[9.5px] font-medium text-amber-500"
              >
                超时未推
              </span>
            )}
            {isPush ? (
              <span
                title={`外部推送接收：${pushEndpoint}`}
                className="hidden sm:inline-flex items-center text-[10px] text-primary/80"
              >
                <Radio className="h-2.5 w-2.5" />
              </span>
            ) : !isContainer && !isControl && widget.schedule.paused ? (
              <span
                title="定时任务已暂停"
                className="hidden sm:inline-flex items-center gap-0.5 text-[10px] text-amber-500"
              >
                <Pause className="h-2.5 w-2.5" />
              </span>
            ) : !isContainer && !isControl && widget.schedule.mode !== "manual" ? (
              <span
                title={`自动调度：${scheduleDesc}`}
                className="hidden sm:inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/75"
              >
                <Clock className="h-2.5 w-2.5" />
              </span>
            ) : null}

            {!isContainer && !isControl && lastTimeLabel && (
              <span
                title={
                  runtime?.lastResult
                    ? `最近更新：${new Date(runtime.lastResult.ranAt).toLocaleString()} (${runtime.lastResult.durationMs}ms)`
                    : undefined
                }
                className="text-[10.5px] text-muted-foreground/75 tabular-nums group-hover:hidden"
              >
                {lastTimeLabel}
              </span>
            )}

            <div className="hidden items-center gap-0.5 group-hover:flex">
              {!isContainer && !isControl && !isWeb && (
                isPush ? (
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(pushEndpoint).catch(() => {});
                      onNotify("已复制推送地址");
                    }}
                    title="复制推送地址"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                ) : isRunning ? (
                  <button
                    type="button"
                    onClick={() => onCancel(widget)}
                    title="停止运行"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-rose-500 hover:bg-rose-500/15"
                  >
                    <Square className="h-3 w-3 fill-current" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onRun(widget)}
                    title="立即运行"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Play className="h-3 w-3" />
                  </button>
                )
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onContextMenu(e, widget);
                }}
                title="更多操作"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <MoreVertical className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      ) : !isContainer && !isControl && !isWeb ? (
        /* Compact floating quick-run bar when header is hidden on regular data cards */
        <div
          onPointerDown={(e) => {
            if (!locked && !panMode) onStartDrag(e, widget);
          }}
          className={`absolute right-1.5 top-1.5 z-20 flex items-center gap-0.5 rounded-md border border-border/70 bg-popover/90 px-1 py-0.5 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover:opacity-100 ${
            locked || panMode ? "cursor-default" : "cursor-grab active:cursor-grabbing"
          }`}
        >
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              if (isPush) {
                navigator.clipboard.writeText(pushEndpoint).catch(() => {});
                onNotify("已复制推送地址");
              } else if (isRunning) {
                onCancel(widget);
              } else {
                onRun(widget);
              }
            }}
            title={isPush ? "复制推送地址" : isRunning ? "停止" : "运行"}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {isPush ? (
              <Copy className="h-2.5 w-2.5" />
            ) : isRunning ? (
              <Square className="h-2.5 w-2.5 text-rose-500 fill-current" />
            ) : (
              <Play className="h-2.5 w-2.5" />
            )}
          </button>
          {onToggleCollapse && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse(widget);
              }}
              title="折叠卡片"
              aria-label="折叠卡片"
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ChevronDown className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
      ) : isContainer && onToggleCollapse ? (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse(widget);
          }}
          title="折叠空白卡片"
          aria-label="折叠空白卡片"
          className="absolute right-2 top-2 z-20 inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/70 bg-popover/90 text-muted-foreground opacity-0 shadow-sm backdrop-blur-sm transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      ) : null}

      {/* Body Content */}
      {isCollapsed ? null : isContainer ? (
        <div
          onPointerDown={(e) => {
            if (!locked && !panMode) {
              const target = e.target as HTMLElement;
              if (!target.closest("button, a, input, select")) {
                onStartDrag(e, widget);
              }
            }
          }}
          className={`relative flex min-h-0 flex-1 items-center justify-center p-3 select-none ${
            locked || panMode ? "cursor-default" : "cursor-grab active:cursor-grabbing"
          }`}
        >
          {childCount === 0 && !isDropTarget && (
            <span className="pointer-events-none text-center text-[11.5px] text-muted-foreground/55">
              拖入卡片 / 开关 / 图标
            </span>
          )}
          {isDropTarget && (
            <span className="pointer-events-none absolute bottom-2.5 rounded-full bg-primary px-2.5 py-0.5 text-[10.5px] font-medium text-primary-foreground shadow">
              松开放入空白卡片
            </span>
          )}
        </div>
      ) : isControl ? (
        <div
          onPointerDown={(e) => {
            if (!locked && !panMode) {
              const target = e.target as HTMLElement;
              if (!target.closest("button, a, input, select")) {
                onStartDrag(e, widget);
              }
            }
          }}
          className={`flex min-h-0 flex-1 items-center justify-center select-none ${
            widget.source.controlLabelPosition === "right"
              ? "flex-row gap-2.5 px-3 py-2"
              : "flex-col gap-1.5 px-2.5 py-2"
          } ${
            locked || panMode ? "cursor-default" : "cursor-grab active:cursor-grabbing"
          }`}
        >
          {widget.source.controlType !== "icon" ? (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onToggleControl?.(widget)}
              aria-pressed={Boolean(widget.source.controlState)}
              title={
                controlDisplayLabel ||
                (widget.source.controlState ? "已开启" : "已关闭")
              }
              className="group/sw flex shrink-0 items-center gap-2 rounded-lg px-1 py-0.5 transition-colors hover:bg-accent/55"
            >
              {widget.source.controlIcon && (
                <span
                  style={{
                    color: widget.source.controlState
                      ? accent || "hsl(var(--primary))"
                      : undefined,
                  }}
                  className={
                    widget.source.controlState
                      ? ""
                      : "text-muted-foreground"
                  }
                >
                  {renderControlIcon(widget.source.controlIcon, "h-4 w-4")}
                </span>
              )}
              <span
                style={
                  widget.source.controlState && accent
                    ? { backgroundColor: accent }
                    : undefined
                }
                className={`relative inline-flex h-[22px] w-10 shrink-0 items-center rounded-full border border-transparent transition-colors ${
                  widget.source.controlState
                    ? accent
                      ? ""
                      : "bg-primary"
                    : "bg-muted-foreground/30"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                    widget.source.controlState ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </span>
            </button>
          ) : (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onTriggerControl?.(widget)}
              title={controlDisplayLabel || "点击触发"}
              style={accent ? { color: accent } : undefined}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-surface/65 transition-all hover:scale-105 hover:border-primary/50 hover:bg-accent active:scale-95 ${
                accent ? "" : "text-foreground"
              }`}
            >
              {isRunning ? (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              ) : (
                renderControlIcon(widget.source.controlIcon, "h-5 w-5")
              )}
            </button>
          )}
          {isRenaming ? (
            <div className="w-full max-w-[140px]">
              {renderInlineRenameInput("text-center text-[11px]")}
            </div>
          ) : (
            controlDisplayLabel && (
              <span
                className={`truncate text-[11px] font-medium text-muted-foreground ${
                  widget.source.controlLabelPosition === "right"
                    ? "min-w-0 flex-1 text-left"
                    : "max-w-full"
                }`}
              >
                {controlDisplayLabel}
              </span>
            )
          )}
        </div>
      ) : isWebEmbed ? (
        <WebEmbedViewport
          url={webUrl}
          title={webTitle}
          deviceMode={webDeviceMode}
          embedKey={embedKey}
          interactive={!activeTransform && !anyInteracting}
          fallbackWidth={Math.max(120, pixelRect.w - 2)}
          fallbackHeight={Math.max(80, pixelRect.h - 38)}
        />
      ) : isWeb ? (
        (() => {
          const isCompactTile =
            pixelRect.w < 136 || pixelRect.h >= pixelRect.w * 0.85;
          return (
            <div
              onPointerDown={(e) => {
                if (!locked && !panMode && !isRenaming) {
                  const target = e.target as HTMLElement;
                  if (!target.closest("button, a, input")) {
                    onStartDrag(e, widget);
                  }
                }
              }}
              onClick={() => {
                if (locked && !panMode && !isRenaming && webUrl) {
                  onOpenWebUrl?.(widget);
                }
              }}
              title={webUrl ? `${webTitle}\n${webUrl}` : webTitle}
              className={`group/web relative flex min-h-0 flex-1 select-none ${
                isCompactTile
                  ? "flex-col items-center justify-center gap-1.5 px-2.5 py-2 text-center"
                  : "flex-row items-center gap-2.5 px-3 py-2 text-left"
              } ${
                locked && !panMode
                  ? "cursor-pointer transition-colors hover:bg-accent/35"
                  : panMode
                    ? "cursor-default"
                    : "cursor-grab active:cursor-grabbing"
              }`}
            >
              <div
                className={`flex shrink-0 items-center justify-center rounded-xl border border-border/70 bg-surface/70 shadow-sm ${
                  isCompactTile ? "h-9 w-9" : "h-8 w-8"
                }`}
              >
                <WebFavicon
                  url={webUrl}
                  favicon={widget.source.webFavicon}
                  className={isCompactTile ? "h-5 w-5" : "h-4.5 w-4.5"}
                  iconClassName={isCompactTile ? "h-5 w-5" : "h-4 w-4"}
                />
              </div>

              <div className="min-w-0 flex-1">
                {isRenaming ? (
                  renderInlineRenameInput(
                    isCompactTile ? "text-center text-[11px]" : ""
                  )
                ) : (
                  <>
                    <div
                      className={`truncate font-medium text-foreground ${
                        isCompactTile ? "text-[11px]" : "text-xs"
                      }`}
                    >
                      {webTitle}
                    </div>
                    {!isCompactTile && (
                      <div className="truncate font-mono text-[10px] text-muted-foreground">
                        {webHost}
                      </div>
                    )}
                  </>
                )}
              </div>

              {!isCompactTile && !isRenaming && webUrl && (
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenWebUrl?.(widget);
                  }}
                  title="打开网页"
                  className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/web:opacity-100"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })()
      ) : (
        /* Body Content (allow drag on hidden-header mode empty area) */
        <div
          onPointerDown={(e) => {
            if (effectiveHideHeader && !locked && !panMode) {
              const target = e.target as HTMLElement;
              if (!target.closest("button, a, input, select, pre, code, table")) {
                onStartDrag(e, widget);
              }
            }
          }}
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        >
          <InfoContentRenderer
            parsed={parsed}
            running={isRunning}
            compactPadding={widget.appearance?.compactPadding}
            isPushSource={isPush}
            onCopyPushUrl={() => {
              navigator.clipboard.writeText(pushEndpoint).catch(() => {});
              onNotify("已复制推送地址");
            }}
            onRunNow={() => onRun(widget)}
            onViewLogs={() => onViewLogs(widget)}
            onSendItemToKanban={onSendItemToKanban}
            onSendItemToIdea={onSendItemToIdea}
            onNotify={onNotify}
          />
        </div>
      )}

      {/* Live Drag / Resize Coordinate Pill */}
      {(isResizing || isDragging) && (
        <div className="pointer-events-none absolute bottom-2 right-3.5 z-30 rounded bg-primary px-1.5 py-0.5 font-mono text-[10px] font-medium text-primary-foreground shadow">
          {isResizing
            ? `${Math.round(pixelRect.w)} × ${Math.round(pixelRect.h)} px`
            : `X:${Math.round(pixelRect.x)} Y:${Math.round(pixelRect.y)}`}
        </div>
      )}

      {/* 5-Edge Resize Handles (hidden when locked or panMode; vertical edges hidden when collapsed) */}
      {!locked && !panMode && (
        <>
          {!isCollapsed && (
            <div
              onPointerDown={(e) => onStartResize(e, widget, "n")}
              title="向上调整高度"
              className="absolute left-3 right-3 top-0 z-20 h-1 cursor-ns-resize opacity-0 transition-opacity hover:bg-primary/35 group-hover:opacity-100"
            />
          )}
          <div
            onPointerDown={(e) => onStartResize(e, widget, "w")}
            title="向左调整宽度"
            className={`absolute ${
              isCollapsed ? "bottom-1.5 top-1.5" : `bottom-3 ${effectiveHideHeader ? "top-2.5" : "top-9"}`
            } left-0 z-20 w-1.5 cursor-ew-resize opacity-0 transition-opacity hover:bg-primary/35 group-hover:opacity-100`}
          />
          <div
            onPointerDown={(e) => onStartResize(e, widget, "e")}
            title="向右调整宽度"
            className={`absolute ${
              isCollapsed ? "bottom-1.5 top-1.5" : `bottom-3 ${effectiveHideHeader ? "top-2.5" : "top-9"}`
            } right-0 z-20 w-1.5 cursor-ew-resize opacity-0 transition-opacity hover:bg-primary/35 group-hover:opacity-100`}
          />
          {!isCollapsed && (
            <>
              <div
                onPointerDown={(e) => onStartResize(e, widget, "s")}
                title="向下调整高度"
                className="absolute bottom-0 left-3 right-3 z-20 h-1.5 cursor-ns-resize opacity-0 transition-opacity hover:bg-primary/35 group-hover:opacity-100"
              />
              <div
                onPointerDown={(e) => onStartResize(e, widget, "se")}
                title="拖拽调整卡片大小"
                className="absolute bottom-0.5 right-0.5 z-20 flex h-3.5 w-3.5 cursor-nwse-resize items-end justify-end p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
              >
                <span className="h-2 w-2 rounded-br-[2px] border-b-2 border-r-2 border-muted-foreground/65" />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};
