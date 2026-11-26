import React from "react";
import { CheckCircle2, RotateCcw, Trash2 } from "lucide-react";
import { BoardColumn, TaskItem } from "../../types";
import { useI18n } from "../../lib/i18n";

/** Dedicated Completed Tasks Tab View */
export const DoneTasksView: React.FC<{
  tasks: TaskItem[];
  columnMap: Map<string, BoardColumn>;
  toggleDone: (task: TaskItem) => void;
  requestDelete: (task: TaskItem) => void;
}> = ({ tasks, columnMap, toggleDone, requestDelete }) => {
  const { t } = useI18n();
  const doneTasks = tasks.filter((task) => task.status === "done");

  return (
    <div className="flex-1 overflow-y-auto">
      {doneTasks.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface/40 p-8 text-center">
          <CheckCircle2 className="h-6 w-6 text-muted-foreground/50" />
          <p className="mt-2.5 text-xs text-muted-foreground">
            {t("kanban.noDoneTasks")}
          </p>
        </div>
      ) : (
        <div className="mx-auto max-w-3xl space-y-1.5 pb-4">
          {doneTasks
            .sort((a, b) =>
              (b.completedAt ?? b.createdAt).localeCompare(
                a.completedAt ?? a.createdAt
              )
            )
            .map((task) => {
              const col = columnMap.get(task.columnId);
              return (
                <div
                  key={task.id}
                  className="group flex items-center justify-between gap-3 rounded-lg border border-border/75 bg-card px-3.5 py-2.5 transition-colors hover:border-foreground/15 hover:bg-surface-elevated"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-zinc-400 line-through">
                        {task.title}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                        {col && (
                          <span className="flex items-center gap-1">
                            <span
                              className="h-1.5 w-1.5 rounded-full opacity-70"
                              style={{ backgroundColor: col.color }}
                            />
                            {col.title}
                          </span>
                        )}
                        {task.completedAt && (
                          <span>
                            {t("kanban.completedAt")}{" "}
                            {new Date(task.completedAt).toLocaleString(
                              "zh-CN",
                              {
                                month: "2-digit",
                                day: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              }
                            )}
                          </span>
                        )}
                        {task.actualMinutes > 0 && (
                          <span>
                            {t("kanban.usedMinutes")} {task.actualMinutes}m
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => toggleDone(task)}
                      className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/[0.08] hover:text-shiba-400"
                      title={t("kanban.restoreTodo")}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => requestDelete(task)}
                      className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/[0.08] hover:text-rose-400"
                      title={t("common.delete")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
};
