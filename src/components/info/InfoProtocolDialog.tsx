import React, { useState } from "react";
import { BookOpen, Check, Copy, Sparkles } from "lucide-react";
import { AI_INFO_PROTOCOL_PROMPT, buildPushCodeSnippets } from "../../lib/infoProtocol";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";

interface InfoProtocolDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNotify?: (msg: string) => void;
}

const SAMPLE_JSON = `{
  "schema": "shibaplan-info/v1",
  "status": "ok",
  "title": "项目与服务概览",
  "subtitle": "每 5 分钟自动采集",
  "badge": "正常",
  "view": "composite",
  "blocks": [
    {
      "type": "metrics",
      "items": [
        { "label": "CPU", "value": "24", "unit": "%", "trend": "-3%", "tone": "ok", "sparkline": [30, 28, 25, 24] },
        { "label": "待处理", "value": 3, "tone": "warn" }
      ]
    },
    {
      "type": "list",
      "title": "最新动态",
      "items": [
        { "title": "构建已完成", "subtitle": "main · 2m ago", "tag": "CI", "tone": "ok", "url": "https://example.com" }
      ]
    }
  ],
  "actions": [
    { "label": "打开报告", "openPath": "D:\\\\Reports\\\\today.html" },
    { "label": "复制摘要", "copyText": "CPU 24%, 待处理 3" }
  ]
}`;

const SAMPLE_PYTHON = `import json, os

# 读取自定义参数 (SHIBA_PARAM_*) 或 stdin JSON 上下文
topic = os.environ.get("SHIBA_PARAM_TOPIC", "默认主题")

print(json.dumps({
    "schema": "shibaplan-info/v1",
    "status": "ok",
    "badge": topic,
    "view": "kv",
    "items": [
        {"key": "触发方式", "value": os.environ.get("SHIBA_TRIGGER", "manual")},
        {"key": "数据目录", "value": os.environ.get("SHIBA_DATA_DIR", "")},
    ]
}, ensure_ascii=False))`;

export const InfoProtocolDialog: React.FC<InfoProtocolDialogProps> = ({
  open,
  onOpenChange,
  onNotify,
}) => {
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    onNotify?.(`已复制${label}`);
  };

  const handleCopyPrompt = () => {
    copyText(AI_INFO_PROTOCOL_PROMPT, " AI 写脚本提示词");
    setCopiedPrompt(true);
    window.setTimeout(() => setCopiedPrompt(false), 1800);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] max-w-2xl flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            标准数据源接口规范 (shibaplan-info/v1)
          </DialogTitle>
        </DialogHeader>

        <Separator className="my-3" />

        <div className="flex-1 space-y-4 overflow-y-auto pr-1 text-xs leading-relaxed">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/25 bg-primary/8 px-3 py-2.5">
            <div className="space-y-0.5">
              <div className="font-semibold text-foreground">
                AI 零门槛生成脚本
              </div>
              <div className="text-[11px] text-muted-foreground">
                复制协议提示词发送给任意 AI，说出你的需求即可直接生成兼容脚本。
              </div>
            </div>
            <Button size="sm" onClick={handleCopyPrompt} className="gap-1.5">
              {copiedPrompt ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              <span>{copiedPrompt ? "已复制提示词" : "复制 AI 提示词"}</span>
            </Button>
          </div>

          <section className="space-y-1.5">
            <h3 className="font-semibold text-foreground">
              1. 协议兼容性（开箱即用 + 自动降级）
            </h3>
            <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
              <li>
                <strong className="text-foreground">标准协议模式</strong>：脚本向{" "}
                <code className="rounded bg-muted px-1">stdout</code> 输出包含{" "}
                <code className="rounded bg-muted px-1">
                  &quot;schema&quot;: &quot;shibaplan-info/v1&quot;
                </code>{" "}
                的 JSON，支持指标卡、趋势折线、列表、表格、键值对、Markdown 组合排版与底部快捷按钮。
              </li>
              <li>
                <strong className="text-foreground">普通 JSON 自动降级</strong>：任意合法 JSON
                数组或对象（支持配置 JSONPath 提取节点）会自动渲染为表格、列表或键值表。
              </li>
              <li>
                <strong className="text-foreground">纯文本 / Markdown 降级</strong>：原有命令行输出或
                Markdown 日志无需修改即可直接展示。
              </li>
            </ul>
          </section>

          <section className="space-y-1.5">
            <h3 className="font-semibold text-foreground">
              2. 运行上下文（环境变量 & stdin）
            </h3>
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-left text-[11px]">
                <thead className="border-b border-border bg-surface/75">
                  <tr>
                    <th className="px-2.5 py-1.5 font-semibold">环境变量</th>
                    <th className="px-2.5 py-1.5 font-semibold">说明</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  <tr>
                    <td className="px-2.5 py-1 font-mono text-primary">
                      SHIBA_WIDGET_ID / TITLE
                    </td>
                    <td className="px-2.5 py-1 text-muted-foreground">
                      当前卡片 ID 与名称
                    </td>
                  </tr>
                  <tr>
                    <td className="px-2.5 py-1 font-mono text-primary">
                      SHIBA_TRIGGER
                    </td>
                    <td className="px-2.5 py-1 text-muted-foreground">
                      触发来源：manual / schedule / startup / test
                    </td>
                  </tr>
                  <tr>
                    <td className="px-2.5 py-1 font-mono text-primary">
                      SHIBA_DATA_DIR
                    </td>
                    <td className="px-2.5 py-1 text-muted-foreground">
                      ShibaPlan 本地数据目录路径
                    </td>
                  </tr>
                  <tr>
                    <td className="px-2.5 py-1 font-mono text-primary">
                      SHIBA_LAST_RUN_AT
                    </td>
                    <td className="px-2.5 py-1 text-muted-foreground">
                      上次成功执行时间（ISO8601）
                    </td>
                  </tr>
                  <tr>
                    <td className="px-2.5 py-1 font-mono text-primary">
                      SHIBA_PARAM_*
                    </td>
                    <td className="px-2.5 py-1 text-muted-foreground">
                      卡片自定义参数（如配置 topic=AI → SHIBA_PARAM_TOPIC）
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-1.5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-foreground">
                3. 标准输出 JSON 示例
              </h3>
              <button
                type="button"
                onClick={() => copyText(SAMPLE_JSON, " JSON 示例")}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Copy className="h-3 w-3" />
                <span>复制</span>
              </button>
            </div>
            <pre className="select-text overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-[11.5px] leading-relaxed text-foreground">
              {SAMPLE_JSON}
            </pre>
          </section>

          <section className="space-y-1.5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-foreground">
                4. Python 最小接入示例
              </h3>
              <button
                type="button"
                onClick={() => copyText(SAMPLE_PYTHON, " Python 示例")}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Copy className="h-3 w-3" />
                <span>复制</span>
              </button>
            </div>
            <pre className="select-text overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-[11.5px] leading-relaxed text-foreground">
              {SAMPLE_PYTHON}
            </pre>
          </section>

          <section className="space-y-1.5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-foreground">
                5. 外部脚本主动推送（零资源占用）
              </h3>
              <button
                type="button"
                onClick={() =>
                  copyText(
                    buildPushCodeSnippets("http://127.0.0.1:18421/api/info/push/my-task").curl,
                    "推送示例"
                  )
                }
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Copy className="h-3 w-3" />
                <span>复制 cURL</span>
              </button>
            </div>
            <p className="text-muted-foreground">
              外部脚本或系统定时任务可直接{" "}
              <code className="rounded bg-muted px-1">
                POST http://127.0.0.1:18421/api/info/push/&lt;pushKey&gt;
              </code>
              ，无需 ShibaPlan 主动轮询或启动子进程。若卡片配置了访问令牌，请添加请求头{" "}
              <code className="rounded bg-muted px-1">
                Authorization: Bearer &lt;token&gt;
              </code>
              。
            </p>
            <pre className="select-text overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-[11.5px] leading-relaxed text-foreground">
              {buildPushCodeSnippets("http://127.0.0.1:18421/api/info/push/my-task").curl}
            </pre>
          </section>
        </div>

        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
