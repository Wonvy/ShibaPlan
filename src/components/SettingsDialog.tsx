import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  BookOpen,
  Bot,
  Check,
  Copy,
  DatabaseBackup,
  Download,
  Eye,
  EyeOff,
  FolderArchive,
  FolderOpen,
  FolderSearch,
  Info,
  Languages,
  Loader2,
  Moon,
  Palette,
  Plus,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Search,
  Sparkles,
  Sun,
  Trash2,
  Upload,
} from "lucide-react";
import { ProjectArchiveDir, ThemeMode, WorkspaceData } from "../types";
import {
  AI_PROVIDER_PRESETS,
  fetchAvailableModels,
  testAIConnection,
} from "../lib/ai";
import { pickArchiveFolder } from "../lib/archive";
import { ACCENT_COLOR_PRESETS, normalizeHex } from "../lib/theme";
import {
  clearAppLogs,
  getLogFilePath,
  readAppLogs,
} from "../lib/logger";
import { isTauriRuntime, openPathInOs, uid } from "../lib/storage";
import { UpdateCheckResult } from "../lib/updater";
import { useI18n } from "../lib/i18n";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Separator } from "./ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";

export type SettingsTabId =
  | "appearance"
  | "projects"
  | "ai"
  | "data"
  | "logs"
  | "about";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: SettingsTabId;
  workspace: WorkspaceData;
  onUpdate: (next: WorkspaceData) => void;
  defaultDir: string;
  appVersion: string;
  updateInfo: UpdateCheckResult | null;
  checkingUpdate: boolean;
  onCheckUpdate: () => void;
  onOpenUpdateDialog: () => void;
  onExportBackup: () => void;
  onImportBackup: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onNotify: (msg: string) => void;
}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({
  open,
  onOpenChange,
  initialTab = "appearance",
  workspace,
  onUpdate,
  defaultDir,
  appVersion,
  updateInfo,
  checkingUpdate,
  onCheckUpdate,
  onOpenUpdateDialog,
  onExportBackup,
  onImportBackup,
  onNotify,
}) => {
  const {
    t,
    locale,
    setLocale,
    availableLocales,
    exportCurrentLocale,
    importLocaleFile,
    removeCustomLocale,
  } = useI18n();

  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab);

  // Appearance state
  const currentTheme: ThemeMode = workspace.settings.theme || "dark";
  const paperGrain = workspace.settings.paperGrain ?? true;
  const currentAccent = workspace.settings.accentColor || "";
  const [hexInput, setHexInput] = useState(currentAccent || "#f59e0b");

  // AI form state
  const [aiBaseUrl, setAiBaseUrl] = useState(
    workspace.settings.ai?.baseUrl ?? "https://open.bigmodel.cn/api/paas/v4"
  );
  const [aiApiKey, setAiApiKey] = useState(workspace.settings.ai?.apiKey ?? "");
  const [aiModel, setAiModel] = useState(
    workspace.settings.ai?.model ?? "glm-4-flash"
  );
  const [showApiKey, setShowApiKey] = useState(false);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiTestMsg, setAiTestMsg] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [aiSaved, setAiSaved] = useState(false);

  // Auto-fetched models state
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [modelSearch, setModelSearch] = useState("");
  const [modelFetchError, setModelFetchError] = useState<string | null>(null);

  // Data & Language state
  const [dirInput, setDirInput] = useState(workspace.settings.customDataDir);
  const [dirSaved, setDirSaved] = useState(false);
  const [langNotice, setLangNotice] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);

  // Project Archive Folders state
  const archiveDirs = workspace.settings.projectArchiveDirs ?? [];
  const [newProjectDir, setNewProjectDir] = useState("");
  const [newProjectLabel, setNewProjectLabel] = useState("");

  const getArchiveFolderLabel = (dir: ProjectArchiveDir) => {
    if (dir.label?.trim()) return dir.label.trim();
    const clean = dir.path.replace(/[\\/]+$/, "");
    const parts = clean.split(/[\\/]/);
    return parts[parts.length - 1] || clean;
  };

  const addProjectArchiveDir = (rawPath: string, alias?: string) => {
    const cleanPath = rawPath.trim().replace(/^"|"$/g, "");
    if (!cleanPath) return;
    if (
      archiveDirs.some(
        (d) => d.path.trim().toLowerCase() === cleanPath.toLowerCase()
      )
    ) {
      onNotify("该文件夹已在项目索引列表中");
      return;
    }
    const nextDir: ProjectArchiveDir = {
      id: uid("arch"),
      path: cleanPath,
      label: alias?.trim() || undefined,
      enabled: true,
    };
    onUpdate({
      ...workspace,
      settings: {
        ...workspace.settings,
        projectArchiveDirs: [...archiveDirs, nextDir],
      },
    });
    setNewProjectDir("");
    setNewProjectLabel("");
    onNotify("已添加项目目录，将自动建立索引并缓存");
  };

  const handlePickProjectFolder = async () => {
    try {
      const picked = await pickArchiveFolder();
      if (picked) {
        addProjectArchiveDir(picked, newProjectLabel);
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "选择文件夹失败");
    }
  };

  const handleToggleProjectDir = (id: string) => {
    onUpdate({
      ...workspace,
      settings: {
        ...workspace.settings,
        projectArchiveDirs: archiveDirs.map((d) =>
          d.id === id ? { ...d, enabled: d.enabled === false } : d
        ),
      },
    });
  };

  const handleRemoveProjectDir = (id: string) => {
    onUpdate({
      ...workspace,
      settings: {
        ...workspace.settings,
        projectArchiveDirs: archiveDirs.filter((d) => d.id !== id),
      },
    });
  };

  // Logs tab state
  const [logText, setLogText] = useState("");
  const [logPath, setLogPath] = useState<string | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [errorsOnly, setErrorsOnly] = useState(false);

  const loadLogs = async () => {
    setLogLoading(true);
    try {
      const [content, path] = await Promise.all([
        readAppLogs(workspace.settings.customDataDir, 400),
        getLogFilePath(workspace.settings.customDataDir),
      ]);
      setLogText(content);
      setLogPath(path);
    } finally {
      setLogLoading(false);
    }
  };

  useEffect(() => {
    if (open && activeTab === "logs") {
      loadLogs();
    }
  }, [open, activeTab]);

  useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
    }
  }, [open, initialTab]);

  useEffect(() => {
    setDirInput(workspace.settings.customDataDir);
    setAiBaseUrl(
      workspace.settings.ai?.baseUrl ?? "https://open.bigmodel.cn/api/paas/v4"
    );
    setAiApiKey(workspace.settings.ai?.apiKey ?? "");
    setAiModel(workspace.settings.ai?.model ?? "glm-4-flash");
    setHexInput(workspace.settings.accentColor || "#f59e0b");
  }, [workspace.settings]);

  const setTheme = (theme: ThemeMode) => {
    onUpdate({
      ...workspace,
      settings: { ...workspace.settings, theme },
    });
  };

  const togglePaperGrain = () => {
    onUpdate({
      ...workspace,
      settings: { ...workspace.settings, paperGrain: !paperGrain },
    });
  };

  const setAccentColor = (hex: string) => {
    const clean = hex ? normalizeHex(hex) ?? "" : "";
    onUpdate({
      ...workspace,
      settings: { ...workspace.settings, accentColor: clean || undefined },
    });
    if (clean) setHexInput(clean);
  };

  const handleSaveAI = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdate({
      ...workspace,
      settings: {
        ...workspace.settings,
        ai: {
          baseUrl: aiBaseUrl.trim(),
          apiKey: aiApiKey.trim(),
          model: aiModel.trim(),
        },
      },
    });
    setAiSaved(true);
    onNotify("AI 配置已保存");
    setTimeout(() => setAiSaved(false), 1800);
  };

  const handleFetchModels = async () => {
    setFetchingModels(true);
    setModelFetchError(null);
    setAiTestMsg(null);
    try {
      const models = await fetchAvailableModels({
        baseUrl: aiBaseUrl,
        apiKey: aiApiKey,
      });
      setFetchedModels(models);
      setModelSearch("");
      if (models.length > 0 && !aiModel.trim()) {
        setAiModel(models[0]);
      }
      onNotify(`已获取 ${models.length} 个可用模型`);
    } catch (err) {
      setModelFetchError(
        err instanceof Error ? err.message : "自动获取模型失败"
      );
    } finally {
      setFetchingModels(false);
    }
  };

  const handleTestAI = async () => {
    setAiTesting(true);
    setAiTestMsg(null);
    try {
      await testAIConnection({
        baseUrl: aiBaseUrl,
        apiKey: aiApiKey,
        model: aiModel,
      });
      setAiTestMsg({ ok: true, text: "连接成功，接口可用" });
    } catch (err) {
      setAiTestMsg({
        ok: false,
        text: err instanceof Error ? err.message : "连接测试失败",
      });
    } finally {
      setAiTesting(false);
    }
  };

  const handleSaveDir = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdate({
      ...workspace,
      settings: {
        ...workspace.settings,
        customDataDir: dirInput.trim(),
      },
    });
    setDirSaved(true);
    onNotify("同步目录已保存");
    setTimeout(() => setDirSaved(false), 1800);
  };

  const handleImportLang = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const res = await importLocaleFile(file);
    setLangNotice({
      ok: res.ok,
      text: res.message,
    });
    e.target.value = "";
    setTimeout(() => setLangNotice(null), 3500);
  };

  const filteredModels = useMemo(() => {
    const q = modelSearch.trim().toLowerCase();
    if (!q) return fetchedModels;
    return fetchedModels.filter((m) => m.toLowerCase().includes(q));
  }, [fetchedModels, modelSearch]);

  const tabs: {
    id: SettingsTabId;
    label: string;
    icon: React.ReactNode;
    badge?: boolean;
  }[] = [
    {
      id: "appearance",
      label: "外观与主题",
      icon: <Palette className="h-3.5 w-3.5" />,
    },
    {
      id: "projects",
      label: "项目目录",
      icon: <FolderArchive className="h-3.5 w-3.5" />,
    },
    {
      id: "ai",
      label: "AI 模型",
      icon: <Bot className="h-3.5 w-3.5" />,
    },
    {
      id: "data",
      label: "语言与数据",
      icon: <DatabaseBackup className="h-3.5 w-3.5" />,
    },
    {
      id: "logs",
      label: "错误日志",
      icon: <ScrollText className="h-3.5 w-3.5" />,
    },
    {
      id: "about",
      label: "关于与更新",
      icon: <Info className="h-3.5 w-3.5" />,
      badge: Boolean(updateInfo?.hasUpdate),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden">
        <div className="flex flex-col sm:flex-row h-[540px] max-h-[84vh]">
          {/* Left Tab Navigation (Desktop) / Top Tab Strip (Mobile) */}
          <aside className="shrink-0 sm:w-44 bg-muted/40 p-3 sm:p-4 flex flex-col gap-3">
            <DialogHeader className="px-1.5 pt-0.5 text-left">
              <DialogTitle className="text-base font-semibold">
                {t("settings.title")}
              </DialogTitle>
            </DialogHeader>

            <nav className="flex sm:flex-col gap-1 overflow-x-auto no-scrollbar">
              {tabs.map((tab) => {
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`relative flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] transition-colors ${
                      active
                        ? "bg-primary text-primary-foreground font-medium shadow-sm"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    {tab.icon}
                    <span className="truncate">{tab.label}</span>
                    {tab.badge && (
                      <span
                        className={`ml-auto h-1.5 w-1.5 rounded-full ${
                          active ? "bg-primary-foreground" : "bg-primary"
                        }`}
                      />
                    )}
                  </button>
                );
              })}
            </nav>

            <div className="mt-auto hidden sm:block px-2 pt-2 text-xs font-mono text-muted-foreground/75">
              ShibaPlan v{appVersion}
            </div>
          </aside>

          {/* Right Scrollable Content Pane */}
          <div className="flex-1 overflow-y-auto p-5 sm:p-6">
            {/* TAB 1: APPEARANCE & CUSTOM ACCENT COLOR */}
            {activeTab === "appearance" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-[15px] font-semibold text-foreground">
                    外观与主题
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    切换背景风格、自定义全局强调色与纸张纹理
                  </p>
                </div>

                {/* Theme Mode */}
                <div className="space-y-2.5">
                  <div className="text-xs font-medium text-foreground">
                    {t("settings.themeLabel")}
                  </div>
                  <div className="grid grid-cols-3 gap-2.5">
                    {(
                      [
                        {
                          id: "dark",
                          icon: <Moon className="h-4 w-4" />,
                          desc: "深邃暗色",
                        },
                        {
                          id: "light",
                          icon: <Sun className="h-4 w-4" />,
                          desc: "极简浅白",
                        },
                        {
                          id: "paper",
                          icon: <BookOpen className="h-4 w-4" />,
                          desc: "温暖纸感",
                        },
                      ] as const
                    ).map((item) => {
                      const active = currentTheme === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setTheme(item.id)}
                          className={`flex flex-col items-start gap-1.5 rounded-xl p-3 text-left transition-all ${
                            active
                              ? "bg-primary text-primary-foreground shadow-sm"
                              : "bg-secondary/75 text-secondary-foreground hover:bg-accent"
                          }`}
                        >
                          <div className="flex w-full items-center justify-between">
                            {item.icon}
                            {active && <Check className="h-3.5 w-3.5" />}
                          </div>
                          <div className="text-xs font-medium">
                            {t(`theme.${item.id}`)}
                          </div>
                          <div
                            className={`text-xs ${
                              active
                                ? "text-primary-foreground/80"
                                : "text-muted-foreground"
                            }`}
                          >
                            {item.desc}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <Separator />

                {/* Custom Accent Color */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-medium text-foreground">
                        主题强调色
                      </div>
                      <div className="text-xs text-muted-foreground">
                        选择预设色板或自由拾取任意 HEX 颜色，实时生效
                      </div>
                    </div>
                    {currentAccent && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setAccentColor("")}
                        className="h-7 px-2 text-xs"
                      >
                        <RotateCcw className="h-3 w-3" />
                        恢复默认
                      </Button>
                    )}
                  </div>

                  {/* Curated Swatches */}
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {ACCENT_COLOR_PRESETS.map((preset) => {
                      const isSelected =
                        (preset.hex === "" && !currentAccent) ||
                        (preset.hex !== "" &&
                          currentAccent.toLowerCase() ===
                            preset.hex.toLowerCase());
                      const swatchColor = preset.hex || "#f59e0b";
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => setAccentColor(preset.hex)}
                          className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors ${
                            isSelected
                              ? "bg-accent text-foreground font-medium shadow-sm"
                              : "bg-muted/50 text-muted-foreground hover:bg-accent hover:text-foreground"
                          }`}
                        >
                          <span
                            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full shadow-inner"
                            style={{ backgroundColor: swatchColor }}
                          >
                            {isSelected && (
                              <Check className="h-2.5 w-2.5 text-white drop-shadow" />
                            )}
                          </span>
                          <span className="truncate">{preset.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Custom Color Picker + Hex Input */}
                  <div className="flex items-center gap-2.5 rounded-xl bg-muted/50 p-2.5">
                    <label
                      className="relative flex h-8 w-10 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg shadow-sm"
                      style={{
                        backgroundColor:
                          normalizeHex(hexInput) || currentAccent || "#f59e0b",
                      }}
                      title="点击拾取自定义颜色"
                    >
                      <input
                        type="color"
                        value={
                          normalizeHex(hexInput) || currentAccent || "#f59e0b"
                        }
                        onChange={(e) => {
                          setHexInput(e.target.value);
                          setAccentColor(e.target.value);
                        }}
                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                      />
                    </label>
                    <div className="flex-1">
                      <Input
                        type="text"
                        value={hexInput}
                        onChange={(e) => {
                          const v = e.target.value;
                          setHexInput(v);
                          const valid = normalizeHex(v);
                          if (valid) setAccentColor(valid);
                        }}
                        placeholder="#f59e0b"
                        className="h-8 font-mono text-xs"
                      />
                    </div>
                    <span className="hidden sm:inline text-xs text-muted-foreground pr-1">
                      自定义取色器
                    </span>
                  </div>
                </div>

                <Separator />

                {/* Tactile Fine Paper Grain Switch */}
                <div className="flex items-center justify-between rounded-xl bg-muted/50 px-3.5 py-3">
                  <div>
                    <div className="text-xs font-medium text-foreground">
                      细微纸张颗粒质感
                    </div>
                    <div className="text-xs text-muted-foreground">
                      在深色、浅色与纸张主题下叠加柔和哑光纤维颗粒
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={paperGrain}
                    onClick={togglePaperGrain}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                      paperGrain ? "bg-primary" : "bg-input"
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-background shadow transition-transform ${
                        paperGrain ? "translate-x-4" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
              </div>
            )}

            {/* TAB 2: PROJECT ARCHIVE FOLDERS */}
            {activeTab === "projects" && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-[15px] font-semibold text-foreground">
                    项目归档目录
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    支持添加多个过往项目文件夹，自动识别多种日期格式、提取缩略图并本地持久化缓存
                  </p>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    addProjectArchiveDir(newProjectDir, newProjectLabel);
                  }}
                  className="space-y-2.5"
                >
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      value={newProjectDir}
                      onChange={(e) => setNewProjectDir(e.target.value)}
                      placeholder="文件夹绝对路径，如 W:\#完成项目"
                      className="flex-1 font-mono"
                    />
                    {isTauriRuntime() && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={handlePickProjectFolder}
                        className="h-9 shrink-0 px-3"
                      >
                        <FolderSearch className="h-3.5 w-3.5" />
                        选择文件夹
                      </Button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      value={newProjectLabel}
                      onChange={(e) => setNewProjectLabel(e.target.value)}
                      placeholder="显示别名（可选，如：完成项目库）"
                      className="flex-1"
                    />
                    <Button type="submit" size="sm" className="h-9 shrink-0 px-3.5">
                      <Plus className="h-3.5 w-3.5" />
                      添加目录
                    </Button>
                  </div>
                </form>

                <Separator />

                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">
                      已添加的文件夹 ({archiveDirs.length})
                    </span>
                    <span className="text-muted-foreground">
                      支持单独启用或停用
                    </span>
                  </div>

                  {archiveDirs.length === 0 ? (
                    <div className="rounded-xl bg-muted/50 px-4 py-8 text-center text-xs text-muted-foreground space-y-2">
                      <div>暂未添加任何项目归档文件夹</div>
                      <div>
                        点击上方“选择文件夹”或粘贴本地路径，即可自动建立 Everything 级索引
                      </div>
                    </div>
                  ) : (
                    <div className="max-h-60 space-y-2 overflow-y-auto pr-0.5">
                      {archiveDirs.map((dir) => {
                        const enabled = dir.enabled !== false;
                        return (
                          <div
                            key={dir.id}
                            className="flex items-center justify-between gap-2.5 rounded-xl bg-muted/50 px-3 py-2.5"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[13px] font-medium text-foreground">
                                {getArchiveFolderLabel(dir)}
                              </div>
                              <div className="truncate font-mono text-xs text-muted-foreground">
                                {dir.path}
                              </div>
                            </div>

                            <button
                              type="button"
                              role="switch"
                              aria-checked={enabled}
                              onClick={() => handleToggleProjectDir(dir.id)}
                              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                                enabled ? "bg-primary" : "bg-input"
                              }`}
                              title={enabled ? "点击停用此目录" : "点击启用此目录"}
                            >
                              <span
                                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-background shadow transition-transform ${
                                  enabled ? "translate-x-4" : "translate-x-1"
                                }`}
                              />
                            </button>

                            <button
                              type="button"
                              onClick={() => handleRemoveProjectDir(dir.id)}
                              className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-destructive/12 hover:text-destructive"
                              title="移除目录"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: AI & AUTO-FETCH MODELS */}
            {activeTab === "ai" && (
              <form onSubmit={handleSaveAI} className="space-y-5">
                <div>
                  <h3 className="text-[15px] font-semibold text-foreground">
                    AI 平台与模型配置
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    支持 OpenAI 兼容协议，支持一键获取服务端可用模型列表
                  </p>
                </div>

                {/* Provider Presets */}
                <div className="space-y-2">
                  <div className="text-xs font-medium text-foreground">
                    快速选择平台
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {AI_PROVIDER_PRESETS.map((preset) => {
                      const isSelected =
                        aiBaseUrl.trim().replace(/\/+$/, "") === preset.baseUrl;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
                            setAiBaseUrl(preset.baseUrl);
                            setAiModel(preset.defaultModel);
                            setFetchedModels([]);
                            setModelFetchError(null);
                            setAiTestMsg(null);
                          }}
                          className={`rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                            isSelected
                              ? "bg-primary text-primary-foreground font-medium shadow-sm"
                              : "bg-secondary text-secondary-foreground hover:bg-accent"
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Base URL & API Key */}
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      API Base URL
                    </label>
                    <Input
                      type="text"
                      value={aiBaseUrl}
                      onChange={(e) => setAiBaseUrl(e.target.value)}
                      placeholder="https://open.bigmodel.cn/api/paas/v4"
                      className="font-mono text-xs"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      API Key（本地 Ollama 可留空）
                    </label>
                    <div className="relative">
                      <Input
                        type={showApiKey ? "text" : "password"}
                        value={aiApiKey}
                        onChange={(e) => setAiApiKey(e.target.value)}
                        placeholder="sk-..."
                        className="pr-9 font-mono text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey((v) => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        title={showApiKey ? "隐藏 Key" : "显示 Key"}
                      >
                        {showApiKey ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Model Input + Auto Fetch Models */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-muted-foreground">
                        模型名称
                      </label>
                      {fetchedModels.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          已加载 {fetchedModels.length} 个模型
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <Input
                        type="text"
                        value={aiModel}
                        onChange={(e) => setAiModel(e.target.value)}
                        placeholder="glm-4-flash"
                        className="flex-1 font-mono text-xs"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={fetchingModels}
                        onClick={handleFetchModels}
                        className="h-9 shrink-0 px-3"
                      >
                        {fetchingModels ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        {fetchingModels ? "获取中..." : "自动获取"}
                      </Button>
                    </div>

                    {modelFetchError && (
                      <div className="rounded-lg bg-destructive/12 px-3 py-2 text-xs text-destructive">
                        {modelFetchError}
                      </div>
                    )}

                    {/* Fetched Model Picker */}
                    {fetchedModels.length > 0 && (
                      <div className="rounded-xl bg-muted/50 p-2.5 space-y-2">
                        {fetchedModels.length > 6 && (
                          <div className="relative">
                            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              type="text"
                              value={modelSearch}
                              onChange={(e) => setModelSearch(e.target.value)}
                              placeholder="筛选模型名称..."
                              className="h-7 pl-7 text-xs"
                            />
                          </div>
                        )}
                        <div className="max-h-36 overflow-y-auto flex flex-wrap gap-1.5 pr-0.5">
                          {filteredModels.length === 0 ? (
                            <span className="py-2 text-xs text-muted-foreground">
                              没有匹配的模型
                            </span>
                          ) : (
                            filteredModels.map((modelId) => {
                              const active = aiModel.trim() === modelId;
                              return (
                                <button
                                  key={modelId}
                                  type="button"
                                  onClick={() => setAiModel(modelId)}
                                  className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-xs transition-colors ${
                                    active
                                      ? "bg-primary text-primary-foreground font-medium"
                                      : "bg-card text-foreground/85 hover:bg-accent"
                                  }`}
                                >
                                  {active && <Check className="h-2.5 w-2.5" />}
                                  <span>{modelId}</span>
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Test & Save Actions */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={aiTesting}
                      onClick={handleTestAI}
                    >
                      {aiTesting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                      {aiTesting ? "测试中..." : "测试连接"}
                    </Button>
                    {aiTestMsg && (
                      <span
                        className={`truncate text-xs ${
                          aiTestMsg.ok ? "text-emerald-500" : "text-destructive"
                        }`}
                      >
                        {aiTestMsg.text}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {aiSaved && (
                      <span className="flex items-center gap-1 text-xs text-emerald-500">
                        <Check className="h-3.5 w-3.5" />
                        {t("common.saved")}
                      </span>
                    )}
                    <Button type="submit" size="sm">
                      {t("common.save")}
                    </Button>
                  </div>
                </div>
              </form>
            )}

            {/* TAB 3: LANGUAGE & DATA */}
            {activeTab === "data" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-[15px] font-semibold text-foreground">
                    语言与本地数据
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    管理多语言包、自定义本地同步目录以及整库备份恢复
                  </p>
                </div>

                {/* Language Section */}
                <div className="space-y-3">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <Languages className="h-3.5 w-3.5 text-primary" />
                    <span>{t("settings.languageLabel")}</span>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {availableLocales.map((item) => (
                      <div
                        key={item.code}
                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs transition ${
                          locale === item.code
                            ? "bg-primary text-primary-foreground font-medium shadow-sm"
                            : "bg-secondary text-secondary-foreground hover:bg-accent"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setLocale(item.code)}
                        >
                          {item.name}
                        </button>
                        {!item.builtin && (
                          <button
                            type="button"
                            onClick={() => removeCustomLocale(item.code)}
                            className="ml-1 opacity-70 hover:opacity-100"
                            title={t("common.delete")}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={exportCurrentLocale}
                    >
                      <Download className="h-3.5 w-3.5" />
                      {t("settings.exportLang")}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="h-3.5 w-3.5" />
                      {t("settings.importLang")}
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json,application/json"
                      onChange={handleImportLang}
                      className="hidden"
                    />
                  </div>

                  {langNotice && (
                    <div
                      className={`rounded-lg px-3 py-2 text-xs ${
                        langNotice.ok
                          ? "bg-emerald-500/12 text-emerald-500"
                          : "bg-destructive/12 text-destructive"
                      }`}
                    >
                      {langNotice.text}
                    </div>
                  )}
                </div>

                <Separator />

                {/* Sync Directory */}
                <form onSubmit={handleSaveDir} className="space-y-2.5">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <FolderOpen className="h-3.5 w-3.5 text-primary" />
                    {t("settings.syncDirLabel")}
                  </label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      value={dirInput}
                      onChange={(e) => setDirInput(e.target.value)}
                      placeholder={defaultDir}
                      className="flex-1 font-mono text-xs"
                    />
                    <Button type="submit" size="sm" className="h-9 shrink-0">
                      {dirSaved ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        t("common.save")
                      )}
                    </Button>
                  </div>
                </form>

                <Separator />

                {/* Full Workspace Backup */}
                <div className="space-y-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <DatabaseBackup className="h-3.5 w-3.5 text-primary" />
                    <span>数据整库备份与恢复</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={onExportBackup}
                    >
                      <Download className="h-3.5 w-3.5" />
                      导出完整备份 (.json)
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => backupInputRef.current?.click()}
                    >
                      <Upload className="h-3.5 w-3.5" />
                      从备份恢复
                    </Button>
                    <input
                      ref={backupInputRef}
                      type="file"
                      accept=".json,application/json"
                      onChange={onImportBackup}
                      className="hidden"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: ERROR & DIAGNOSTIC LOGS */}
            {activeTab === "logs" && (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-[15px] font-semibold text-foreground">
                      运行与错误日志
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      自动记录前端异常、未捕获 Promise 错误与 Rust 崩溃信息
                    </p>
                  </div>
                  <div className="flex items-center rounded-lg bg-muted/70 p-0.5">
                    <button
                      type="button"
                      onClick={() => setErrorsOnly(false)}
                      className={`rounded-md px-2 py-0.5 text-xs transition-colors ${
                        !errorsOnly
                          ? "bg-card text-foreground font-medium shadow-card-rest"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      全部
                    </button>
                    <button
                      type="button"
                      onClick={() => setErrorsOnly(true)}
                      className={`rounded-md px-2 py-0.5 text-xs transition-colors ${
                        errorsOnly
                          ? "bg-card text-foreground font-medium shadow-card-rest"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      仅错误
                    </button>
                  </div>
                </div>

                {logPath && (
                  <div className="flex items-center justify-between gap-2 rounded-xl bg-muted/50 px-3 py-2 text-xs">
                    <span className="truncate font-mono text-muted-foreground select-text">
                      {logPath}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const dir = logPath.replace(/[\\/][^\\/]+$/, "");
                        openPathInOs(dir).catch(() => {});
                      }}
                      className="shrink-0 inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground hover:bg-accent"
                    >
                      <FolderOpen className="h-3 w-3" />
                      打开目录
                    </button>
                  </div>
                )}

                <div className="h-64 overflow-y-auto rounded-xl bg-muted/50 p-3 font-mono text-xs leading-relaxed text-foreground/85 select-text">
                  {logLoading ? (
                    <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      加载日志中...
                    </div>
                  ) : (
                    (() => {
                      const lines = logText
                        .split("\n")
                        .filter((l) => l.trim().length > 0);
                      const filtered = errorsOnly
                        ? lines.filter(
                            (l) => l.includes("[ERROR]") || l.startsWith("  ")
                          )
                        : lines;
                      if (filtered.length === 0) {
                        return (
                          <div className="flex h-full items-center justify-center text-muted-foreground">
                            {errorsOnly ? "暂无错误日志" : "暂无日志记录"}
                          </div>
                        );
                      }
                      return (
                        <pre className="whitespace-pre-wrap break-all">
                          {filtered.join("\n")}
                        </pre>
                      );
                    })()
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={logLoading}
                      onClick={loadLogs}
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${
                          logLoading ? "animate-spin" : ""
                        }`}
                      />
                      刷新
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={!logText}
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(logText);
                          onNotify("已复制日志内容");
                        } catch {
                          onNotify("复制失败");
                        }
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      复制日志
                    </Button>
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!logText}
                    onClick={async () => {
                      await clearAppLogs(workspace.settings.customDataDir);
                      setLogText("");
                      onNotify("日志已清空");
                    }}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    清空日志
                  </Button>
                </div>
              </div>
            )}

            {/* TAB 5: ABOUT & UPDATES */}
            {activeTab === "about" && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-[15px] font-semibold text-foreground">
                    关于与在线更新
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    ShibaPlan 桌面端与局域网跨端工作台
                  </p>
                </div>

                <div className="rounded-xl bg-muted/50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-foreground">
                        ShibaPlan
                      </div>
                      <div className="text-xs font-mono text-muted-foreground">
                        当前版本 v{appVersion}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={checkingUpdate}
                      onClick={onCheckUpdate}
                    >
                      {checkingUpdate ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      {checkingUpdate ? "检查中..." : "检查更新"}
                    </Button>
                  </div>

                  {updateInfo?.hasUpdate ? (
                    <div className="flex items-center justify-between rounded-lg bg-primary/12 px-3 py-2 text-xs">
                      <span className="font-medium text-primary">
                        发现新版本 v{updateInfo.latestVersion}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 px-2.5 text-xs"
                        onClick={() => {
                          onOpenChange(false);
                          onOpenUpdateDialog();
                        }}
                      >
                        <ArrowDownToLine className="h-3 w-3" />
                        查看更新详情
                      </Button>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      已连接 GitHub Releases，支持一键检测最新版本与下载安装包。
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
