import React from "react";
import {
  ArrowUpRight,
  BookOpen,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileCode2,
  FolderOpen,
  Frame,
  Grid,
  LayoutGrid,
  LogOut,
  Magnet,
  Maximize2,
  Pause,
  Pencil,
  Play,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Square,
  Terminal,
  ToggleRight,
  Trash2,
  Upload,
  Zap,
} from "lucide-react";
import {
  InfoBoard,
  InfoControlType,
  InfoDisplayView,
  InfoWidget,
} from "../../types";
import {
  buildPushCodeSnippets,
  buildPushUrl,
  INFO_DISPLAY_VIEW_OPTIONS,
  INFO_WIDGET_TEMPLATES,
  InfoWidgetTemplate,
} from "../../lib/infoProtocol";

export type InfoMenuState =
  | { kind: "widget"; widgetId: string; x: number; y: number }
  | {
      kind: "canvas";
      worldX: number;
      worldY: number;
      x: number;
      y: number;
    };

interface InfoContextMenuProps {
  menu: InfoMenuState;
  widget: InfoWidget | null;
  board: InfoBoard;
  isRunning: boolean;
  hasColumns: boolean;
  editMode: boolean;
  pushBaseUrl?: string;
  onClose: () => void;
  onNotify?: (msg: string) => void;
  // Widget actions
  onRunWidget: (w: InfoWidget) => void;
  onCancelWidget: (w: InfoWidget) => void;
  onEditWidget: (w: InfoWidget) => void;
  onViewLogs: (w: InfoWidget) => void;
  onCopyPlainText: (w: InfoWidget) => void;
  onCopyRawOutput: (w: InfoWidget) => void;
  onSendToKanban: (w: InfoWidget) => void;
  onSendToIdea: (w: InfoWidget) => void;
  onTogglePause: (w: InfoWidget) => void;
  onSetAccent: (w: InfoWidget, color?: string) => void;
  onSetDisplayView: (w: InfoWidget, view: InfoDisplayView) => void;
  onToggleHideHeader: (w: InfoWidget) => void;
  onResetWidgetSize: (w: InfoWidget) => void;
  onArrangeContainer?: (w: InfoWidget) => void;
  onDetachFromContainer?: (w: InfoWidget) => void;
  onCloneWidget: (w: InfoWidget) => void;
  onDeleteWidget: (w: InfoWidget) => void;
  // Canvas actions
  onAddAtPos: (worldX: number, worldY: number) => void;
  onAddBlankContainer: (worldX: number, worldY: number) => void;
  onAddControlAtPos: (
    controlType: InfoControlType,
    worldX: number,
    worldY: number
  ) => void;
  onAddFromTemplate: (
    tpl: InfoWidgetTemplate,
    worldX: number,
    worldY: number
  ) => void;
  onRefreshAll: () => void;
  onResetView: () => void;
  onFitAll: () => void;
  onToggleSnap: () => void;
  onToggleGrid: () => void;
  onToggleEditMode: () => void;
  onAutoArrange: () => void;
  onOpenScriptsDir: () => void;
  onOpenProtocolDoc: () => void;
  onExportBoard: () => void;
  onImportBoard: () => void;
}

const ITEM_CLS =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-popover-foreground transition-colors hover:bg-accent";

const ACCENT_SWATCHES = [
  "#5e6ad2",
  "#38bdf8",
  "#34d399",
  "#f59e0b",
  "#fb7185",
  "#a78bfa",
];

export const InfoContextMenu: React.FC<InfoContextMenuProps> = ({
  menu,
  widget,
  board,
  isRunning,
  hasColumns,
  editMode,
  pushBaseUrl,
  onClose,
  onNotify,
  onRunWidget,
  onCancelWidget,
  onEditWidget,
  onViewLogs,
  onCopyPlainText,
  onCopyRawOutput,
  onSendToKanban,
  onSendToIdea,
  onTogglePause,
  onSetAccent,
  onSetDisplayView,
  onToggleHideHeader,
  onResetWidgetSize,
  onArrangeContainer,
  onDetachFromContainer,
  onCloneWidget,
  onDeleteWidget,
  onAddAtPos,
  onAddBlankContainer,
  onAddControlAtPos,
  onAddFromTemplate,
  onRefreshAll,
  onResetView,
  onFitAll,
  onToggleSnap,
  onToggleGrid,
  onToggleEditMode,
  onAutoArrange,
  onOpenScriptsDir,
  onOpenProtocolDoc,
  onExportBoard,
  onImportBoard,
}) => {
  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  // Clamp coordinates so menu always stays within viewport
  const menuW = 224;
  const estH = menu.kind === "widget" ? 410 : 440;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const left = Math.max(8, Math.min(menu.x, vw - menuW - 8));
  const top = Math.max(8, Math.min(menu.y, vh - estH - 8));

  const showGrid = board.showGrid ?? true;
  const snapEnabled = board.snapEnabled ?? true;

  const isContainer = widget?.source.kind === "container";
  const isControl = widget?.source.kind === "control";

  return (
    <div
      style={{ left, top, width: menuW }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-50 rounded-lg border border-border bg-popover p-1 shadow-popover-soft"
    >
      {menu.kind === "widget" && widget && (
        <>
          {!isContainer && !isControl && (
            <>
              {widget.source.kind === "push" ? (
                <>
                  <button
                    type="button"
                    onClick={run(() => {
                      const url = buildPushUrl(
                        pushBaseUrl,
                        widget.source.pushKey?.trim() || widget.id
                      );
                      navigator.clipboard.writeText(url).catch(() => {});
                      onNotify?.("已复制推送地址 (URL)");
                    })}
                    className={ITEM_CLS}
                  >
                    <Radio className="h-3.5 w-3.5 text-primary" />
                    <span>复制推送地址 (URL)</span>
                  </button>
                  <button
                    type="button"
                    onClick={run(() => {
                      const url = buildPushUrl(
                        pushBaseUrl,
                        widget.source.pushKey?.trim() || widget.id
                      );
                      const py = buildPushCodeSnippets(url, widget.source.pushToken).python;
                      navigator.clipboard.writeText(py).catch(() => {});
                      onNotify?.("已复制 Python 推送代码");
                    })}
                    className={ITEM_CLS}
                  >
                    <FileCode2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>复制 Python 推送代码</span>
                  </button>
                </>
              ) : isRunning ? (
                <button
                  type="button"
                  onClick={run(() => onCancelWidget(widget))}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-rose-500 transition-colors hover:bg-rose-500/10"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                  <span>停止运行</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={run(() => onRunWidget(widget))}
                  className={ITEM_CLS}
                >
                  <Play className="h-3.5 w-3.5 text-primary" />
                  <span>立即运行</span>
                </button>
              )}
            </>
          )}

          {isContainer && onArrangeContainer && (
            <button
              type="button"
              onClick={run(() => onArrangeContainer(widget))}
              className={ITEM_CLS}
            >
              <LayoutGrid className="h-3.5 w-3.5 text-primary" />
              <span>整理容器内卡片</span>
            </button>
          )}

          <button
            type="button"
            onClick={run(() => onEditWidget(widget))}
            className={ITEM_CLS}
          >
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
            <span>
              {isContainer
                ? "设置空白卡片标题与样式"
                : isControl
                  ? "编辑微组件"
                  : "编辑数据源与任务"}
            </span>
          </button>

          {!isContainer && !isControl && (
            <>
              <button
                type="button"
                onClick={run(() => onViewLogs(widget))}
                className={ITEM_CLS}
              >
                <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
                <span>查看输出与历史日志</span>
              </button>

              <div className="my-1 border-t border-border/60" />

              <button
                type="button"
                onClick={run(() => onCopyPlainText(widget))}
                className={ITEM_CLS}
              >
                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                <span>复制展示内容</span>
              </button>

              <button
                type="button"
                onClick={run(() => onCopyRawOutput(widget))}
                className={ITEM_CLS}
              >
                <FileCode2 className="h-3.5 w-3.5 text-muted-foreground" />
                <span>复制原始输出 (JSON/文本)</span>
              </button>

              {hasColumns && (
                <button
                  type="button"
                  onClick={run(() => onSendToKanban(widget))}
                  className={ITEM_CLS}
                >
                  <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>转为看板任务</span>
                </button>
              )}

              <button
                type="button"
                onClick={run(() => onSendToIdea(widget))}
                className={ITEM_CLS}
              >
                <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                <span>收入灵感流</span>
              </button>

              {widget.source.kind !== "push" && widget.schedule.mode !== "manual" && (
                <button
                  type="button"
                  onClick={run(() => onTogglePause(widget))}
                  className={ITEM_CLS}
                >
                  {widget.schedule.paused ? (
                    <Play className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Pause className="h-3.5 w-3.5 text-amber-500" />
                  )}
                  <span>
                    {widget.schedule.paused ? "恢复自动任务" : "暂停自动任务"}
                  </span>
                </button>
              )}
            </>
          )}

          <div className="my-1 border-t border-border/60" />

          {/* Accent Swatches */}
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-[11px] text-muted-foreground">顶部色条</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                title="无色条"
                onClick={run(() => onSetAccent(widget, undefined))}
                className={`h-3.5 w-3.5 rounded-full border border-border bg-transparent text-[8px] leading-none text-muted-foreground ${
                  !widget.appearance?.accentColor ? "ring-1 ring-primary" : ""
                }`}
              >
                ×
              </button>
              {ACCENT_SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={run(() => onSetAccent(widget, c))}
                  style={{ backgroundColor: c }}
                  className={`h-3.5 w-3.5 rounded-full transition-transform hover:scale-110 ${
                    widget.appearance?.accentColor === c
                      ? "ring-2 ring-foreground ring-offset-1 ring-offset-popover"
                      : ""
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Display View Switch (regular cards only) */}
          {!isContainer && !isControl && (
            <div className="space-y-1 px-2 py-1.5">
              <span className="block text-[11px] text-muted-foreground">
                展示版式
              </span>
              <div className="grid grid-cols-4 gap-1">
                {INFO_DISPLAY_VIEW_OPTIONS.map((opt) => {
                  const curView = widget.appearance?.displayView ?? "auto";
                  const active = curView === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      title={opt.desc}
                      onClick={run(() => onSetDisplayView(widget, opt.id))}
                      className={`rounded px-1 py-0.5 text-[10.5px] font-medium transition-colors ${
                        active
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/70 text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                    >
                      {opt.shortLabel}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {widget.parentId && onDetachFromContainer && (
            <button
              type="button"
              onClick={run(() => onDetachFromContainer(widget))}
              className={ITEM_CLS}
            >
              <LogOut className="h-3.5 w-3.5 text-muted-foreground" />
              <span>移出空白卡片</span>
            </button>
          )}

          <button
            type="button"
            onClick={run(() => onToggleHideHeader(widget))}
            className={ITEM_CLS}
          >
            {widget.appearance?.hideHeader ? (
              <Eye className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span>
              {widget.appearance?.hideHeader ? "显示标题栏" : "隐藏标题栏（极简）"}
            </span>
          </button>

          <button
            type="button"
            onClick={run(() => onResetWidgetSize(widget))}
            className={ITEM_CLS}
          >
            <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
            <span>恢复默认尺寸 (380×260)</span>
          </button>

          <button
            type="button"
            onClick={run(() => onCloneWidget(widget))}
            className={ITEM_CLS}
          >
            <Copy className="h-3.5 w-3.5 text-muted-foreground" />
            <span>克隆卡片</span>
          </button>

          <div className="my-1 border-t border-border/60" />

          <button
            type="button"
            onClick={run(() => onDeleteWidget(widget))}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-rose-500 transition-colors hover:bg-rose-500/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>删除卡片</span>
          </button>
        </>
      )}

      {menu.kind === "canvas" && (
        <>
          <button
            type="button"
            onClick={run(() => onAddAtPos(menu.worldX, menu.worldY))}
            className={ITEM_CLS}
          >
            <Plus className="h-3.5 w-3.5 text-primary" />
            <span>在此处新建信息卡片</span>
          </button>

          <button
            type="button"
            onClick={run(() => onAddBlankContainer(menu.worldX, menu.worldY))}
            className={ITEM_CLS}
          >
            <Frame className="h-3.5 w-3.5 text-muted-foreground" />
            <span>在此处新建空白卡片（容器）</span>
          </button>

          <div className="grid grid-cols-2 gap-1 px-1 py-0.5">
            <button
              type="button"
              onClick={run(() =>
                onAddControlAtPos("switch", menu.worldX, menu.worldY)
              )}
              className="flex items-center justify-center gap-1 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-[11px] text-popover-foreground hover:bg-accent"
            >
              <ToggleRight className="h-3 w-3 text-primary" />
              <span>新建开关</span>
            </button>
            <button
              type="button"
              onClick={run(() =>
                onAddControlAtPos("icon", menu.worldX, menu.worldY)
              )}
              className="flex items-center justify-center gap-1 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-[11px] text-popover-foreground hover:bg-accent"
            >
              <Zap className="h-3 w-3 text-amber-500" />
              <span>新建图标</span>
            </button>
          </div>

          <div className="px-2 pt-1 pb-0.5 text-[10.5px] font-medium text-muted-foreground">
            从模板快速添加
          </div>
          {INFO_WIDGET_TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={run(() =>
                onAddFromTemplate(tpl, menu.worldX, menu.worldY)
              )}
              className={ITEM_CLS}
            >
              <Sparkles className="h-3 w-3 shrink-0 text-primary/80" />
              <span className="truncate">{tpl.defaultTitle}</span>
            </button>
          ))}

          <div className="my-1 border-t border-border/60" />

          <button type="button" onClick={run(onRefreshAll)} className={ITEM_CLS}>
            <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
            <span>刷新当前画布全部卡片</span>
          </button>

          <button type="button" onClick={run(onResetView)} className={ITEM_CLS}>
            <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
            <span>重置视角 (100%)</span>
          </button>

          <button type="button" onClick={run(onFitAll)} className={ITEM_CLS}>
            <Maximize2 className="h-3.5 w-3.5 text-muted-foreground" />
            <span>适配全部卡片</span>
          </button>

          <button type="button" onClick={run(onToggleSnap)} className={ITEM_CLS}>
            <Magnet
              className={`h-3.5 w-3.5 ${
                snapEnabled ? "text-primary" : "text-muted-foreground"
              }`}
            />
            <span>
              {snapEnabled ? "关闭智能磁吸与参考线" : "开启智能磁吸与参考线"}
            </span>
          </button>

          <button type="button" onClick={run(onToggleGrid)} className={ITEM_CLS}>
            <Grid className="h-3.5 w-3.5 text-muted-foreground" />
            <span>{showGrid ? "隐藏背景参考点阵" : "显示背景参考点阵"}</span>
          </button>

          <button type="button" onClick={run(onToggleEditMode)} className={ITEM_CLS}>
            <Pencil
              className={`h-3.5 w-3.5 ${
                editMode ? "text-primary" : "text-muted-foreground"
              }`}
            />
            <span>{editMode ? "退出布局编辑模式" : "开启布局编辑模式"}</span>
          </button>

          <button type="button" onClick={run(onAutoArrange)} className={ITEM_CLS}>
            <LayoutGrid className="h-3.5 w-3.5 text-muted-foreground" />
            <span>一键自动整理排列</span>
          </button>

          <div className="my-1 border-t border-border/60" />

          <button
            type="button"
            onClick={run(onOpenScriptsDir)}
            className={ITEM_CLS}
          >
            <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
            <span>打开本地脚本目录</span>
          </button>

          <button
            type="button"
            onClick={run(onOpenProtocolDoc)}
            className={ITEM_CLS}
          >
            <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
            <span>查看接口规范文档</span>
          </button>

          <div className="my-1 border-t border-border/60" />

          <button type="button" onClick={run(onExportBoard)} className={ITEM_CLS}>
            <Download className="h-3.5 w-3.5 text-muted-foreground" />
            <span>导出画布配置 (.json)</span>
          </button>

          <button type="button" onClick={run(onImportBoard)} className={ITEM_CLS}>
            <Upload className="h-3.5 w-3.5 text-muted-foreground" />
            <span>导入画布配置</span>
          </button>
        </>
      )}
    </div>
  );
};
