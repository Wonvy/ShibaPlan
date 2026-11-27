import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  FileCode2,
  FolderOpen,
  Globe,
  Loader2,
  Play,
  Plus,
  Radio,
  Sparkles,
  Square,
  Terminal,
  Trash2,
} from "lucide-react";
import {
  InfoScheduleMode,
  InfoScriptLang,
  InfoSourceKind,
  InfoWidget,
  InfoWidgetSource,
} from "../../types";
import {
  AI_INFO_PROTOCOL_PROMPT,
  buildPushCodeSnippets,
  buildPushUrl,
  getTemplateExt,
  INFO_WIDGET_TEMPLATES,
  InfoWidgetTemplate,
  parseInfoOutput,
  validateCronExpr,
} from "../../lib/infoProtocol";
import {
  cancelInfoRun,
  getInfoScriptsDir,
  InfoRunResult,
  openInCodeEditor,
  pickScriptFile,
  readScriptFile,
  runInfoSource,
  sendTestPush,
  writeScriptFile,
} from "../../lib/infoRunner";
import { revealPathInOs, uid } from "../../lib/storage";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Separator } from "../ui/separator";
import { CodeEditor } from "./CodeEditor";
import { InfoContentRenderer } from "./InfoContentRenderer";

interface InfoWidgetEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingWidget: InfoWidget | null;
  boardId: string;
  initialGrid?: { x: number; y: number };
  initialPixel?: { x: number; y: number };
  customDataDir?: string;
  pushBaseUrl?: string;
  onSave: (widget: InfoWidget, runImmediately?: boolean) => void;
  onNotify?: (msg: string) => void;
}

interface KvEntry {
  key: string;
  value: string;
}

function recordToPairs(rec?: Record<string, string>): KvEntry[] {
  if (!rec) return [];
  return Object.entries(rec).map(([key, value]) => ({ key, value }));
}

function pairsToRecord(pairs: KvEntry[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of pairs) {
    const k = p.key.trim();
    if (k) out[k] = p.value;
  }
  return out;
}

function inferLangFromPath(path: string): InfoScriptLang | undefined {
  const lower = path.toLowerCase();
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".ps1")) return "powershell";
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
    return "node";
  }
  if (lower.endsWith(".bat") || lower.endsWith(".cmd")) return "batch";
  if (lower.endsWith(".sh")) return "bash";
  if (lower.endsWith(".json")) return "json";
  return undefined;
}

const SIZE_PRESETS = [
  { label: "小 (3×3)", w: 3, h: 3 },
  { label: "标准 (4×4)", w: 4, h: 4 },
  { label: "宽卡 (6×4)", w: 6, h: 4 },
  { label: "大图 (6×6)", w: 6, h: 6 },
];

const ACCENT_COLORS = [
  undefined,
  "#5e6ad2",
  "#38bdf8",
  "#34d399",
  "#f59e0b",
  "#fb7185",
  "#a78bfa",
];

const CRON_PRESETS = [
  { label: "每 5 分钟", expr: "*/5 * * * *" },
  { label: "每小时整点", expr: "0 * * * *" },
  { label: "每天 09:00", expr: "0 9 * * *" },
  { label: "工作日 09:00", expr: "0 9 * * 1-5" },
];

const DEFAULT_PYTHON_STARTER = `import json
import os

# 从环境变量读取自定义参数（可选）
topic = os.environ.get("SHIBA_PARAM_TOPIC", "默认")

payload = {
    "schema": "shibaplan-info/v1",
    "status": "ok",
    "badge": topic,
    "view": "metrics",
    "items": [
        {"label": "示例指标", "value": 100, "unit": "%", "tone": "ok"},
        {"label": "待处理", "value": 2, "tone": "warn"},
    ],
}

print(json.dumps(payload, ensure_ascii=False))
`;

export const InfoWidgetEditorDialog: React.FC<InfoWidgetEditorDialogProps> = ({
  open,
  onOpenChange,
  editingWidget,
  boardId,
  initialGrid,
  initialPixel,
  customDataDir,
  pushBaseUrl,
  onSave,
  onNotify,
}) => {
  const [widgetId, setWidgetId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<InfoSourceKind>("script");

  // Script fields
  const [scriptPath, setScriptPath] = useState("");
  const [scriptLang, setScriptLang] = useState<InfoScriptLang>("python");
  const [inlineCode, setInlineCode] = useState(DEFAULT_PYTHON_STARTER);
  const [codeDirty, setCodeDirty] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [interpreter, setInterpreter] = useState("");

  // Command fields
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState("");
  const [cwd, setCwd] = useState("");
  const [useShell, setUseShell] = useState(true);

  // HTTP fields
  const [httpMethod, setHttpMethod] = useState<
    "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  >("GET");
  const [httpUrl, setHttpUrl] = useState("");
  const [headersPairs, setHeadersPairs] = useState<KvEntry[]>([]);
  const [httpBody, setHttpBody] = useState("");
  const [jsonPath, setJsonPath] = useState("");

  // Push fields
  const [pushKey, setPushKey] = useState("");
  const [pushToken, setPushToken] = useState("");
  const [staleAfterMinutes, setStaleAfterMinutes] = useState<string>("");
  const [pushSnippetTab, setPushSnippetTab] = useState<
    "curl" | "python" | "powershell" | "node"
  >("curl");
  const [pushTestPayload, setPushTestPayload] = useState(
    JSON.stringify(
      {
        schema: "shibaplan-info/v1",
        status: "ok",
        badge: "模拟推送",
        view: "metrics",
        items: [
          { label: "状态", value: "正常", tone: "ok" },
          { label: "耗时", value: 120, unit: "ms", tone: "info" },
        ],
      },
      null,
      2
    )
  );

  // Advanced / Shared
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [envPairs, setEnvPairs] = useState<KvEntry[]>([]);
  const [paramPairs, setParamPairs] = useState<KvEntry[]>([]);
  const [timeoutSec, setTimeoutSec] = useState(30);

  // Schedule
  const [scheduleMode, setScheduleMode] = useState<InfoScheduleMode>("manual");
  const [intervalValue, setIntervalValue] = useState(5);
  const [intervalUnit, setIntervalUnit] = useState<"sec" | "min" | "hour">("min");
  const [cronExpr, setCronExpr] = useState("0 9 * * *");
  const [runOnStartup, setRunOnStartup] = useState(false);

  // Layout & Appearance
  const [gridW, setGridW] = useState(4);
  const [gridH, setGridH] = useState(4);
  const [sizeChanged, setSizeChanged] = useState(false);
  const [accentColor, setAccentColor] = useState<string | undefined>(undefined);
  const [hideHeader, setHideHeader] = useState(false);

  // Test Workbench
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<InfoRunResult | null>(null);
  const [testTab, setTestTab] = useState<"preview" | "stdout" | "stderr" | "spec">(
    "preview"
  );
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTestResult(null);
    setTestTab("preview");
    setTestRunning(false);
    setCodeDirty(false);
    setSizeChanged(false);

    if (editingWidget) {
      setWidgetId(editingWidget.id);
      setTitle(editingWidget.title);
      setDescription(editingWidget.description ?? "");
      setKind(editingWidget.source.kind);
      setScriptPath(editingWidget.source.scriptPath ?? "");
      setScriptLang(editingWidget.source.scriptLang ?? "python");
      setInlineCode(editingWidget.source.inlineCode ?? "");
      setInterpreter(editingWidget.source.interpreter ?? "");
      setCommand(editingWidget.source.command ?? "");
      setArgsText((editingWidget.source.args ?? []).join(" "));
      setCwd(editingWidget.source.cwd ?? "");
      setUseShell(editingWidget.source.useShell ?? true);
      setHttpMethod(editingWidget.source.method ?? "GET");
      setHttpUrl(editingWidget.source.url ?? "");
      setHeadersPairs(recordToPairs(editingWidget.source.headers));
      setHttpBody(editingWidget.source.body ?? "");
      setJsonPath(editingWidget.source.jsonPath ?? "");
      setPushKey(editingWidget.source.pushKey ?? editingWidget.id);
      setPushToken(editingWidget.source.pushToken ?? "");
      setStaleAfterMinutes(
        editingWidget.source.staleAfterMinutes
          ? String(editingWidget.source.staleAfterMinutes)
          : ""
      );
      setEnvPairs(recordToPairs(editingWidget.source.env));
      setParamPairs(recordToPairs(editingWidget.source.params));
      setTimeoutSec(editingWidget.source.timeoutSec ?? 30);

      setScheduleMode(editingWidget.schedule.mode);
      const sec = editingWidget.schedule.intervalSeconds ?? 300;
      if (sec % 3600 === 0 && sec >= 3600) {
        setIntervalUnit("hour");
        setIntervalValue(sec / 3600);
      } else if (sec % 60 === 0 && sec >= 60) {
        setIntervalUnit("min");
        setIntervalValue(sec / 60);
      } else {
        setIntervalUnit("sec");
        setIntervalValue(sec);
      }
      setCronExpr(editingWidget.schedule.cron ?? "0 9 * * *");
      setRunOnStartup(Boolean(editingWidget.schedule.runOnStartup));

      setGridW(editingWidget.layout.w);
      setGridH(editingWidget.layout.h);
      setAccentColor(editingWidget.appearance?.accentColor);
      setHideHeader(Boolean(editingWidget.appearance?.hideHeader));

      if (
        editingWidget.source.kind === "script" &&
        editingWidget.source.scriptPath &&
        !editingWidget.source.inlineCode
      ) {
        readScriptFile(editingWidget.source.scriptPath)
          .then((content) => {
            setInlineCode(content);
            setCodeDirty(false);
          })
          .catch(() => {});
      }
    } else {
      const newId = uid("info");
      setWidgetId(newId);
      setTitle("");
      setDescription("");
      setKind("script");
      setScriptPath("");
      setScriptLang("python");
      setInlineCode(DEFAULT_PYTHON_STARTER);
      setInterpreter("");
      setCommand("");
      setArgsText("");
      setCwd("");
      setUseShell(true);
      setHttpMethod("GET");
      setHttpUrl("");
      setHeadersPairs([]);
      setHttpBody("");
      setJsonPath("");
      setPushKey(newId);
      setPushToken("");
      setStaleAfterMinutes("");
      setEnvPairs([]);
      setParamPairs([]);
      setTimeoutSec(30);
      setScheduleMode("manual");
      setIntervalValue(5);
      setIntervalUnit("min");
      setCronExpr("0 9 * * *");
      setRunOnStartup(false);
      setGridW(4);
      setGridH(4);
      setAccentColor(undefined);
      setHideHeader(false);
    }
  }, [open, editingWidget]);

  const cronValidation = useMemo(() => {
    if (scheduleMode !== "cron") return { valid: true };
    return validateCronExpr(cronExpr);
  }, [scheduleMode, cronExpr]);

  const parsedTest = useMemo(() => {
    if (!testResult) return null;
    return parseInfoOutput(testResult, jsonPath);
  }, [testResult, jsonPath]);

  const parsedArgs = useMemo(
    () => argsText.trim().split(/\s+/).filter(Boolean),
    [argsText]
  );

  const buildSource = (): InfoWidgetSource => ({
    kind,
    scriptPath: scriptPath.trim() || undefined,
    inlineCode: kind === "script" ? inlineCode : undefined,
    scriptLang: kind === "script" ? scriptLang : undefined,
    interpreter: interpreter.trim() || undefined,
    command: command.trim() || undefined,
    args: parsedArgs.length > 0 ? parsedArgs : undefined,
    cwd: cwd.trim() || undefined,
    useShell,
    url: httpUrl.trim() || undefined,
    method: kind === "http" ? httpMethod : undefined,
    headers: kind === "http" ? pairsToRecord(headersPairs) : undefined,
    body: kind === "http" && httpBody ? httpBody : undefined,
    jsonPath: jsonPath.trim() || undefined,
    env: pairsToRecord(envPairs),
    params: pairsToRecord(paramPairs),
    timeoutSec: Math.max(2, Math.min(300, timeoutSec || 30)),
    pushKey:
      kind === "push"
        ? (pushKey.trim() || widgetId)
        : undefined,
    pushToken:
      kind === "push" && pushToken.trim()
        ? pushToken.trim()
        : undefined,
    staleAfterMinutes:
      kind === "push" && Number(staleAfterMinutes) > 0
        ? Math.round(Number(staleAfterMinutes))
        : undefined,
  });

  const handlePickScript = async () => {
    const picked = await pickScriptFile();
    if (!picked) return;
    setScriptPath(picked);
    const inferred = inferLangFromPath(picked);
    if (inferred) setScriptLang(inferred);
    try {
      const content = await readScriptFile(picked);
      setInlineCode(content);
      setCodeDirty(false);
    } catch {
      // Binary executable or oversized file
    }
  };

  const handleSaveScriptFile = async () => {
    setSavingFile(true);
    try {
      let target = scriptPath.trim();
      if (!target) {
        const ext = getTemplateExt(scriptLang);
        const safeTitle = (title.trim() || widgetId || "script")
          .replace(/[^\w\u4e00-\u9fff-]+/g, "_")
          .slice(0, 32);
        target = `${safeTitle}.${ext}`;
      }
      const savedPath = await writeScriptFile(target, inlineCode, customDataDir);
      setScriptPath(savedPath);
      setCodeDirty(false);
      onNotify?.(`脚本已保存至 ${savedPath}`);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : "保存脚本失败");
    } finally {
      setSavingFile(false);
    }
  };

  const handleCreateManagedScript = async () => {
    try {
      const dir = await getInfoScriptsDir(customDataDir);
      const ext = getTemplateExt(scriptLang);
      const safeName = (title.trim() || widgetId || "my_script")
        .replace(/[^\w\u4e00-\u9fff-]+/g, "_")
        .slice(0, 32);
      const sep = dir.includes("\\") ? "\\" : "/";
      const fullPath = `${dir}${sep}${safeName}.${ext}`;
      const savedPath = await writeScriptFile(fullPath, inlineCode, customDataDir);
      setScriptPath(savedPath);
      setCodeDirty(false);
      onNotify?.(`已创建托管脚本：${savedPath}`);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : "创建托管脚本失败");
    }
  };

  const handleRunTest = async () => {
    setTestRunning(true);
    try {
      if (kind === "push") {
        const url = buildPushUrl(pushBaseUrl, pushKey.trim() || widgetId);
        const res = await sendTestPush(url, pushTestPayload, pushToken);
        if (res.ok) {
          setTestResult({
            ...res,
            stdout: pushTestPayload,
          });
        } else {
          setTestResult(res);
        }
        setTestTab(res.ok ? "preview" : "stdout");
        return;
      }

      const src = buildSource();
      const res = await runInfoSource({
        widgetId: `test-${widgetId}`,
        widgetTitle: title.trim() || "测试卡片",
        trigger: "test",
        kind: src.kind,
        scriptPath: src.scriptPath,
        inlineCode: src.inlineCode,
        scriptLang: src.scriptLang,
        interpreter: src.interpreter,
        command: src.command,
        args: src.args ?? [],
        cwd: src.cwd,
        useShell: src.useShell,
        url: src.url,
        method: src.method,
        headers: src.headers ?? {},
        body: src.body,
        env: src.env ?? {},
        params: src.params ?? {},
        timeoutSec: src.timeoutSec,
        customDir: customDataDir,
      });
      setTestResult(res);
      if (!res.ok && res.stderr.trim() && !res.stdout.trim()) {
        setTestTab("stderr");
      } else {
        setTestTab("preview");
      }
    } finally {
      setTestRunning(false);
    }
  };

  const handleStopTest = async () => {
    await cancelInfoRun(`test-${widgetId}`);
  };

  const handleApplyTemplate = (tplId: string) => {
    const tpl = INFO_WIDGET_TEMPLATES.find((t) => t.id === tplId);
    if (!tpl) return;
    if (!title.trim()) setTitle(tpl.defaultTitle);
    setKind(tpl.source.kind);
    setScriptLang(tpl.source.scriptLang ?? "python");
    setInlineCode(tpl.source.inlineCode ?? "");
    setScriptPath(tpl.source.scriptPath ?? "");
    setHttpMethod(tpl.source.method ?? "GET");
    setHttpUrl(tpl.source.url ?? "");
    setPushKey(tpl.source.pushKey ?? widgetId);
    setPushToken(tpl.source.pushToken ?? "");
    setParamPairs(recordToPairs(tpl.source.params));
    setTimeoutSec(tpl.source.timeoutSec ?? 30);
    setGridW(tpl.w);
    setGridH(tpl.h);
    setAccentColor(tpl.accentColor);
    setScheduleMode(tpl.schedule.mode);
    if (tpl.schedule.intervalSeconds) {
      const s = tpl.schedule.intervalSeconds;
      if (s % 60 === 0) {
        setIntervalUnit("min");
        setIntervalValue(s / 60);
      } else {
        setIntervalUnit("sec");
        setIntervalValue(s);
      }
    }
    setRunOnStartup(Boolean(tpl.schedule.runOnStartup));
    setCodeDirty(true);
    onNotify?.(`已填入模板「${tpl.name}」`);
  };

  const handleCommit = async (runAfterSave: boolean) => {
    if (kind === "script" && scriptPath.trim() && codeDirty) {
      try {
        await writeScriptFile(scriptPath.trim(), inlineCode, customDataDir);
        setCodeDirty(false);
      } catch {
        // ignore if non-writable
      }
    }

    const mult =
      intervalUnit === "hour" ? 3600 : intervalUnit === "min" ? 60 : 1;
    const intervalSeconds = Math.max(5, Math.round((intervalValue || 1) * mult));

    const now = new Date().toISOString();
    const nextWidget: InfoWidget = {
      id: editingWidget?.id || widgetId,
      boardId: editingWidget?.boardId || boardId,
      title: title.trim() || "未命名信息卡片",
      description: description.trim() || undefined,
      source: buildSource(),
      schedule: {
        mode: scheduleMode,
        intervalSeconds: scheduleMode === "interval" ? intervalSeconds : undefined,
        cron: scheduleMode === "cron" ? cronExpr.trim() : undefined,
        runOnStartup,
        paused: editingWidget?.schedule.paused ?? false,
      },
      layout: editingWidget
        ? {
            ...editingWidget.layout,
            w: gridW,
            h: gridH,
            ...(sizeChanged
              ? { pw: undefined, ph: undefined }
              : {}),
          }
        : {
            x: initialGrid?.x ?? 0,
            y: initialGrid?.y ?? 0,
            w: gridW,
            h: gridH,
            minW: 2,
            minH: 2,
            ...(initialPixel ? { px: initialPixel.x, py: initialPixel.y } : {}),
          },
      appearance: {
        ...(editingWidget?.appearance ?? {}),
        accentColor,
        hideHeader,
      },
      createdAt: editingWidget?.createdAt ?? now,
      updatedAt: now,
    };

    onSave(nextWidget, runAfterSave);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88vh] max-h-[88vh] w-[95vw] max-w-5xl flex-col p-5">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <FileCode2 className="h-4 w-4 text-primary" />
              {editingWidget ? "编辑信息卡片与数据源" : "新建信息卡片与数据源"}
            </span>

            {/* Quick Template Picker */}
            <div className="flex items-center gap-1.5 mr-4">
              <span className="text-[11px] font-normal text-muted-foreground">
                快速填充模板：
              </span>
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) handleApplyTemplate(e.target.value);
                }}
                className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-normal text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">选择示例模板...</option>
                {INFO_WIDGET_TEMPLATES.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </option>
                ))}
              </select>
            </div>
          </DialogTitle>
        </DialogHeader>

        <Separator className="my-3" />

        {/* Two-column Main Body */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-[1.15fr_0.85fr]">
          {/* LEFT: Configuration */}
          <div className="min-h-0 space-y-4 overflow-y-auto pr-2 text-xs">
            {/* Basic Info */}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                  卡片名称
                </label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例如：本机监控 / 每日热点 / PR 统计"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                  默认网格尺寸 & 强调色
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={`${gridW}x${gridH}`}
                    onChange={(e) => {
                      const [w, h] = e.target.value.split("x").map(Number);
                      if (w && h) {
                        setGridW(w);
                        setGridH(h);
                        setSizeChanged(true);
                      }
                    }}
                    className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {!SIZE_PRESETS.some(
                      (p) => p.w === gridW && p.h === gridH
                    ) && (
                      <option value={`${gridW}x${gridH}`}>
                        当前 ({gridW}×{gridH})
                      </option>
                    )}
                    {SIZE_PRESETS.map((p) => (
                      <option key={p.label} value={`${p.w}x${p.h}`}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1 rounded-md border border-border bg-surface/50 px-2 py-1.5">
                    {ACCENT_COLORS.map((c, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setAccentColor(c)}
                        style={{ backgroundColor: c ?? "transparent" }}
                        className={`h-3.5 w-3.5 rounded-full border border-border ${
                          accentColor === c
                            ? "ring-2 ring-primary ring-offset-1 ring-offset-background"
                            : ""
                        }`}
                        title={c ?? "无强调色"}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Data Source Kind Switch */}
            <div className="space-y-2.5 rounded-xl border border-border bg-surface/35 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-foreground">数据源配置</span>
                <div className="inline-flex rounded-lg border border-border bg-background p-0.5">
                  {(
                    [
                      { id: "script", label: "本地脚本", icon: FileCode2 },
                      { id: "command", label: "命令行 / 程序", icon: Terminal },
                      { id: "http", label: "HTTP 接口", icon: Globe },
                      { id: "push", label: "外部推送", icon: Radio },
                    ] as const
                  ).map((tab) => {
                    const Icon = tab.icon;
                    const active = kind === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setKind(tab.id)}
                        className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                          active
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <Icon className="h-3 w-3" />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {kind === "script" && (
                <div className="space-y-2.5">
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={scriptPath}
                      onChange={(e) => setScriptPath(e.target.value)}
                      placeholder="可选：选择本地脚本路径，或留空直接写内联脚本"
                      className="flex-1 font-mono text-[11.5px]"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={handlePickScript}
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      选择文件
                    </Button>
                    {!scriptPath.trim() && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={handleCreateManagedScript}
                        title="保存为 ShibaPlan/scripts/ 下的独立脚本文件"
                      >
                        托管存盘
                      </Button>
                    )}
                  </div>

                  <CodeEditor
                    value={inlineCode}
                    onChange={(val) => {
                      setInlineCode(val);
                      setCodeDirty(true);
                    }}
                    language={scriptLang}
                    onLanguageChange={(l) => setScriptLang(l)}
                    filePath={scriptPath.trim() || undefined}
                    onSaveFile={
                      scriptPath.trim() ? handleSaveScriptFile : handleCreateManagedScript
                    }
                    onOpenExternal={
                      scriptPath.trim()
                        ? () =>
                            openInCodeEditor(scriptPath.trim()).catch((e) =>
                              onNotify?.(
                                e instanceof Error ? e.message : "打开编辑器失败"
                              )
                            )
                        : undefined
                    }
                    onRevealFile={
                      scriptPath.trim()
                        ? () =>
                            revealPathInOs(scriptPath.trim()).catch(() => {})
                        : undefined
                    }
                    onInsertTemplate={() => {
                      setInlineCode(DEFAULT_PYTHON_STARTER);
                      setScriptLang("python");
                      setCodeDirty(true);
                    }}
                    savingFile={savingFile}
                    dirty={codeDirty}
                    heightClass="h-56"
                    placeholder="在此编写脚本代码，向 stdout 输出 JSON 或文本..."
                  />

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-[11px] text-muted-foreground">
                        自定义解释器（可选，如虚拟环境 python.exe）
                      </label>
                      <Input
                        value={interpreter}
                        onChange={(e) => setInterpreter(e.target.value)}
                        placeholder="留空自动识别 python / powershell / node"
                        className="font-mono text-[11.5px]"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-muted-foreground">
                        命令行参数（空格分隔，可选）
                      </label>
                      <Input
                        value={argsText}
                        onChange={(e) => setArgsText(e.target.value)}
                        placeholder="--mode fast"
                        className="font-mono text-[11.5px]"
                      />
                    </div>
                  </div>
                </div>
              )}

              {kind === "command" && (
                <div className="space-y-2.5">
                  <div>
                    <label className="mb-1 block text-[11px] text-muted-foreground">
                      执行命令或可执行文件路径
                    </label>
                    <Input
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      placeholder="例如：git status -s 或 D:\Tools\check.exe"
                      className="font-mono text-[11.5px]"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-[11px] text-muted-foreground">
                        工作目录 (cwd)
                      </label>
                      <Input
                        value={cwd}
                        onChange={(e) => setCwd(e.target.value)}
                        placeholder="留空默认脚本目录"
                        className="font-mono text-[11.5px]"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-muted-foreground">
                        附加参数（空格分隔）
                      </label>
                      <Input
                        value={argsText}
                        onChange={(e) => setArgsText(e.target.value)}
                        placeholder="可选参数"
                        className="font-mono text-[11.5px]"
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-[11.5px] text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useShell}
                      onChange={(e) => setUseShell(e.target.checked)}
                      className="rounded border-border"
                    />
                    <span>通过系统 Shell 执行（支持管道与内建命令）</span>
                  </label>
                </div>
              )}

              {kind === "http" && (
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2">
                    <select
                      value={httpMethod}
                      onChange={(e) =>
                        setHttpMethod(
                          e.target.value as
                            | "GET"
                            | "POST"
                            | "PUT"
                            | "PATCH"
                            | "DELETE"
                        )
                      }
                      className="h-9 rounded-md border border-input bg-background px-2 font-mono text-xs font-semibold text-foreground"
                    >
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                      <option value="PUT">PUT</option>
                      <option value="PATCH">PATCH</option>
                      <option value="DELETE">DELETE</option>
                    </select>
                    <Input
                      value={httpUrl}
                      onChange={(e) => setHttpUrl(e.target.value)}
                      placeholder="https://api.example.com/status"
                      className="flex-1 font-mono text-[11.5px]"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] text-muted-foreground">
                      JSONPath 数据提取（可选，如 data.items 或 result[0]）
                    </label>
                    <Input
                      value={jsonPath}
                      onChange={(e) => setJsonPath(e.target.value)}
                      placeholder="留空直接解析整个响应体"
                      className="font-mono text-[11.5px]"
                    />
                  </div>

                  {/* Headers KV */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground">
                        请求头 (Headers)
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setHeadersPairs((prev) => [
                            ...prev,
                            { key: "", value: "" },
                          ])
                        }
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-primary hover:bg-primary/10"
                      >
                        <Plus className="h-3 w-3" />
                        <span>添加</span>
                      </button>
                    </div>
                    {headersPairs.map((pair, idx) => (
                      <div key={idx} className="flex items-center gap-1.5">
                        <Input
                          value={pair.key}
                          onChange={(e) =>
                            setHeadersPairs((prev) =>
                              prev.map((p, i) =>
                                i === idx ? { ...p, key: e.target.value } : p
                              )
                            )
                          }
                          placeholder="Authorization"
                          className="h-8 flex-1 font-mono text-[11px]"
                        />
                        <Input
                          value={pair.value}
                          onChange={(e) =>
                            setHeadersPairs((prev) =>
                              prev.map((p, i) =>
                                i === idx ? { ...p, value: e.target.value } : p
                              )
                            )
                          }
                          placeholder="Bearer ..."
                          className="h-8 flex-1 font-mono text-[11px]"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setHeadersPairs((prev) =>
                              prev.filter((_, i) => i !== idx)
                            )
                          }
                          className="rounded p-1 text-muted-foreground hover:text-rose-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {httpMethod !== "GET" && (
                    <div className="space-y-1">
                      <span className="text-[11px] text-muted-foreground">
                        请求体 (Body)
                      </span>
                      <CodeEditor
                        value={httpBody}
                        onChange={setHttpBody}
                        language="json"
                        heightClass="h-28"
                        placeholder='{"query": "value"}'
                      />
                    </div>
                  )}
                </div>
              )}

              {kind === "push" && (() => {
                const effectiveKey = pushKey.trim() || widgetId;
                const endpoint = buildPushUrl(pushBaseUrl, effectiveKey);
                const snippets = buildPushCodeSnippets(endpoint, pushToken);
                return (
                  <div className="space-y-2.5">
                    <div className="rounded-lg border border-primary/25 bg-primary/8 px-2.5 py-2 text-[11px]">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="font-medium text-foreground">
                          专属推送接收地址 (HTTP POST)
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(endpoint).catch(() => {});
                            onNotify?.("已复制推送地址");
                          }}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-primary hover:bg-primary/15"
                        >
                          <Copy className="h-3 w-3" />
                          <span>复制地址</span>
                        </button>
                      </div>
                      <div className="select-text break-all font-mono text-[11px] text-primary">
                        {endpoint}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-[11px] text-muted-foreground">
                          推送标识 (pushKey)
                        </label>
                        <Input
                          value={pushKey}
                          onChange={(e) => setPushKey(e.target.value)}
                          placeholder="例如：daily-report"
                          className="h-8 font-mono text-[11.5px]"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] text-muted-foreground">
                          访问令牌 (Token，可选)
                        </label>
                        <div className="flex items-center gap-1">
                          <Input
                            value={pushToken}
                            onChange={(e) => setPushToken(e.target.value)}
                            placeholder="留空不校验"
                            className="h-8 flex-1 font-mono text-[11.5px]"
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              setPushToken(
                                Math.random().toString(36).slice(2, 10) +
                                  Math.random().toString(36).slice(2, 6)
                              )
                            }
                            className="h-8 px-2 text-[11px]"
                          >
                            生成
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-[11px] text-muted-foreground">
                          JSONPath 提取（可选）
                        </label>
                        <Input
                          value={jsonPath}
                          onChange={(e) => setJsonPath(e.target.value)}
                          placeholder="留空直接解析请求体"
                          className="h-8 font-mono text-[11.5px]"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] text-muted-foreground">
                          超时未推提醒（分钟，可选）
                        </label>
                        <Input
                          type="number"
                          min={1}
                          value={staleAfterMinutes}
                          onChange={(e) => setStaleAfterMinutes(e.target.value)}
                          placeholder="如 60（超1小时提示）"
                          className="h-8 text-[11.5px]"
                        />
                      </div>
                    </div>

                    {/* Ready-to-copy Push Snippets */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-muted-foreground">
                          外部脚本调用代码（已带当前地址与令牌）
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard
                              .writeText(snippets[pushSnippetTab])
                              .catch(() => {});
                            onNotify?.(`已复制 ${pushSnippetTab} 代码`);
                          }}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-primary hover:bg-primary/10"
                        >
                          <Copy className="h-3 w-3" />
                          <span>复制代码</span>
                        </button>
                      </div>
                      <div className="flex items-center gap-1 rounded-md border border-border bg-background p-0.5">
                        {(["curl", "python", "powershell", "node"] as const).map(
                          (tb) => (
                            <button
                              key={tb}
                              type="button"
                              onClick={() => setPushSnippetTab(tb)}
                              className={`flex-1 rounded py-0.5 text-[10.5px] font-medium ${
                                pushSnippetTab === tb
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
                          )
                        )}
                      </div>
                      <pre className="select-text max-h-36 overflow-auto rounded-lg border border-border bg-background p-2.5 font-mono text-[11px] leading-relaxed text-foreground">
                        {snippets[pushSnippetTab]}
                      </pre>
                    </div>
                  </div>
                );
              })()}

              {/* Collapsible Advanced Config */}
              <div className="border-t border-border/60 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((s) => !s)}
                  className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                >
                  {showAdvanced ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                  <span>高级配置（自定义参数 / 环境变量 / 超时时间 / 外观）</span>
                </button>

                {showAdvanced && (
                  <div className="mt-2.5 space-y-3 rounded-lg border border-border/70 bg-background/60 p-2.5">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-[11px] text-muted-foreground">
                          执行超时（秒，2-300）
                        </label>
                        <Input
                          type="number"
                          min={2}
                          max={300}
                          value={timeoutSec}
                          onChange={(e) => setTimeoutSec(Number(e.target.value))}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="flex items-end pb-1">
                        <label className="flex items-center gap-2 text-[11.5px] text-muted-foreground cursor-pointer">
                          <input
                            type="checkbox"
                            checked={hideHeader}
                            onChange={(e) => setHideHeader(e.target.checked)}
                          />
                          <span>隐藏卡片标题栏（极简桌面组件风格）</span>
                        </label>
                      </div>
                    </div>

                    {kind === "script" && (
                      <div>
                        <label className="mb-1 block text-[11px] text-muted-foreground">
                          工作目录 (cwd，可选)
                        </label>
                        <Input
                          value={cwd}
                          onChange={(e) => setCwd(e.target.value)}
                          placeholder="留空默认 ShibaPlan/scripts 目录"
                          className="h-8 font-mono text-[11px]"
                        />
                      </div>
                    )}

                    {/* Custom Params -> SHIBA_PARAM_* */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-muted-foreground">
                          自定义参数（自动注入为 SHIBA_PARAM_* 环境变量）
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setParamPairs((prev) => [
                              ...prev,
                              { key: "", value: "" },
                            ])
                          }
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-primary hover:bg-primary/10"
                        >
                          <Plus className="h-3 w-3" />
                          <span>添加参数</span>
                        </button>
                      </div>
                      {paramPairs.map((p, idx) => (
                        <div key={idx} className="flex items-center gap-1.5">
                          <Input
                            value={p.key}
                            onChange={(e) =>
                              setParamPairs((prev) =>
                                prev.map((it, i) =>
                                  i === idx ? { ...it, key: e.target.value } : it
                                )
                              )
                            }
                            placeholder="参数名 (如 topic)"
                            className="h-7 flex-1 font-mono text-[11px]"
                          />
                          <Input
                            value={p.value}
                            onChange={(e) =>
                              setParamPairs((prev) =>
                                prev.map((it, i) =>
                                  i === idx
                                    ? { ...it, value: e.target.value }
                                    : it
                                )
                              )
                            }
                            placeholder="参数值"
                            className="h-7 flex-1 font-mono text-[11px]"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setParamPairs((prev) =>
                                prev.filter((_, i) => i !== idx)
                              )
                            }
                            className="rounded p-1 text-muted-foreground hover:text-rose-500"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Env Vars */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-muted-foreground">
                          额外环境变量 (ENV)
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setEnvPairs((prev) => [
                              ...prev,
                              { key: "", value: "" },
                            ])
                          }
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-primary hover:bg-primary/10"
                        >
                          <Plus className="h-3 w-3" />
                          <span>添加变量</span>
                        </button>
                      </div>
                      {envPairs.map((p, idx) => (
                        <div key={idx} className="flex items-center gap-1.5">
                          <Input
                            value={p.key}
                            onChange={(e) =>
                              setEnvPairs((prev) =>
                                prev.map((it, i) =>
                                  i === idx ? { ...it, key: e.target.value } : it
                                )
                              )
                            }
                            placeholder="API_TOKEN"
                            className="h-7 flex-1 font-mono text-[11px]"
                          />
                          <Input
                            value={p.value}
                            onChange={(e) =>
                              setEnvPairs((prev) =>
                                prev.map((it, i) =>
                                  i === idx
                                    ? { ...it, value: e.target.value }
                                    : it
                                )
                              )
                            }
                            placeholder="值"
                            className="h-7 flex-1 font-mono text-[11px]"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setEnvPairs((prev) =>
                                prev.filter((_, i) => i !== idx)
                              )
                            }
                            className="rounded p-1 text-muted-foreground hover:text-rose-500"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Automation Schedule */}
            {kind === "push" ? (
              <div className="flex items-center gap-2 rounded-xl border border-border bg-surface/35 p-3 text-[11.5px] text-muted-foreground">
                <Radio className="h-4 w-4 shrink-0 text-primary" />
                <span>
                  外部推送模式无需本程序定时调度，由你的外部脚本 / 系统计划任务 / CI 流水线主动 POST 数据至此地址，零后台运行开销。
                </span>
              </div>
            ) : (
            <div className="space-y-2.5 rounded-xl border border-border bg-surface/35 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-semibold text-foreground">
                  <Clock className="h-3.5 w-3.5 text-primary" />
                  自动化任务调度
                </span>
                <div className="inline-flex rounded-lg border border-border bg-background p-0.5">
                  {(
                    [
                      { id: "manual", label: "仅手动" },
                      { id: "interval", label: "固定间隔" },
                      { id: "cron", label: "Cron 定时" },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setScheduleMode(m.id)}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        scheduleMode === m.id
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {scheduleMode === "interval" && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">每隔</span>
                  <Input
                    type="number"
                    min={1}
                    value={intervalValue}
                    onChange={(e) => setIntervalValue(Number(e.target.value))}
                    className="h-8 w-20 text-xs"
                  />
                  <select
                    value={intervalUnit}
                    onChange={(e) =>
                      setIntervalUnit(
                        e.target.value as "sec" | "min" | "hour"
                      )
                    }
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  >
                    <option value="sec">秒（最低 5 秒）</option>
                    <option value="min">分钟</option>
                    <option value="hour">小时</option>
                  </select>
                  <span className="text-muted-foreground">自动运行一次</span>
                </div>
              )}

              {scheduleMode === "cron" && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      value={cronExpr}
                      onChange={(e) => setCronExpr(e.target.value)}
                      placeholder="0 9 * * *"
                      className="h-8 flex-1 font-mono text-xs"
                    />
                    <span
                      className={`text-[11px] ${
                        cronValidation.valid
                          ? "text-emerald-500"
                          : "text-rose-500"
                      }`}
                    >
                      {cronValidation.valid
                        ? "表达式有效"
                        : cronValidation.error}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {CRON_PRESETS.map((p) => (
                      <button
                        key={p.expr}
                        type="button"
                        onClick={() => setCronExpr(p.expr)}
                        className="rounded border border-border bg-background px-2 py-0.5 text-[10.5px] text-muted-foreground hover:border-primary/50 hover:text-foreground"
                      >
                        {p.label} ({p.expr})
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <label className="flex items-center gap-2 text-[11.5px] text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={runOnStartup}
                  onChange={(e) => setRunOnStartup(e.target.checked)}
                />
                <span>打开 ShibaPlan 时自动执行一次</span>
              </label>
            </div>
            )}
          </div>

          {/* RIGHT: Live Test Workbench */}
          <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface/35">
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-foreground">
                  实时测试与预览台
                </span>
                {testResult && (
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">
                    {testResult.durationMs}ms · exit={testResult.exitCode}
                  </span>
                )}
              </div>

              {testRunning ? (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={handleStopTest}
                  className="h-7 gap-1 px-2.5 text-xs"
                >
                  <Square className="h-3 w-3 fill-current" />
                  <span>停止</span>
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  onClick={handleRunTest}
                  className="h-7 gap-1 px-2.5 text-xs"
                >
                  <Play className="h-3 w-3" />
                  <span>{kind === "push" ? "模拟发送推送" : "测试运行"}</span>
                </Button>
              )}
            </div>

            {kind === "push" && (
              <div className="border-b border-border/60 p-2.5 space-y-1">
                <div className="text-[11px] font-medium text-muted-foreground">
                  模拟推送 JSON 数据（点击「模拟发送推送」将真实 POST 到本地接收端口）
                </div>
                <CodeEditor
                  value={pushTestPayload}
                  onChange={setPushTestPayload}
                  language="json"
                  heightClass="h-28"
                />
              </div>
            )}

            {/* Validation Status Banner */}
            {parsedTest && (
              <div
                className={`flex items-center gap-1.5 border-b border-border/60 px-3 py-1.5 text-[11px] ${
                  parsedTest.validation.mode === "standard"
                    ? "bg-emerald-500/8 text-emerald-500"
                    : parsedTest.validation.mode === "error"
                      ? "bg-rose-500/10 text-rose-400"
                      : "bg-sky-500/8 text-sky-400"
                }`}
              >
                {parsedTest.validation.mode === "error" ? (
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="truncate">{parsedTest.validation.message}</span>
              </div>
            )}

            {/* Sub-tabs */}
            <div className="flex items-center justify-between border-b border-border/60 bg-background/40 px-2 py-1">
              <div className="flex items-center gap-1">
                {(
                  [
                    { id: "preview", label: "卡片预览" },
                    { id: "stdout", label: "stdout" },
                    { id: "stderr", label: "stderr" },
                    { id: "spec", label: "协议速查" },
                  ] as const
                ).map((tb) => (
                  <button
                    key={tb.id}
                    type="button"
                    onClick={() => setTestTab(tb.id)}
                    className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      testTab === tb.id
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tb.label}
                    {tb.id === "stderr" && testResult?.stderr?.trim() ? " •" : ""}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  navigator.clipboard
                    .writeText(AI_INFO_PROTOCOL_PROMPT)
                    .catch(() => {});
                  setCopiedPrompt(true);
                  onNotify?.("已复制 AI 写脚本规范提示词");
                  window.setTimeout(() => setCopiedPrompt(false), 1800);
                }}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-primary hover:bg-primary/10"
              >
                {copiedPrompt ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                <span>{copiedPrompt ? "已复制" : "复制 AI 提示词"}</span>
              </button>
            </div>

            {/* Tab Content */}
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {testRunning ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span>正在执行数据源...</span>
                </div>
              ) : testTab === "preview" ? (
                testResult ? (
                  <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card-rest">
                    {accentColor && (
                      <div
                        className="h-[2.5px] w-full"
                        style={{ backgroundColor: accentColor }}
                      />
                    )}
                    {!hideHeader && (
                      <div className="flex items-center justify-between border-b border-border/60 bg-surface/55 px-3 py-2 text-xs font-semibold">
                        <span className="truncate">
                          {parsedTest?.title || title.trim() || "测试预览卡片"}
                        </span>
                        {parsedTest?.badge && (
                          <span className="rounded bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                            {parsedTest.badge}
                          </span>
                        )}
                      </div>
                    )}
                    <InfoContentRenderer
                      parsed={parsedTest}
                      onNotify={onNotify}
                    />
                  </div>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-xs text-muted-foreground">
                    <span>点击右上角「测试运行」立即验证输出与渲染效果</span>
                    <span className="text-[11px] opacity-75">
                      支持 shibaplan-info/v1 标准 JSON、普通 JSON 与纯文本/Markdown 自动降级
                    </span>
                  </div>
                )
              ) : testTab === "stdout" ? (
                <div className="space-y-2">
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard
                          .writeText(testResult?.stdout ?? "")
                          .catch(() => {});
                        onNotify?.("已复制 stdout");
                      }}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <Copy className="h-3 w-3" />
                      <span>复制</span>
                    </button>
                  </div>
                  <pre className="select-text whitespace-pre-wrap break-words rounded-lg border border-border bg-background p-2.5 font-mono text-[11.5px] text-foreground">
                    {testResult?.stdout || "(暂无 stdout 输出)"}
                  </pre>
                </div>
              ) : testTab === "stderr" ? (
                <pre className="select-text whitespace-pre-wrap break-words rounded-lg border border-border bg-background p-2.5 font-mono text-[11.5px] text-rose-400">
                  {testResult?.stderr || "(无 stderr 错误输出)"}
                </pre>
              ) : (
                <pre className="select-text whitespace-pre-wrap break-words rounded-lg border border-border bg-background p-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
                  {AI_INFO_PROTOCOL_PROMPT}
                </pre>
              )}
            </div>
          </div>
        </div>

        <Separator className="my-3" />

        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] text-muted-foreground">
            {scheduleMode === "cron" && !cronValidation.valid
              ? `请修正 Cron 表达式：${cronValidation.error}`
              : "提示：脚本输出遵循 shibaplan-info/v1 可解锁指标卡与折线图"}
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
            {kind === "push" ? (
              <Button
                type="button"
                size="sm"
                onClick={() => handleCommit(false)}
              >
                保存卡片
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={scheduleMode === "cron" && !cronValidation.valid}
                  onClick={() => handleCommit(false)}
                >
                  仅保存
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={scheduleMode === "cron" && !cronValidation.valid}
                  onClick={() => handleCommit(true)}
                >
                  保存并运行
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
