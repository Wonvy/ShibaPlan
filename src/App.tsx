import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  BookOpen,
  Bot,
  CalendarDays,
  Copy,
  Download,
  ExternalLink,
  FolderArchive,
  Kanban,
  Languages,
  Layers,
  Loader2,
  Minus,
  Moon,
  QrCode,
  Redo2,
  Search,
  Settings,
  Sparkles,
  Square,
  Sun,
  Undo2,
  X,
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
import { applyAccentColor } from "./lib/theme";
import { setLoggerCustomDataDir } from "./lib/logger";
import {
  checkForUpdates,
  getCurrentAppVersion,
  UpdateCheckResult,
} from "./lib/updater";
import { CustomLocalePack, I18nProvider, useI18n } from "./lib/i18n";
import { QuickCapture } from "./components/QuickCapture";
import { KanbanBoard } from "./components/KanbanBoard";
import { CalendarView } from "./components/CalendarView";
import { ProjectsView } from "./components/ProjectsView";
import { IdeaRiver } from "./components/IdeaRiver";
import { CommandPalette } from "./components/CommandPalette";
import { LanShareDialog } from "./components/LanShareDialog";
import { SettingsDialog, SettingsTabId } from "./components/SettingsDialog";
import { Button } from "./components/ui/button";
import { Separator } from "./components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";

type TopView = "projects" | "kanban" | "calendar";

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
    let pollTimer: number | undefined;
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
    } else {
      pollTimer = window.setInterval(() => {
        if (document.visibilityState !== "visible") return;
        const active = document.activeElement as HTMLElement | null;
        if (
          active &&
          (active.tagName === "INPUT" ||
            active.tagName === "TEXTAREA" ||
            active.isContentEditable)
        ) {
          return;
        }
        loadWorkspace()
          .then((remote) => {
            setWorkspace((prev) =>
              JSON.stringify(prev) === JSON.stringify(remote) ? prev : remote
            );
          })
          .catch(() => {});
      }, 4000);
    }

    return () => {
      if (unlisten) unlisten();
      if (pollTimer !== undefined) window.clearInterval(pollTimer);
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
  const { t, locale } = useI18n();

  const [view, setView] = useState<TopView>("kanban");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>("appearance");
  const [commandOpen, setCommandOpen] = useState(false);
  const [lanShareOpen, setLanShareOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow }) => {
        const win = getCurrentWindow();
        setIsMaximized(await win.isMaximized());
        unlisten = await win.onResized(async () => {
          setIsMaximized(await win.isMaximized());
        });
      })
      .catch(() => {});
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleWindowMinimize = useCallback(async () => {
    if (!isTauriRuntime()) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().minimize();
  }, []);

  const handleWindowToggleMaximize = useCallback(async () => {
    if (!isTauriRuntime()) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    await win.toggleMaximize();
    setIsMaximized(await win.isMaximized());
  }, []);

  const handleWindowClose = useCallback(async () => {
    if (!isTauriRuntime()) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  }, []);

  const handleHeaderMouseDown = useCallback(
    async (e: React.MouseEvent<HTMLElement>) => {
      if (!isTauriRuntime() || e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest("button, a, input, [role='button']")) return;
      if (e.detail === 2) {
        await handleWindowToggleMaximize();
        return;
      }
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().startDragging();
    },
    [handleWindowToggleMaximize]
  );

  // AI Today Plan Dialog state
  const [aiPlanOpen, setAiPlanOpen] = useState(false);
  const [aiPlanLoading, setAiPlanLoading] = useState(false);
  const [aiPlanResult, setAiPlanResult] = useState<string>("");
  const [aiPlanError, setAiPlanError] = useState<string | null>(null);

  // Version & Online Update state
  const [appVersion, setAppVersion] = useState("0.1.0");
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);

  const runUpdateCheck = useCallback(
    async (silent = false) => {
      setCheckingUpdate(true);
      try {
        const res = await checkForUpdates();
        setAppVersion(res.currentVersion);
        setUpdateInfo(res);
        if (res.hasUpdate) {
          if (!silent) setUpdateDialogOpen(true);
        } else if (!silent) {
          onNotify(`当前已是最新版本 v${res.currentVersion}`);
        }
      } catch (err) {
        if (!silent) {
          onNotify(err instanceof Error ? err.message : "检查更新失败");
        }
      } finally {
        setCheckingUpdate(false);
      }
    },
    [onNotify]
  );

  useEffect(() => {
    getCurrentAppVersion().then(setAppVersion);
    // Silent background update check shortly after launch
    const timer = setTimeout(() => {
      runUpdateCheck(true);
    }, 3500);
    return () => clearTimeout(timer);
  }, [runUpdateCheck]);

  const [defaultDir, setDefaultDir] = useState("");

  useEffect(() => {
    const theme = workspace.settings.theme || "dark";
    const grain = workspace.settings.paperGrain ?? true;
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.setAttribute("data-grain", grain ? "on" : "off");
    applyAccentColor(workspace.settings.accentColor);
  }, [
    workspace.settings.theme,
    workspace.settings.paperGrain,
    workspace.settings.accentColor,
  ]);

  useEffect(() => {
    getDefaultDataDir().then(setDefaultDir);
  }, []);

  useEffect(() => {
    setLoggerCustomDataDir(workspace.settings.customDataDir);
  }, [workspace.settings.customDataDir]);

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

  const setTheme = (nextTheme: ThemeMode) => {
    onUpdate({
      ...workspace,
      settings: {
        ...workspace.settings,
        theme: nextTheme,
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
      {/* Frameless Custom Titlebar + Minimal Header */}
      <header
        data-tauri-drag-region
        onMouseDown={handleHeaderMouseDown}
        className="flex h-11 shrink-0 items-center justify-between border-b border-border/60 bg-background/85 pl-3 sm:pl-4 pr-2 backdrop-blur-md"
      >
        <div
          data-tauri-drag-region
          className="flex items-center gap-2"
        >
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/15 text-primary pointer-events-none">
            <Layers className="h-3.5 w-3.5" />
          </div>
          <span className="text-[15px] font-semibold tracking-tight text-foreground pointer-events-none">
            ShibaPlan
          </span>
        </div>

        {/* Center Segmented Tabs */}
        <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
          <button
            onClick={() => setView("projects")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-[13px] font-medium transition-all ${
              view === "projects"
                ? "bg-card text-foreground shadow-card-rest"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <FolderArchive className="h-3.5 w-3.5" />
            <span>项目</span>
          </button>

          <button
            onClick={() => setView("kanban")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-[13px] font-medium transition-all ${
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
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-[13px] font-medium transition-all ${
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
            onClick={() => setLanShareOpen(true)}
            title="局域网访问与手机扫码"
          >
            <QrCode className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSettingsOpen(true)}
            title={t("nav.settings")}
          >
            <Settings className="h-3.5 w-3.5" />
          </Button>

          {isTauriRuntime() && (
            <>
              <div className="mx-1 h-4 w-px bg-border/70" />
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={handleWindowMinimize}
                  title="最小化"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleWindowToggleMaximize}
                  title={isMaximized ? "还原窗口" : "最大化"}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {isMaximized ? (
                    <Copy className="h-3 w-3" />
                  ) : (
                    <Square className="h-3 w-3" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleWindowClose}
                  title="隐藏到托盘"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </>
          )}
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
            {view === "projects" ? (
              <ProjectsView
                workspace={workspace}
                onOpenProjectSettings={() => {
                  setSettingsTab("projects");
                  setSettingsOpen(true);
                }}
                onNotify={onNotify}
              />
            ) : view === "kanban" ? (
              <KanbanBoard workspace={workspace} onUpdate={onUpdate} />
            ) : (
              <CalendarView workspace={workspace} onUpdate={onUpdate} />
            )}
          </main>
          <IdeaRiver workspace={workspace} onUpdate={onUpdate} />
        </div>
      )}

      {/* Unified Bottom Status Bar */}
      <footer className="flex h-7 shrink-0 items-center justify-between border-t border-border/60 bg-background px-3 sm:px-5 text-xs text-muted-foreground select-none">
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
            className="hidden lg:inline font-mono text-xs opacity-75 hover:opacity-100 hover:text-foreground"
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
            onClick={() => {
              setSettingsTab("data");
              setSettingsOpen(true);
            }}
            className="flex items-center gap-1 text-muted-foreground transition hover:text-foreground"
            title={t("settings.languageLabel")}
          >
            <Languages className="h-3 w-3" />
            <span className="uppercase">{locale}</span>
          </button>

          <button
            onClick={() => {
              if (updateInfo?.hasUpdate) {
                setUpdateDialogOpen(true);
              } else {
                runUpdateCheck(false);
              }
            }}
            className={`flex items-center gap-1 font-mono text-xs transition ${
              updateInfo?.hasUpdate
                ? "text-primary font-medium hover:opacity-80"
                : "text-muted-foreground hover:text-foreground"
            }`}
            title={
              updateInfo?.hasUpdate
                ? `发现新版本 v${updateInfo.latestVersion}，点击更新`
                : "点击检查在线更新"
            }
          >
            {checkingUpdate ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : updateInfo?.hasUpdate ? (
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            ) : null}
            <span>
              {updateInfo?.hasUpdate
                ? `v${appVersion} -> v${updateInfo.latestVersion}`
                : `v${appVersion}`}
            </span>
          </button>
        </div>
      </footer>

      {/* LAN Access & Mobile QR Share Dialog */}
      <LanShareDialog
        open={lanShareOpen}
        onOpenChange={setLanShareOpen}
        customDataDir={workspace.settings.customDataDir}
      />

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

      {/* Online Update Dialog */}
      <Dialog open={updateDialogOpen} onOpenChange={setUpdateDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowDownToLine className="h-4 w-4 text-primary" />
              发现新版本 v{updateInfo?.latestVersion}
            </DialogTitle>
          </DialogHeader>

          <Separator className="my-3" />

          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between rounded-xl bg-muted/60 px-3 py-2 font-mono">
              <span className="text-muted-foreground">
                当前版本 v{appVersion}
              </span>
              <span className="font-semibold text-primary">
                最新 v{updateInfo?.latestVersion}
              </span>
            </div>

            {updateInfo?.releaseNotes && (
              <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-xl bg-background p-3 leading-relaxed text-foreground/85">
                {updateInfo.releaseNotes}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setUpdateDialogOpen(false)}
              >
                稍后提醒
              </Button>
              {updateInfo?.releaseUrl && (
                <a
                  href={updateInfo.releaseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-secondary px-2.5 text-xs font-medium text-secondary-foreground hover:bg-accent"
                >
                  <ExternalLink className="h-3 w-3" />
                  查看发布页
                </a>
              )}
              {updateInfo?.downloadUrl && (
                <a
                  href={updateInfo.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90"
                >
                  <Download className="h-3 w-3" />
                  下载安装包
                </a>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
                    setSettingsTab("ai");
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

      {/* Tabbed Settings Dialog */}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialTab={settingsTab}
        workspace={workspace}
        onUpdate={onUpdate}
        defaultDir={defaultDir}
        appVersion={appVersion}
        updateInfo={updateInfo}
        checkingUpdate={checkingUpdate}
        onCheckUpdate={() => runUpdateCheck(false)}
        onOpenUpdateDialog={() => setUpdateDialogOpen(true)}
        onExportBackup={handleExportWorkspaceBackup}
        onImportBackup={handleImportWorkspaceBackup}
        onNotify={onNotify}
      />
    </div>
  );
};

export default App;
