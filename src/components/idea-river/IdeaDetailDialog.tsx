import React from "react";
import {
  ArrowUpRight,
  Check,
  Copy,
  FileDown,
  Loader2,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { BoardColumn, IdeaItem } from "../../types";
import { useI18n } from "../../lib/i18n";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";

export interface IdeaDetailDialogProps {
  selectedIdea: IdeaItem | null;
  specText: string;
  columns: BoardColumn[];
  targetColId: string;
  onTargetColChange: (id: string) => void;
  exportMsg: string | null;
  aiError: string | null;
  aiBreakingDown: boolean;
  copied: boolean;
  onClose: () => void;
  onTrash: (idea: IdeaItem) => void;
  onSendToKanban: (idea: IdeaItem) => void;
  onAiBreakdown: (idea: IdeaItem) => void;
  onExportMd: (idea: IdeaItem) => void;
  onCopySpec: () => void;
}

/** Idea Detail & AI Prompt Modal (shadcn/ui Dialog) */
export const IdeaDetailDialog: React.FC<IdeaDetailDialogProps> = ({
  selectedIdea,
  specText,
  columns,
  targetColId,
  onTargetColChange,
  exportMsg,
  aiError,
  aiBreakingDown,
  copied,
  onClose,
  onTrash,
  onSendToKanban,
  onAiBreakdown,
  onExportMd,
  onCopySpec,
}) => {
  const { t } = useI18n();
  return (
    <Dialog
      open={Boolean(selectedIdea)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[84vh] max-w-xl flex-col p-0 select-text">
        <div className="flex items-center justify-between px-5 py-3.5">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            {t("river.detailTitle")}
          </DialogTitle>
          {selectedIdea && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onTrash(selectedIdea)}
              className="mr-6 text-muted-foreground hover:text-destructive"
              title={t("river.trashTitle")}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>

        <Separator />

        {selectedIdea && (
          <>
            <div className="flex-1 space-y-3 overflow-y-auto p-5">
              {exportMsg && (
                <div className="rounded-lg bg-emerald-500/12 px-3 py-2 text-xs text-emerald-500">
                  {exportMsg}
                </div>
              )}
              {aiError && (
                <div className="rounded-lg bg-destructive/12 px-3 py-2 text-xs text-destructive">
                  {aiError}
                </div>
              )}

              {selectedIdea.imagePreview && (
                <img
                  src={selectedIdea.imagePreview}
                  alt="attached"
                  className="max-h-48 rounded-xl shadow-card-rest object-contain"
                />
              )}

              <pre className="whitespace-pre-wrap rounded-xl bg-background p-4 font-mono text-xs leading-relaxed text-foreground/90">
                {specText}
              </pre>
            </div>

            <Separator />

            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5">
              {columns.length > 0 ? (
                <div className="flex items-center gap-1.5">
                  <select
                    value={targetColId}
                    onChange={(e) => onTargetColChange(e.target.value)}
                    className="h-8 rounded-lg bg-background px-2.5 text-xs text-foreground focus:outline-none"
                  >
                    {columns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="secondary"
                    onClick={() => onSendToKanban(selectedIdea)}
                  >
                    <ArrowUpRight className="h-3.5 w-3.5" />
                    {t("river.sendToKanban")}
                  </Button>
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {t("river.needColumnForIdea")}
                </span>
              )}

              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  disabled={aiBreakingDown}
                  onClick={() => onAiBreakdown(selectedIdea)}
                  title="调用 AI 自动拆解为 3~5 张看板卡片"
                >
                  {aiBreakingDown ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Wand2 className="h-3.5 w-3.5 text-primary" />
                  )}
                  {aiBreakingDown ? "拆解中..." : "AI 拆解卡片"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => onExportMd(selectedIdea)}
                >
                  <FileDown className="h-3.5 w-3.5" />
                  {t("river.exportMd")}
                </Button>
                <Button onClick={onCopySpec}>
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      {t("river.copied")}
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      {t("river.copyForAi")}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
