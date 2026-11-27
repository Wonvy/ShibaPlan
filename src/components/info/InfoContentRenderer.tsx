import React from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Copy,
  ExternalLink,
  FolderOpen,
  Play,
  Radio,
  Sparkles,
} from "lucide-react";
import { InfoCardStatus } from "../../types";
import {
  InfoAction,
  InfoBlock,
  InfoListItem,
  InfoMetricItem,
  ParsedInfoResult,
} from "../../lib/infoProtocol";
import { openPathInOs } from "../../lib/storage";
import { openExternalUrl } from "../../lib/updater";
import { MarkdownPreview } from "../MarkdownPreview";

interface InfoContentRendererProps {
  parsed: ParsedInfoResult | null;
  running?: boolean;
  compactPadding?: boolean;
  isPushSource?: boolean;
  onCopyPushUrl?: () => void;
  onRunNow?: () => void;
  onViewLogs?: () => void;
  onSendItemToKanban?: (title: string, notes?: string) => void;
  onSendItemToIdea?: (content: string) => void;
  onNotify?: (msg: string) => void;
}

const TONE_DOT: Record<InfoCardStatus, string> = {
  ok: "bg-emerald-500",
  info: "bg-sky-500",
  warn: "bg-amber-500",
  error: "bg-rose-500",
};

const TONE_TEXT: Record<InfoCardStatus, string> = {
  ok: "text-emerald-500",
  info: "text-sky-500",
  warn: "text-amber-500",
  error: "text-rose-500",
};

const TONE_BADGE: Record<InfoCardStatus, string> = {
  ok: "bg-emerald-500/12 text-emerald-500 border-emerald-500/20",
  info: "bg-sky-500/12 text-sky-500 border-sky-500/20",
  warn: "bg-amber-500/12 text-amber-500 border-amber-500/20",
  error: "bg-rose-500/12 text-rose-500 border-rose-500/20",
};

const Sparkline: React.FC<{ data: number[]; tone?: InfoCardStatus }> = ({
  data,
  tone = "info",
}) => {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const w = 72;
  const h = 22;
  const pts = data
    .map((val, idx) => {
      const x = (idx / (data.length - 1)) * w;
      const y = h - 2 - ((val - min) / span) * (h - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={`h-5 w-16 shrink-0 ${TONE_TEXT[tone]}`}
      fill="none"
    >
      <polyline
        points={pts}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

const MetricBlockView: React.FC<{
  title?: string;
  items: InfoMetricItem[];
}> = ({ title, items }) => (
  <div className="space-y-1.5">
    {title && (
      <div className="text-[11px] font-medium text-muted-foreground">
        {title}
      </div>
    )}
    <div
      className="grid gap-2"
      style={{
        gridTemplateColumns: "repeat(auto-fit, minmax(105px, 1fr))",
      }}
    >
      {items.map((item, idx) => {
        const tone = item.tone ?? "info";
        return (
          <div
            key={idx}
            className="flex flex-col justify-between rounded-lg border border-border/70 bg-surface/55 px-2.5 py-2"
          >
            <div className="flex items-center justify-between gap-1.5">
              <span className="truncate text-[11px] text-muted-foreground">
                {item.label}
              </span>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[tone]}`} />
            </div>
            <div className="mt-1 flex items-end justify-between gap-1">
              <div className="flex items-baseline gap-0.5 min-w-0">
                <span className="truncate text-[18px] font-semibold leading-tight tracking-tight text-foreground tabular-nums">
                  {item.value}
                </span>
                {item.unit && (
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {item.unit}
                  </span>
                )}
              </div>
              {item.sparkline && item.sparkline.length >= 2 && (
                <Sparkline data={item.sparkline} tone={tone} />
              )}
            </div>
            {item.trend && (
              <div className={`mt-0.5 truncate text-[10.5px] ${TONE_TEXT[tone]}`}>
                {item.trend}
              </div>
            )}
          </div>
        );
      })}
    </div>
  </div>
);

const ListBlockView: React.FC<{
  title?: string;
  items: InfoListItem[];
  onSendItemToKanban?: (title: string, notes?: string) => void;
  onSendItemToIdea?: (content: string) => void;
  onNotify?: (msg: string) => void;
}> = ({ title, items, onSendItemToKanban, onSendItemToIdea, onNotify }) => {
  const handleItemClick = (item: InfoListItem) => {
    if (item.url) {
      openExternalUrl(item.url).catch((e) =>
        onNotify?.(e instanceof Error ? e.message : "打开链接失败")
      );
    } else if (item.path) {
      openPathInOs(item.path).catch((e) =>
        onNotify?.(e instanceof Error ? e.message : "打开本地路径失败")
      );
    }
  };

  return (
    <div className="space-y-1">
      {title && (
        <div className="text-[11px] font-medium text-muted-foreground">
          {title}
        </div>
      )}
      {items.length === 0 ? (
        <div className="rounded-md bg-surface/40 px-2.5 py-2 text-[11.5px] text-muted-foreground">
          暂无列表条目
        </div>
      ) : (
        <div className="divide-y divide-border/50 rounded-lg border border-border/60 bg-surface/35">
          {items.map((item, idx) => {
            const clickable = Boolean(item.url || item.path);
            const tone = item.tone ?? "info";
            return (
              <div
                key={idx}
                onClick={clickable ? () => handleItemClick(item) : undefined}
                className={`group/row flex items-start justify-between gap-2 px-2.5 py-1.5 text-xs ${
                  clickable
                    ? "cursor-pointer transition-colors hover:bg-accent/55"
                    : ""
                }`}
              >
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[tone]}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className="truncate font-medium text-foreground/95">
                        {item.title}
                      </span>
                      {item.url && (
                        <ExternalLink className="h-2.5 w-2.5 shrink-0 text-muted-foreground opacity-70" />
                      )}
                      {!item.url && item.path && (
                        <FolderOpen className="h-2.5 w-2.5 shrink-0 text-muted-foreground opacity-70" />
                      )}
                    </div>
                    {item.subtitle && (
                      <div className="truncate text-[11px] text-muted-foreground">
                        {item.subtitle}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {item.tag && (
                    <span
                      className={`rounded border px-1.5 py-px text-[10px] font-medium ${TONE_BADGE[tone]}`}
                    >
                      {item.tag}
                    </span>
                  )}
                  {item.time && (
                    <span className="text-[10.5px] text-muted-foreground tabular-nums">
                      {item.time}
                    </span>
                  )}
                  {(onSendItemToKanban || onSendItemToIdea) && (
                    <div
                      className="hidden items-center gap-0.5 group-hover/row:flex"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {onSendItemToKanban && (
                        <button
                          type="button"
                          title="转为看板任务"
                          onClick={() =>
                            onSendItemToKanban(
                              item.title,
                              [item.subtitle, item.url, item.path]
                                .filter(Boolean)
                                .join("\n")
                            )
                          }
                          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          <ArrowUpRight className="h-3 w-3" />
                        </button>
                      )}
                      {onSendItemToIdea && (
                        <button
                          type="button"
                          title="收入灵感流"
                          onClick={() =>
                            onSendItemToIdea(
                              [item.title, item.subtitle, item.url]
                                .filter(Boolean)
                                .join("\n")
                            )
                          }
                          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          <Sparkles className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const BlockView: React.FC<{
  block: InfoBlock;
  onSendItemToKanban?: (title: string, notes?: string) => void;
  onSendItemToIdea?: (content: string) => void;
  onNotify?: (msg: string) => void;
}> = ({ block, onSendItemToKanban, onSendItemToIdea, onNotify }) => {
  switch (block.type) {
    case "metrics":
      return <MetricBlockView title={block.title} items={block.items} />;
    case "list":
      return (
        <ListBlockView
          title={block.title}
          items={block.items}
          onSendItemToKanban={onSendItemToKanban}
          onSendItemToIdea={onSendItemToIdea}
          onNotify={onNotify}
        />
      );
    case "kv":
      return (
        <div className="space-y-1">
          {block.title && (
            <div className="text-[11px] font-medium text-muted-foreground">
              {block.title}
            </div>
          )}
          <div className="divide-y divide-border/50 rounded-lg border border-border/60 bg-surface/35 text-xs">
            {block.items.map((kv, idx) => (
              <div
                key={idx}
                onClick={
                  kv.copyable !== false
                    ? () => {
                        navigator.clipboard.writeText(kv.value).catch(() => {});
                        onNotify?.(`已复制 ${kv.key}`);
                      }
                    : undefined
                }
                title={kv.copyable !== false ? "点击复制值" : undefined}
                className={`flex items-center justify-between gap-3 px-2.5 py-1.5 ${
                  kv.copyable !== false
                    ? "cursor-pointer hover:bg-accent/45"
                    : ""
                }`}
              >
                <span className="shrink-0 text-muted-foreground">{kv.key}</span>
                <span
                  className={`truncate font-mono text-[11.5px] ${
                    kv.tone ? TONE_TEXT[kv.tone] : "text-foreground"
                  }`}
                >
                  {kv.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    case "table":
      return (
        <div className="space-y-1">
          {block.title && (
            <div className="text-[11px] font-medium text-muted-foreground">
              {block.title}
            </div>
          )}
          <div className="overflow-x-auto rounded-lg border border-border/60 bg-surface/35">
            <table className="w-full border-collapse text-left text-[11.5px]">
              <thead className="border-b border-border/70 bg-surface/75">
                <tr>
                  {block.columns.map((col, idx) => (
                    <th
                      key={idx}
                      className="whitespace-nowrap px-2.5 py-1.5 font-semibold text-foreground"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/45">
                {block.rows.map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-accent/35">
                    {block.columns.map((_, cIdx) => (
                      <td
                        key={cIdx}
                        className="whitespace-nowrap px-2.5 py-1 text-foreground/90"
                      >
                        {String(row[cIdx] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    case "markdown":
      return (
        <div className="space-y-1">
          {block.title && (
            <div className="text-[11px] font-medium text-muted-foreground">
              {block.title}
            </div>
          )}
          <MarkdownPreview
            content={block.content}
            onNotify={onNotify}
            className="text-xs"
          />
        </div>
      );
    case "text":
      return (
        <div className="space-y-1">
          {block.title && (
            <div className="text-[11px] font-medium text-muted-foreground">
              {block.title}
            </div>
          )}
          <pre className="select-text whitespace-pre-wrap break-words rounded-lg border border-border/60 bg-surface/45 p-2.5 font-mono text-[11.5px] leading-relaxed text-foreground/90">
            {block.text}
          </pre>
        </div>
      );
  }
};

const ActionButtonsBar: React.FC<{
  actions: InfoAction[];
  onNotify?: (msg: string) => void;
}> = ({ actions, onNotify }) => {
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1">
      {actions.map((act, idx) => (
        <button
          key={idx}
          type="button"
          onClick={() => {
            if (act.openUrl) {
              openExternalUrl(act.openUrl).catch(() => {});
            } else if (act.openPath) {
              openPathInOs(act.openPath).catch(() => {});
            } else if (act.copyText !== undefined) {
              navigator.clipboard.writeText(act.copyText).catch(() => {});
              onNotify?.(`已复制「${act.label}」`);
            }
          }}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
        >
          {act.openUrl ? (
            <ExternalLink className="h-3 w-3 text-muted-foreground" />
          ) : act.openPath ? (
            <FolderOpen className="h-3 w-3 text-muted-foreground" />
          ) : (
            <Copy className="h-3 w-3 text-muted-foreground" />
          )}
          <span>{act.label}</span>
        </button>
      ))}
    </div>
  );
};

export const InfoContentRenderer: React.FC<InfoContentRendererProps> = ({
  parsed,
  running,
  compactPadding,
  isPushSource,
  onCopyPushUrl,
  onRunNow,
  onViewLogs,
  onSendItemToKanban,
  onSendItemToIdea,
  onNotify,
}) => {
  if (!parsed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
        {running ? (
          <div className="w-full max-w-[220px] space-y-2">
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-12 w-full animate-pulse rounded-lg bg-muted/70" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted/60" />
          </div>
        ) : isPushSource ? (
          <>
            <Radio className="h-4 w-4 text-primary/75" />
            <span className="text-xs text-muted-foreground">
              等待外部脚本推送数据
            </span>
            {onCopyPushUrl && (
              <button
                type="button"
                onClick={onCopyPushUrl}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
              >
                <Copy className="h-3 w-3 text-primary" />
                <span>复制推送地址</span>
              </button>
            )}
          </>
        ) : (
          <>
            <span className="text-xs text-muted-foreground">尚未运行数据源</span>
            {onRunNow && (
              <button
                type="button"
                onClick={onRunNow}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
              >
                <Play className="h-3 w-3 text-primary" />
                <span>立即运行</span>
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className={`${compactPadding ? "p-2" : "p-3"} space-y-2.5`}>
      {parsed.subtitle && (
        <div className="text-[11px] text-muted-foreground">{parsed.subtitle}</div>
      )}

      {parsed.status === "error" && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-rose-500/25 bg-rose-500/10 px-2.5 py-1.5 text-[11.5px] text-rose-400">
          <div className="flex items-center gap-1.5 min-w-0">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{parsed.validation.message}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onViewLogs && (
              <button
                type="button"
                onClick={onViewLogs}
                className="rounded px-1.5 py-0.5 text-[10.5px] hover:bg-rose-500/20"
              >
                日志
              </button>
            )}
            {onRunNow && (
              <button
                type="button"
                onClick={onRunNow}
                className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10.5px] font-medium hover:bg-rose-500/30"
              >
                重试
              </button>
            )}
          </div>
        </div>
      )}

      {parsed.blocks.map((block, idx) => (
        <BlockView
          key={idx}
          block={block}
          onSendItemToKanban={onSendItemToKanban}
          onSendItemToIdea={onSendItemToIdea}
          onNotify={onNotify}
        />
      ))}

      <ActionButtonsBar actions={parsed.actions} onNotify={onNotify} />
    </div>
  );
};
