import React from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { TrashedIdeaItem } from "../../types";
import { useI18n } from "../../lib/i18n";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { formatShortDateTime } from "./constants";

export interface TrashDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trashedIdeas: TrashedIdeaItem[];
  onEmptyTrash: () => void;
  onRestore: (item: TrashedIdeaItem) => void;
  onPermanentDelete: (id: string) => void;
}

/** Idea Recycle Bin Modal (shadcn/ui Dialog) */
export const TrashDialog: React.FC<TrashDialogProps> = ({
  open,
  onOpenChange,
  trashedIdeas,
  onEmptyTrash,
  onRestore,
  onPermanentDelete,
}) => {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-lg flex-col p-0 select-text">
        <div className="flex items-center justify-between px-5 py-3.5">
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-muted-foreground" />
            {t("river.trashTitle")}
            <span className="text-xs font-normal text-muted-foreground">
              ({trashedIdeas.length})
            </span>
          </DialogTitle>

          {trashedIdeas.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onEmptyTrash}
              className="mr-6 text-destructive hover:text-destructive"
            >
              {t("river.emptyTrashBtn")}
            </Button>
          )}
        </div>

        <Separator />

        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {trashedIdeas.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground">
              {t("river.trashEmptyDesc")}
            </div>
          ) : (
            trashedIdeas.map((item) => (
              <div
                key={item.id}
                className="flex items-start justify-between gap-3 rounded-xl bg-background p-3 shadow-card-rest"
              >
                <div className="flex min-w-0 flex-1 gap-2.5">
                  {item.imagePreview && (
                    <img
                      src={item.imagePreview}
                      alt="trashed"
                      className="h-10 w-10 shrink-0 rounded-lg object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-xs text-foreground/85">
                      {item.content}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span
                        className={`rounded px-1.5 py-0.5 ${
                          item.reason === "used"
                            ? "bg-emerald-500/12 text-emerald-500"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {item.reason === "used"
                          ? t("river.reasonUsed")
                          : t("river.reasonDeleted")}
                      </span>
                      <span>{formatShortDateTime(item.deletedAt)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onRestore(item)}
                    title={t("river.restore")}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onPermanentDelete(item.id)}
                    className="hover:text-destructive"
                    title={t("river.permanentDelete")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
