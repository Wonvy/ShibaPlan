import React, { useState } from "react";
import { AlertTriangle, Calendar, X } from "lucide-react";
import { BoardColumn, TaskItem } from "../../types";
import { useI18n } from "../../lib/i18n";
import { Button } from "../ui/button";
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
}

/**
 * Owns the editor's form state so typing does not re-render the board.
 * `task` is the snapshot of the task at the moment the editor was opened;
 * the fields are (re)seeded synchronously whenever a new task is passed in.
 */
export const TaskEditorDialog: React.FC<{
  task: TaskItem | null;
  onClose: () => void;
  onSave: (fields: TaskEditFields) => void;
}> = ({ task, onClose, onSave }) => {
  const { t } = useI18n();
  const [seededFrom, setSeededFrom] = useState<TaskItem | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editStartTime, setEditStartTime] = useState("");
  const [editImagePreview, setEditImagePreview] = useState<string | undefined>(
    undefined
  );

  // Re-seed form fields during render when a new task is opened
  // (equivalent to setting them together with the "open" state).
  if (task && task !== seededFrom) {
    setSeededFrom(task);
    setEditTitle(task.title);
    setEditNotes(task.notes ?? "");
    setEditDueDate(task.dueDate ?? "");
    setEditStartTime(task.startTime ?? "");
    setEditImagePreview(task.imagePreview);
  } else if (!task && seededFrom) {
    setSeededFrom(null);
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!task || !editTitle.trim()) return;
    onSave({
      title: editTitle.trim(),
      notes: editNotes.trim() || undefined,
      dueDate: editDueDate || undefined,
      startTime: editStartTime || undefined,
      imagePreview: editImagePreview,
    });
  };

  return (
    <Dialog
      open={Boolean(task)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" />
            {t("kanban.taskModalTitle")}
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
            rows={2}
            value={editNotes}
            onChange={(e) => setEditNotes(e.target.value)}
            placeholder={t("kanban.taskNotesPlaceholder")}
          />

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
              <Input
                type="date"
                value={editDueDate}
                onChange={(e) => setEditDueDate(e.target.value)}
              />
              <Input
                type="time"
                value={editStartTime}
                onChange={(e) => setEditStartTime(e.target.value)}
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
