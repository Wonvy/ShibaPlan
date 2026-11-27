import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InfoPushServerConfig, InfoWidget, WorkspaceData } from "../types";
import { createDefaultInfoBoards, isTauriRuntime, uid } from "./storage";
import {
  DEFAULT_WIDGET_PX_H,
  DEFAULT_WIDGET_PX_W,
  findFreePixelSlot,
  getWidgetPixelRect,
  SNAP_GAP,
} from "./infoGrid";
import {
  cancelInfoRun,
  getInfoPushServerStatus,
  InfoCacheFile,
  InfoPushEventPayload,
  InfoPushRule,
  InfoPushServerStatus,
  InfoRunHistoryEntry,
  InfoRunResult,
  InfoWidgetRuntimeState,
  loadInfoCache,
  runInfoSource,
  saveInfoCache,
  startInfoPushServer,
  stopInfoPushServer,
  syncInfoPushRules,
} from "./infoRunner";
import { matchesCronDate, parseInfoOutput } from "./infoProtocol";

const MAX_HISTORY_PER_WIDGET = 10;
const MAX_HISTORY_TEXT_CHARS = 32768;

function truncatePreview(text: string): string {
  if (text.length <= MAX_HISTORY_TEXT_CHARS) return text;
  return text.slice(0, MAX_HISTORY_TEXT_CHARS) + "\n... [历史记录已截断]";
}

function getMinuteKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

export interface InfoAlertStats {
  total: number;
  running: number;
  errorCount: number;
  warnCount: number;
  scheduledCount: number;
  pushCount: number;
}

export function useInfoScheduler({
  workspace,
  loaded,
  onUpdate,
  onNotify,
}: {
  workspace: WorkspaceData;
  loaded: boolean;
  onUpdate: (next: WorkspaceData) => void;
  onNotify?: (msg: string) => void;
}) {
  const [runtimeMap, setRuntimeMap] = useState<
    Record<string, InfoWidgetRuntimeState>
  >({});
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const [pushServerStatus, setPushServerStatus] =
    useState<InfoPushServerStatus | null>(null);

  const runtimeRef = useRef(runtimeMap);
  runtimeRef.current = runtimeMap;

  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const onNotifyRef = useRef(onNotify);
  onNotifyRef.current = onNotify;

  const startupRanRef = useRef<Set<string>>(new Set());
  const lastIntervalTickRef = useRef<Record<string, number>>({});
  const lastCronMinuteRef = useRef<Record<string, string>>({});
  const saveCacheTimerRef = useRef<number | null>(null);

  const customDataDir = workspace.settings.customDataDir;

  // Load persisted results cache once workspace is loaded
  useEffect(() => {
    if (!loaded) return;
    let active = true;
    loadInfoCache(customDataDir).then((cache) => {
      if (!active) return;
      const hydrated: Record<string, InfoWidgetRuntimeState> = {};
      for (const [id, entry] of Object.entries(cache)) {
        if (!entry || typeof entry !== "object") continue;
        hydrated[id] = {
          running: false,
          lastResult: entry.lastResult,
          lastSuccessAt: entry.lastSuccessAt,
          history: Array.isArray(entry.history) ? entry.history : [],
        };
      }
      setRuntimeMap((prev) => ({ ...hydrated, ...prev }));
      setCacheLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [loaded, customDataDir]);

  const schedulePersistCache = useCallback(
    (nextMap: Record<string, InfoWidgetRuntimeState>) => {
      if (saveCacheTimerRef.current !== null) {
        window.clearTimeout(saveCacheTimerRef.current);
      }
      saveCacheTimerRef.current = window.setTimeout(() => {
        saveCacheTimerRef.current = null;
        const payload: InfoCacheFile = {};
        const validIds = new Set(
          (workspaceRef.current.infoWidgets ?? []).map((w) => w.id)
        );
        for (const [id, state] of Object.entries(nextMap)) {
          if (!validIds.has(id)) continue;
          payload[id] = {
            lastResult: state.lastResult,
            lastSuccessAt: state.lastSuccessAt,
            history: state.history.slice(0, MAX_HISTORY_PER_WIDGET),
          };
        }
        void saveInfoCache(payload, workspaceRef.current.settings.customDataDir);
      }, 600);
    },
    []
  );

  // Sync External Push Receiver lifecycle with workspace.settings.infoPush
  const pushEnabled = workspace.settings.infoPush?.enabled ?? true;
  const pushPort = workspace.settings.infoPush?.port ?? 18421;
  const pushAllowLan = workspace.settings.infoPush?.allowLan ?? false;
  const pushAutoCreate = workspace.settings.infoPush?.autoCreate ?? true;

  useEffect(() => {
    if (!loaded || !isTauriRuntime()) return;
    let active = true;
    if (pushEnabled) {
      startInfoPushServer(pushPort, pushAllowLan, pushAutoCreate)
        .then((status) => {
          if (active && status) setPushServerStatus(status);
        })
        .catch((err) => {
          if (!active) return;
          getInfoPushServerStatus()
            .then((s) => {
              if (active && s) {
                setPushServerStatus({
                  ...s,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            })
            .catch(() => {});
        });
    } else {
      stopInfoPushServer()
        .then((status) => {
          if (active && status) setPushServerStatus(status);
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [loaded, pushEnabled, pushPort, pushAllowLan, pushAutoCreate]);

  // Sync allowed push keys & tokens into Rust Push Receiver
  useEffect(() => {
    if (!loaded || !isTauriRuntime()) return;
    const rules: InfoPushRule[] = [];
    for (const w of workspace.infoWidgets ?? []) {
      if (w.source.kind !== "push") continue;
      const token = w.source.pushToken?.trim() || undefined;
      const pk = w.source.pushKey?.trim();
      if (pk) rules.push({ key: pk, token });
      rules.push({ key: w.id, token });
    }
    void syncInfoPushRules(rules, pushAutoCreate).catch(() => {});
  }, [loaded, workspace.infoWidgets, pushAutoCreate]);

  // Listen to incoming external push payloads emitted by Rust HTTP listener
  useEffect(() => {
    if (!loaded || !isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<InfoPushEventPayload>("info-push-received", (event) => {
        const payload = event.payload;
        if (!payload || !payload.key) return;

        const ws = workspaceRef.current;
        const widgets = ws.infoWidgets ?? [];
        let target =
          widgets.find(
            (w) =>
              w.source.kind === "push" &&
              (w.source.pushKey?.trim() === payload.key || w.id === payload.key)
          ) ?? widgets.find((w) => w.id === payload.key);

        if (!target) {
          const allowAutoCreate = ws.settings.infoPush?.autoCreate ?? true;
          if (!allowAutoCreate) return;

          const boards =
            ws.infoBoards && ws.infoBoards.length > 0
              ? ws.infoBoards
              : createDefaultInfoBoards();
          const targetBoard = boards[0];
          const boardWidgets = widgets.filter(
            (w) => w.boardId === targetBoard.id
          );
          const slot = findFreePixelSlot(
            boardWidgets.map((bw) => getWidgetPixelRect(bw)),
            DEFAULT_WIDGET_PX_W,
            DEFAULT_WIDGET_PX_H,
            0,
            0,
            SNAP_GAP
          );
          const now = new Date().toISOString();
          target = {
            id: uid("info"),
            boardId: targetBoard.id,
            title: payload.title?.trim() || payload.key,
            description: `自动创建于外部推送 (${payload.remoteAddr})`,
            source: {
              kind: "push",
              pushKey: payload.key,
            },
            schedule: {
              mode: "manual",
            },
            layout: {
              x: 0,
              y: 0,
              w: 4,
              h: 4,
              minW: 2,
              minH: 2,
              px: slot.x,
              py: slot.y,
              pw: DEFAULT_WIDGET_PX_W,
              ph: DEFAULT_WIDGET_PX_H,
            },
            appearance: {
              accentColor: "#38bdf8",
            },
            createdAt: now,
            updatedAt: now,
          };

          onUpdateRef.current({
            ...ws,
            infoBoards: boards,
            infoWidgets: [...widgets, target],
          });
          onNotifyRef.current?.(
            `收到外部推送，已自动创建卡片「${target.title}」`
          );
        }

        const targetId = target.id;
        const syntheticResult: InfoRunResult = {
          ok: true,
          exitCode: 0,
          stdout: payload.body,
          stderr: "",
          durationMs: 0,
          timedOut: false,
          cancelled: false,
          httpStatus: 200,
          ranAt: payload.receivedAt,
        };
        const historyEntry: InfoRunHistoryEntry = {
          ranAt: payload.receivedAt,
          trigger: "push",
          ok: true,
          exitCode: 0,
          durationMs: 0,
          httpStatus: 200,
          stdoutPreview: truncatePreview(payload.body),
          stderrPreview: "",
        };

        setRuntimeMap((prev) => {
          const prevEntry = prev[targetId];
          const nextMap: Record<string, InfoWidgetRuntimeState> = {
            ...prev,
            [targetId]: {
              running: false,
              lastResult: syntheticResult,
              lastSuccessAt: payload.receivedAt,
              history: [historyEntry, ...(prevEntry?.history ?? [])].slice(
                0,
                MAX_HISTORY_PER_WIDGET
              ),
            },
          };
          schedulePersistCache(nextMap);
          return nextMap;
        });
      })
        .then((fn) => {
          unlisten = fn;
        })
        .catch(() => {});
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, [loaded, schedulePersistCache]);

  const applyPushServerConfig = useCallback(
    async (nextCfg: InfoPushServerConfig) => {
      const ws = workspaceRef.current;
      onUpdateRef.current({
        ...ws,
        settings: {
          ...ws.settings,
          infoPush: nextCfg,
        },
      });
      if (!isTauriRuntime()) return null;
      if (nextCfg.enabled) {
        const status = await startInfoPushServer(
          nextCfg.port,
          nextCfg.allowLan,
          nextCfg.autoCreate
        );
        if (status) setPushServerStatus(status);
        return status;
      } else {
        const status = await stopInfoPushServer();
        if (status) setPushServerStatus(status);
        return status;
      }
    },
    []
  );

  const runWidget = useCallback(
    async (
      widget: InfoWidget,
      trigger: "manual" | "schedule" | "startup" = "manual"
    ): Promise<InfoRunResult | null> => {
      if (widget.source.kind === "container") {
        return null;
      }
      if (widget.source.kind === "control") {
        const act = widget.source.controlActionKind ?? "none";
        if (act !== "script" && act !== "command") {
          return null;
        }
      }
      if (widget.source.kind === "push") {
        if (trigger === "manual") {
          onNotifyRef.current?.(
            "该卡片为外部推送数据源，请由外部脚本 POST 数据至推送地址"
          );
        }
        return null;
      }

      const curState = runtimeRef.current[widget.id];
      if (curState?.running && trigger !== "manual") {
        return null;
      }

      const effectiveKind =
        widget.source.kind === "control"
          ? widget.source.controlActionKind === "command"
            ? "command"
            : "script"
          : widget.source.kind;
      const effectiveEnv =
        widget.source.kind === "control" &&
        widget.source.controlType !== "icon"
          ? {
              ...(widget.source.env ?? {}),
              SHIBA_SWITCH_STATE: widget.source.controlState ? "on" : "off",
            }
          : widget.source.env ?? {};

      lastIntervalTickRef.current[widget.id] = Date.now();
      setRuntimeMap((prev) => ({
        ...prev,
        [widget.id]: {
          running: true,
          lastResult: prev[widget.id]?.lastResult,
          lastSuccessAt: prev[widget.id]?.lastSuccessAt,
          history: prev[widget.id]?.history ?? [],
        },
      }));

      try {
        const result = await runInfoSource({
          widgetId: widget.id,
          widgetTitle: widget.title || widget.source.controlLabel || "微组件",
          trigger,
          kind: effectiveKind,
          scriptPath: widget.source.scriptPath,
          inlineCode: widget.source.inlineCode,
          scriptLang: widget.source.scriptLang,
          interpreter: widget.source.interpreter,
          command: widget.source.command,
          args: widget.source.args ?? [],
          cwd: widget.source.cwd,
          useShell: widget.source.useShell,
          url: widget.source.url,
          method: widget.source.method,
          headers: widget.source.headers ?? {},
          body: widget.source.body,
          env: effectiveEnv,
          params: widget.source.params ?? {},
          timeoutSec: widget.source.timeoutSec,
          lastRunAt: curState?.lastSuccessAt,
          customDir: workspaceRef.current.settings.customDataDir,
        });

        const historyEntry: InfoRunHistoryEntry = {
          ranAt: result.ranAt,
          trigger,
          ok: result.ok,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          httpStatus: result.httpStatus,
          error: result.error,
          stdoutPreview: truncatePreview(result.stdout),
          stderrPreview: truncatePreview(result.stderr),
        };

        setRuntimeMap((prev) => {
          const prevEntry = prev[widget.id];
          const nextMap: Record<string, InfoWidgetRuntimeState> = {
            ...prev,
            [widget.id]: {
              running: false,
              lastResult: result,
              lastSuccessAt: result.ok
                ? result.ranAt
                : prevEntry?.lastSuccessAt,
              history: [historyEntry, ...(prevEntry?.history ?? [])].slice(
                0,
                MAX_HISTORY_PER_WIDGET
              ),
            },
          };
          schedulePersistCache(nextMap);
          return nextMap;
        });

        return result;
      } catch (err) {
        const errResult: InfoRunResult = {
          ok: false,
          exitCode: -1,
          stdout: "",
          stderr: "",
          durationMs: 0,
          timedOut: false,
          cancelled: false,
          error: err instanceof Error ? err.message : "执行脚本失败",
          ranAt: new Date().toISOString(),
        };
        setRuntimeMap((prev) => {
          const prevEntry = prev[widget.id];
          const nextMap: Record<string, InfoWidgetRuntimeState> = {
            ...prev,
            [widget.id]: {
              running: false,
              lastResult: errResult,
              lastSuccessAt: prevEntry?.lastSuccessAt,
              history: prevEntry?.history ?? [],
            },
          };
          schedulePersistCache(nextMap);
          return nextMap;
        });
        return errResult;
      }
    },
    [schedulePersistCache]
  );

  const cancelWidget = useCallback(async (widgetId: string) => {
    await cancelInfoRun(widgetId);
  }, []);

  const runAllWidgets = useCallback(
    async (boardId?: string) => {
      const list = (workspaceRef.current.infoWidgets ?? []).filter(
        (w) =>
          w.source.kind !== "push" &&
          w.source.kind !== "container" &&
          w.source.kind !== "control" &&
          (boardId ? w.boardId === boardId : true)
      );
      if (list.length === 0) {
        onNotify?.("当前没有可主动执行的数据源（外部推送卡片无需手动运行）");
        return;
      }
      onNotify?.(`正在刷新 ${list.length} 张信息卡片...`);
      await Promise.allSettled(list.map((w) => runWidget(w, "manual")));
      onNotify?.(`已完成 ${list.length} 张信息卡片刷新`);
    },
    [runWidget, onNotify]
  );

  // Run-on-startup trigger (once per widget per app session, skipping push/container/control sources)
  useEffect(() => {
    if (!loaded || !cacheLoaded) return;
    const widgets = workspace.infoWidgets ?? [];
    const pending = widgets.filter(
      (w) =>
        w.source.kind !== "push" &&
        w.source.kind !== "container" &&
        w.source.kind !== "control" &&
        w.schedule.runOnStartup &&
        !w.schedule.paused &&
        !startupRanRef.current.has(w.id)
    );
    if (pending.length === 0) return;

    const timers: number[] = [];
    pending.forEach((w, idx) => {
      startupRanRef.current.add(w.id);
      const t = window.setTimeout(() => {
        void runWidget(w, "startup");
      }, 250 + idx * 250);
      timers.push(t);
    });
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [loaded, cacheLoaded, workspace.infoWidgets, runWidget]);

  // Background interval & cron ticker (1s resolution, skipping push/container/control sources)
  useEffect(() => {
    if (!loaded || !cacheLoaded) return;
    const timer = window.setInterval(() => {
      const now = new Date();
      const nowMs = now.getTime();
      const minuteKey = getMinuteKey(now);
      const widgets = workspaceRef.current.infoWidgets ?? [];

      for (const w of widgets) {
        if (
          w.source.kind === "push" ||
          w.source.kind === "container" ||
          w.source.kind === "control" ||
          w.schedule.paused
        ) {
          continue;
        }
        const state = runtimeRef.current[w.id];
        if (state?.running) continue;

        if (w.schedule.mode === "interval") {
          const intervalMs =
            Math.max(5, w.schedule.intervalSeconds ?? 300) * 1000;
          const lastTick =
            lastIntervalTickRef.current[w.id] ??
            (state?.lastResult?.ranAt
              ? Date.parse(state.lastResult.ranAt) || 0
              : 0);
          if (nowMs - lastTick >= intervalMs) {
            lastIntervalTickRef.current[w.id] = nowMs;
            void runWidget(w, "schedule");
          }
        } else if (w.schedule.mode === "cron" && w.schedule.cron) {
          if (lastCronMinuteRef.current[w.id] === minuteKey) continue;
          if (matchesCronDate(w.schedule.cron, now)) {
            lastCronMinuteRef.current[w.id] = minuteKey;
            void runWidget(w, "schedule");
          }
        }
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [loaded, cacheLoaded, runWidget]);

  const alertStats = useMemo<InfoAlertStats>(() => {
    const widgets = workspace.infoWidgets ?? [];
    let running = 0;
    let errorCount = 0;
    let warnCount = 0;
    let scheduledCount = 0;
    let pushCount = 0;

    for (const w of widgets) {
      if (w.source.kind === "push") {
        pushCount++;
      } else if (w.schedule.mode !== "manual" && !w.schedule.paused) {
        scheduledCount++;
      }
      const st = runtimeMap[w.id];
      if (st?.running) running++;
      if (st?.lastResult) {
        const parsed = parseInfoOutput(
          st.lastResult,
          w.source.jsonPath,
          w.appearance?.displayView
        );
        if (parsed.status === "error") errorCount++;
        else if (parsed.status === "warn") warnCount++;
      }
    }

    return {
      total: widgets.length,
      running,
      errorCount,
      warnCount,
      scheduledCount,
      pushCount,
    };
  }, [workspace.infoWidgets, runtimeMap]);

  return {
    runtimeMap,
    runWidget,
    cancelWidget,
    runAllWidgets,
    alertStats,
    pushServerStatus,
    applyPushServerConfig,
  };
}
