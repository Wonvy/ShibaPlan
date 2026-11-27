import React, { useMemo } from "react";
import {
  Clock,
  Copy,
  Loader2,
  MoreVertical,
  Pause,
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
import { renderControlIcon } from "./controlIcons";
import { InfoContentRenderer } from "./InfoContentRenderer";

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
  const isRunning = Boolean(runtime?.running);
  const status: InfoCardStatus = parsed?.status ?? "info";
  const accent = widget.appearance?.accentColor;
  const controlDisplayLabel =
    widget.title.trim() || widget.source.controlLabel?.trim() || "";
  const hasVisibleTitle = Boolean(
    (!isContainer && !isControl && parsed?.title?.trim()) || widget.title.trim()
  );
  const effectiveHideHeader =
    isControl || Boolean(widget.appearance?.hideHeader) || !hasVisibleTitle;
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
        if (!locked && !panMode) {
          const target = e.target as HTMLElement;
          if (!target.closest("button, a, input, select, pre, code, table")) {
            e.stopPropagation();
            onEdit(widget);
          }
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

      {/* Header (hidden when titleless or hideHeader is enabled) */}
      {!effectiveHideHeader ? (
        <div
          onPointerDown={(e) => {
            if (!locked && !panMode) onStartDrag(e, widget);
          }}
          className={`flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-surface/55 px-3 select-none ${
            locked || panMode ? "cursor-default" : "cursor-grab active:cursor-grabbing"
          }`}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {!isContainer &&
              (isRunning ? (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
              ) : (
                <span
                  title={parsed ? `状态: ${status}` : "尚未运行"}
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    parsed ? STATUS_DOT_CLS[status] : "bg-muted-foreground/45"
                  }`}
                />
              ))}
            <span className="truncate text-[12.5px] font-semibold text-foreground">
              {(!isContainer && !isControl && parsed?.title) || widget.title}
            </span>
            {!isContainer && !isControl && parsed?.badge && (
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
              {!isContainer && !isControl && (
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
      ) : !isContainer && !isControl ? (
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
        </div>
      ) : null}

      {/* Body Content */}
      {isContainer ? (
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
          {controlDisplayLabel && (
            <span
              className={`truncate text-[11px] font-medium text-muted-foreground ${
                widget.source.controlLabelPosition === "right"
                  ? "min-w-0 flex-1 text-left"
                  : "max-w-full"
              }`}
            >
              {controlDisplayLabel}
            </span>
          )}
        </div>
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

      {/* 5-Edge Resize Handles (hidden when locked or panMode) */}
      {!locked && !panMode && (
        <>
          <div
            onPointerDown={(e) => onStartResize(e, widget, "n")}
            title="向上调整高度"
            className="absolute left-3 right-3 top-0 z-20 h-1 cursor-ns-resize opacity-0 transition-opacity hover:bg-primary/35 group-hover:opacity-100"
          />
          <div
            onPointerDown={(e) => onStartResize(e, widget, "w")}
            title="向左调整宽度"
            className={`absolute bottom-3 left-0 ${
              effectiveHideHeader ? "top-2.5" : "top-9"
            } z-20 w-1.5 cursor-ew-resize opacity-0 transition-opacity hover:bg-primary/35 group-hover:opacity-100`}
          />
          <div
            onPointerDown={(e) => onStartResize(e, widget, "e")}
            title="向右调整宽度"
            className={`absolute bottom-3 right-0 ${
              effectiveHideHeader ? "top-2.5" : "top-9"
            } z-20 w-1.5 cursor-ew-resize opacity-0 transition-opacity hover:bg-primary/35 group-hover:opacity-100`}
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
