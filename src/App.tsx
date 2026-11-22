import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Bot,
  CalendarDays,
  Check,
  DatabaseBackup,
  Download,
  FolderOpen,
  Kanban,
  Languages,
  Layers,
  Loader2,
  Moon,
  Palette,
  Redo2,
  Search,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import { ThemeMode, WorkspaceData } from "./types";
import {
  createDefaultWorkspace,
  getDefaultDataDir,
  isTauriRuntime,
  loadWorkspace,
  openCaptureWindow,
  saveWorkspace,
} from "./lib/storage";
import { suggestTodayPlanWithAI } from "./lib/ai";
import { CustomLocalePack, I18nProvider, useI18n } from "./lib/i18n";
import { QuickCapture } from "./components/QuickCapture";
import { KanbanBoard } from "./components/KanbanBoard";
import { CalendarView } from "./components/CalendarView";
import { IdeaRiver } from "./components/IdeaRiver";
import { CommandPalette } from "./components/CommandPalette";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Separator } from "./components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";

type TopView = "kanban" | "calendar";

const MAX_HISTORY = 30;

export const App: React.FC = () => {
  const isCaptureWindow =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("window") === "capture";

  if (isCaptureWindow) {
    return <QuickCapture />;
  }

  return <WorkspaceShell />;
};

const WorkspaceShell: React.FC = () => {
  const [workspace, setWorkspace] = useState<WorkspaceData>(
    createDefaultWorkspace()
  );
  const [loaded, setLoaded] = useState(false);

  // Undo / Redo snapshot stacks (up to 30 steps)
  const undoStackRef = useRef<WorkspaceData[]>([]);
  const redoStackRef = useRef<WorkspaceData[]>([]);
  const [historyMeta, setHistoryMeta] = useState({
    canUndo: false,
    canRedo: false,
  });
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const notify = useCallback((msg: string) => {
    setStatusNotice(msg);
    setTimeout(() => {
      setStatusNotice((prev) => (prev === msg ? null : prev));
    }, 2600);
  }, []);

  const syncHistoryMeta = () => {
    setHistoryMeta({
      canUndo: undoStackRef.current.length > 0,
      canRedo: redoStackRef.current.length > 0,
    });
  };

  useEffect(() => {
    loadWorkspace().then((data) => {
      setWorkspace(data);
      setLoaded(true);
    });

    let unlisten: (() => void) | undefined;
    if (isTauriRuntime()) {
      import("@tauri-apps/api/event").then(({ listen }) => {
        listen<string>("workspace-updated", (event) => {
          try {
            const parsed = JSON.parse(event.payload) as WorkspaceData;
            setWorkspace(parsed);
          } catch {
            // ignore
          }
        }).then((fn) => {
          unlisten = fn;
        });
      });
    }

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleUpdate = useCallback((next: WorkspaceData) => {
    setWorkspace((prev) => {
      undoStackRef.current = [...undoStackRef.current.slice(-(MAX_HISTORY - 1)), prev];
      redoStackRef.current = [];
      syncHistoryMeta();
      return next;
    });
    saveWorkspace(next).catch((err) =>
      console.error("Failed to save workspace:", err)
    );
  }, []);

  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const prevSnapshot = undoStackRef.current.pop()!;
    setWorkspace((current) => {
      redoStackRef.current.push(current);
      syncHistoryMeta();
      saveWorkspace(prevSnapshot).catch(() => {});
      return prevSnapshot;
    });
    notify("已撤销上一步操作");
  }, [notify]);

  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const nextSnapshot = redoStackRef.current.pop()!;
    setWorkspace((current) => {
      undoStackRef.current.push(current);
      syncHistoryMeta();
      saveWorkspace(nextSnapshot).catch(() => {});
      return nextSnapshot;
    });
    notify("已重做操作");
  }, [notify]);

  const handleChangeLocale = (code: string) => {
    handleUpdate({
      ...workspace,
      settings: {
        ...workspace.settings,
        locale: code,
      },
    });
  };

  const handleChangeCustomLocales = (
    packs: CustomLocalePack[],
    switchTo?: string
  ) => {
    handleUpdate({
      ...workspace,
      settings: {
        ...workspace.settings,
        customLocales: packs,
        locale: switchTo ?? workspace.settings.locale,
      },
    });
  };

  return (
    <I18nProvider
      locale={workspace.settings.locale || "zh-CN"}
      customLocales={workspace.settings.customLocales || []}
      onChangeLocale={handleChangeLocale}
      onChangeCustomLocales={handleChangeCustomLocales}
    >
      <MainWorkspace
        workspace={workspace}
        loaded={loaded}
        onUpdate={handleUpdate}
        canUndo={historyMeta.canUndo}
        canRedo={historyMeta.canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
        statusNotice={statusNotice}
        onNotify={notify}
      />
    </I18nProvider>
  );
};

interface MainWorkspaceProps {
  workspace: WorkspaceData;
  loaded: boolean;
  onUpdate: (next: WorkspaceData) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  statusNotice: string | null;
  onNotify: (msg: string) => void;
}

const MainWorkspace: React.FC<MainWorkspaceProps> = ({
  workspace,
  loaded,
  onUpdate,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  statusNotice,
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

  const [view, setView] = useState<TopView>("kanban");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);

  // AI Today Plan Dialog state
  const [aiPlanOpen, setAiPlanOpen] = useState(false);
  const [aiPlanLoading, setAiPlanLoading] = useState(false);
  const [aiPlanResult, setAiPlanResult] = useState<string>("");
  const [aiPlanError, setAiPlanError] = useState<string | null>(null);

  // Settings form states
  const [defaultDir, setDefaultDir] = useState("");
  const [dirInput, setDirInput] = useState(workspace.settings.customDataDir);
  const [aiBaseUrl, setAiBaseUrl] = useState(
    workspace.settings.ai?.baseUrl ?? "https://api.openai.com/v1"
  );
  const [aiApiKey, setAiApiKey] = useState(workspace.settings.ai?.apiKey ?? "");
  const [aiModel, setAiModel] = useState(
    workspace.settings.ai?.model ?? "gpt-4o-mini"
  );
  const [dirSaved, setDirSaved] = useState(false);
  const [langNotice, setLangNotice] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const theme = workspace.settings.theme || "dark";
    const grain = workspace.settings.paperGrain ?? true;
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.setAttribute("data-grain", grain ? "on" : "off");
  }, [workspace.settings.theme, workspace.settings.paperGrain]);

  useEffect(() => {
    getDefaultDataDir().then(setDefaultDir);
  }, []);

  useEffect(() => {
    setDirInput(workspace.settings.customDataDir);
    setAiBaseUrl(workspace.settings.ai?.baseUrl ?? "https://api.openai.com/v1");
    setAiApiKey(workspace.settings.ai?.apiKey ?? "");
    setAiModel(workspace.settings.ai?.model ?? "gpt-4o-mini");
  }, [workspace.settings]);

  // Global shortcuts: Ctrl+K (Command Palette), Ctrl+Z / Ctrl+Shift+Z (Undo / Redo)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen((o) => !o);
        return;
      }

      const active = document.activeElement;
      const inInput =
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          (active as HTMLElement).isContentEditable);
      if (inInput) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          onRedo();
        } else {
          onUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        onRedo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onUndo, onRedo]);

  const handleOpenAiPlan = async () => {
    setAiPlanOpen(true);
    setAiPlanError(null);
    setAiPlanLoading(true);
    try {
      const cfg = workspace.settings.ai ?? {
        baseUrl: "https://api.openai.com/v1",
        apiKey: "",
        model: "gpt-4o-mini",
      };
      const result = await suggestTodayPlanWithAI(
        workspace.tasks,
        workspace.columns,
        cfg
      );
      setAiPlanResult(result);
    } catch (err) {
      setAiPlanError(err instanceof Error ? err.message : "请求 AI 失败");
    } finally {
      setAiPlanLoading(false);
    }
  };

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdate({
      ...workspace,
      settings: {
        ...workspace.settings,
        customDataDir: dirInput.trim(),
        ai: {
          baseUrl: aiBaseUrl.trim(),
          apiKey: aiApiKey.trim(),
          model: aiModel.trim(),
        },
      },
    });
    setDirSaved(true);
    setTimeout(() => setDirSaved(false), 1800);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const res = await importLocaleFile(file);
    setLangNotice({ ok: res.ok, text: res.message });
    setTimeout(() => setLangNotice(null), 3200);
    e.target.value = "";
  };

  const handleExportWorkspaceBackup = () => {
    const blob = new Blob([JSON.stringify(workspace, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `shibaplan-backup-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onNotify("已导出完整工作区备份");
  };

  const handleImportWorkspaceBackup = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<WorkspaceData>;
      if (!parsed || !Array.isArray(parsed.columns) || !Array.isArray(parsed.tasks)) {
        onNotify("备份文件格式无效");
        return;
      }
      onUpdate({
        ...createDefaultWorkspace(),
        ...parsed,
        settings: {
          ...createDefaultWorkspace().settings,
          ...(parsed.settings ?? {}),
        },
      });
      onNotify("已恢复工作区备份");
      setSettingsOpen(false);
    } catch {
      onNotify("读取备份文件失败");
    } finally {
      e.target.value = "";
    }
  };

  const currentTheme: ThemeMode = workspace.settings.theme || "dark";
  const paperGrain = workspace.settings.paperGrain ?? true;

  const setTheme = (nextTheme: ThemeMode) => {
    onUpdate({
      ...workspace,
      settings: {
        ...workspace.settings,
        theme: nextTheme,
      },
    });
  };

  const togglePaperGrain = () => {
    onUpdate({
      ...workspace,
      settings: {
        ...workspace.settings,
        paperGrain: !paperGrain,
      },
    });
  };

  const cycleTheme = () => {
    const order: ThemeMode[] = ["dark", "light", "paper"];
    setTheme(order[(order.indexOf(currentTheme) + 1) % order.length]);
  };

  const pendingTaskCount = workspace.tasks.filter(
    (item) => item.status !== "done"
  ).length;
  const doneTaskCount = workspace.tasks.filter(
    (item) => item.status === "done"
  ).length;
  const unscheduledTaskCount = workspace.tasks.filter(
    (item) => !item.dueDate && item.status !== "done"
  ).length;
  const ideaCount = workspace.ideas.length;

  return (
    <div className="flex h-[100dvh] w-screen flex-col overflow-hidden bg-background text-foreground touch-manipulation">
      {/* shadcn/ui Refined Minimal Header */}
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border/60 bg-background/85 px-3 sm:px-5 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Layers className="h-3.5 w-3.5" />
          </div>
          <span className="text-[13px] font-semibold tracking-tight text-foreground">
            ShibaPlan
          </span>
        </div>

        {/* Center Segmented Tabs */}
        <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
          <button
            onClick={() => setView("kanban")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-all ${
              view === "kanban"
                ? "bg-card text-foreground shadow-card-rest"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Kanban className="h-3.5 w-3.5" />
            <span>{t("nav.kanban")}</span>
          </button>

          <button
            onClick={() => setView("calendar")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-all ${
              view === "calendar"
                ? "bg-card text-foreground shadow-card-rest"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            <span>{t("nav.calendar")}</span>
          </button>
        </div>

        {/* Icon-Only Right Actions */}
        <div className="flex items-center gap-0.5 sm:gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCommandOpen(true)}
            title="全局搜索与命令面板 (Ctrl + K)"
          >
            <Search className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={handleOpenAiPlan}
            title="AI 今日排期建议"
          >
            <Bot className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            disabled={!canUndo}
            onClick={onUndo}
            title="撤销 (Ctrl + Z)"
            className="hidden sm:inline-flex"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            disabled={!canRedo}
            onClick={onRedo}
            title="重做 (Ctrl + Shift + Z)"
            className="hidden sm:inline-flex"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </Button>

          {isTauriRuntime() && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => openCaptureWindow()}
              title={t("nav.quickCapture")}
            >
              <Sparkles className="h-3.5 w-3.5" />
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSettingsOpen(true)}
            title={t("nav.settings")}
          >
            <Settings className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      {/* Main Content + Bottom Idea River */}
      {!loaded ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          {t("common.loading")}
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden">
          <main className="flex-1 overflow-hidden">
            {view === "kanban" ? (
              <KanbanBoard workspace={workspace} onUpdate={onUpdate} />
            ) : (
              <CalendarView workspace={workspace} onUpdate={onUpdate} />
            )}
          </main>
          <IdeaRiver workspace={workspace} onUpdate={onUpdate} />
        </div>
      )}

      {/* Unified Bottom Status Bar */}
      <footer className="flex h-7 shrink-0 items-center justify-between border-t border-border/60 bg-background px-3 sm:px-5 text-[11px] text-muted-foreground select-none">
        <div className="flex items-center gap-2.5 overflow-hidden">
          {statusNotice ? (
            <span className="truncate font-medium text-primary">
              {statusNotice}
            </span>
          ) : (
            <>
              <span className="truncate">
                {t("nav.kanban")} {workspace.columns.length} ·{" "}
                {pendingTaskCount} / {doneTaskCount} {t("kanban.tabDone")}
              </span>
              <Separator orientation="vertical" className="hidden sm:block h-3" />
              <span className="hidden sm:inline truncate">
                {t("river.title")} {ideaCount}
              </span>
              {unscheduledTaskCount > 0 && (
                <>
                  <Separator
                    orientation="vertical"
                    className="hidden md:block h-3"
                  />
                  <span className="hidden md:inline truncate">
                    {t("calendar.unscheduled")} {unscheduledTaskCount}
                  </span>
                </>
              )}
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <button
            onClick={() => setCommandOpen(true)}
            className="hidden lg:inline font-mono text-[10px] opacity-75 hover:opacity-100 hover:text-foreground"
            title="打开命令面板"
          >
            Ctrl+K · Ctrl+Z
          </button>

          <button
            onClick={cycleTheme}
            className="flex items-center gap-1 text-muted-foreground transition hover:text-foreground"
            title={t("settings.themeLabel")}
          >
            {currentTheme === "dark" ? (
              <Moon className="h-3 w-3" />
            ) : currentTheme === "light" ? (
              <Sun className="h-3 w-3" />
            ) : (
              <BookOpen className="h-3 w-3" />
            )}
            <span>{t(`theme.${currentTheme}`)}</span>
          </button>

          <button
            onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-1 text-muted-foreground transition hover:text-foreground"
            title={t("settings.languageLabel")}
          >
            <Languages className="h-3 w-3" />
            <span className="uppercase">{locale}</span>
          </button>
        </div>
      </footer>

      {/* Global Command Palette (Ctrl + K) */}
      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        workspace={workspace}
        onUpdate={onUpdate}
        onSwitchView={setView}
        onOpenAiPlan={handleOpenAiPlan}
        onOpenSettings={() => setSettingsOpen(true)}
        onNotify={onNotify}
      />

      {/* AI Today Plan Dialog */}
      <Dialog open={aiPlanOpen} onOpenChange={setAiPlanOpen}>
        <DialogContent className="max-h-[82vh] max-w-lg flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              AI 今日排期建议
            </DialogTitle>
          </DialogHeader>

          <Separator className="my-3" />

          <div className="flex-1 overflow-y-auto">
            {aiPlanLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                正在分析待办任务与耗时...
              </div>
            ) : aiPlanError ? (
              <div className="space-y-3 py-4">
                <div className="rounded-lg bg-destructive/12 px-3 py-2.5 text-xs text-destructive">
                  {aiPlanError}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setAiPlanOpen(false);
                    setSettingsOpen(true);
                  }}
                >
                  前往设置配置 AI 接口
                </Button>
              </div>
            ) : (
              <div className="whitespace-pre-wrap rounded-xl bg-background p-4 text-xs leading-relaxed text-foreground/90">
                {aiPlanResult}
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={aiPlanLoading}
              onClick={handleOpenAiPlan}
            >
              重新生成
            </Button>
            <Button size="sm" onClick={() => setAiPlanOpen(false)}>
              {t("common.close")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* shadcn/ui Radix Settings Dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("settings.title")}</DialogTitle>
          </DialogHeader>

          <Separator className="my-3.5" />

          <div className="space-y-5">
            {/* Theme Selector */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <Palette className="h-3.5 w-3.5 text-primary" />
                <span>{t("settings.themeLabel")}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: "dark", icon: <Moon className="h-3.5 w-3.5" /> },
                    { id: "light", icon: <Sun className="h-3.5 w-3.5" /> },
                    { id: "paper", icon: <BookOpen className="h-3.5 w-3.5" /> },
                  ] as const
                ).map((item) => (
                  <Button
                    key={item.id}
                    type="button"
                    variant={currentTheme === item.id ? "default" : "secondary"}
                    onClick={() => setTheme(item.id)}
                    className="w-full"
                  >
                    {item.icon}
                    <span>{t(`theme.${item.id}`)}</span>
                  </Button>
                ))}
              </div>

              {/* Tactile Fine Paper Grain Switch */}
              <div className="flex items-center justify-between rounded-xl bg-muted/60 px-3 py-2">
                <div>
                  <div className="text-xs font-medium text-foreground">
                    细微纸张颗粒质感
                  </div>
                  <div className="text-[10px] text-muted-foreground">
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

            {/* Language Selector + Import / Export */}
            <div className="space-y-2.5">
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
                    <button onClick={() => setLocale(item.code)}>
                      {item.name}
                    </button>
                    {!item.builtin && (
                      <button
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

              <div className="flex flex-wrap items-center gap-2 pt-0.5">
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
                  onChange={handleImportFile}
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

            {/* AI Direct API Config + Sync Dir Form */}
            <form onSubmit={handleSaveSettings} className="space-y-4">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <Bot className="h-3.5 w-3.5 text-primary" />
                    <span>AI 直连接口（OpenAI 兼容 / Ollama）</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setAiBaseUrl("http://localhost:11434/v1");
                        setAiModel("qwen2.5:7b");
                      }}
                      className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground hover:bg-accent"
                    >
                      Ollama 本地
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAiBaseUrl("https://api.deepseek.com/v1");
                        setAiModel("deepseek-chat");
                      }}
                      className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground hover:bg-accent"
                    >
                      DeepSeek
                    </button>
                  </div>
                </div>

                <Input
                  type="text"
                  value={aiBaseUrl}
                  onChange={(e) => setAiBaseUrl(e.target.value)}
                  placeholder="Base URL，例如 https://api.openai.com/v1"
                  className="font-mono"
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="password"
                    value={aiApiKey}
                    onChange={(e) => setAiApiKey(e.target.value)}
                    placeholder="API Key（本地 Ollama 可留空）"
                  />
                  <Input
                    type="text"
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}
                    placeholder="模型名，如 gpt-4o-mini"
                    className="font-mono"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <FolderOpen className="h-3.5 w-3.5 text-primary" />
                  {t("settings.syncDirLabel")}
                </label>
                <Input
                  type="text"
                  value={dirInput}
                  onChange={(e) => setDirInput(e.target.value)}
                  placeholder={defaultDir}
                  className="font-mono"
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                {dirSaved && (
                  <span className="flex items-center gap-1 text-xs text-emerald-500">
                    <Check className="h-3.5 w-3.5" />
                    {t("common.saved")}
                  </span>
                )}
                <Button type="submit">{t("common.save")}</Button>
              </div>
            </form>

            <Separator />

            {/* Full Workspace Backup & Restore */}
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
                  onClick={handleExportWorkspaceBackup}
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
                  onChange={handleImportWorkspaceBackup}
                  className="hidden"
                />
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default App;
