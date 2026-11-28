import React, {
  lazy,
  startTransition,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowDownToLine,
  BookOpen,
  Bot,
  Copy,
  Download,
  ExternalLink,
  Languages,
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
  createDefaultInfoBoards,
  createDefaultWorkspace,
  getDefaultDataDir,
  hasPendingSave,
  isOwnSaveEcho,
  isTauriRuntime,
  loadWorkspace,
  openCaptureWindow,
  openPathInOs,
  scheduleSaveWorkspace,
} from "./lib/storage";
import { useInfoScheduler } from "./lib/useInfoScheduler";
import { suggestTodayPlanWithAI } from "./lib/ai";
import { applyAccentColor } from "./lib/theme";
import { setLoggerCustomDataDir } from "./lib/logger";
import { EXPIRY_SOON_DAYS, EXPIRY_URGENT_DAYS, getDaysUntilExpiry } from "./lib/memo";
import {
  checkForUpdates,
  getCurrentAppVersion,
  installPendingUpdate,
  openExternalUrl,
  type UpdateCheckResult,
  type UpdateDownloadProgress,
} from "./lib/updater";
import { openOfflineDocs } from "./lib/docs";
import { CustomLocalePack, I18nProvider, useI18n } from "./lib/i18n";
import type { SettingsTabId } from "./components/SettingsDialog";
import { Button } from "./components/ui/button";
import { Separator } from "./components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";

const CalendarView = lazy(() =>
  import("./components/CalendarView").then((m) => ({ default: m.CalendarView }))
);
const KanbanBoard = lazy(() =>
  import("./components/KanbanBoard").then((m) => ({ default: m.KanbanBoard }))
);
const IdeaRiver = lazy(() =>
  import("./components/IdeaRiver").then((m) => ({ default: m.IdeaRiver }))
);
const QuickCapture = lazy(() =>
  import("./components/QuickCapture").then((m) => ({ default: m.QuickCapture }))
);
const ProjectsView = lazy(() =>
  import("./components/ProjectsView").then((m) => ({ default: m.ProjectsView }))
);
const MemosView = lazy(() =>
  import("./components/MemosView").then((m) => ({ default: m.MemosView }))
);
const InfoDashboardView = lazy(() =>
  import("./components/InfoDashboardView").then((m) => ({
    default: m.InfoDashboardView,
  }))
);
const CommandPalette = lazy(() =>
  import("./components/CommandPalette").then((m) => ({
    default: m.CommandPalette,
  }))
);
const LanShareDialog = lazy(() =>
  import("./components/LanShareDialog").then((m) => ({
    default: m.LanShareDialog,
  }))
);
const SettingsDialog = lazy(() =>
  import("./components/SettingsDialog").then((m) => ({
    default: m.SettingsDialog,
  }))
);

type TopView = "projects" | "kanban" | "calendar" | "memos" | "info";

const ACTIVE_VIEW_STORAGE_KEY = "shibaplan_active_view";

function loadInitialTopView(): TopView {
  if (typeof window === "undefined") return "kanban";
  try {
    const saved = window.localStorage.getItem(ACTIVE_VIEW_STORAGE_KEY);
    if (
      saved === "projects" ||
      saved === "kanban" ||
      saved === "calendar" ||
      saved === "memos" ||
      saved === "info"
    ) {
      return saved;
    }
  } catch {
    // ignore
  }
  return "kanban";
}

const MAX_HISTORY = 30;
const HISTORY_COALESCE_MS = 800;

export const App: React.FC = () => {
  const isCaptureWindow =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("window") === "capture";

  if (isCaptureWindow) {
    return (
      <Suspense fallback={null}>
        <QuickCapture />
      </Suspense>
    );
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
  const lastHistoryPushRef = useRef(0);
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
          // Ignore the echo of our own save (keeps object identity / structural
          // sharing intact) and don't clobber local edits that are still pending.
          if (isOwnSaveEcho(event.payload) || hasPendingSave()) return;
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
        if (document.visibilityState !== "visible" || hasPendingSave()) return;
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
      // Coalesce rapid successive edits (e.g. typing) into one undo step so the
      // history stays meaningful and bounded instead of one snapshot per key.
      const now = Date.now();
      if (now - lastHistoryPushRef.current > HISTORY_COALESCE_MS) {
        undoStackRef.current = [
          ...undoStackRef.current.slice(-(MAX_HISTORY - 1)),
          prev,
        ];
      }
      lastHistoryPushRef.current = now;
      redoStackRef.current = [];
      syncHistoryMeta();
      return next;
    });
    scheduleSaveWorkspace(next);
  }, []);

  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const prevSnapshot = undoStackRef.current.pop()!;
    lastHistoryPushRef.current = 0;
    setWorkspace((current) => {
      redoStackRef.current = [
        ...redoStackRef.current.slice(-(MAX_HISTORY - 1)),
        current,
      ];
      syncHistoryMeta();
      return prevSnapshot;
    });
    scheduleSaveWorkspace(prevSnapshot);
    notify("已撤销上一步操作");
  }, [notify]);

  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const nextSnapshot = redoStackRef.current.pop()!;
    lastHistoryPushRef.current = 0;
    setWorkspace((current) => {
      undoStackRef.current = [
        ...undoStackRef.current.slice(-(MAX_HISTORY - 1)),
        current,
      ];
      syncHistoryMeta();
      return nextSnapshot;
    });
    scheduleSaveWorkspace(nextSnapshot);
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

  const [view, setView] = useState<TopView>(loadInitialTopView);

  useEffect(() => {
    try {
      window.localStorage.setItem(ACTIVE_VIEW_STORAGE_KEY, view);
    } catch {
      // ignore
    }
  }, [view]);
  const {
    runtimeMap: infoRuntimeMap,
    runWidget: runInfoWidget,
    cancelWidget: cancelInfoWidget,
    runAllWidgets: runAllInfoWidgets,
    alertStats: infoAlertStats,
    pushServerStatus: infoPushServerStatus,
    applyPushServerConfig: applyInfoPushServerConfig,
  } = useInfoScheduler({ workspace, loaded, onUpdate, onNotify });
  const [activeMemoId, setActiveMemoId] = useState<string | null>(null);
  const handleOpenMemo = useCallback((memoId?: string) => {
    if (memoId) setActiveMemoId(memoId);
    startTransition(() => setView("memos"));
  }, []);
  const [projectStatusText, setProjectStatusText] = useState<string | null>(
    null
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>("appearance");
  const openProjectSettings = useCallback(() => {
    setSettingsTab("projects");
    setSettingsOpen(true);
  }, []);
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
    const currentlyMax = await win.isMaximized();
    if (currentlyMax) {
      await win.unmaximize();
      setIsMaximized(false);
    } else {
      await win.maximize();
      setIsMaximized(true);
    }
  }, []);

  const handleWindowClose = useCallback(async () => {
    if (!isTauriRuntime()) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  }, []);

  const handleHeaderMouseDown = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (!isTauriRuntime() || e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest("button, a, input, [role='button']")) return;
      if (e.detail >= 2) return;

      const startX = e.screenX;
      const startY = e.screenY;

      const onMove = (ev: MouseEvent) => {
        if (
          Math.abs(ev.screenX - startX) > 4 ||
          Math.abs(ev.screenY - startY) > 4
        ) {
          cleanup();
          import("@tauri-apps/api/window")
            .then(({ getCurrentWindow }) => getCurrentWindow().startDragging())
            .catch(() => {});
        }
      };

      const cleanup = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", cleanup);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", cleanup);
    },
    []
  );

  const handleHeaderDoubleClick = useCallback(
    async (e: React.MouseEvent<HTMLElement>) => {
      if (!isTauriRuntime()) return;
      const target = e.target as HTMLElement;
      if (target.closest("button, a, input, [role='button']")) return;
      await handleWindowToggleMaximize();
    },
    [handleWindowToggleMaximize]
  );

  // AI Today Plan Dialog state
  const [aiPlanOpen, setAiPlanOpen] = useState(false);
  const [aiPlanLoading, setAiPlanLoading] = useState(false);
  const [aiPlanResult, setAiPlanResult] = useState<string>("");
  const [aiPlanError, setAiPlanError] = useState<string | null>(null);

  // Version & Online Update state
  const [appVersion, setAppVersion] = useState("0.2.0");
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [updatingApp, setUpdatingApp] = useState(false);
  const [updateProgress, setUpdateProgress] =
    useState<UpdateDownloadProgress | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const handleInstallUpdate = useCallback(async () => {
    setUpdatingApp(true);
    setUpdateError(null);
    setUpdateProgress({ phase: "downloading", downloadedBytes: 0, percent: 0 });
    try {
      await installPendingUpdate((progress) => {
        setUpdateProgress(progress);
      });
    } catch (err) {
      setUpdateError(
        err instanceof Error ? err.message : "自动更新失败，请尝试手动下载安装包"
      );
      setUpdatingApp(false);
    }
  }, []);

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
        memos: Array.isArray(parsed.memos) ? parsed.memos : [],
        memoFolders: Array.isArray(parsed.memoFolders) ? parsed.memoFolders : [],
        infoBoards:
          Array.isArray(parsed.infoBoards) && parsed.infoBoards.length > 0
            ? parsed.infoBoards
            : createDefaultInfoBoards(),
        infoWidgets: Array.isArray(parsed.infoWidgets) ? parsed.infoWidgets : [],
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
  const memos = workspace.memos ?? [];
  let urgentMemoCount = 0;
  let hasCriticalMemo = false;
  for (const memo of memos) {
    const daysLeft = getDaysUntilExpiry(memo.expiresAt);
    if (daysLeft !== null && daysLeft <= EXPIRY_SOON_DAYS) {
      urgentMemoCount++;
      if (daysLeft <= EXPIRY_URGENT_DAYS) {
        hasCriticalMemo = true;
      }
    }
  }

  return (
    <div className="flex h-[100dvh] w-screen flex-col overflow-hidden bg-background text-foreground touch-manipulation">
      {/* Frameless Linear Topbar (3-column grid keeps primary nav mathematically centered) */}
      <header
        onMouseDown={handleHeaderMouseDown}
        onDoubleClick={handleHeaderDoubleClick}
        className="grid h-11 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-border bg-surface/80 pl-3 sm:pl-4 pr-2 backdrop-blur-md select-none"
      >
        {/* Left: Brand */}
        <div className="flex items-center gap-2 justify-self-start pointer-events-none">
          <div className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
            <svg
              viewBox="0 0 512 512"
              className="h-3.5 w-3.5"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M144 128 L206 184 H306 L368 128 C374 122 384 126 384 135 V268 C384 338 326 388 256 388 C186 388 128 338 128 268 V135 C128 126 138 122 144 128 Z"
                fill="currentColor"
              />
              <circle cx="212" cy="258" r="16" fill="hsl(var(--primary))" />
              <circle cx="300" cy="258" r="16" fill="hsl(var(--primary))" />
              <rect
                x="232"
                y="306"
                width="48"
                height="18"
                rx="9"
                fill="hsl(var(--primary))"
              />
            </svg>
          </div>
          <span className="hidden sm:inline text-[13px] font-semibold tracking-[-0.015em] text-foreground">
            ShibaPlan
          </span>
        </div>

        {/* Center: Prominent Primary Navigation (项目 / 看板 / 时间, 14px) */}
        <nav className="flex h-full items-center justify-self-center gap-1 sm:gap-2">
          {(
            [
              { id: "projects", label: "项目" },
              { id: "kanban", label: t("nav.kanban") },
              { id: "calendar", label: t("nav.calendar") },
              { id: "memos", label: t("nav.memos") },
              { id: "info", label: t("nav.info") },
            ] as const
          ).map((tab) => {
            const active = view === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => startTransition(() => setView(tab.id))}
                className={`relative flex h-full items-center gap-1.5 px-3 text-[14px] tracking-[-0.01em] transition-colors ${
                  active
                    ? "font-semibold text-foreground"
                    : "font-medium text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>{tab.label}</span>
                {tab.id === "memos" && urgentMemoCount > 0 && (
                  <span
                    title={`有 ${urgentMemoCount} 条临期备忘`}
                    className={`h-1.5 w-1.5 rounded-full ${
                      hasCriticalMemo ? "bg-rose-500" : "bg-amber-500"
                    }`}
                  />
                )}
                {tab.id === "info" &&
                  (infoAlertStats.errorCount > 0 ||
                    infoAlertStats.warnCount > 0 ||
                    infoAlertStats.running > 0) && (
                    <span
                      title={
                        infoAlertStats.errorCount > 0
                          ? `${infoAlertStats.errorCount} 张信息卡片运行异常`
                          : infoAlertStats.warnCount > 0
                            ? `${infoAlertStats.warnCount} 张信息卡片存在告警`
                            : `${infoAlertStats.running} 张信息卡片运行中`
                      }
                      className={`h-1.5 w-1.5 rounded-full ${
                        infoAlertStats.errorCount > 0
                          ? "bg-rose-500"
                          : infoAlertStats.warnCount > 0
                            ? "bg-amber-500"
                            : "bg-primary animate-pulse"
                      }`}
                    />
                  )}
                {active && (
                  <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-primary" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Right: Cleanly Grouped Actions + Window Controls */}
        <div className="flex items-center justify-self-end gap-1.5 shrink-0">
          {/* Linear Command Palette Trigger */}
          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            title="全局搜索与命令面板 (Ctrl + K)"
            className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background/70 px-2 text-xs text-muted-foreground transition-colors hover:border-foreground/15 hover:bg-accent/60 hover:text-foreground"
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <kbd className="hidden xl:inline-flex items-center rounded border border-border/80 bg-surface px-1 py-px font-mono text-[10px] leading-tight text-muted-foreground/80">
              Ctrl K
            </kbd>
          </button>

          {/* Group 1: AI & Quick Capture */}
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleOpenAiPlan}
              title="AI 今日排期建议"
            >
              <Bot className="h-3.5 w-3.5" />
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
          </div>

          <div className="hidden sm:block h-3.5 w-px bg-border" />

          {/* Group 2: Undo / Redo */}
          <div className="hidden sm:flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              disabled={!canUndo}
              onClick={onUndo}
              title="撤销 (Ctrl + Z)"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              disabled={!canRedo}
              onClick={onRedo}
              title="重做 (Ctrl + Shift + Z)"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="h-3.5 w-px bg-border" />

          {/* Group 3: LAN Share, Docs & Settings */}
          <div className="flex items-center gap-0.5">
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
              onClick={() => {
                openOfflineDocs("home", locale).catch(() => {});
              }}
              title={t("nav.docs")}
            >
              <BookOpen className="h-3.5 w-3.5" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSettingsOpen(true)}
              title={t("nav.settings")}
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
          </div>

          {isTauriRuntime() && (
            <>
              <div className="h-3.5 w-px bg-border" />
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
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  {t("common.loading")}
                </div>
              }
            >
              {view === "projects" ? (
                <ProjectsView
                  workspace={workspace}
                  onUpdate={onUpdate}
                  onOpenProjectSettings={openProjectSettings}
                  onStatusChange={setProjectStatusText}
                  onNotify={onNotify}
                />
              ) : view === "kanban" ? (
                <KanbanBoard workspace={workspace} onUpdate={onUpdate} />
              ) : view === "memos" ? (
                <MemosView
                  workspace={workspace}
                  onUpdate={onUpdate}
                  selectedMemoId={activeMemoId}
                  onSelectMemo={setActiveMemoId}
                  onNotify={onNotify}
                />
              ) : view === "info" ? (
                <InfoDashboardView
                  workspace={workspace}
                  onUpdate={onUpdate}
                  runtimeMap={infoRuntimeMap}
                  onRunWidget={runInfoWidget}
                  onCancelWidget={cancelInfoWidget}
                  onRunAllWidgets={runAllInfoWidgets}
                  pushServerStatus={infoPushServerStatus}
                  onApplyPushConfig={applyInfoPushServerConfig}
                  onNotify={onNotify}
                />
              ) : (
                <CalendarView
                  workspace={workspace}
                  onUpdate={onUpdate}
                  onOpenMemo={handleOpenMemo}
                />
              )}
            </Suspense>
          </main>
          {view !== "projects" && view !== "memos" && view !== "info" && (
            <Suspense fallback={null}>
              <IdeaRiver workspace={workspace} onUpdate={onUpdate} />
            </Suspense>
          )}
        </div>
      )}

      {/* Unified Bottom Status Bar */}
      <footer className="flex h-6 shrink-0 items-center justify-between border-t border-border bg-surface/60 px-3 sm:px-4 text-[11.5px] text-muted-foreground tabular-nums select-none">
        <div className="flex items-center gap-2.5 overflow-hidden">
          {statusNotice ? (
            <span className="truncate font-medium text-primary">
              {statusNotice}
            </span>
          ) : view === "projects" ? (
            projectStatusText &&
            (/^[a-zA-Z]:[\\/]/.test(projectStatusText) ||
              projectStatusText.startsWith("\\\\") ||
              projectStatusText.startsWith("/")) ? (
              <button
                type="button"
                onClick={() => openPathInOs(projectStatusText).catch(() => {})}
                title={`点击打开：${projectStatusText}`}
                className="truncate text-left font-mono transition-colors hover:text-foreground hover:underline underline-offset-2 cursor-pointer"
              >
                {projectStatusText}
              </button>
            ) : (
              <span className="truncate">
                {projectStatusText || "项目归档工作台"}
              </span>
            )
          ) : view === "memos" ? (
            <span className="truncate">
              备忘 {memos.length} 条
              {urgentMemoCount > 0 ? ` · 临期 ${urgentMemoCount} 条` : ""}
            </span>
          ) : view === "info" ? (
            <span className="truncate">
              信息卡片 {infoAlertStats.total} · 自动任务{" "}
              {infoAlertStats.scheduledCount}
              {infoAlertStats.pushCount > 0
                ? ` · 推送接收 ${infoAlertStats.pushCount}`
                : ""}
              {infoAlertStats.running > 0
                ? ` · 运行中 ${infoAlertStats.running}`
                : ""}
              {infoAlertStats.errorCount > 0
                ? ` · 异常 ${infoAlertStats.errorCount}`
                : ""}
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

      {/* Lazy-Loaded Modal Dialogs */}
      <Suspense fallback={null}>
        {lanShareOpen && (
          <LanShareDialog
            open={lanShareOpen}
            onOpenChange={setLanShareOpen}
            customDataDir={workspace.settings.customDataDir}
          />
        )}

        {commandOpen && (
          <CommandPalette
            open={commandOpen}
            onOpenChange={setCommandOpen}
            workspace={workspace}
            onUpdate={onUpdate}
            onSwitchView={setView}
            onOpenMemo={handleOpenMemo}
            onRunAllInfoWidgets={() => void runAllInfoWidgets()}
            onOpenAiPlan={handleOpenAiPlan}
            onOpenSettings={() => setSettingsOpen(true)}
            onNotify={onNotify}
          />
        )}
      </Suspense>

      {/* Online Update Dialog */}
      <Dialog
        open={updateDialogOpen}
        onOpenChange={(open) => {
          if (!updatingApp) {
            setUpdateDialogOpen(open);
            if (!open) {
              setUpdateError(null);
              setUpdateProgress(null);
            }
          }
        }}
      >
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

            {updatingApp && updateProgress && (
              <div className="space-y-1.5 rounded-xl bg-primary/8 px-3 py-2.5">
                <div className="flex items-center justify-between text-[11px] font-medium text-primary">
                  <span>
                    {updateProgress.phase === "downloading"
                      ? "正在下载更新包..."
                      : updateProgress.phase === "installing"
                        ? "正在安装更新..."
                        : "更新完成，正在重启应用..."}
                  </span>
                  {typeof updateProgress.percent === "number" && (
                    <span className="font-mono">{updateProgress.percent}%</span>
                  )}
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary/15">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-200"
                    style={{
                      width: `${updateProgress.percent ?? 35}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {updateError && (
              <div className="rounded-xl bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                {updateError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={updatingApp}
                onClick={() => setUpdateDialogOpen(false)}
              >
                稍后提醒
              </Button>
              {updateInfo?.releaseUrl && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={updatingApp}
                  onClick={() => {
                    openExternalUrl(updateInfo.releaseUrl).catch((err) => {
                      onNotify(
                        err instanceof Error ? err.message : "无法打开外部链接"
                      );
                    });
                  }}
                >
                  <ExternalLink className="h-3 w-3" />
                  查看发布页
                </Button>
              )}
              {updateInfo?.canAutoUpdate ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={updatingApp}
                  onClick={handleInstallUpdate}
                >
                  <Download className="h-3 w-3" />
                  {updatingApp ? "更新中..." : "立即更新并重启"}
                </Button>
              ) : (
                updateInfo?.downloadUrl && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      openExternalUrl(updateInfo.downloadUrl!).catch((err) => {
                        onNotify(
                          err instanceof Error ? err.message : "无法打开下载链接"
                        );
                      });
                    }}
                  >
                    <Download className="h-3 w-3" />
                    下载安装包
                  </Button>
                )
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
      <Suspense fallback={null}>
        {settingsOpen && (
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
        )}
      </Suspense>
    </div>
  );
};

export default App;
