import React, { useState } from "react";
import { CheckCircle2, Copy, Play, Terminal, XCircle } from "lucide-react";
import { InfoWidget } from "../../types";
import { InfoWidgetRuntimeState } from "../../lib/infoRunner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";

interface InfoLogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  widget: InfoWidget | null;
  runtime?: InfoWidgetRuntimeState;
  onRunNow: (widget: InfoWidget) => void;
  onNotify?: (msg: string) => void;
}

export const InfoLogDialog: React.FC<InfoLogDialogProps> = ({
  open,
  onOpenChange,
  widget,
  runtime,
  onRunNow,
  onNotify,
}) => {
  const [selectedIdx, setSelectedIdx] = useState(0);

  if (!widget) return null;
  const history = runtime?.history ?? [];
  const activeEntry = history[selectedIdx] ?? history[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[84vh] max-w-3xl flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 truncate">
              <Terminal className="h-4 w-4 text-primary" />
              运行输出与历史日志 · {widget.title}
            </span>
          </DialogTitle>
        </DialogHeader>

        <Separator className="my-3" />

        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
            <span>暂无运行历史记录</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onRunNow(widget)}
              className="gap-1.5"
            >
              <Play className="h-3.5 w-3.5" />
              <span>立即运行一次</span>
            </Button>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-[210px_1fr]">
            {/* History List */}
            <div className="overflow-y-auto rounded-lg border border-border bg-surface/40 p-1.5 space-y-1">
              {history.map((entry, idx) => {
                const selected = idx === (activeEntry === entry ? idx : -1);
                return (
                  <button
                    key={`${entry.ranAt}-${idx}`}
                    type="button"
                    onClick={() => setSelectedIdx(idx)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                      selected
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/50 text-foreground/85"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      {entry.ok ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-500" />
                      )}
                      <div className="min-w-0">
                        <div className="truncate font-mono text-[11px]">
                          {new Date(entry.ranAt).toLocaleTimeString("zh-CN", {
                            hour12: false,
                          })}
                        </div>
                        <div className="truncate text-[10px] text-muted-foreground">
                          {entry.trigger} · {entry.durationMs}ms
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Active Detail */}
            {activeEntry && (
              <div className="flex min-h-0 flex-col gap-2 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface/55 px-3 py-1.5 text-[11px]">
                  <div className="flex items-center gap-3 font-mono">
                    <span
                      className={
                        activeEntry.ok ? "text-emerald-500" : "text-rose-500"
                      }
                    >
                      {activeEntry.ok ? "SUCCESS" : "FAILED"}
                    </span>
                    <span className="text-muted-foreground">
                      exit={activeEntry.exitCode}
                    </span>
                    {activeEntry.httpStatus !== undefined && (
                      <span className="text-muted-foreground">
                        HTTP {activeEntry.httpStatus}
                      </span>
                    )}
                    <span className="text-muted-foreground">
                      {activeEntry.durationMs}ms
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard
                        .writeText(activeEntry.stdoutPreview || "")
                        .catch(() => {});
                      onNotify?.("已复制 stdout");
                    }}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Copy className="h-3 w-3" />
                    <span>复制 stdout</span>
                  </button>
                </div>

                {activeEntry.error && (
                  <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-400">
                    {activeEntry.error}
                  </div>
                )}

                <div className="flex-1 space-y-2 overflow-y-auto">
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-muted-foreground">
                      stdout
                    </div>
                    <pre className="select-text whitespace-pre-wrap break-words rounded-lg border border-border bg-background p-2.5 font-mono text-[11.5px] leading-relaxed text-foreground">
                      {activeEntry.stdoutPreview || "(空)"}
                    </pre>
                  </div>

                  {activeEntry.stderrPreview && (
                    <div>
                      <div className="mb-1 text-[11px] font-medium text-rose-400">
                        stderr
                      </div>
                      <pre className="select-text whitespace-pre-wrap break-words rounded-lg border border-rose-500/25 bg-rose-500/5 p-2.5 font-mono text-[11.5px] leading-relaxed text-rose-300">
                        {activeEntry.stderrPreview}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-3 flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={Boolean(runtime?.running)}
            onClick={() => onRunNow(widget)}
            className="gap-1.5"
          >
            <Play className="h-3 w-3" />
            <span>{runtime?.running ? "运行中..." : "立即运行"}</span>
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
