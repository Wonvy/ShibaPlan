import React, { useEffect, useMemo, useRef, useState } from "react";
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
  Frame,
  Globe,
  Loader2,
  Play,
  Plus,
  Radio,
  Sparkles,
  Square,
  Terminal,
  ToggleRight,
  Trash2,
  Upload,
} from "lucide-react";
import {
  InfoControlActionKind,
  InfoControlType,
  InfoDisplayView,
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
  buildSampleParsedForView,
  buildStarterScriptForView,
  getTemplateExt,
  inferScriptFromFilename,
  INFO_DISPLAY_VIEW_OPTIONS,
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
import {
  DEFAULT_CONTAINER_PX_H,
  DEFAULT_CONTAINER_PX_W,
  DEFAULT_CONTROL_ICON_H,
  DEFAULT_CONTROL_ICON_W,
  DEFAULT_CONTROL_SWITCH_H,
  DEFAULT_CONTROL_SWITCH_W,
  DEFAULT_WIDGET_PX_H,
  DEFAULT_WIDGET_PX_W,
  getWidgetPixelRect,
  gridLayoutToPixelRect,
  MIN_WIDGET_PX_H,
  MIN_WIDGET_PX_W,
} from "../../lib/infoGrid";
import { isTauriRuntime, revealPathInOs, uid } from "../../lib/storage";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { CustomSelect, CustomSelectOption } from "../ui/custom-select";
import { Input } from "../ui/input";
import { CodeEditor } from "./CodeEditor";
import { CONTROL_ICON_OPTIONS, renderControlIcon } from "./controlIcons";
import { DisplayViewThumbnail } from "./DisplayViewThumbnails";
import { InfoContentRenderer } from "./InfoContentRenderer";

interface InfoWidgetEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingWidget: InfoWidget | null;
  boardId: string;
  initialPos?: { x: number; y: number };
  initialKind?: InfoSourceKind;
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

const INTERVAL_UNIT_OPTIONS: CustomSelectOption[] = [
  { value: "sec", label: "秒（最低 5 秒）" },
  { value: "min", label: "分钟" },
  { value: "hour", label: "小时" },
];

const HTTP_METHOD_OPTIONS: CustomSelectOption[] = (
  ["GET", "POST", "PUT", "PATCH", "DELETE"] as const
).map((m) => ({ value: m, label: m }));

const TEMPLATE_SELECT_OPTIONS: CustomSelectOption[] = INFO_WIDGET_TEMPLATES.map(
  (tpl) => ({
    value: tpl.id,
    label: tpl.name,
  })
);

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
  initialPos,
  initialKind,
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
  const [pxW, setPxW] = useState(DEFAULT_WIDGET_PX_W);
  const [pxH, setPxH] = useState(DEFAULT_WIDGET_PX_H);
  const [sizeChanged, setSizeChanged] = useState(false);
  const [accentColor, setAccentColor] = useState<string | undefined>(undefined);
  const [hideHeader, setHideHeader] = useState(false);
  const [displayView, setDisplayView] = useState<InfoDisplayView>("auto");

  // Test Workbench
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<InfoRunResult | null>(null);
  const [testTab, setTestTab] = useState<"preview" | "stdout" | "stderr" | "spec">(
    "preview"
  );
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  // Simple / Pro editor mode & script file drop state
  const [editorMode, setEditorMode] = useState<"simple" | "pro">("simple");
  const [droppedFileName, setDroppedFileName] = useState("");
  const [isScriptDragOver, setIsScriptDragOver] = useState(false);

  // Atomic control widget fields
  const [controlType, setControlType] = useState<InfoControlType>("switch");
  const [controlState, setControlState] = useState(false);
  const [controlIcon, setControlIcon] = useState("power");
  const [controlLabelPosition, setControlLabelPosition] = useState<
    "bottom" | "right"
  >("bottom");
  const [controlActionKind, setControlActionKind] =
    useState<InfoControlActionKind>("script");
  const [controlTarget, setControlTarget] = useState("");
  const browserFileInputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef(title);
  titleRef.current = title;
  const kindRef = useRef(kind);
  kindRef.current = kind;
  const onNotifyRef = useRef(onNotify);
  onNotifyRef.current = onNotify;

  const previewStageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ w: 380, h: 480 });
  const [resizingPreview, setResizingPreview] = useState(false);
  const [hoverHint, setHoverHint] = useState<string | null>(null);

  useEffect(() => {
    if (!open) setHoverHint(null);
  }, [open, editorMode]);

  const hintProps = (text: string) => ({
    title: text,
    onMouseEnter: () => setHoverHint(text),
    onMouseLeave: () => setHoverHint((cur) => (cur === text ? null : cur)),
  });

  useEffect(() => {
    if (!open) return;
    const el = previewStageRef.current;
    if (!el) return;
    const sync = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        setStageSize({ w: el.clientWidth, h: el.clientHeight });
      }
    };
    sync();
    if (typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setStageSize({ w: width, h: height });
        }
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [open, editorMode]);

  const availW = Math.max(160, stageSize.w - 32);
  const availH = Math.max(140, stageSize.h - 48);
  const previewScale = Math.min(
    1,
    availW / Math.max(1, pxW),
    availH / Math.max(1, pxH)
  );
  const scaledW = Math.max(40, Math.round(pxW * previewScale));
  const scaledH = Math.max(32, Math.round(pxH * previewScale));

  const handleStartPreviewResize = (
    e: React.PointerEvent,
    edge: "n" | "s" | "e" | "w" | "se"
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = pxW;
    const startH = pxH;
    const startScale = Math.max(0.25, previewScale);
    setResizingPreview(true);

    const onMove = (ev: PointerEvent) => {
      const dx = ((ev.clientX - startX) * 2) / startScale;
      const dy = ((ev.clientY - startY) * 2) / startScale;
      const rawW =
        edge === "e" || edge === "se"
          ? startW + dx
          : edge === "w"
            ? startW - dx
            : startW;
      const rawH =
        edge === "s" || edge === "se"
          ? startH + dy
          : edge === "n"
            ? startH - dy
            : startH;
      const nextW = Math.min(
        960,
        Math.max(MIN_WIDGET_PX_W, Math.round(rawW / 4) * 4)
      );
      const nextH = Math.min(
        760,
        Math.max(MIN_WIDGET_PX_H, Math.round(rawH / 4) * 4)
      );
      setPxW(nextW);
      setPxH(nextH);
      setSizeChanged(true);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setResizingPreview(false);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  useEffect(() => {
    if (!open) return;
    setTestResult(null);
    setTestTab("preview");
    setTestRunning(false);
    setCodeDirty(false);
    setSizeChanged(false);
    setDroppedFileName("");
    setIsScriptDragOver(false);

    if (editingWidget) {
      const k = editingWidget.source.kind;
      setEditorMode(
        k === "script" || k === "container" || k === "control" ? "simple" : "pro"
      );
      setWidgetId(editingWidget.id);
      setTitle(
        editingWidget.title ||
          (editingWidget.source.kind === "control"
            ? editingWidget.source.controlLabel ?? ""
            : "")
      );
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
      setControlType(editingWidget.source.controlType ?? "switch");
      setControlState(Boolean(editingWidget.source.controlState));
      setControlIcon(editingWidget.source.controlIcon ?? "power");
      setControlLabelPosition(
        editingWidget.source.controlLabelPosition ?? "bottom"
      );
      setControlActionKind(editingWidget.source.controlActionKind ?? "none");
      setControlTarget(editingWidget.source.controlTarget ?? "");
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

      const rect = getWidgetPixelRect(editingWidget);
      setPxW(rect.w);
      setPxH(rect.h);
      setAccentColor(editingWidget.appearance?.accentColor);
      setHideHeader(Boolean(editingWidget.appearance?.hideHeader));
      setDisplayView(editingWidget.appearance?.displayView ?? "auto");

      if (
        (editingWidget.source.kind === "script" ||
          (editingWidget.source.kind === "control" &&
            editingWidget.source.controlActionKind === "script")) &&
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
      const startKind = initialKind ?? "script";
      setEditorMode("simple");
      setWidgetId(newId);
      setTitle("");
      setDescription("");
      setKind(startKind);
      setScriptPath("");
      setScriptLang("python");
      setInlineCode("");
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
      setControlType("switch");
      setControlState(false);
      setControlIcon("power");
      setControlLabelPosition("bottom");
      setControlActionKind("script");
      setControlTarget("");
      setEnvPairs([]);
      setParamPairs([]);
      setTimeoutSec(30);
      setScheduleMode("manual");
      setIntervalValue(5);
      setIntervalUnit("min");
      setCronExpr("0 9 * * *");
      setRunOnStartup(false);
      setPxW(
        startKind === "container"
          ? DEFAULT_CONTAINER_PX_W
          : startKind === "control"
            ? DEFAULT_CONTROL_SWITCH_W
            : DEFAULT_WIDGET_PX_W
      );
      setPxH(
        startKind === "container"
          ? DEFAULT_CONTAINER_PX_H
          : startKind === "control"
            ? DEFAULT_CONTROL_SWITCH_H
            : DEFAULT_WIDGET_PX_H
      );
      setAccentColor(undefined);
      setHideHeader(false);
      setDisplayView("auto");
    }
  }, [open, editingWidget, initialKind]);

  const cronValidation = useMemo(() => {
    if (scheduleMode !== "cron") return { valid: true };
    return validateCronExpr(cronExpr);
  }, [scheduleMode, cronExpr]);

  const parsedTest = useMemo(() => {
    if (!testResult) return null;
    return parseInfoOutput(testResult, jsonPath, displayView);
  }, [testResult, jsonPath, displayView]);

  const sampleParsed = useMemo(
    () => buildSampleParsedForView(displayView),
    [displayView]
  );

  const hasAdvancedOverrides = Boolean(
    interpreter.trim() ||
      argsText.trim() ||
      cwd.trim() ||
      hideHeader ||
      timeoutSec !== 30 ||
      paramPairs.length > 0 ||
      envPairs.length > 0
  );

  const parsedArgs = useMemo(
    () => argsText.trim().split(/\s+/).filter(Boolean),
    [argsText]
  );

  const buildSource = (): InfoWidgetSource => {
    if (kind === "container") {
      return { kind: "container" };
    }
    if (kind === "control") {
      const hasControlScript = Boolean(scriptPath.trim() || inlineCode.trim());
      const effectiveActionKind: InfoControlActionKind =
        controlActionKind === "script" && !hasControlScript
          ? "none"
          : controlActionKind === "command" && !command.trim()
            ? "none"
            : (controlActionKind === "url" || controlActionKind === "path") &&
                !controlTarget.trim()
              ? "none"
              : controlActionKind;

      return {
        kind: "control",
        controlType,
        controlState,
        controlIcon,
        controlLabel: undefined,
        controlLabelPosition,
        controlActionKind: effectiveActionKind,
        controlTarget: controlTarget.trim() || undefined,
        scriptPath:
          effectiveActionKind === "script"
            ? scriptPath.trim() || undefined
            : undefined,
        inlineCode:
          effectiveActionKind === "script" && inlineCode
            ? inlineCode
            : undefined,
        scriptLang: effectiveActionKind === "script" ? scriptLang : undefined,
        interpreter:
          effectiveActionKind === "script"
            ? interpreter.trim() || undefined
            : undefined,
        command:
          effectiveActionKind === "command"
            ? command.trim() || undefined
            : undefined,
        args: parsedArgs.length > 0 ? parsedArgs : undefined,
        cwd: cwd.trim() || undefined,
        useShell,
        env: pairsToRecord(envPairs),
        params: pairsToRecord(paramPairs),
        timeoutSec: Math.max(2, Math.min(300, timeoutSec || 30)),
      };
    }
    return {
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
    };
  };

  // Native OS file drag-and-drop inside editor dialog (Tauri)
  useEffect(() => {
    if (!open || !isTauriRuntime()) {
      setIsScriptDragOver(false);
      return;
    }
    let unlisten: (() => void) | undefined;
    let disposed = false;

    import("@tauri-apps/api/event").then(({ listen }) => {
      if (disposed) return;
      listen<{ kind: string; paths: string[] }>(
        "os-drag-drop",
        async (event) => {
          const payload = event.payload;
          if (payload.kind === "enter" || payload.kind === "over") {
            setIsScriptDragOver(true);
            return;
          }
          if (payload.kind === "leave") {
            setIsScriptDragOver(false);
            return;
          }
          if (payload.kind === "drop") {
            setIsScriptDragOver(false);
            if (!payload.paths || payload.paths.length === 0) return;
            const matchedPath = payload.paths.find((p) =>
              Boolean(inferScriptFromFilename(p))
            );
            if (!matchedPath) {
              onNotifyRef.current?.(
                "请拖入脚本文件（支持 .py / .ps1 / .js / .sh / .bat / .cmd）"
              );
              return;
            }
            const inferred = inferScriptFromFilename(matchedPath)!;
            if (kindRef.current === "control") {
              setControlActionKind("script");
            } else {
              setKind("script");
            }
            setScriptPath(matchedPath);
            setScriptLang(inferred.lang);
            setDroppedFileName("");
            if (!titleRef.current.trim()) {
              setTitle(inferred.title);
            }
            try {
              const content = await readScriptFile(matchedPath);
              setInlineCode(content);
              setCodeDirty(false);
            } catch {
              setInlineCode("");
              setCodeDirty(false);
            }
            onNotifyRef.current?.(`已载入脚本「${inferred.title}」`);
          }
        }
      ).then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [open]);

  const handleLocalScriptFile = async (file: File) => {
    const inferred = inferScriptFromFilename(file.name);
    if (!inferred) {
      onNotify?.(
        "请拖入或选择脚本文件（支持 .py / .ps1 / .js / .sh / .bat / .cmd）"
      );
      return;
    }
    const fileWithPath = file as File & { path?: string };
    if (kind === "control") {
      setControlActionKind("script");
    } else {
      setKind("script");
    }
    setScriptLang(inferred.lang);
    setScriptPath(fileWithPath.path || "");
    setDroppedFileName(file.name);
    if (!title.trim()) {
      setTitle(inferred.title);
    }
    try {
      const text = await file.text();
      setInlineCode(text);
      setCodeDirty(false);
    } catch {
      // ignore read failure
    }
    onNotify?.(`已载入脚本「${inferred.title}」`);
  };

  const handlePickScript = async () => {
    if (!isTauriRuntime()) {
      browserFileInputRef.current?.click();
      return;
    }
    const picked = await pickScriptFile();
    if (!picked) return;
    if (kind === "control") {
      setControlActionKind("script");
    } else {
      setKind("script");
    }
    setScriptPath(picked);
    setDroppedFileName("");
    const meta = inferScriptFromFilename(picked);
    const inferredLang = meta?.lang ?? inferLangFromPath(picked);
    if (inferredLang) setScriptLang(inferredLang);
    if (meta && !title.trim()) {
      setTitle(meta.title);
    }
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
      if (
        src.kind === "control" &&
        src.controlActionKind !== "script" &&
        src.controlActionKind !== "command"
      ) {
        onNotify?.("请先为该元件绑定本地脚本或命令后再测试运行");
        return;
      }

      const effectiveKind =
        src.kind === "control"
          ? src.controlActionKind === "command"
            ? "command"
            : "script"
          : src.kind;
      const effectiveEnv =
        src.kind === "control" && src.controlType !== "icon"
          ? {
              ...(src.env ?? {}),
              SHIBA_SWITCH_STATE: src.controlState ? "on" : "off",
            }
          : (src.env ?? {});

      const res = await runInfoSource({
        widgetId: `test-${widgetId}`,
        widgetTitle: title.trim() || "测试卡片",
        trigger: "test",
        kind: effectiveKind,
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
        env: effectiveEnv,
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
    const tplRect = gridLayoutToPixelRect({ x: 0, y: 0, w: tpl.w, h: tpl.h });
    setPxW(tplRect.w);
    setPxH(tplRect.h);
    setSizeChanged(true);
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
    if (kind === "script" && !scriptPath.trim() && !inlineCode.trim()) {
      onNotify?.("请先拖入或选择本地脚本文件，或切换至专业模式编写脚本");
      return;
    }

    if (
      (kind === "script" ||
        (kind === "control" && controlActionKind === "script")) &&
      scriptPath.trim() &&
      codeDirty
    ) {
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
      title: title.trim(),
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
            ...(sizeChanged
              ? {
                  pw: Math.max(MIN_WIDGET_PX_W, pxW),
                  ph: Math.max(MIN_WIDGET_PX_H, pxH),
                }
              : {}),
          }
        : {
            x: 0,
            y: 0,
            w: 4,
            h: 4,
            minW: 2,
            minH: 2,
            px: initialPos?.x ?? 0,
            py: initialPos?.y ?? 0,
            pw: Math.max(MIN_WIDGET_PX_W, pxW),
            ph: Math.max(MIN_WIDGET_PX_H, pxH),
          },
      appearance: {
        ...(editingWidget?.appearance ?? {}),
        accentColor,
        hideHeader,
        displayView: displayView === "auto" ? undefined : displayView,
      },
      createdAt: editingWidget?.createdAt ?? now,
      updatedAt: now,
    };

    onSave(nextWidget, runAfterSave);
    onOpenChange(false);
  };

  const scriptDisplayLabel =
    scriptPath.trim() ||
    droppedFileName ||
    (inlineCode.trim() ? "内联脚本代码" : "");

  const SCRIPT_LANG_BADGE: Record<InfoScriptLang, string> = {
    python: "Python",
    powershell: "PowerShell",
    node: "Node.js",
    batch: "Batch",
    bash: "Bash",
    json: "JSON",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`flex flex-col gap-0 overflow-hidden p-0 ${
          editorMode === "simple"
            ? "h-[min(640px,84vh)] w-[92vw] max-w-4xl"
            : "h-[86vh] max-h-[86vh] w-[94vw] max-w-5xl"
        }`}
      >
        <input
          ref={browserFileInputRef}
          type="file"
          accept=".py,.ps1,.js,.mjs,.cjs,.bat,.cmd,.sh,.bash"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleLocalScriptFile(f);
            e.target.value = "";
          }}
          className="hidden"
        />

        <DialogHeader className="shrink-0 border-b border-border px-5 py-3 pr-10">
          <DialogTitle className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2">
              <FileCode2 className="h-4 w-4 text-primary" />
              {editingWidget ? "编辑信息卡片" : "新建信息卡片"}
            </span>

            <div className="flex items-center gap-2.5 mr-2">
              {/* Simple / Pro Mode Switcher */}
              <div className="inline-flex rounded-lg border border-border bg-background p-0.5 font-normal">
                {(
                  [
                    {
                      id: "simple",
                      label: "简单模式",
                      hint: "快速配置脚本、开关/图标、空白容器及展示版式",
                    },
                    {
                      id: "pro",
                      label: "专业模式",
                      hint: "编写内联脚本、命令行、HTTP 接口、外部推送与实时测试",
                    },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    {...hintProps(m.hint)}
                    onClick={() => {
                      setEditorMode(m.id);
                      setHoverHint(null);
                      if (m.id === "pro" && kind === "container") {
                        setKind("script");
                      }
                      if (
                        m.id === "simple" &&
                        (testTab === "stdout" || testTab === "spec")
                      ) {
                        setTestTab("preview");
                      }
                    }}
                    className={`rounded-md px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                      editorMode === m.id
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {/* Quick Template Picker (Pro Mode only) */}
              {editorMode === "pro" && (
                <CustomSelect
                  value=""
                  placeholder="快速填充模板..."
                  options={TEMPLATE_SELECT_OPTIONS}
                  onChange={(val) => {
                    if (val) handleApplyTemplate(val);
                  }}
                  className="h-7 min-w-[144px] border-border text-[11px] font-normal"
                  ariaLabel="快速填充模板"
                />
              )}
            </div>
          </DialogTitle>
        </DialogHeader>

        {/* Full-bleed Two-column Main Body */}
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[1.15fr_0.85fr]">
          {/* LEFT */}
          {editorMode === "simple" ? (
            <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-4 text-xs">
              {/* Top Shared Basic Info Row (Name) */}
              <div {...hintProps("卡片名称可选，留空即隐藏标题栏，仅显示内容")}>
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                  卡片名称
                </label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="留空即隐藏标题栏"
                  className="h-8 text-xs"
                />
              </div>

              {/* Unified Display Settings (Card Kind + Visual Presentation) */}
              <div className="space-y-3 border-t border-border/50 pt-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-foreground">展示效果</span>
                  <div className="inline-flex rounded-lg border border-border bg-background p-0.5">
                    {(
                      [
                        {
                          id: "script",
                          label: "数据卡片",
                          icon: FileCode2,
                          hint: "运行本地脚本并按所选版式展示结果",
                        },
                        {
                          id: "control",
                          label: "开关 / 图标",
                          icon: ToggleRight,
                          hint: "点击触发本地脚本、命令或链接的开关/图标，可拖入空白容器分组",
                        },
                        {
                          id: "container",
                          label: "空白容器",
                          icon: Frame,
                          hint: "纯分组容器（无需脚本），可将其他卡片、开关或图标拖入其中跟随整体移动",
                        },
                      ] as const
                    ).map((t) => {
                      const Icon = t.icon;
                      const active = kind === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          {...hintProps(t.hint)}
                          onClick={() => {
                            setKind(t.id);
                            if (!editingWidget) {
                              if (t.id === "container") {
                                setPxW(DEFAULT_CONTAINER_PX_W);
                                setPxH(DEFAULT_CONTAINER_PX_H);
                              } else if (t.id === "control") {
                                setPxW(
                                  controlType === "icon"
                                    ? DEFAULT_CONTROL_ICON_W
                                    : DEFAULT_CONTROL_SWITCH_W
                                );
                                setPxH(
                                  controlType === "icon"
                                    ? DEFAULT_CONTROL_ICON_H
                                    : DEFAULT_CONTROL_SWITCH_H
                                );
                              } else {
                                setPxW(DEFAULT_WIDGET_PX_W);
                                setPxH(DEFAULT_WIDGET_PX_H);
                              }
                            }
                          }}
                          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                            active
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <Icon className="h-3 w-3" />
                          <span>{t.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {kind === "container" && (
                  <div
                    {...hintProps(
                      "空白卡片是一个可分组的容器，创建后可将其他卡片、开关或图标拖入其中跟随整体移动"
                    )}
                    className="flex flex-wrap items-center justify-between gap-2 pt-0.5"
                  >
                    <div className="flex items-center gap-1.5">
                      {ACCENT_COLORS.map((c, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setAccentColor(c)}
                          style={{ backgroundColor: c ?? "transparent" }}
                          className={`h-3.5 w-3.5 rounded-full border border-border transition-transform hover:scale-110 ${
                            accentColor === c
                              ? "ring-2 ring-primary ring-offset-1 ring-offset-background"
                              : ""
                          }`}
                          {...hintProps(c ? `强调色：${c}` : "强调色：无")}
                        />
                      ))}
                    </div>
                    {title.trim() && (
                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
                        <input
                          type="checkbox"
                          checked={hideHeader}
                          onChange={(e) => setHideHeader(e.target.checked)}
                        />
                        <span>隐藏标题栏</span>
                      </label>
                    )}
                  </div>
                )}

                {kind === "control" && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        元件类型
                      </span>
                      <div className="inline-flex w-48 rounded-md border border-border bg-background p-0.5">
                        {(
                          [
                            {
                              id: "switch",
                              label: "开关",
                              hint: "点击切换开/关状态，触发脚本时自动注入 SHIBA_SWITCH_STATE=on/off",
                            },
                            {
                              id: "icon",
                              label: "图标按钮",
                              hint: "点击立即触发绑定的脚本、命令、网址或路径",
                            },
                          ] as const
                        ).map((ct) => (
                          <button
                            key={ct.id}
                            type="button"
                            {...hintProps(ct.hint)}
                            onClick={() => {
                              setControlType(ct.id);
                              if (!editingWidget) {
                                setPxW(
                                  ct.id === "icon"
                                    ? DEFAULT_CONTROL_ICON_W
                                    : DEFAULT_CONTROL_SWITCH_W
                                );
                                setPxH(
                                  ct.id === "icon"
                                    ? DEFAULT_CONTROL_ICON_H
                                    : DEFAULT_CONTROL_SWITCH_H
                                );
                              }
                            }}
                            className={`flex-1 rounded py-1 text-[11px] font-medium transition-colors ${
                              controlType === ct.id
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {ct.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Icon Palette */}
                    <div>
                      <label className="mb-1.5 block text-[11px] text-muted-foreground">
                        图标选择
                      </label>
                      <div className="grid grid-cols-8 gap-1.5">
                        {CONTROL_ICON_OPTIONS.map((opt) => {
                          const Icon = opt.Icon;
                          const active = controlIcon === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              {...hintProps(`图标：${opt.label}`)}
                              onClick={() => setControlIcon(opt.id)}
                              className={`flex h-8 items-center justify-center rounded-md border transition-colors ${
                                active
                                  ? "border-primary bg-primary/12 text-primary"
                                  : "border-border/70 bg-background/60 text-muted-foreground hover:bg-accent hover:text-foreground"
                              }`}
                            >
                              <Icon className="h-3.5 w-3.5" />
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                      <div className="flex items-center gap-1.5">
                        {ACCENT_COLORS.map((c, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setAccentColor(c)}
                            style={{ backgroundColor: c ?? "transparent" }}
                            className={`h-3.5 w-3.5 rounded-full border border-border transition-transform hover:scale-110 ${
                              accentColor === c
                                ? "ring-2 ring-primary ring-offset-1 ring-offset-background"
                                : ""
                            }`}
                            {...hintProps(c ? `强调色：${c}` : "强调色：无")}
                          />
                        ))}
                      </div>

                      <div
                        {...hintProps("卡片名称显示在元件下方或右侧")}
                        className="inline-flex rounded border border-border bg-background p-0.5 text-[10px]"
                      >
                        {(
                          [
                            { id: "bottom", label: "下方" },
                            { id: "right", label: "右侧" },
                          ] as const
                        ).map((pos) => (
                          <button
                            key={pos.id}
                            type="button"
                            onClick={() => {
                              setControlLabelPosition(pos.id);
                              if (
                                pos.id === "right" &&
                                !editingWidget &&
                                pxW < 140
                              ) {
                                setPxW(148);
                                setSizeChanged(true);
                              }
                            }}
                            className={`rounded px-1.5 py-px font-medium transition-colors ${
                              controlLabelPosition === pos.id
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {pos.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {kind !== "container" && kind !== "control" && (
                  <div className="space-y-3">
                    {/* Display View Wireframe Thumbnails */}
                    <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
                      {INFO_DISPLAY_VIEW_OPTIONS.map((opt) => {
                        const active = displayView === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            {...hintProps(`${opt.label}：${opt.desc}`)}
                            onClick={() => setDisplayView(opt.id)}
                            className={`group flex flex-col items-center gap-1 rounded-lg border px-1.5 py-1.5 transition-colors ${
                              active
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border/70 bg-background/60 text-muted-foreground hover:border-border hover:bg-accent/50 hover:text-foreground"
                            }`}
                          >
                            <DisplayViewThumbnail view={opt.id} active={active} />
                            <span className="text-[10.5px] font-medium leading-none">
                              {opt.shortLabel}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Accent & Hide Header row */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                      <div className="flex items-center gap-1.5">
                        {ACCENT_COLORS.map((c, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setAccentColor(c)}
                            style={{ backgroundColor: c ?? "transparent" }}
                            className={`h-3.5 w-3.5 rounded-full border border-border transition-transform hover:scale-110 ${
                              accentColor === c
                                ? "ring-2 ring-primary ring-offset-1 ring-offset-background"
                                : ""
                            }`}
                            {...hintProps(c ? `强调色：${c}` : "强调色：无")}
                          />
                        ))}
                      </div>
                      <label
                        {...hintProps("隐藏顶部标题栏，仅展示卡片内容")}
                        className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={hideHeader}
                          onChange={(e) => setHideHeader(e.target.checked)}
                        />
                        <span>隐藏卡片标题栏</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {/* Script / Trigger Section (Below Display Settings) */}
              {kind !== "container" && (
                <div className="space-y-2 border-t border-border/50 pt-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="font-semibold text-foreground">
                        {kind === "control" ? "触发" : "脚本"}
                      </span>
                      {(kind !== "control" ||
                        controlActionKind === "script" ||
                        controlActionKind === "none") &&
                        scriptDisplayLabel && (
                          <span className="rounded bg-primary/10 px-1.5 py-px font-mono text-[10px] font-medium text-primary">
                            {SCRIPT_LANG_BADGE[scriptLang] ?? scriptLang}
                          </span>
                        )}
                    </div>

                    {kind === "control" ? (
                      <div
                        {...hintProps(
                          "点击开关/图标时触发的动作；开关状态会注入 SHIBA_SWITCH_STATE=on/off"
                        )}
                        className="inline-flex rounded-md border border-border bg-background p-0.5 text-[10.5px]"
                      >
                        {(
                          [
                            { id: "script", label: "脚本" },
                            { id: "command", label: "命令" },
                            { id: "url", label: "网址" },
                            { id: "path", label: "路径" },
                          ] as const
                        ).map((act) => {
                          const active =
                            act.id === "script"
                              ? controlActionKind === "script" ||
                                controlActionKind === "none"
                              : controlActionKind === act.id;
                          return (
                            <button
                              key={act.id}
                              type="button"
                              onClick={() => setControlActionKind(act.id)}
                              className={`rounded px-2 py-0.5 font-medium transition-colors ${
                                active
                                  ? "bg-primary text-primary-foreground"
                                  : "text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {act.label}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      scriptDisplayLabel && (
                        <button
                          type="button"
                          onClick={() => setEditorMode("pro")}
                          className="text-[11px] font-medium text-primary hover:underline"
                        >
                          编辑代码
                        </button>
                      )
                    )}
                  </div>

                  {kind !== "control" ||
                  controlActionKind === "script" ||
                  controlActionKind === "none" ? (
                    <div
                      onDragEnter={(e) => {
                        if (!e.dataTransfer?.types?.includes("Files")) return;
                        e.preventDefault();
                        setIsScriptDragOver(true);
                      }}
                      onDragOver={(e) => {
                        if (!e.dataTransfer?.types?.includes("Files")) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "copy";
                        if (!isScriptDragOver) setIsScriptDragOver(true);
                      }}
                      onDragLeave={() => setIsScriptDragOver(false)}
                      onDrop={(e) => {
                        if (!e.dataTransfer?.files?.length) return;
                        e.preventDefault();
                        setIsScriptDragOver(false);
                        const file = e.dataTransfer.files[0];
                        if (file) void handleLocalScriptFile(file);
                      }}
                    >
                      {scriptDisplayLabel ? (
                        <div
                          className={`flex h-8 items-center justify-between gap-1.5 rounded-md border px-2.5 transition-colors ${
                            isScriptDragOver
                              ? "border-primary bg-primary/10"
                              : "border-input bg-background"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={handlePickScript}
                            {...hintProps(
                              `${scriptDisplayLabel}（点击更换或直接拖入新脚本）`
                            )}
                            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                          >
                            <FileCode2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                            <span className="truncate font-mono text-[11px] text-foreground">
                              {scriptDisplayLabel}
                            </span>
                          </button>
                          <div className="flex shrink-0 items-center gap-0.5">
                            {kind === "control" && (
                              <button
                                type="button"
                                onClick={() => setEditorMode("pro")}
                                className="rounded px-1.5 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                              >
                                编辑
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={handlePickScript}
                              className="rounded px-1.5 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            >
                              更换
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={handlePickScript}
                          {...hintProps(
                            "支持 .py / .ps1 / .js / .sh / .bat / .cmd，点击选择或直接拖入"
                          )}
                          className={`flex h-16 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 text-xs transition-colors ${
                            isScriptDragOver
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-surface/30 text-muted-foreground hover:border-primary/50 hover:bg-surface/55 hover:text-foreground"
                          }`}
                        >
                          <Upload className="h-4 w-4 shrink-0 text-primary" />
                          <span className="truncate">选择或拖入脚本</span>
                        </button>
                      )}
                    </div>
                  ) : controlActionKind === "command" ? (
                    <Input
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      placeholder="例如：ipconfig /flushdns"
                      className="h-8 font-mono text-[11px]"
                    />
                  ) : (
                    <Input
                      value={controlTarget}
                      onChange={(e) => setControlTarget(e.target.value)}
                      placeholder={
                        controlActionKind === "url"
                          ? "https://example.com"
                          : "C:\\Tools\\app.exe"
                      }
                      className="h-8 font-mono text-[11px]"
                    />
                  )}
                </div>
              )}

              {kind !== "container" && kind !== "control" && (
              <>

              {/* 2. Schedule / Runtime Frequency */}
              <div className="space-y-2.5 border-t border-border/50 pt-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-semibold text-foreground">
                    <Clock className="h-3.5 w-3.5 text-primary" />
                    运行时间
                  </span>
                  <div className="inline-flex rounded-lg border border-border bg-background p-0.5">
                    {(
                      [
                        {
                          id: "manual",
                          label: "仅手动",
                          hint: "仅在点击卡片刷新或重启后手动触发运行",
                        },
                        {
                          id: "interval",
                          label: "固定间隔",
                          hint: "按设定的秒/分钟/小时周期自动循环执行",
                        },
                        {
                          id: "cron",
                          label: "Cron 定时",
                          hint: "按 5 段标准 Cron 表达式在指定时间自动执行",
                        },
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        {...hintProps(m.hint)}
                        onClick={() => setScheduleMode(m.id)}
                        className={`rounded-md px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
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
                      className="h-7 w-20 text-xs"
                    />
                    <CustomSelect
                      value={intervalUnit}
                      options={INTERVAL_UNIT_OPTIONS}
                      onChange={(val) =>
                        setIntervalUnit(val as "sec" | "min" | "hour")
                      }
                      className="h-7 min-w-[132px] text-xs"
                      ariaLabel="时间单位"
                    />
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
                        className="h-7 flex-1 font-mono text-xs"
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

                <label
                  {...hintProps("打开 ShibaPlan 时自动执行一次该脚本")}
                  className="flex items-center gap-2 text-[11.5px] text-muted-foreground cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={runOnStartup}
                    onChange={(e) => setRunOnStartup(e.target.checked)}
                  />
                  <span>打开 ShibaPlan 时自动执行一次</span>
                </label>
              </div>
              </>
              )}
            </div>
          ) : (
            /* PRO MODE LEFT: Flat Configuration Sections */
            <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-4 text-xs">
            {/* 1. Basic Info */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                  卡片名称
                </label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例如：本机监控 / 每日热点 / PR 统计"
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                  强调色
                </label>
                <div className="flex h-8 items-center gap-1.5">
                  {ACCENT_COLORS.map((c, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setAccentColor(c)}
                      style={{ backgroundColor: c ?? "transparent" }}
                      className={`h-3.5 w-3.5 rounded-full border border-border transition-transform hover:scale-110 ${
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

            {/* 2. Display Style Selector with Visual Wireframe Thumbnails */}
            <div className="space-y-2 border-t border-border/50 pt-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-foreground">展示版式</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
                {INFO_DISPLAY_VIEW_OPTIONS.map((opt) => {
                  const active = displayView === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      {...hintProps(`${opt.label}：${opt.desc}`)}
                      onClick={() => setDisplayView(opt.id)}
                      className={`group flex flex-col items-center gap-1 rounded-lg border px-1.5 py-1.5 transition-colors ${
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border/70 bg-background/60 text-muted-foreground hover:border-border hover:bg-accent/50 hover:text-foreground"
                      }`}
                    >
                      <DisplayViewThumbnail view={opt.id} active={active} />
                      <span className="text-[10.5px] font-medium leading-none">
                        {opt.shortLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. Data Source Section */}
            <div className="space-y-2.5 border-t border-border/50 pt-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-foreground">
                  {kind === "control" ? "开关 / 图标触发源" : "数据源"}
                </span>
                {kind === "control" ? (
                  <div className="flex items-center gap-1.5">
                    <div className="inline-flex rounded-lg border border-border bg-background p-0.5">
                      {(
                        [
                          { id: "script", label: "本地脚本", icon: FileCode2 },
                          { id: "command", label: "命令行", icon: Terminal },
                        ] as const
                      ).map((tab) => {
                        const Icon = tab.icon;
                        const active =
                          (controlActionKind === "command"
                            ? "command"
                            : "script") === tab.id;
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setControlActionKind(tab.id)}
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
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
                    <button
                      type="button"
                      onClick={() => setKind("script")}
                      className="rounded-md px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                      title="切换为常规数据卡片"
                    >
                      切为数据卡片
                    </button>
                  </div>
                ) : (
                  <div className="inline-flex rounded-lg border border-border bg-background p-0.5">
                    {(
                      [
                        { id: "script", label: "本地脚本", icon: FileCode2 },
                        { id: "command", label: "命令行", icon: Terminal },
                        { id: "http", label: "HTTP", icon: Globe },
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
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
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
                )}
              </div>

              {(kind === "script" ||
                (kind === "control" && controlActionKind !== "command")) && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={scriptPath}
                      onChange={(e) => setScriptPath(e.target.value)}
                      placeholder="可选：选择本地脚本路径，或留空直接写内联脚本"
                      className="h-8 flex-1 font-mono text-[11.5px]"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={handlePickScript}
                      className="h-8 px-2.5 text-[11px]"
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
                        className="h-8 px-2.5 text-[11px]"
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
                      const starter = buildStarterScriptForView(
                        displayView,
                        scriptLang
                      );
                      setInlineCode(starter);
                      setCodeDirty(true);
                      const label =
                        INFO_DISPLAY_VIEW_OPTIONS.find(
                          (o) => o.id === displayView
                        )?.label ?? displayView;
                      onNotify?.(`已生成「${label}」版式示例脚本`);
                    }}
                    savingFile={savingFile}
                    dirty={codeDirty}
                    heightClass="h-52"
                    placeholder="在此编写脚本代码，向 stdout 输出 JSON 或文本..."
                  />
                </div>
              )}

              {(kind === "command" ||
                (kind === "control" && controlActionKind === "command")) && (
                <div className="space-y-2.5">
                  <div>
                    <label className="mb-1 block text-[11px] text-muted-foreground">
                      执行命令或可执行文件路径
                    </label>
                    <Input
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      placeholder="例如：git status -s 或 D:\Tools\check.exe"
                      className="h-8 font-mono text-[11.5px]"
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
                        className="h-8 font-mono text-[11.5px]"
                      />
                    </div>
                    <div {...hintProps("多个参数以空格分隔")}>
                      <label className="mb-1 block text-[11px] text-muted-foreground">
                        附加参数
                      </label>
                      <Input
                        value={argsText}
                        onChange={(e) => setArgsText(e.target.value)}
                        placeholder="可选参数"
                        className="h-8 font-mono text-[11.5px]"
                      />
                    </div>
                  </div>
                  <label
                    {...hintProps("通过系统 Shell 执行，支持管道与系统内建命令")}
                    className="flex items-center gap-2 text-[11.5px] text-muted-foreground cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={useShell}
                      onChange={(e) => setUseShell(e.target.checked)}
                      className="rounded border-border"
                    />
                    <span>通过系统 Shell 执行</span>
                  </label>
                </div>
              )}

              {kind === "http" && (
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2">
                    <CustomSelect
                      value={httpMethod}
                      options={HTTP_METHOD_OPTIONS}
                      onChange={(val) =>
                        setHttpMethod(
                          val as "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
                        )
                      }
                      className="h-8 w-[92px] shrink-0 font-mono text-xs font-semibold"
                      ariaLabel="HTTP 请求方法"
                    />
                    <Input
                      value={httpUrl}
                      onChange={(e) => setHttpUrl(e.target.value)}
                      placeholder="https://api.example.com/status"
                      className="h-8 flex-1 font-mono text-[11.5px]"
                    />
                  </div>

                  <div
                    {...hintProps(
                      "可选，如 data.items 或 result[0]；留空直接解析整个响应体"
                    )}
                  >
                    <label className="mb-1 block text-[11px] text-muted-foreground">
                      JSONPath 数据提取
                    </label>
                    <Input
                      value={jsonPath}
                      onChange={(e) => setJsonPath(e.target.value)}
                      placeholder="例如：data.items"
                      className="h-8 font-mono text-[11.5px]"
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
                          className="h-7 flex-1 font-mono text-[11px]"
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
                          className="h-7 flex-1 font-mono text-[11px]"
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
                        heightClass="h-24"
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
            </div>

            {/* 4. Automation Schedule (Flat Section) */}
            <div className="space-y-2.5 border-t border-border/50 pt-3.5">
              {kind === "push" ? (
                <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                  <Radio className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>
                    外部推送模式由外部脚本 / 系统计划任务主动 POST 至接收地址，零后台轮询开销。
                  </span>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-semibold text-foreground">
                      <Clock className="h-3.5 w-3.5 text-primary" />
                      定时调度
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
                          className={`rounded-md px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
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
                        className="h-7 w-20 text-xs"
                      />
                      <CustomSelect
                        value={intervalUnit}
                        options={INTERVAL_UNIT_OPTIONS}
                        onChange={(val) =>
                          setIntervalUnit(val as "sec" | "min" | "hour")
                        }
                        className="h-7 min-w-[132px] text-xs"
                        ariaLabel="时间单位"
                      />
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
                          className="h-7 flex-1 font-mono text-xs"
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
                </>
              )}
            </div>

            {/* 5. Collapsible Advanced Options (Flat) */}
            <div className="border-t border-border/50 pt-3">
              <button
                type="button"
                {...hintProps(
                  "配置自定义解释器、命令行参数、超时、工作目录、自定义参数与环境变量"
                )}
                onClick={() => setShowAdvanced((s) => !s)}
                className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
              >
                {showAdvanced ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                <span>高级选项</span>
                {hasAdvancedOverrides && (
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                )}
              </button>

              {showAdvanced && (
                <div className="mt-3 space-y-3 pl-1">
                  {(kind === "script" ||
                    (kind === "control" &&
                      controlActionKind === "script")) && (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div
                        {...hintProps(
                          "可选，例如指定虚拟环境 python.exe；留空自动识别"
                        )}
                      >
                        <label className="mb-1 block text-[11px] text-muted-foreground">
                          自定义解释器
                        </label>
                        <Input
                          value={interpreter}
                          onChange={(e) => setInterpreter(e.target.value)}
                          placeholder="留空自动识别"
                          className="h-7 font-mono text-[11px]"
                        />
                      </div>
                      <div {...hintProps("多个参数以空格分隔，例如 --mode fast")}>
                        <label className="mb-1 block text-[11px] text-muted-foreground">
                          命令行参数
                        </label>
                        <Input
                          value={argsText}
                          onChange={(e) => setArgsText(e.target.value)}
                          placeholder="--mode fast"
                          className="h-7 font-mono text-[11px]"
                        />
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div {...hintProps("单次执行最大等待时长，范围 2–300 秒")}>
                      <label className="mb-1 block text-[11px] text-muted-foreground">
                        执行超时（秒）
                      </label>
                      <Input
                        type="number"
                        min={2}
                        max={300}
                        value={timeoutSec}
                        onChange={(e) => setTimeoutSec(Number(e.target.value))}
                        className="h-7 text-xs"
                      />
                    </div>
                    <div className="flex items-end pb-1">
                      <label
                        {...hintProps("隐藏顶部标题栏，仅展示卡片内容")}
                        className="flex items-center gap-2 text-[11.5px] text-muted-foreground cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={hideHeader}
                          onChange={(e) => setHideHeader(e.target.checked)}
                        />
                        <span>隐藏卡片标题栏</span>
                      </label>
                    </div>
                  </div>

                  {(kind === "script" ||
                    (kind === "control" &&
                      controlActionKind === "script")) && (
                    <div {...hintProps("可选，留空默认使用 ShibaPlan/scripts 目录")}>
                      <label className="mb-1 block text-[11px] text-muted-foreground">
                        工作目录 (cwd)
                      </label>
                      <Input
                        value={cwd}
                        onChange={(e) => setCwd(e.target.value)}
                        placeholder="留空使用默认脚本目录"
                        className="h-7 font-mono text-[11px]"
                      />
                    </div>
                  )}

                  {/* Custom Params -> SHIBA_PARAM_* */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span
                        {...hintProps("自动注入为 SHIBA_PARAM_* 环境变量，供脚本读取")}
                        className="text-[11px] text-muted-foreground"
                      >
                        自定义参数
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
          )}

          {/* RIGHT: Flat Live Preview & Test Workbench */}
          <div className="flex min-h-0 flex-col border-t border-border bg-surface/20 lg:border-t-0 lg:border-l">
            {editorMode === "pro" && (
              /* Single Merged Top Control Bar */
              <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3.5 py-2">
                <div className="flex items-center gap-1">
                  {(
                    [
                      { id: "preview", label: "预览" },
                      { id: "stdout", label: "stdout" },
                      { id: "stderr", label: "stderr" },
                      { id: "spec", label: "协议" },
                    ] as const
                  ).map((tb) => (
                    <button
                      key={tb.id}
                      type="button"
                      onClick={() => setTestTab(tb.id)}
                      className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                        testTab === tb.id
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {tb.label}
                      {tb.id === "stderr" && testResult?.stderr?.trim() ? " •" : ""}
                    </button>
                  ))}
                  {testResult && (
                    <span className="ml-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {testResult.durationMs}ms · exit={testResult.exitCode}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
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
                    title="复制 AI 脚本生成规范提示词"
                    className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-primary hover:bg-primary/10"
                  >
                    {copiedPrompt ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <Sparkles className="h-3 w-3" />
                    )}
                    <span className="hidden sm:inline">
                      {copiedPrompt ? "已复制" : "AI 提示词"}
                    </span>
                  </button>

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
                      <span>{kind === "push" ? "模拟推送" : "测试运行"}</span>
                    </Button>
                  )}
                </div>
              </div>
            )}

            {editorMode === "pro" && kind === "push" && (
              <div
                {...hintProps("点击「模拟推送」将真实 POST 到本地接收端口")}
                className="border-b border-border/60 p-3 space-y-1"
              >
                <div className="text-[11px] font-medium text-muted-foreground">
                  模拟推送 JSON 数据
                </div>
                <CodeEditor
                  value={pushTestPayload}
                  onChange={setPushTestPayload}
                  language="json"
                  heightClass="h-24"
                />
              </div>
            )}

            {/* Validation Status Banner */}
            {editorMode === "pro" && parsedTest && (
              <div
                className={`flex items-center gap-1.5 border-b border-border/60 px-3.5 py-1.5 text-[11px] ${
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

            {/* Tab Content */}
            <div ref={previewStageRef} className="min-h-0 flex-1 overflow-y-auto p-4">
              {testRunning ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span>正在执行数据源...</span>
                </div>
            ) : editorMode === "simple" || testTab === "preview" ? (
                <div className="flex min-h-full w-full items-center justify-center py-2">
                  <div
                    style={{ width: scaledW, height: scaledH }}
                    onMouseEnter={() =>
                      setHoverHint("拖拽卡片边缘或右下角可调整默认尺寸")
                    }
                    onMouseLeave={() =>
                      setHoverHint((cur) =>
                        cur === "拖拽卡片边缘或右下角可调整默认尺寸" ? null : cur
                      )
                    }
                    className={`group/preview relative shrink-0 select-none rounded-xl ${
                      resizingPreview ? "ring-1 ring-primary/70" : ""
                    }`}
                  >
                    <div
                      style={{
                        width: pxW,
                        height: pxH,
                        transform:
                          previewScale < 1
                            ? `scale(${previewScale})`
                            : undefined,
                        transformOrigin: "top left",
                      }}
                      className="overflow-hidden rounded-xl"
                    >
                      {kind === "container" ? (
                        <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-border/80 bg-surface/40 shadow-card-rest">
                          {accentColor && (
                            <div
                              className="h-[2.5px] w-full shrink-0"
                              style={{ backgroundColor: accentColor }}
                            />
                          )}
                          {title.trim() && !hideHeader && (
                            <div className="flex h-8 shrink-0 items-center border-b border-border/60 bg-surface/55 px-3 text-xs font-semibold">
                              <span className="truncate">{title.trim()}</span>
                            </div>
                          )}
                          <div className="flex flex-1 items-center justify-center p-4 text-[11.5px] text-muted-foreground/60">
                            拖入卡片 / 开关 / 图标
                          </div>
                        </div>
                      ) : kind === "control" ? (
                        <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card-rest">
                          {accentColor && (
                            <div
                              className="h-[2.5px] w-full shrink-0"
                              style={{ backgroundColor: accentColor }}
                            />
                          )}
                          <div
                            className={`flex flex-1 items-center justify-center ${
                              controlLabelPosition === "right"
                                ? "flex-row gap-2.5 px-3"
                                : "flex-col gap-1.5 p-2"
                            }`}
                          >
                            {controlType === "switch" ? (
                              <button
                                type="button"
                                onClick={() => setControlState((s) => !s)}
                                className="flex shrink-0 items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-accent/55"
                              >
                                {controlIcon && (
                                  <span
                                    style={{
                                      color: controlState
                                        ? accentColor || "hsl(var(--primary))"
                                        : undefined,
                                    }}
                                    className={
                                      controlState
                                        ? ""
                                        : "text-muted-foreground"
                                    }
                                  >
                                    {renderControlIcon(controlIcon, "h-4 w-4")}
                                  </span>
                                )}
                                <span
                                  style={
                                    controlState && accentColor
                                      ? { backgroundColor: accentColor }
                                      : undefined
                                  }
                                  className={`relative inline-flex h-[22px] w-10 shrink-0 items-center rounded-full transition-colors ${
                                    controlState
                                      ? accentColor
                                        ? ""
                                        : "bg-primary"
                                      : "bg-muted-foreground/30"
                                  }`}
                                >
                                  <span
                                    className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                                      controlState
                                        ? "translate-x-5"
                                        : "translate-x-0.5"
                                    }`}
                                  />
                                </span>
                              </button>
                            ) : (
                              <div
                                style={
                                  accentColor ? { color: accentColor } : undefined
                                }
                                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-surface/65"
                              >
                                {renderControlIcon(controlIcon, "h-5 w-5")}
                              </div>
                            )}
                            {title.trim() && (
                              <span
                                className={`truncate text-[11px] font-medium text-muted-foreground ${
                                  controlLabelPosition === "right"
                                    ? "min-w-0 flex-1 text-left"
                                    : "max-w-full"
                                }`}
                              >
                                {title.trim()}
                              </span>
                            )}
                          </div>
                        </div>
                      ) : testResult && parsedTest ? (
                        <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card-rest">
                          {accentColor && (
                            <div
                              className="h-[2.5px] w-full shrink-0"
                              style={{ backgroundColor: accentColor }}
                            />
                          )}
                          {!hideHeader && (
                            <div className="flex shrink-0 items-center justify-between border-b border-border/60 bg-surface/55 px-3 py-2 text-xs font-semibold">
                              <span className="truncate">
                                {parsedTest.title ||
                                  title.trim() ||
                                  "测试预览卡片"}
                              </span>
                              {parsedTest.badge && (
                                <span className="rounded bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                                  {parsedTest.badge}
                                </span>
                              )}
                            </div>
                          )}
                          <div className="min-h-0 flex-1 overflow-y-auto">
                            <InfoContentRenderer
                              parsed={parsedTest}
                              onNotify={onNotify}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card-rest">
                          {accentColor && (
                            <div
                              className="h-[2.5px] w-full shrink-0"
                              style={{ backgroundColor: accentColor }}
                            />
                          )}
                          {!hideHeader && (
                            <div className="flex shrink-0 items-center justify-between border-b border-border/60 bg-surface/55 px-3 py-2 text-xs font-semibold">
                              <span className="truncate">
                                {title.trim() || "示例信息卡片"}
                              </span>
                              {sampleParsed.badge && (
                                <span className="rounded bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                                  {sampleParsed.badge}
                                </span>
                              )}
                            </div>
                          )}
                          <div className="min-h-0 flex-1 overflow-y-auto">
                            <InfoContentRenderer
                              parsed={sampleParsed}
                              onNotify={onNotify}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 5-Edge Drag Resize Handles */}
                    <div
                      onPointerDown={(e) => handleStartPreviewResize(e, "n")}
                      title="拖拽调整高度"
                      className="absolute left-3 right-3 -top-0.5 z-20 h-1.5 cursor-ns-resize rounded-full opacity-0 transition-opacity hover:bg-primary/45 group-hover/preview:opacity-100"
                    />
                    <div
                      onPointerDown={(e) => handleStartPreviewResize(e, "s")}
                      title="拖拽调整高度"
                      className="absolute -bottom-0.5 left-3 right-3 z-20 h-1.5 cursor-ns-resize rounded-full opacity-0 transition-opacity hover:bg-primary/45 group-hover/preview:opacity-100"
                    />
                    <div
                      onPointerDown={(e) => handleStartPreviewResize(e, "w")}
                      title="拖拽调整宽度"
                      className="absolute -left-0.5 bottom-3 top-3 z-20 w-1.5 cursor-ew-resize rounded-full opacity-0 transition-opacity hover:bg-primary/45 group-hover/preview:opacity-100"
                    />
                    <div
                      onPointerDown={(e) => handleStartPreviewResize(e, "e")}
                      title="拖拽调整宽度"
                      className="absolute -right-0.5 bottom-3 top-3 z-20 w-1.5 cursor-ew-resize rounded-full opacity-0 transition-opacity hover:bg-primary/45 group-hover/preview:opacity-100"
                    />
                    <div
                      onPointerDown={(e) => handleStartPreviewResize(e, "se")}
                      title="拖拽调整卡片尺寸"
                      className="absolute bottom-0.5 right-0.5 z-20 flex h-3.5 w-3.5 cursor-nwse-resize items-end justify-end p-0.5 opacity-45 transition-opacity group-hover/preview:opacity-100"
                    >
                      <span className="block h-2 w-2 rounded-br-[3px] border-b-2 border-r-2 border-muted-foreground/70" />
                    </div>

                    {/* Floating Live Size Pill */}
                    <div
                      className={`pointer-events-none absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-border/70 bg-popover/95 px-2 py-0.5 font-mono text-[10px] text-muted-foreground shadow-sm transition-opacity ${
                        resizingPreview
                          ? "border-primary/50 text-foreground opacity-100"
                          : "opacity-0 group-hover/preview:opacity-100"
                      }`}
                    >
                      {pxW} × {pxH}
                      {previewScale < 1
                        ? ` · ${Math.round(previewScale * 100)}%`
                        : ""}
                    </div>
                  </div>
                </div>
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

        {/* Footer Bar */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-surface/40 px-5 py-2.5">
          <div
            title={hoverHint ?? undefined}
            className={`min-w-0 flex-1 truncate text-[11px] transition-colors ${
              scheduleMode === "cron" && !cronValidation.valid
                ? "text-rose-500"
                : hoverHint
                  ? "text-foreground/85"
                  : "text-muted-foreground"
            }`}
          >
            {scheduleMode === "cron" && !cronValidation.valid
              ? `请修正 Cron 表达式：${cronValidation.error}`
              : hoverHint
                ? hoverHint
                : editorMode === "simple"
                  ? "悬停选项查看说明，拖拽右侧预览边缘调整尺寸"
                  : "悬停选项查看说明，支持 shibaplan-info/v1 协议"}
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
            {kind === "push" ||
            kind === "container" ||
            (kind === "control" &&
              !(
                (controlActionKind === "script" &&
                  Boolean(scriptPath.trim() || inlineCode.trim())) ||
                (controlActionKind === "command" && Boolean(command.trim()))
              )) ? (
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
