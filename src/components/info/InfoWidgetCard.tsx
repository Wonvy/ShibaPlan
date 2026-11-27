import React, { useMemo } from "react";
import {
  Clock,
  Copy,
  Loader2,
  MoreVertical,
  Pause,
  Pencil,
  Play,
  Radio,
  Square,
} from "lucide-react";
import { InfoCardStatus, InfoWidget } from "../../types";
import { InfoWidgetRuntimeState } from "../../lib/infoRunner";
import { PixelRect } from "../../lib/infoGrid";
import {
  buildPushUrl,
  describeSchedule,
  parseInfoOutput,
} from "../../lib/infoProtocol";
import { InfoContentRenderer } from "./InfoContentRenderer";

export type ResizeEdge = "se" | "e" | "s" | "w" | "n";

interface InfoWidgetCardProps {
  widget: InfoWidget;
  pixelRect: PixelRect;
  gridSizeLabel?: string;
  runtime?: InfoWidgetRuntimeState;
  locked: boolean;
  pushBaseUrl?: string;
  isDragging: boolean;
  isResizing: boolean;
  anyInteracting: boolean;
  onStartDrag: (e: React.PointerEvent, widget: InfoWidget) => void;
  onStartResize: (
    e: React.PointerEvent,
    widget: InfoWidget,
    edge: ResizeEdge
  ) => void;
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
  gridSizeLabel,
  runtime,
  locked,
  pushBaseUrl,
  isDragging,
  isResizing,
  anyInteracting,
  onStartDrag,
  onStartResize,
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
    return parseInfoOutput(runtime.lastResult, widget.source.jsonPath);
  }, [runtime?.lastResult, widget.source.jsonPath]);

  const isRunning = Boolean(runtime?.running);
  const status: InfoCardStatus = parsed?.status ?? "info";
  const accent = widget.appearance?.accentColor;
  const hideHeader = Boolean(widget.appearance?.hideHeader);
  const activeTransform = isDragging || isResizing;

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

  return (
    <div
      data-info-widget={widget.id}
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
      className={`group absolute flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground ${
        activeTransform
          ? "z-30 border-primary/80 shadow-popover-soft ring-1 ring-primary/35 select-none transition-none"
          : anyInteracting
            ? "z-10 border-border shadow-card-rest transition-[left,top,width,height] duration-100 ease-out"
            : "z-10 border-border shadow-card-rest transition-[left,top,width,height,box-shadow] duration-150 ease-out hover:shadow-card-hover"
      }`}
    >
      {/* Optional Top Accent Bar */}
      {accent && (
        <div
          className="h-[2.5px] w-full shrink-0"
          style={{ backgroundColor: accent }}
        />
      )}

      {/* Header (draggable handle unless locked) */}
      {!hideHeader ? (
        <div
          onPointerDown={(e) => {
            if (!locked) onStartDrag(e, widget);
          }}
          className={`flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-surface/55 px-3 select-none ${
            locked ? "cursor-default" : "cursor-grab active:cursor-grabbing"
          }`}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {isRunning ? (
              <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
            ) : (
              <span
                title={parsed ? `状态: ${status}` : "尚未运行"}
                className={`h-2 w-2 shrink-0 rounded-full ${
                  parsed ? STATUS_DOT_CLS[status] : "bg-muted-foreground/45"
                }`}
              />
            )}
            <span className="truncate text-[12.5px] font-semibold text-foreground">
              {parsed?.title || widget.title}
            </span>
            {parsed?.badge && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                {parsed.badge}
              </span>
            )}
          </div>

          <div
            className="flex shrink-0 items-center gap-1"
            onPointerDown={(e) => e.stopPropagation()}
          >
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
            ) : widget.schedule.paused ? (
              <span
                title="定时任务已暂停"
                className="hidden sm:inline-flex items-center gap-0.5 text-[10px] text-amber-500"
              >
                <Pause className="h-2.5 w-2.5" />
              </span>
            ) : widget.schedule.mode !== "manual" ? (
              <span
                title={`自动调度：${scheduleDesc}`}
                className="hidden sm:inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/75"
              >
                <Clock className="h-2.5 w-2.5" />
              </span>
            ) : null}

            {lastTimeLabel && (
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
              {isPush ? (
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
              )}
              <button
                type="button"
                onClick={() => onEdit(widget)}
                title="编辑卡片与脚本"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Pencil className="h-3 w-3" />
              </button>
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
      ) : (
        /* Compact floating bar when header is hidden */
        <div
          onPointerDown={(e) => {
            if (!locked) onStartDrag(e, widget);
          }}
          className={`absolute right-1.5 top-1.5 z-20 flex items-center gap-0.5 rounded-md border border-border/70 bg-popover/90 px-1 py-0.5 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover:opacity-100 ${
            locked ? "cursor-default" : "cursor-grab active:cursor-grabbing"
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
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onEdit(widget)}
            title="编辑"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Pencil className="h-2.5 w-2.5" />
          </button>
        </div>
      )}

      {/* Body Content (allow drag on hidden-header mode empty area) */}
      <div
        onPointerDown={(e) => {
          if (hideHeader && !locked) {
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

      {/* Live Drag / Resize Coordinate Pill */}
      {(isResizing || isDragging) && (
        <div className="pointer-events-none absolute bottom-2 right-3.5 z-30 rounded bg-primary px-1.5 py-0.5 font-mono text-[10px] font-medium text-primary-foreground shadow">
          {isResizing
            ? gridSizeLabel || `${Math.round(pixelRect.w)} × ${Math.round(pixelRect.h)} px`
            : `X:${Math.round(pixelRect.x)} Y:${Math.round(pixelRect.y)}`}
        </div>
      )}

      {/* 5-Edge Resize Handles (hidden when locked) */}
      {!locked && (
        <>
          <div
            onPointerDown={(e) => onStartResize(e, widget, "n")}
            title="向上调整高度"
            className="absolute left-3 right-3 top-0 z-20 h-1 cursor-ns-resize opacity-0 transition-opacity hover:bg-primary/35 group-hover:opacity-100"
          />
          <div
            onPointerDown={(e) => onStartResize(e, widget, "w")}
            title="向左调整宽度"
            className="absolute bottom-3 left-0 top-9 z-20 w-1.5 cursor-ew-resize opacity-0 transition-opacity hover:bg-primary/35 group-hover:opacity-100"
          />
          <div
            onPointerDown={(e) => onStartResize(e, widget, "e")}
            title="向右调整宽度"
            className="absolute bottom-3 right-0 top-9 z-20 w-1.5 cursor-ew-resize opacity-0 transition-opacity hover:bg-primary/35 group-hover:opacity-100"
          />
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
    </div>
  );
};
