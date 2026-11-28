const DEADLINES_ALARM = "shiba-deadlines-refresh";
const STARTUP_ALARM = "shiba-startup-sync";
const TASK_ALARM_PREFIX = "shiba-task::";

const DEFAULT_SETTINGS = {
  baseUrl: "http://127.0.0.1:18421",
  token: "",
  theme: "auto",
  clipsPushKey: "browser-clips",
  clipsTitle: "浏览器速记",
  deadlinesPushKey: "browser-deadlines",
  deadlinesTitle: "时间倒计时",
};

const DEFAULT_TASKS = [
  {
    id: "tpl-xhs-fans",
    name: "小红书粉丝",
    cardTitle: "小红书粉丝",
    enabled: true,
    collector: "xiaohongshu",
    pushKey: "xhs-fans",
    urlPattern: "https://creator.xiaohongshu.com/*",
    targetUrl: "https://creator.xiaohongshu.com/new/home",
    autoSyncOnVisit: true,
    runOnStartup: true,
    scheduleMode: "interval",
    intervalMinutes: 60,
    dailyTime: "09:00",
  },
];

let syncQueuePromise = Promise.resolve();

function enqueueSync(fn) {
  const next = syncQueuePromise.then(fn, fn);
  syncQueuePromise = next.catch(() => {});
  return next;
}

function formatLocalDateTime(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatLocalDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatSignedDelta(delta) {
  const num = Number(delta) || 0;
  if (num > 0) return `+${num.toLocaleString("zh-CN")}`;
  if (num < 0) return `${num.toLocaleString("zh-CN")}`;
  return "0";
}

function urlPatternMatches(pattern, url) {
  const raw = String(pattern || "").trim();
  if (!raw || !url) return false;
  const escaped = raw
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  try {
    return new RegExp(`^${escaped}$`, "i").test(url);
  } catch {
    return false;
  }
}

function parseDateTimeFromText(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  let m = /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})[日号]?(?:\s+(\d{1,2}):(\d{1,2}))?/.exec(
    raw
  );
  if (m) {
    const d = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      m[4] ? Number(m[4]) : 23,
      m[5] ? Number(m[5]) : 59
    );
    if (!Number.isNaN(d.getTime())) return d;
  }

  m = /(\d{1,2})月(\d{1,2})[日号]?(?:\s+(\d{1,2}):(\d{1,2}))?/.exec(raw);
  if (m) {
    const now = new Date();
    let d = new Date(
      now.getFullYear(),
      Number(m[1]) - 1,
      Number(m[2]),
      m[3] ? Number(m[3]) : 23,
      m[4] ? Number(m[4]) : 59
    );
    if (d.getTime() < now.getTime() - 86_400_000) {
      d = new Date(
        now.getFullYear() + 1,
        Number(m[1]) - 1,
        Number(m[2]),
        m[3] ? Number(m[3]) : 23,
        m[4] ? Number(m[4]) : 59
      );
    }
    if (!Number.isNaN(d.getTime())) return d;
  }

  return null;
}

async function getSettings() {
  const stored = await chrome.storage.local.get(["shiba_settings"]);
  return { ...DEFAULT_SETTINGS, ...(stored.shiba_settings || {}) };
}

async function getTasks() {
  const stored = await chrome.storage.local.get(["shiba_tasks"]);
  if (Array.isArray(stored.shiba_tasks)) {
    return stored.shiba_tasks;
  }
  await chrome.storage.local.set({ shiba_tasks: DEFAULT_TASKS });
  return [...DEFAULT_TASKS];
}

async function saveTasks(tasks) {
  await chrome.storage.local.set({ shiba_tasks: tasks });
  await syncAllAlarms(tasks);
  await syncRegisteredUserScripts(tasks);
}

function buildUserScriptWrapper(code, task) {
  const safeTaskJson = JSON.stringify({
    id: task.id,
    name: task.name,
    pushKey: task.pushKey,
    targetUrl: task.targetUrl || "",
  });

  return `(async () => {
    const task = ${safeTaskJson};
    const helpers = {
      parseCnCount(raw) {
        if (raw === null || raw === undefined) return null;
        const cleaned = String(raw).replace(/[\\s,+]/g, "").trim();
        if (!cleaned) return null;
        const m = /^(-?\\d+(?:\\.\\d+)?)(亿|万|千|[wWkK])?$/.exec(cleaned);
        if (!m) return null;
        const num = Number(m[1]);
        if (!Number.isFinite(num) || num < 0) return null;
        const unit = m[2] ? m[2].toLowerCase() : "";
        let mult = 1;
        if (unit === "亿") mult = 100000000;
        else if (unit === "万" || unit === "w") mult = 10000;
        else if (unit === "千" || unit === "k") mult = 1000;
        return Math.round(num * mult);
      }
    };
    try {
      const __userFn = async () => {
        ${code}
      };
      const out = await __userFn();
      if (out && typeof out === "object" && "ok" in out) {
        return out;
      }
      if (out === null || out === undefined) {
        return { ok: false, reason: "脚本未返回数据（请使用 return 返回对象或数值）" };
      }
      return { ok: true, data: out };
    } catch (err) {
      return { ok: false, reason: err && err.message ? err.message : String(err) };
    }
  })()`;
}

function buildRegisteredListenerScript(task) {
  const eventName = `shiba-run-script:${task.id}`;
  const wrapper = buildUserScriptWrapper(task.customCode || "", task);
  return `(() => {
    const evtName = ${JSON.stringify(eventName)};
    window.addEventListener(evtName, async (ev) => {
      const runId = ev && ev.detail && ev.detail.runId;
      let res;
      try {
        res = await ${wrapper};
      } catch (err) {
        res = { ok: false, reason: err && err.message ? err.message : String(err) };
      }
      if (runId) {
        window.dispatchEvent(new CustomEvent("shiba-script-result:" + runId, { detail: res }));
      }
    });
  })();`;
}

async function syncRegisteredUserScripts(tasksArg) {
  try {
    if (!chrome.userScripts || typeof chrome.userScripts.register !== "function") return;
    if (typeof chrome.userScripts.execute === "function") return;

    const tasks = tasksArg || (await getTasks());
    const customTasks = tasks.filter(
      (t) => t && t.enabled && t.collector === "custom_js" && String(t.customCode || "").trim()
    );

    const existing = await chrome.userScripts.getScripts().catch(() => []);
    if (Array.isArray(existing) && existing.length > 0) {
      await chrome.userScripts
        .unregister({ ids: existing.map((s) => s.id) })
        .catch(() => {});
    }

    if (customTasks.length === 0) return;

    const toRegister = customTasks.map((task) => ({
      id: `shiba-us-${task.id}`,
      matches: [
        task.urlPattern && String(task.urlPattern).includes("://")
          ? String(task.urlPattern)
          : "<all_urls>",
      ],
      world: "USER_SCRIPT",
      runAt: "document_idle",
      js: [{ code: buildRegisteredListenerScript(task) }],
    }));

    await chrome.userScripts.register(toRegister).catch(() => {});
  } catch {
    // Ignore when userScripts API is disabled by browser
  }
}

function computeNextDailyTimestamp(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "09:00").trim());
  const hour = m ? Math.min(23, Math.max(0, Number(m[1]))) : 9;
  const min = m ? Math.min(59, Math.max(0, Number(m[2]))) : 0;

  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, min, 0, 0);
  if (next.getTime() <= now.getTime() + 5000) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime();
}

async function syncAllAlarms(tasksArg) {
  const tasks = tasksArg || (await getTasks());
  const existing = await chrome.alarms.getAll();
  for (const alarm of existing) {
    if (alarm.name.startsWith(TASK_ALARM_PREFIX) || alarm.name === DEADLINES_ALARM) {
      await chrome.alarms.clear(alarm.name);
    }
  }

  for (const task of tasks) {
    if (!task?.enabled) continue;
    const alarmName = `${TASK_ALARM_PREFIX}${task.id}`;
    if (task.scheduleMode === "interval") {
      const periodInMinutes = Math.max(15, Number(task.intervalMinutes) || 60);
      await chrome.alarms.create(alarmName, { periodInMinutes });
    } else if (task.scheduleMode === "daily") {
      await chrome.alarms.create(alarmName, {
        when: computeNextDailyTimestamp(task.dailyTime),
        periodInMinutes: 1440,
      });
    }
  }

  const stored = await chrome.storage.local.get(["shiba_deadlines"]);
  if (Array.isArray(stored.shiba_deadlines) && stored.shiba_deadlines.length > 0) {
    await chrome.alarms.create(DEADLINES_ALARM, { periodInMinutes: 60 });
  }
}

async function pushPayloadToShibaPlan(pushKey, cardTitle, payload) {
  const settings = await getSettings();
  const baseUrl = String(settings.baseUrl || DEFAULT_SETTINGS.baseUrl).replace(/\/+$/, "");
  const cleanKey = String(pushKey || "").trim();
  if (!cleanKey) {
    throw new Error("未配置 pushKey");
  }

  const titleParam = cardTitle ? `?title=${encodeURIComponent(cardTitle)}` : "";
  const url = `${baseUrl}/api/info/push/${encodeURIComponent(cleanKey)}${titleParam}`;

  const headers = {
    "Content-Type": "application/json; charset=utf-8",
  };
  if (settings.token && settings.token.trim()) {
    headers["Authorization"] = `Bearer ${settings.token.trim()}`;
  }

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    let detail = "";
    try {
      detail = await resp.text();
    } catch {}
    throw new Error(`推送失败 HTTP ${resp.status}${detail ? `: ${detail}` : ""}`);
  }
  return await resp.json();
}

async function recordTaskHistoryAndPush(task, data) {
  const now = new Date();
  const ts = formatLocalDateTime(now);
  const today = formatLocalDate(now);

  const stored = await chrome.storage.local.get(["shiba_history_map", "shiba_last_runs"]);
  const historyMap = stored.shiba_history_map && typeof stored.shiba_history_map === "object"
    ? { ...stored.shiba_history_map }
    : {};
  const lastRuns = stored.shiba_last_runs && typeof stored.shiba_last_runs === "object"
    ? { ...stored.shiba_last_runs }
    : {};

  const hasNumeric = typeof data.numericValue === "number" && Number.isFinite(data.numericValue);
  let trend = "已同步";
  let sparkline;
  let tone = "ok";
  let todayChangeText = "首次记录";
  let prevChangeText = "首次记录";

  if (hasNumeric) {
    const history = Array.isArray(historyMap[task.id]) ? [...historyMap[task.id]] : [];
    const curVal = Number(data.numericValue);
    const hasPrev = history.length > 0;
    let prevDelta = 0;
    let todayDelta = 0;
    let hasTodayBaseline = false;

    if (hasPrev) {
      const last = history[history.length - 1];
      prevDelta = curVal - Number(last.value || 0);

      let baseline = null;
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].date < today) {
          baseline = history[i];
          break;
        }
      }
      if (!baseline) {
        baseline = history.find((entry) => entry.date === today) || null;
      }
      if (baseline) {
        hasTodayBaseline = true;
        todayDelta = curVal - Number(baseline.value || 0);
      }
    }

    const entry = { ts, date: today, value: curVal };
    let replaceLast = false;
    if (history.length > 0 && history[history.length - 1].date === today) {
      const lastMs = Date.parse(String(history[history.length - 1].ts).replace(" ", "T"));
      if (!Number.isNaN(lastMs) && now.getTime() - lastMs < 60_000) {
        replaceLast = true;
      }
    }
    if (replaceLast) {
      history[history.length - 1] = entry;
    } else {
      history.push(entry);
    }
    while (history.length > 60) {
      history.shift();
    }
    historyMap[task.id] = history;

    if (!hasPrev || !hasTodayBaseline) {
      trend = "首次记录";
    } else {
      if (todayDelta > 0) trend = `+${todayDelta.toLocaleString("zh-CN")} 今日`;
      else if (todayDelta < 0) trend = `${todayDelta.toLocaleString("zh-CN")} 今日`;
      else trend = "今日持平";
      todayChangeText = formatSignedDelta(todayDelta);
      prevChangeText = formatSignedDelta(prevDelta);
      if (todayDelta < 0) tone = "warn";
    }

    if (history.length >= 2) {
      sparkline = history.slice(-12).map((h) => Number(h.value));
    }
  }

  const displayValue = hasNumeric
    ? Number(data.numericValue).toLocaleString("zh-CN")
    : String(data.value ?? "-");

  const tooltipItems = [];
  if (Array.isArray(data.extraItems)) {
    for (const extra of data.extraItems) {
      if (extra?.label && extra?.value !== undefined) {
        tooltipItems.push({ label: String(extra.label), value: String(extra.value) });
      }
    }
  }
  tooltipItems.push({ label: "当前值", value: String(data.rawValue ?? displayValue) });
  if (hasNumeric) {
    tooltipItems.push({ label: "今日变化", value: todayChangeText });
    tooltipItems.push({ label: "较上次", value: prevChangeText });
  }
  tooltipItems.push(
    { label: "同步方式", value: data.sourceType || task.collector },
    { label: "更新时间", value: ts }
  );
  if (data.pageUrl) {
    tooltipItems.push({ label: "来源页", value: data.pageUrl });
  }

  const metricItem = {
    label: task.cardTitle || task.name || data.label || "指标",
    value: displayValue,
    unit: data.unit || "",
    trend,
    tone,
    tooltip: {
      title: `${task.cardTitle || task.name} 详情`,
      items: tooltipItems,
    },
  };
  if (sparkline && sparkline.length >= 2) {
    metricItem.sparkline = sparkline;
  }

  const payload = {
    schema: "shibaplan-info/v1",
    status: tone,
    view: "metrics",
    items: [metricItem],
  };

  await pushPayloadToShibaPlan(task.pushKey, task.cardTitle || task.name, payload);

  const runInfo = {
    ok: true,
    value: displayValue,
    trend,
    ranAt: ts,
    error: "",
  };
  lastRuns[task.id] = runInfo;
  await chrome.storage.local.set({
    shiba_history_map: historyMap,
    shiba_last_runs: lastRuns,
  });

  return runInfo;
}

async function waitForTabComplete(tabId, timeoutMs = 15000) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === "complete") return;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("等待页面加载超时"));
    }, timeoutMs);

    function onUpdated(updatedId, changeInfo) {
      if (updatedId === tabId && changeInfo.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

function tabMatchesTask(tab, task) {
  const url = tab?.url || "";
  if (!url.startsWith("http")) return false;
  if (task.targetUrl && url === task.targetUrl) return true;
  if (task.urlPattern && urlPatternMatches(task.urlPattern, url)) return true;
  if (
    task.collector === "xiaohongshu" &&
    (url.startsWith("https://creator.xiaohongshu.com/") ||
      url.includes("xiaohongshu.com/user/profile/"))
  ) {
    return true;
  }
  if (!task.targetUrl && !task.urlPattern) return true;
  return false;
}

async function findMatchingTabForTask(task) {
  const allTabs = await chrome.tabs.query({});
  if (task.targetUrl) {
    const exact = allTabs.find((t) => t.url === task.targetUrl);
    if (exact) return exact;
  }
  if (task.urlPattern) {
    const byPattern = allTabs.find((t) => urlPatternMatches(task.urlPattern, t.url || ""));
    if (byPattern) return byPattern;
  }
  if (task.collector === "xiaohongshu") {
    const creator = allTabs.find((t) =>
      (t.url || "").startsWith("https://creator.xiaohongshu.com/")
    );
    if (creator) return creator;
  }
  return null;
}

function extractJsonPath(data, rawPath) {
  const cleaned = String(rawPath || "").trim().replace(/^\$\.?/, "");
  if (!cleaned) return data;

  const tokens = [];
  const partRe = /[^.[\]]+|\[(\d+)\]/g;
  let match;
  while ((match = partRe.exec(cleaned)) !== null) {
    if (match[1] !== undefined) {
      tokens.push(Number(match[1]));
    } else {
      tokens.push(match[0]);
    }
  }

  let cur = data;
  for (const tk of tokens) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof tk === "number") {
      if (Array.isArray(cur)) cur = cur[tk];
      else return undefined;
    } else if (typeof cur === "object") {
      cur = cur[tk];
    } else {
      return undefined;
    }
  }
  return cur;
}

function parseFlexibleNumberForFetch(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const text = String(raw).trim();
  if (!text) return null;
  const m = /(-?\d[\d,]*(?:\.\d+)?)\s*(亿|万|千|[wWkK])?/.exec(text);
  if (!m) return null;
  const base = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const unit = m[2] ? m[2].toLowerCase() : "";
  let multiplier = 1;
  if (unit === "亿") multiplier = 100000000;
  else if (unit === "万" || unit === "w") multiplier = 10000;
  else if (unit === "千" || unit === "k") multiplier = 1000;
  return multiplier === 1 ? base : Math.round(base * multiplier);
}

async function runFetchCollector(task) {
  const url = String(task.targetUrl || "").trim();
  if (!url) {
    throw new Error("后台接口抓取必须配置目标网址 (targetUrl)");
  }

  const cfg = task.fetchConfig || {};
  const resp = await fetch(url, {
    method: "GET",
    credentials: "include",
  });
  if (!resp.ok) {
    throw new Error(`后台请求失败 HTTP ${resp.status}`);
  }

  const rawText = await resp.text();
  let extracted = rawText.trim();
  const jsonPath = String(cfg.jsonPath || "").trim();

  if (jsonPath || extracted.startsWith("{") || extracted.startsWith("[")) {
    try {
      const parsedJson = JSON.parse(extracted);
      const picked = extractJsonPath(parsedJson, jsonPath);
      if (picked === undefined || picked === null) {
        throw new Error(`JSONPath 未匹配到值: ${jsonPath || "$"}`);
      }
      extracted = typeof picked === "object" ? JSON.stringify(picked) : String(picked);
    } catch (err) {
      if (jsonPath) {
        throw new Error(err?.message || "解析 JSONPath 失败");
      }
    }
  }

  const regexStr = String(cfg.regex || "").trim();
  if (regexStr) {
    try {
      const m = new RegExp(regexStr).exec(extracted);
      if (m) extracted = String(m[1] ?? m[0] ?? extracted).trim();
    } catch {}
  }

  const parseNumber = cfg.parseNumber !== false;
  const numericValue = parseNumber ? parseFlexibleNumberForFetch(extracted) : null;
  const displayValue = numericValue !== null ? numericValue : extracted;

  return {
    value: displayValue,
    numericValue,
    rawValue: extracted,
    label: task.cardTitle || task.name || "后台接口",
    unit: String(cfg.unit || ""),
    sourceType: "后台接口静默抓取",
    extraItems: [],
    pageUrl: url,
  };
}

async function executeCustomJsInTab(tabId, task) {
  const code = String(task.customCode || "").trim();
  if (!code) {
    throw new Error("自定义脚本代码为空，请先在编辑页编写 JS 代码");
  }

  if (!chrome.userScripts) {
    throw new Error(
      "浏览器未启用用户脚本权限：请在扩展详情页开启「允许用户脚本」和「开发者模式」后重试"
    );
  }

  let rawResult;
  if (typeof chrome.userScripts.execute === "function") {
    try {
      const results = await chrome.userScripts.execute({
        target: { tabId },
        world: "USER_SCRIPT",
        js: [{ code: buildUserScriptWrapper(code, task) }],
      });
      rawResult = results?.[0]?.result;
    } catch (err) {
      const msg = err?.message || String(err);
      if (/developer|user script|permission/i.test(msg)) {
        throw new Error(
          "浏览器未启用用户脚本权限：请在扩展详情页开启「允许用户脚本」和「开发者模式」后重试"
        );
      }
      throw new Error(`执行自定义脚本失败: ${msg}`);
    }
  } else if (typeof chrome.userScripts.register === "function") {
    await syncRegisteredUserScripts();
    rawResult = await chrome.tabs.sendMessage(tabId, {
      type: "RUN_USER_SCRIPT_EVENT",
      taskId: task.id,
    });
  } else {
    throw new Error(
      "当前浏览器不支持动态用户脚本执行，请升级 Chrome/Edge 或改用内置/CSS 选择器模式"
    );
  }

  if (!rawResult?.ok) {
    return rawResult || { ok: false, reason: "自定义脚本未返回有效结果" };
  }

  const d = rawResult.data;
  const obj = d && typeof d === "object" && !Array.isArray(d) ? d : { value: d };
  const rawVal = obj.rawValue ?? obj.value;
  let numericValue =
    typeof obj.numericValue === "number" && Number.isFinite(obj.numericValue)
      ? obj.numericValue
      : null;
  if (numericValue === null && task.customParseNumber !== false) {
    numericValue = parseFlexibleNumberForFetch(rawVal);
  }

  return {
    ok: true,
    data: {
      value: numericValue !== null ? numericValue : String(rawVal ?? "-"),
      numericValue,
      rawValue: String(rawVal ?? "-"),
      label: obj.label || task.cardTitle || task.name,
      unit: String(obj.unit || ""),
      sourceType: "自定义 JS 脚本",
      extraItems: Array.isArray(obj.extraItems) ? obj.extraItems : [],
      pageUrl: obj.pageUrl || task.targetUrl || "",
    },
  };
}

async function runTaskSyncImpl(taskId, interactive = true, preferredTabId = null) {
  const tasks = await getTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) {
    throw new Error("未找到指定采集脚本");
  }

  if (task.collector === "fetch") {
    try {
      const data = await runFetchCollector(task);
      return await recordTaskHistoryAndPush(task, data);
    } catch (err) {
      const stored = await chrome.storage.local.get(["shiba_last_runs"]);
      const lastRuns = { ...(stored.shiba_last_runs || {}) };
      lastRuns[task.id] = {
        ok: false,
        ranAt: formatLocalDateTime(),
        error: err?.message || "后台抓取失败",
      };
      await chrome.storage.local.set({ shiba_last_runs: lastRuns });
      throw err;
    }
  }

  let tab = null;
  if (preferredTabId) {
    try {
      const candidate = await chrome.tabs.get(preferredTabId);
      if (tabMatchesTask(candidate, task)) {
        tab = candidate;
      }
    } catch {}
  }
  if (!tab) {
    tab = await findMatchingTabForTask(task);
  }

  let createdTempTab = false;
  let keepTabOpen = false;
  if (!tab) {
    const openUrl = (task.targetUrl || "").trim();
    if (!openUrl) {
      throw new Error("未找到匹配标签页，且脚本未配置目标 URL");
    }
    tab = await chrome.tabs.create({ url: openUrl, active: false });
    createdTempTab = true;
    await waitForTabComplete(tab.id, 18000);
  }

  try {
    let extractRes;
    if (task.collector === "custom_js") {
      const maxAttempts = createdTempTab ? 6 : 1;
      for (let i = 0; i < maxAttempts; i++) {
        extractRes = await executeCustomJsInTab(tab.id, task);
        if (extractRes?.ok || extractRes?.needsLogin) break;
        if (i < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, 600));
        }
      }
      if (extractRes?.ok && !extractRes.data.pageUrl) {
        extractRes.data.pageUrl = tab.url || task.targetUrl || "";
      }
    } else {
      const maxSendAttempts = createdTempTab ? 3 : 1;
      let lastSendErr = null;
      for (let i = 0; i < maxSendAttempts; i++) {
        try {
          extractRes = await chrome.tabs.sendMessage(tab.id, { type: "RUN_COLLECTOR", task });
          lastSendErr = null;
          break;
        } catch (err) {
          lastSendErr = err;
          if (i < maxSendAttempts - 1) {
            await new Promise((r) => setTimeout(r, 350));
          }
        }
      }
      if (lastSendErr) {
        throw new Error("无法连接页面脚本，请刷新目标网页或检查网址是否正确");
      }
    }

    if (!extractRes?.ok) {
      if (extractRes?.needsLogin && interactive) {
        keepTabOpen = true;
        await chrome.tabs.update(tab.id, { active: true });
      }
      const errMsg = extractRes?.reason || "未提取到目标数据";
      const stored = await chrome.storage.local.get(["shiba_last_runs"]);
      const lastRuns = { ...(stored.shiba_last_runs || {}) };
      lastRuns[task.id] = {
        ok: false,
        ranAt: formatLocalDateTime(),
        error: errMsg,
      };
      await chrome.storage.local.set({ shiba_last_runs: lastRuns });
      throw new Error(errMsg);
    }

    return await recordTaskHistoryAndPush(task, extractRes.data);
  } finally {
    if (createdTempTab && !keepTabOpen && tab?.id) {
      chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
}

function runTaskSync(taskId, interactive = true, preferredTabId = null) {
  return enqueueSync(() => runTaskSyncImpl(taskId, interactive, preferredTabId));
}

async function syncAllEnabledTasks(interactive = false) {
  const tasks = await getTasks();
  const candidates = tasks.filter(
    (t) => t && t.enabled && (interactive || t.runOnStartup !== false)
  );
  const details = [];
  let succeeded = 0;
  let failed = 0;

  for (const task of candidates) {
    try {
      const res = await runTaskSync(task.id, interactive, null);
      succeeded++;
      details.push({ id: task.id, name: task.name, ok: true, value: res.value });
    } catch (err) {
      failed++;
      details.push({
        id: task.id,
        name: task.name,
        ok: false,
        error: err?.message || "同步失败",
      });
    }
  }

  return { total: candidates.length, succeeded, failed, details };
}

async function pushClipsList(clips) {
  const settings = await getSettings();
  const listItems = clips.map((clip) => ({
    title: clip.title,
    subtitle: clip.subtitle,
    tag: clip.tag || "网页",
    time: clip.time,
    tone: clip.tone || "info",
    url: clip.url,
    tooltip: {
      title: clip.title,
      items: [
        { label: "来源", value: clip.pageTitle || "-" },
        { label: "链接", value: clip.url || "-" },
        { label: "记录时间", value: clip.createdAt },
      ],
      text: clip.rawText,
    },
  }));

  await pushPayloadToShibaPlan(settings.clipsPushKey, settings.clipsTitle, {
    schema: "shibaplan-info/v1",
    status: "info",
    badge: `${listItems.length} 条`,
    view: "list",
    items: listItems,
  });
}

async function addClipAndPush({ text, url, pageTitle }) {
  const cleanText = String(text || "").trim();
  const parsedDate = parseDateTimeFromText(cleanText);
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;

  let hostname = "网页";
  try {
    hostname = new URL(url).hostname.replace(/^www\./, "");
  } catch {}

  const title = cleanSelTitle(cleanText, pageTitle || hostname);
  const clip = {
    id: `clip-${Date.now().toString(36)}`,
    title,
    subtitle: parsedDate
      ? `识别到时间：${formatLocalDateTime(parsedDate).slice(0, 16)} · ${hostname}`
      : pageTitle || url,
    tag: parsedDate ? "含时间" : hostname,
    time: timeStr,
    tone: parsedDate ? "warn" : "info",
    url,
    pageTitle: pageTitle || hostname,
    rawText: cleanText || pageTitle || url,
    createdAt: formatLocalDateTime(now),
  };

  const stored = await chrome.storage.local.get(["shiba_clips"]);
  const clips = Array.isArray(stored.shiba_clips) ? [clip, ...stored.shiba_clips] : [clip];
  const trimmed = clips.slice(0, 20);
  await chrome.storage.local.set({ shiba_clips: trimmed });
  await pushClipsList(trimmed);
  return clip;
}

function cleanSelTitle(cleanText, fallback) {
  if (!cleanText) return String(fallback || "网页书签").slice(0, 48);
  const oneLine = cleanText.replace(/\s+/g, " ").trim();
  return oneLine.length > 48 ? `${oneLine.slice(0, 48)}…` : oneLine;
}

async function pushDeadlinesList(deadlinesArg) {
  const settings = await getSettings();
  const stored = await chrome.storage.local.get(["shiba_deadlines"]);
  const deadlines = deadlinesArg || (Array.isArray(stored.shiba_deadlines) ? stored.shiba_deadlines : []);

  const nowMs = Date.now();
  const sorted = [...deadlines].sort(
    (a, b) => Date.parse(a.targetIso) - Date.parse(b.targetIso)
  );

  let hasAlert = false;
  let hasExpiring = false;

  const kvItems = sorted.map((d) => {
    const targetMs = Date.parse(d.targetIso);
    const diffDays = (targetMs - nowMs) / 86_400_000;
    const warnThreshold = Math.max(0, Number(d.warningDays ?? 7));

    let valueText;
    let tone = "ok";
    let statusLabel = "正常";

    if (diffDays <= 0) {
      hasAlert = true;
      hasExpiring = true;
      tone = "error";
      valueText = "已到期";
      statusLabel = "已到期";
    } else if (diffDays <= warnThreshold) {
      hasAlert = true;
      hasExpiring = true;
      tone = "error";
      const daysFloor = Math.floor(diffDays);
      if (daysFloor < 1) {
        const hrs = Math.max(1, Math.ceil(diffDays * 24));
        valueText = `仅剩 ${hrs} 小时`;
      } else {
        valueText = `仅剩 ${daysFloor} 天`;
      }
      statusLabel = `即将到期（<= ${warnThreshold} 天）`;
    } else {
      valueText = `剩余 ${Math.floor(diffDays)} 天`;
    }

    const tooltipItems = [
      { label: "状态", value: statusLabel },
      { label: "目标时间", value: formatLocalDateTime(new Date(targetMs)).slice(0, 16) },
      { label: "剩余精确值", value: `${diffDays.toFixed(1)} 天` },
    ];
    if (d.sourceTitle) tooltipItems.push({ label: "来源页面", value: d.sourceTitle });
    if (d.sourceUrl) tooltipItems.push({ label: "来源链接", value: d.sourceUrl });

    return {
      key: d.title,
      value: valueText,
      tone,
      tooltip: {
        title: `${d.title} · 倒计时`,
        items: tooltipItems,
        text: d.sourceText || undefined,
      },
    };
  });

  const payload = {
    schema: "shibaplan-info/v1",
    status: hasAlert ? "error" : "ok",
    view: "kv",
    items: kvItems,
  };
  if (hasAlert && hasExpiring) {
    payload.badge = "即将到期";
  }

  await pushPayloadToShibaPlan(settings.deadlinesPushKey, settings.deadlinesTitle, payload);
  return sorted;
}

async function addDeadlineAndPush(item) {
  const stored = await chrome.storage.local.get(["shiba_deadlines"]);
  const list = Array.isArray(stored.shiba_deadlines) ? [...stored.shiba_deadlines] : [];
  const nextItem = {
    id: `dl-${Date.now().toString(36)}`,
    title: String(item.title || "未命名时间").trim(),
    targetIso: item.targetIso,
    warningDays: Math.max(0, Number(item.warningDays ?? 7)),
    sourceText: item.sourceText || "",
    sourceUrl: item.sourceUrl || "",
    sourceTitle: item.sourceTitle || "",
    createdAt: formatLocalDateTime(),
  };
  list.push(nextItem);
  await chrome.storage.local.set({ shiba_deadlines: list });
  await syncAllAlarms();
  await pushDeadlinesList(list);
  return nextItem;
}

async function rebuildContextMenus() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: "shiba-root",
    title: "ShibaPlan 助手",
    contexts: ["page", "selection", "link"],
  });
  chrome.contextMenus.create({
    id: "shiba-push-selection",
    parentId: "shiba-root",
    title: "推送选中内容到 ShibaPlan",
    contexts: ["selection"],
  });
  chrome.contextMenus.create({
    id: "shiba-push-deadline",
    parentId: "shiba-root",
    title: "选择时间添加倒计时推送...",
    contexts: ["selection", "page"],
  });
  chrome.contextMenus.create({
    id: "shiba-pick-element",
    parentId: "shiba-root",
    title: "点选网页元素添加监控脚本",
    contexts: ["page", "selection", "link"],
  });
  chrome.contextMenus.create({
    id: "shiba-push-page",
    parentId: "shiba-root",
    title: "推送当前网页到 ShibaPlan",
    contexts: ["page", "link"],
  });
  chrome.contextMenus.create({
    id: "shiba-sync-tab",
    parentId: "shiba-root",
    title: "立即同步当前页匹配脚本",
    contexts: ["page"],
  });
}

async function safeSendTabToast(tabId, text, kind = "ok") {
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: "SHOW_TOAST", text, kind });
  } catch {}
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const tabId = tab?.id;
  if (info.menuItemId === "shiba-push-selection") {
    addClipAndPush({
      text: info.selectionText || "",
      url: info.pageUrl || tab?.url || "",
      pageTitle: tab?.title || "",
    })
      .then((clip) => safeSendTabToast(tabId, `已推送「${clip.title}」到 ShibaPlan`))
      .catch((err) => safeSendTabToast(tabId, err?.message || "推送失败", "error"));
    return;
  }

  if (info.menuItemId === "shiba-push-page") {
    addClipAndPush({
      text: "",
      url: info.linkUrl || info.pageUrl || tab?.url || "",
      pageTitle: tab?.title || info.linkUrl || "",
    })
      .then((clip) => safeSendTabToast(tabId, `已推送网页「${clip.title}」`))
      .catch((err) => safeSendTabToast(tabId, err?.message || "推送失败", "error"));
    return;
  }

  if (info.menuItemId === "shiba-push-deadline" && tabId) {
    chrome.tabs
      .sendMessage(tabId, {
        type: "OPEN_DEADLINE_MODAL",
        selectionText: info.selectionText || "",
        pageUrl: info.pageUrl || tab?.url || "",
        pageTitle: tab?.title || "",
      })
      .catch(() => {});
    return;
  }

  if (info.menuItemId === "shiba-pick-element" && tabId) {
    chrome.tabs.sendMessage(tabId, { type: "START_ELEMENT_PICKER" }).catch(() => {});
    return;
  }

  if (info.menuItemId === "shiba-sync-tab" && tabId) {
    (async () => {
      const tasks = await getTasks();
      const url = tab?.url || "";
      const matched = tasks.filter(
        (t) =>
          t.enabled &&
          ((t.urlPattern && urlPatternMatches(t.urlPattern, url)) ||
            (t.collector === "xiaohongshu" &&
              (url.startsWith("https://creator.xiaohongshu.com/") ||
                url.includes("/user/profile/"))))
      );
      if (matched.length === 0) {
        await safeSendTabToast(tabId, "当前网页暂无匹配的启用脚本", "error");
        return;
      }
      for (const task of matched) {
        await runTaskSync(task.id, true, tabId);
      }
      await safeSendTabToast(tabId, `已同步 ${matched.length} 个脚本到 ShibaPlan`);
    })().catch((err) => safeSendTabToast(tabId, err?.message || "同步失败", "error"));
  }
});

chrome.runtime.onInstalled.addListener(() => {
  rebuildContextMenus().catch(() => {});
  getTasks()
    .then(async (tasks) => {
      await syncAllAlarms(tasks);
      await syncRegisteredUserScripts(tasks);
    })
    .catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  rebuildContextMenus().catch(() => {});
  getTasks()
    .then(async (tasks) => {
      await syncAllAlarms(tasks);
      await syncRegisteredUserScripts(tasks);
    })
    .catch(() => {});
  chrome.alarms.create(STARTUP_ALARM, { delayInMinutes: 0.25 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === STARTUP_ALARM) {
    syncAllEnabledTasks(false).catch(() => {});
    chrome.storage.local
      .get(["shiba_deadlines"])
      .then((s) => {
        if (Array.isArray(s.shiba_deadlines) && s.shiba_deadlines.length > 0) {
          return pushDeadlinesList(s.shiba_deadlines);
        }
      })
      .catch(() => {});
    return;
  }
  if (alarm.name === DEADLINES_ALARM) {
    pushDeadlinesList().catch(() => {});
    return;
  }
  if (alarm.name.startsWith(TASK_ALARM_PREFIX)) {
    const taskId = alarm.name.slice(TASK_ALARM_PREFIX.length);
    runTaskSync(taskId, false).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handle = async () => {
    switch (message?.type) {
      case "GET_STATE": {
        const [settings, tasks, stored] = await Promise.all([
          getSettings(),
          getTasks(),
          chrome.storage.local.get(["shiba_last_runs", "shiba_deadlines", "shiba_clips"]),
        ]);
        return {
          ok: true,
          settings,
          tasks,
          lastRuns: stored.shiba_last_runs || {},
          deadlines: Array.isArray(stored.shiba_deadlines) ? stored.shiba_deadlines : [],
          clips: Array.isArray(stored.shiba_clips) ? stored.shiba_clips : [],
        };
      }
      case "SAVE_SETTINGS": {
        const cur = await getSettings();
        const merged = { ...cur, ...(message.settings || {}) };
        await chrome.storage.local.set({ shiba_settings: merged });
        return { ok: true, settings: merged };
      }
      case "TEST_HEALTH": {
        const settings = await getSettings();
        const base = String(message.baseUrl || settings.baseUrl || DEFAULT_SETTINGS.baseUrl).replace(
          /\/+$/,
          ""
        );
        const resp = await fetch(`${base}/api/info/health`, { method: "GET" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        if (!json?.ok) throw new Error("服务响应异常");
        return { ok: true, result: json };
      }
      case "UPSERT_TASK": {
        const tasks = await getTasks();
        const incoming = message.task;
        if (!incoming?.id) throw new Error("缺少脚本 ID");
        const idx = tasks.findIndex((t) => t.id === incoming.id);
        if (idx >= 0) tasks[idx] = { ...tasks[idx], ...incoming };
        else tasks.push(incoming);
        await saveTasks(tasks);
        return { ok: true, tasks };
      }
      case "DELETE_TASK": {
        const tasks = (await getTasks()).filter((t) => t.id !== message.taskId);
        const stored = await chrome.storage.local.get(["shiba_history_map", "shiba_last_runs"]);
        const historyMap = { ...(stored.shiba_history_map || {}) };
        const lastRuns = { ...(stored.shiba_last_runs || {}) };
        delete historyMap[message.taskId];
        delete lastRuns[message.taskId];
        await chrome.storage.local.set({
          shiba_history_map: historyMap,
          shiba_last_runs: lastRuns,
        });
        await saveTasks(tasks);
        return { ok: true, tasks };
      }
      case "SYNC_TASK": {
        const result = await runTaskSync(message.taskId, true, message.tabId || null);
        return { ok: true, result };
      }
      case "SYNC_ALL_ENABLED": {
        const results = await syncAllEnabledTasks(true);
        return { ok: true, results };
      }
      case "CREATE_AND_SYNC_TASK": {
        const tasks = await getTasks();
        const incoming = message.task;
        if (!incoming?.id) throw new Error("缺少脚本 ID");
        tasks.push(incoming);
        await saveTasks(tasks);
        const result = await runTaskSync(incoming.id, true, _sender?.tab?.id || null);
        return { ok: true, result, tasks };
      }
      case "TASK_COLLECTED": {
        const tasks = await getTasks();
        const task = tasks.find((t) => t.id === message.taskId);
        if (!task) throw new Error("未找到匹配脚本");
        const result = await recordTaskHistoryAndPush(task, message.data);
        return { ok: true, result };
      }
      case "ADD_DEADLINE": {
        const created = await addDeadlineAndPush(message.item || {});
        return { ok: true, item: created };
      }
      case "DELETE_DEADLINE": {
        const stored = await chrome.storage.local.get(["shiba_deadlines"]);
        const next = (Array.isArray(stored.shiba_deadlines) ? stored.shiba_deadlines : []).filter(
          (d) => d.id !== message.id
        );
        await chrome.storage.local.set({ shiba_deadlines: next });
        await syncAllAlarms();
        await pushDeadlinesList(next);
        return { ok: true, deadlines: next };
      }
      case "PUSH_DEADLINES_NOW": {
        const list = await pushDeadlinesList();
        return { ok: true, deadlines: list };
      }
      case "PUSH_PAGE_NOW": {
        const clip = await addClipAndPush({
          text: message.text || "",
          url: message.url || "",
          pageTitle: message.pageTitle || "",
        });
        return { ok: true, clip };
      }
      case "CLEAR_CLIPS": {
        await chrome.storage.local.set({ shiba_clips: [] });
        await pushClipsList([]);
        return { ok: true };
      }
      case "EXPORT_LOCAL_BACKUP": {
        const dump = await chrome.storage.local.get(null);
        return { ok: true, data: dump };
      }
      case "IMPORT_LOCAL_BACKUP": {
        const data = message.data;
        if (!data || typeof data !== "object") throw new Error("备份格式无效");
        await chrome.storage.local.set(data);
        await syncAllAlarms();
        return { ok: true };
      }
      default:
        return { ok: false, error: "未知消息类型" };
    }
  };

  handle()
    .then((res) => sendResponse(res))
    .catch((err) => sendResponse({ ok: false, error: err?.message || "操作失败" }));

  return true;
});
