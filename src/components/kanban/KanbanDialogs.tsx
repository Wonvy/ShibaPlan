import React, { useState } from "react";
import { AlertTriangle, Calendar, SquarePen, X } from "lucide-react";
import { BoardColumn, TaskAttachment, TaskItem } from "../../types";
import { openPathInOs } from "../../lib/storage";
import { useI18n } from "../../lib/i18n";
import { Button } from "../ui/button";
import { DatePicker, TimePicker } from "../ui/date-time-picker";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { dateWithOffset } from "./constants";
import { AttachmentIcon } from "./AttachmentIcon";
import {
  getTaskAttachments,
  isOsFileDrag,
  mergeTaskAttachments,
  resolveDroppedOsItems,
  stripLegacyFolderTokens,
} from "./dropUtils";

/* ------------------------------------------------------------------ */
/* Confirm Delete Card Modal                                           */
/* ------------------------------------------------------------------ */

export const ConfirmDeleteTaskDialog: React.FC<{
  task: TaskItem | null;
  onCancel: () => void;
  onConfirm: (task: TaskItem) => void;
}> = ({ task, onCancel, onConfirm }) => {
  const { t } = useI18n();
  return (
    <Dialog
      open={Boolean(task)}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-destructive/15 text-destructive">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <DialogTitle>{t("kanban.confirmDeleteCardTitle")}</DialogTitle>
          </div>
          <DialogDescription className="pt-2">
            {task
              ? t("kanban.confirmDeleteCardDesc", {
                  name: task.title,
                })
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              if (task) onConfirm(task);
              onCancel();
            }}
          >
            {t("common.delete")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

/* ------------------------------------------------------------------ */
/* Confirm Delete Column Modal                                         */
/* ------------------------------------------------------------------ */

export const ConfirmDeleteColumnDialog: React.FC<{
  column: BoardColumn | null;
  taskCount: number;
  onCancel: () => void;
  onConfirm: (column: BoardColumn) => void;
}> = ({ column, taskCount, onCancel, onConfirm }) => {
  const { t } = useI18n();
  return (
    <Dialog
      open={Boolean(column)}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-destructive/15 text-destructive">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <DialogTitle>{t("kanban.confirmDeleteTitle")}</DialogTitle>
          </div>
          <DialogDescription className="pt-2">
            {column &&
              (taskCount > 0
                ? t("kanban.confirmDeleteDesc", {
                    name: column.title,
                    count: taskCount,
                  })
                : t("kanban.confirmDeleteEmpty", {
                    name: column.title,
                  }))}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              if (column) onConfirm(column);
              onCancel();
            }}
          >
            {t("common.delete")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

/* ------------------------------------------------------------------ */
/* Card Time & Detail Editor Modal                                     */
/* ------------------------------------------------------------------ */

export interface TaskEditFields {
  title: string;
  notes: string | undefined;
  dueDate: string | undefined;
  startTime: string | undefined;
  imagePreview: string | undefined;
  attachments: TaskAttachment[] | undefined;
}

/**
 * Owns the editor's form state so typing does not re-render the board.
 * `task` is the snapshot of the task at the moment the editor was opened;
 * the fields are (re)seeded synchronously whenever a new task is passed in.
 */
export const TaskEditorDialog: React.FC<{
  task: TaskItem | null;
  creatingInColId?: string | null;
  onClose: () => void;
  onSave: (fields: TaskEditFields) => void;
  onCreate?: (colId: string, fields: TaskEditFields) => void;
}> = ({ task, creatingInColId = null, onClose, onSave, onCreate }) => {
  const { t } = useI18n();
  const isCreateMode = !task && Boolean(creatingInColId);
  const seedKey = task ? `edit:${task.id}` : creatingInColId ? `create:${creatingInColId}` : null;
  const [seededKey, setSeededKey] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editStartTime, setEditStartTime] = useState("");
  const [editImagePreview, setEditImagePreview] = useState<string | undefined>(
    undefined
  );
  const [editAttachments, setEditAttachments] = useState<TaskAttachment[]>([]);
  const [isDragOverForm, setIsDragOverForm] = useState(false);

  // Re-seed form fields during render when a new task or create modal is opened.
  if (seedKey && seedKey !== seededKey) {
    setSeededKey(seedKey);
    if (task) {
      setEditTitle(stripLegacyFolderTokens(task.title) || task.title);
      const cleanedNotes = task.notes ? stripLegacyFolderTokens(task.notes) : "";
      const existingAtts = getTaskAttachments(task);
      const isRedundant =
        task.notes &&
        existingAtts.some(
          (a) =>
            task.notes!.trim() === a.path.trim() ||
            task.notes!.trim() === `[[${a.path.trim()}]]`
        );
      setEditNotes(isRedundant ? "" : cleanedNotes);
      setEditDueDate(task.dueDate ?? "");
      setEditStartTime(task.startTime ?? "");
      setEditImagePreview(task.imagePreview);
      setEditAttachments(existingAtts);
    } else {
      setEditTitle("");
      setEditNotes("");
      setEditDueDate("");
      setEditStartTime("");
      setEditImagePreview(undefined);
      setEditAttachments([]);
    }
  } else if (!seedKey && seededKey) {
    setSeededKey(null);
  }

  const handleFormDrop = (e: React.DragEvent) => {
    if (!isOsFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOverForm(false);
    const dropPromise = resolveDroppedOsItems(e.dataTransfer);
    void dropPromise.then((items) => {
      if (items.length === 0) return;
      const firstImg = items.find((it) => it.imagePreview)?.imagePreview;
      if (firstImg) {
        setEditImagePreview(firstImg);
      }
      const nonImageItems = items.filter((it) => !it.imagePreview);
      if (nonImageItems.length > 0) {
        const incoming: TaskAttachment[] = nonImageItems.map((it) => ({
          path: it.path,
          name: it.name,
          is_dir: it.is_dir,
        }));
        setEditAttachments((prev) => mergeTaskAttachments(prev, incoming));
      }
    });
  };

  const handleFormPaste = (e: React.ClipboardEvent) => {
    const clipItems = e.clipboardData?.items;
    if (!clipItems) return;
    for (let i = 0; i < clipItems.length; i++) {
      if (clipItems[i].type.startsWith("image/")) {
        const file = clipItems[i].getAsFile();
        if (!file) continue;
        e.preventDefault();
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") {
            setEditImagePreview(reader.result);
          }
        };
        reader.readAsDataURL(file);
        return;
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTitle.trim()) return;
    const fields: TaskEditFields = {
      title: editTitle.trim(),
      notes: editNotes.trim() || undefined,
      dueDate: editDueDate || undefined,
      startTime: editStartTime || undefined,
      imagePreview: editImagePreview,
      attachments: editAttachments.length > 0 ? editAttachments : undefined,
    };
    if (task) {
      onSave(fields);
    } else if (creatingInColId && onCreate) {
      onCreate(creatingInColId, fields);
    }
  };

  return (
    <Dialog
      open={Boolean(task) || Boolean(creatingInColId)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        onDragOver={(e) => {
          if (!isOsFileDrag(e.dataTransfer)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "copy";
          setIsDragOverForm(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setIsDragOverForm(false);
          }
        }}
        onDrop={handleFormDrop}
        onPaste={handleFormPaste}
        className={isDragOverForm ? "ring-2 ring-primary/60" : undefined}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isCreateMode ? (
              <>
                <SquarePen className="h-4 w-4 text-primary" />
                {t("kanban.addCard")}
              </>
            ) : (
              <>
                <Calendar className="h-4 w-4 text-primary" />
                {t("kanban.taskModalTitle")}
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
          <Input
            autoFocus
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            placeholder={t("kanban.taskTitlePlaceholder")}
            className="h-9 text-sm"
          />

          {editImagePreview && (
            <div className="relative inline-block">
              <img
                src={editImagePreview}
                alt="attached"
                className="max-h-32 rounded-xl shadow-card-rest"
              />
              <button
                type="button"
                onClick={() => setEditImagePreview(undefined)}
                className="absolute -right-2 -top-2 rounded-full bg-secondary p-1 text-secondary-foreground shadow hover:bg-accent"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          <Textarea
            rows={3}
            value={editNotes}
            onChange={(e) => setEditNotes(e.target.value)}
            placeholder={t("kanban.taskNotesPlaceholder")}
          />

          {editAttachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {editAttachments.map((att) => (
                <span
                  key={att.path}
                  className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs text-foreground"
                  title={att.path}
                >
                  <button
                    type="button"
                    onClick={() => openPathInOs(att.path).catch(() => {})}
                    className="flex min-w-0 items-center gap-1.5 hover:text-primary"
                  >
                    <AttachmentIcon
                      path={att.path}
                      isDir={att.is_dir}
                      className="h-3.5 w-3.5"
                    />
                    <span className="max-w-[180px] truncate">{att.name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setEditAttachments((prev) =>
                        prev.filter((a) => a.path !== att.path)
                      )
                    }
                    className="rounded p-0.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                    title="移除"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {t("kanban.dateAndTime")}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setEditDueDate(dateWithOffset(0))}
                >
                  {t("common.today")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setEditDueDate(dateWithOffset(1))}
                >
                  {t("common.tomorrow")}
                </Button>
                {editDueDate && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditDueDate("");
                      setEditStartTime("");
                    }}
                    className="text-destructive hover:text-destructive"
                  >
                    {t("common.clear")}
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <DatePicker
                value={editDueDate}
                onChange={setEditDueDate}
                placeholder="选择日期"
                clearable
              />
              <TimePicker
                value={editStartTime}
                onChange={setEditStartTime}
                placeholder="选择时间"
                clearable
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit">{t("common.save")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
