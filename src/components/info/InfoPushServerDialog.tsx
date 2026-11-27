import React, { useEffect, useState } from "react";
import { BookOpen, Check, Copy, ExternalLink, Radio } from "lucide-react";
import { InfoPushServerConfig } from "../../types";
import { openOfflineDocs, openOnlineDocs } from "../../lib/docs";
import { useI18n } from "../../lib/i18n";
import { InfoPushServerStatus } from "../../lib/infoRunner";
import { buildPushCodeSnippets, buildPushUrl } from "../../lib/infoProtocol";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Separator } from "../ui/separator";

interface InfoPushServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: InfoPushServerConfig;
  status: InfoPushServerStatus | null;
  onApply: (next: InfoPushServerConfig) => Promise<InfoPushServerStatus | null>;
  onNotify?: (msg: string) => void;
}

export const InfoPushServerDialog: React.FC<InfoPushServerDialogProps> = ({
  open,
  onOpenChange,
  config,
  status,
  onApply,
  onNotify,
}) => {
  const { locale } = useI18n();
  const [enabled, setEnabled] = useState(config.enabled);
  const [port, setPort] = useState(config.port);
  const [allowLan, setAllowLan] = useState(Boolean(config.allowLan));
  const [autoCreate, setAutoCreate] = useState(config.autoCreate ?? true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [langTab, setLangTab] = useState<"curl" | "python" | "powershell" | "node">(
    "curl"
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEnabled(config.enabled);
    setPort(config.port);
    setAllowLan(Boolean(config.allowLan));
    setAutoCreate(config.autoCreate ?? true);
    setErrorMsg(status?.error ?? null);
  }, [open, config, status]);

  const baseUrl = `http://127.0.0.1:${port || 18421}`;
  const sampleUrl = buildPushUrl(baseUrl, "my-task");
  const snippets = buildPushCodeSnippets(sampleUrl);

  const handleSave = async () => {
    const validPort = Math.max(1024, Math.min(65535, Number(port) || 18421));
    setSaving(true);
    setErrorMsg(null);
    try {
      const nextStatus = await onApply({
        enabled,
        port: validPort,
        allowLan,
        autoCreate,
      });
      if (nextStatus?.error) {
        setErrorMsg(nextStatus.error);
      } else {
        onNotify?.(
          enabled
            ? `推送接收服务已启动 (${nextStatus?.baseUrl ?? baseUrl})`
            : "推送接收服务已关闭"
        );
        onOpenChange(false);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "应用设置失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] max-w-xl flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radio
              className={`h-4 w-4 ${
                status?.running ? "text-emerald-500" : "text-muted-foreground"
              }`}
            />
            外部脚本推送接收服务 (Push / Webhook)
          </DialogTitle>
        </DialogHeader>

        <Separator className="my-3" />

        <div className="flex-1 space-y-4 overflow-y-auto pr-1 text-xs">
          {/* Status Banner */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface/55 px-3 py-2">
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  status?.running ? "bg-emerald-500" : "bg-muted-foreground/45"
                }`}
              />
              <span className="font-medium text-foreground">
                {status?.running
                  ? `运行中：${status.baseUrl}`
                  : "当前未启动（仅接收外部请求时占用极低资源）"}
              </span>
            </div>
            {status?.running && status.lanUrl && (
              <span className="font-mono text-[11px] text-primary">
                局域网：{status.lanUrl}
              </span>
            )}
          </div>

          {errorMsg && (
            <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-rose-400">
              {errorMsg}
            </div>
          )}

          {/* Settings */}
          <div className="space-y-3 rounded-xl border border-border bg-surface/35 p-3">
            <label className="flex items-center justify-between gap-2 cursor-pointer">
              <div>
                <div className="font-medium text-foreground">
                  启用本地 HTTP 推送接收服务
                </div>
                <div className="text-[11px] text-muted-foreground">
                  外部脚本/定时任务可直接 POST 数据到本机，ShibaPlan 无需自己跑脚本
                </div>
              </div>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="h-4 w-4"
              />
            </label>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">
                  监听端口 (1024-65535)
                </label>
                <Input
                  type="number"
                  min={1024}
                  max={65535}
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value))}
                  className="h-8 font-mono text-xs"
                />
              </div>
              <div className="flex flex-col justify-end gap-1.5 pb-0.5">
                <label className="flex items-center gap-2 text-[11.5px] text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowLan}
                    onChange={(e) => setAllowLan(e.target.checked)}
                  />
                  <span>允许局域网设备推送 (绑定 0.0.0.0)</span>
                </label>
                <label className="flex items-center gap-2 text-[11.5px] text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoCreate}
                    onChange={(e) => setAutoCreate(e.target.checked)}
                  />
                  <span>收到未知 pushKey 时自动创建卡片</span>
                </label>
              </div>
            </div>
          </div>

          {/* Endpoint + Snippets */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground">
                快速对接示例（替换末尾 &lt;key&gt; 为卡片推送标识）
              </span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(sampleUrl).catch(() => {});
                  setCopied(true);
                  onNotify?.("已复制推送地址");
                  window.setTimeout(() => setCopied(false), 1600);
                }}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-primary hover:bg-primary/10"
              >
                {copied ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                <span>复制示例地址</span>
              </button>
            </div>

            <div className="flex items-center gap-1 rounded-lg border border-border bg-surface/50 p-1">
              {(["curl", "python", "powershell", "node"] as const).map((tb) => (
                <button
                  key={tb}
                  type="button"
                  onClick={() => setLangTab(tb)}
                  className={`flex-1 rounded-md py-1 text-[11px] font-medium transition-colors ${
                    langTab === tb
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tb === "curl"
                    ? "cURL"
                    : tb === "python"
                      ? "Python"
                      : tb === "powershell"
                        ? "PowerShell"
                        : "Node.js"}
                </button>
              ))}
            </div>

            <div className="relative">
              <pre className="select-text overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-[11.5px] leading-relaxed text-foreground">
                {snippets[langTab]}
              </pre>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard
                    .writeText(snippets[langTab])
                    .catch(() => {});
                  onNotify?.(`已复制 ${langTab} 推送代码`);
                }}
                className="absolute right-2 top-2 rounded border border-border bg-surface/90 px-2 py-0.5 text-[10.5px] text-muted-foreground hover:text-foreground"
              >
                复制代码
              </button>
            </div>
          </div>
        </div>

        <Separator className="my-3" />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                openOfflineDocs("api-webhook", locale).catch(() => {});
              }}
            >
              <BookOpen className="h-3.5 w-3.5" />
              Webhook 接口手册 &amp; 调试器
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                openOnlineDocs("api-webhook", locale).catch(() => {});
              }}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              在线版
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={saving}
              onClick={handleSave}
            >
              {saving ? "应用中..." : "保存并应用"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
