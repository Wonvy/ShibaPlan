import React from "react";
import {
  ArrowUpRight,
  ChevronDown,
  Copy,
  FileDown,
  Gauge,
  List,
  Pause,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Waves,
} from "lucide-react";
import { IdeaItem } from "../../types";
import { useI18n } from "../../lib/i18n";
import { IdeaViewMode, RiverSpeed, SPEED_LABEL } from "./constants";

export type RiverMenuState =
  | { kind: "idea"; ideaId: string; x: number; y: number }
  | { kind: "area"; x: number; y: number };

export interface RiverContextMenuProps {
  menu: RiverMenuState;
  /** Resolved idea when menu.kind === "idea" (null if it no longer exists). */
  ctxIdea: IdeaItem | null;
  hasColumns: boolean;
  viewMode: IdeaViewMode;
  paused: boolean;
  speed: RiverSpeed;
  trashCount: number;
  onClose: () => void;
  onEditIdea: (idea: IdeaItem) => void;
  onOpenDetail: (ideaId: string) => void;
  onExportMd: (idea: IdeaItem) => void;
  onSendToKanban: (idea: IdeaItem) => void;
  onTrashIdea: (idea: IdeaItem) => void;
  onAddIdea: () => void;
  onToggleViewMode: () => void;
  onTogglePaused: () => void;
  onCycleSpeed: () => void;
  onOpenTrash: () => void;
  onCollapse: () => void;
}

const ITEM_CLS =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-popover-foreground transition-colors hover:bg-accent";

/** IdeaRiver Right-Click Context Menu */
export const RiverContextMenu: React.FC<RiverContextMenuProps> = ({
  menu,
  ctxIdea,
  hasColumns,
  viewMode,
  paused,
  speed,
  trashCount,
  onClose,
  onEditIdea,
  onOpenDetail,
  onExportMd,
  onSendToKanban,
  onTrashIdea,
  onAddIdea,
  onToggleViewMode,
  onTogglePaused,
  onCycleSpeed,
  onOpenTrash,
  onCollapse,
}) => {
  const { t } = useI18n();
  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <div
      style={{ left: menu.x, top: menu.y }}
      onClick={(e) => e.stopPropagation()}
      className="fixed z-50 w-44 rounded-lg border border-border bg-popover p-1 shadow-popover-soft"
    >
      {menu.kind === "idea" && ctxIdea && (
        <>
          <button
            type="button"
            onClick={run(() => onEditIdea(ctxIdea))}
            className={ITEM_CLS}
          >
            <Pencil className="h-3.5 w-3.5 text-zinc-400" />
            <span>{t("river.editIdea")}</span>
          </button>

          <button
            type="button"
            onClick={run(() => onOpenDetail(ctxIdea.id))}
            className={ITEM_CLS}
          >
            <Sparkles className="h-3.5 w-3.5 text-shiba-400" />
            <span>AI Prompt</span>
          </button>

          <button
            type="button"
            onClick={run(() => {
              navigator.clipboard.writeText(ctxIdea.content);
            })}
            className={ITEM_CLS}
          >
            <Copy className="h-3.5 w-3.5 text-zinc-400" />
            <span>复制内容</span>
          </button>

          <button
            type="button"
            onClick={run(() => onExportMd(ctxIdea))}
            className={ITEM_CLS}
          >
            <FileDown className="h-3.5 w-3.5 text-zinc-400" />
            <span>{t("river.exportMd")}</span>
          </button>

          {hasColumns && (
            <button
              type="button"
              onClick={run(() => onSendToKanban(ctxIdea))}
              className={ITEM_CLS}
            >
              <ArrowUpRight className="h-3.5 w-3.5 text-zinc-400" />
              <span>{t("river.sendToKanban")}</span>
            </button>
          )}

          <div className="my-1 border-t border-white/[0.06]" />

          <button
            type="button"
            onClick={run(() => onTrashIdea(ctxIdea))}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-rose-400 transition hover:bg-rose-500/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>移入回收站</span>
          </button>
        </>
      )}

      {menu.kind === "area" && (
        <>
          <button type="button" onClick={run(onAddIdea)} className={ITEM_CLS}>
            <Plus className="h-3.5 w-3.5 text-zinc-400" />
            <span>{t("river.addIdea")}</span>
          </button>

          <button
            type="button"
            onClick={run(onToggleViewMode)}
            className={ITEM_CLS}
          >
            {viewMode === "river" ? (
              <List className="h-3.5 w-3.5 text-zinc-400" />
            ) : (
              <Waves className="h-3.5 w-3.5 text-zinc-400" />
            )}
            <span>
              {viewMode === "river" ? "切换到列表视图" : "切换到河流视图"}
            </span>
          </button>

          {viewMode === "river" && (
            <>
              <button
                type="button"
                onClick={run(onTogglePaused)}
                className={ITEM_CLS}
              >
                {paused ? (
                  <Play className="h-3.5 w-3.5 text-shiba-400" />
                ) : (
                  <Pause className="h-3.5 w-3.5 text-zinc-400" />
                )}
                <span>{paused ? t("river.resume") : t("river.pause")}</span>
              </button>

              <button
                type="button"
                onClick={run(onCycleSpeed)}
                className={ITEM_CLS}
              >
                <Gauge className="h-3.5 w-3.5 text-zinc-400" />
                <span>切换流速 ({SPEED_LABEL[speed]})</span>
              </button>
            </>
          )}

          <div className="my-1 border-t border-white/[0.06]" />

          <button type="button" onClick={run(onOpenTrash)} className={ITEM_CLS}>
            <Trash2 className="h-3.5 w-3.5 text-zinc-400" />
            <span>
              {t("river.trashTitle")} ({trashCount})
            </span>
          </button>

          <button type="button" onClick={run(onCollapse)} className={ITEM_CLS}>
            <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
            <span>折叠灵感流</span>
          </button>
        </>
      )}
    </div>
  );
};
