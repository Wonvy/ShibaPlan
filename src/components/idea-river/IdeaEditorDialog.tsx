import React from "react";
import { Check, ChevronUp, Image as ImageIcon, X } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";

export interface IdeaEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isEditing: boolean;
  draft: string;
  onDraftChange: (v: string) => void;
  draftTag: string;
  onDraftTagChange: (v: string) => void;
  draftImage: string | null;
  onClearImage: () => void;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onSave: () => void;
  enterToSave: boolean;
  onSetEnterToSave: (val: boolean) => void;
  saveModeMenuOpen: boolean;
  onToggleSaveModeMenu: () => void;
}

/** Quick Add / Edit Idea Modal (shadcn/ui Dialog) */
export const IdeaEditorDialog: React.FC<IdeaEditorDialogProps> = ({
  open,
  onOpenChange,
  isEditing,
  draft,
  onDraftChange,
  draftTag,
  onDraftTagChange,
  draftImage,
  onClearImage,
  onPaste,
  onSave,
  enterToSave,
  onSetEnterToSave,
  saveModeMenuOpen,
  onToggleSaveModeMenu,
}) => {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg select-text">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? t("river.editIdea") : t("river.newIdea")}
          </DialogTitle>
        </DialogHeader>

        <Textarea
          autoFocus
          rows={4}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (enterToSave) {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSave();
              }
            } else {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                onSave();
              }
            }
          }}
          placeholder={t("river.ideaPlaceholder")}
          className="mt-3 text-sm"
        />

        {draftImage && (
          <div className="relative mt-2.5 inline-block">
            <img
              src={draftImage}
              alt="preview"
              className="max-h-28 rounded-xl shadow-card-rest"
            />
            <button
              onClick={onClearImage}
              className="absolute -right-2 -top-2 rounded-full bg-secondary p-1 text-secondary-foreground shadow hover:bg-accent"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Input
              type="text"
              value={draftTag}
              onChange={(e) => onDraftTagChange(e.target.value)}
              placeholder={t("river.tagPlaceholder")}
              className="w-24"
            />
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <ImageIcon className="h-3.5 w-3.5" />
              {t("river.pasteTip")}
            </span>
          </div>

          <div className="relative flex items-center">
            {saveModeMenuOpen && (
              <div className="absolute bottom-full right-0 mb-1.5 w-44 rounded-xl bg-popover p-1 shadow-popover-soft">
                <button
                  type="button"
                  onClick={() => onSetEnterToSave(true)}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs text-popover-foreground hover:bg-accent"
                >
                  <span>{t("river.enterSave")}</span>
                  {enterToSave && <Check className="h-3.5 w-3.5 text-primary" />}
                </button>
                <button
                  type="button"
                  onClick={() => onSetEnterToSave(false)}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs text-popover-foreground hover:bg-accent"
                >
                  <span>{t("river.ctrlEnterSave")}</span>
                  {!enterToSave && <Check className="h-3.5 w-3.5 text-primary" />}
                </button>
              </div>
            )}

            <div className="flex items-stretch overflow-hidden rounded-lg bg-primary text-primary-foreground shadow-sm">
              <button
                type="button"
                onClick={onSave}
                disabled={!draft.trim() && !draftImage}
                className="h-8 px-3.5 text-xs font-medium transition hover:opacity-90 disabled:opacity-40"
              >
                {t("common.save")}
              </button>
              <button
                type="button"
                onClick={onToggleSaveModeMenu}
                className="flex items-center justify-center border-l border-primary-foreground/20 px-1.5 transition hover:opacity-90"
                title={enterToSave ? t("river.enterSave") : t("river.ctrlEnterSave")}
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
