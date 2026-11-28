const CODE_TEMPLATES = {
  xhs_js: `// 在小红书个人主页或创作者中心页面提取粉丝数
// 可直接调用 helpers.parseCnCount("1.2万") 与标准 DOM / fetch API
const boxes = Array.from(document.querySelectorAll(".user-interactions > div, [class*='interaction'] > div"));
let raw = null;
for (const box of boxes) {
  const txt = (box.innerText || "").trim();
  if (txt.includes("粉丝")) {
    const countEl = box.querySelector(".count, [class*='count']");
    raw = (countEl?.textContent || txt.replace("粉丝", "")).trim();
    break;
  }
}
if (!raw) {
  return { ok: false, reason: "未找到粉丝数据，请确认已登录并打开个人主页或创作者中心" };
}
const count = helpers.parseCnCount(raw);
return {
  value: count ?? raw,
  rawValue: raw,
  numericValue: count,
  extraItems: [{ label: "页面标题", value: document.title }]
};`,

  dom_js: `// 通用 DOM 元素提取示例：修改下方 CSS 选择器
const el = document.querySelector("h1");
if (!el) {
  return { ok: false, reason: "页面未找到目标元素" };
}
const text = (el.innerText || el.textContent || "").trim();
const num = helpers.parseCnCount(text);
return {
  value: num !== null ? num : text,
  rawValue: text,
  numericValue: num,
  unit: "",
  extraItems: [{ label: "页面", value: document.title }]
};`,

  page_fetch_js: `// 页内带登录态请求同源 API 示例
const resp = await fetch("/api/example", { credentials: "include" });
if (!resp.ok) {
  return { ok: false, reason: "接口请求失败 HTTP " + resp.status };
}
const json = await resp.json();
const val = json?.data?.count ?? 0;
return {
  value: val,
  rawValue: String(val),
  numericValue: Number(val)
};`,
};

const els = {
  connPill: document.getElementById("connPill"),
  themeSelect: document.getElementById("themeSelect"),
  navScriptsCount: document.getElementById("navScriptsCount"),
  navDeadlinesCount: document.getElementById("navDeadlinesCount"),
  navClipsCount: document.getElementById("navClipsCount"),

  syncAllTasksBtn: document.getElementById("syncAllTasksBtn"),
  newTaskBtn: document.getElementById("newTaskBtn"),
  tasksContainer: document.getElementById("tasksContainer"),

  taskId: document.getElementById("taskId"),
  taskName: document.getElementById("taskName"),
  taskPushKey: document.getElementById("taskPushKey"),
  taskCollector: document.getElementById("taskCollector"),
  taskTargetUrl: document.getElementById("taskTargetUrl"),
  taskUrlPattern: document.getElementById("taskUrlPattern"),
  scheduleMode: document.getElementById("scheduleMode"),
  intervalMinutes: document.getElementById("intervalMinutes"),
  dailyTime: document.getElementById("dailyTime"),
  taskEnabled: document.getElementById("taskEnabled"),
  runOnStartup: document.getElementById("runOnStartup"),
  autoSyncOnVisit: document.getElementById("autoSyncOnVisit"),
  parseNumber: document.getElementById("parseNumber"),

  editorLangBadge: document.getElementById("editorLangBadge"),
  templateSelect: document.getElementById("templateSelect"),
  formatJsonBtn: document.getElementById("formatJsonBtn"),
  deleteTaskBtn: document.getElementById("deleteTaskBtn"),
  runTaskBtn: document.getElementById("runTaskBtn"),
  saveTaskBtn: document.getElementById("saveTaskBtn"),
  codeEditorMount: document.getElementById("codeEditorMount"),
  editorHint: document.getElementById("editorHint"),
  taskConsole: document.getElementById("taskConsole"),

  dlTitle: document.getElementById("dlTitle"),
  dlTime: document.getElementById("dlTime"),
  dlWarnDays: document.getElementById("dlWarnDays"),
  addDeadlineBtn: document.getElementById("addDeadlineBtn"),
  pushDeadlinesNowBtn: document.getElementById("pushDeadlinesNowBtn"),
  deadlinesContainer: document.getElementById("deadlinesContainer"),
  dlMsg: document.getElementById("dlMsg"),

  clipsContainer: document.getElementById("clipsContainer"),
  clearClipsBtn: document.getElementById("clearClipsBtn"),
  clipsMsg: document.getElementById("clipsMsg"),

  baseUrl: document.getElementById("baseUrl"),
  token: document.getElementById("token"),
  clipsPushKey: document.getElementById("clipsPushKey"),
  deadlinesPushKey: document.getElementById("deadlinesPushKey"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  testConnBtn: document.getElementById("testConnBtn"),
  settingsMsg: document.getElementById("settingsMsg"),
  exportBtn: document.getElementById("exportBtn"),
  importBtn: document.getElementById("importBtn"),
  importFile: document.getElementById("importFile"),
  backupMsg: document.getElementById("backupMsg"),
};

let stateCache = {
  settings: {},
  tasks: [],
  lastRuns: {},
  deadlines: [],
  clips: [],
};
let selectedTaskId = "";
let codeEditor = null;

function setMsg(el, text, kind = "") {
  el.textContent = text;
  el.className = `msg ${kind}`.trim();
}

function setConsole(text, kind = "") {
  els.taskConsole.textContent = text;
  els.taskConsole.className = `console-bar ${kind}`.trim();
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme || "auto");
}

function switchTab(tabName) {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${tabName}`);
  });
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

function buildDefaultConfigJson(collector, task) {
  if (collector === "selector") {
    return JSON.stringify(
      {
        selector: task?.selectorConfig?.selector || "h1",
        regex: task?.selectorConfig?.regex || "",
        unit: task?.selectorConfig?.unit || "",
        parseNumber: task?.selectorConfig?.parseNumber !== false,
        extraFields: task?.selectorConfig?.extraFields || [],
      },
      null,
      2
    );
  }
  if (collector === "fetch") {
    return JSON.stringify(
      {
        jsonPath: task?.fetchConfig?.jsonPath || "data.follower",
        regex: task?.fetchConfig?.regex || "",
        unit: task?.fetchConfig?.unit || "",
        parseNumber: task?.fetchConfig?.parseNumber !== false,
      },
      null,
      2
    );
  }
  return JSON.stringify(
    {
      collector: "xiaohongshu",
      note: "内置小红书个人主页/创作者中心粉丝采集模块，无需手动编写选择器",
    },
    null,
    2
  );
}

function syncEditorForMode(collector, task) {
  const isJs = collector === "custom_js";
  codeEditor.setLanguage(isJs ? "javascript" : "json");
  els.editorLangBadge.textContent = isJs ? "JavaScript" : "JSON 配置";
  els.templateSelect.style.display = isJs ? "inline-block" : "none";
  els.formatJsonBtn.style.display = isJs ? "none" : "inline-block";

  if (isJs) {
    codeEditor.setValue(task?.customCode || CODE_TEMPLATES.dom_js);
  } else {
    codeEditor.setValue(buildDefaultConfigJson(collector, task));
  }
}

function selectTask(task) {
  selectedTaskId = task?.id || "";
  els.taskId.value = task?.id || "";
  els.taskName.value = task?.name || "";
  els.taskPushKey.value = task?.pushKey || "";
  const collector = task?.collector || "custom_js";
  els.taskCollector.value = collector;
  els.taskTargetUrl.value = task?.targetUrl || "";
  els.taskUrlPattern.value = task?.urlPattern || "";
  els.scheduleMode.value = task?.scheduleMode || "interval";
  els.intervalMinutes.value = String(task?.intervalMinutes || 60);
  els.dailyTime.value = task?.dailyTime || "09:00";
  els.taskEnabled.checked = task ? Boolean(task.enabled) : true;
  els.runOnStartup.checked = task?.runOnStartup !== false;
  els.autoSyncOnVisit.checked = task?.autoSyncOnVisit !== false;
  els.parseNumber.checked =
    task?.collector === "selector"
      ? task?.selectorConfig?.parseNumber !== false
      : task?.collector === "fetch"
        ? task?.fetchConfig?.parseNumber !== false
        : task?.customParseNumber !== false;

  els.deleteTaskBtn.style.display = task?.id ? "inline-flex" : "none";
  els.deleteTaskBtn.dataset.armed = "0";
  els.deleteTaskBtn.textContent = "删除脚本";
  els.deleteTaskBtn.className = "shiba-btn sm danger";

  syncEditorForMode(collector, task);

  const run = task?.id ? stateCache.lastRuns[task.id] : null;
  if (run?.ok) {
    setConsole(`最近运行 (${run.ranAt})：${run.value}${run.trend ? ` · ${run.trend}` : ""}`, "ok");
  } else if (run?.error) {
    setConsole(`最近运行异常 (${run.ranAt})：${run.error}`, "err");
  } else {
    setConsole(task?.id ? "就绪：修改后按 Ctrl+S 保存，或点击「立即运行并推送」。" : "新建脚本模式：填写信息并编写代码后保存。");
  }

  renderTasks();
}

function renderTasks() {
  const tasks = stateCache.tasks || [];
  const lastRuns = stateCache.lastRuns || {};
  els.navScriptsCount.textContent = String(tasks.length);
  els.tasksContainer.innerHTML = "";

  if (tasks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "script-item-sub";
    empty.style.padding = "10px";
    empty.textContent = "暂无脚本，点击右上角「+ 新建脚本」创建。";
    els.tasksContainer.appendChild(empty);
    return;
  }

  for (const task of tasks) {
    const item = document.createElement("div");
    item.className = `script-item ${task.id === selectedTaskId ? "active" : ""}`.trim();
    item.addEventListener("click", () => selectTask(task));

    const run = lastRuns[task.id];
    const top = document.createElement("div");
    top.className = "script-item-top";

    const nameWrap = document.createElement("div");
    nameWrap.className = "script-item-name";
    const dot = document.createElement("span");
    dot.className = `dot ${run?.ok ? "ok" : run?.error ? "err" : ""}`.trim();
    const txt = document.createElement("span");
    txt.className = "txt";
    txt.textContent = task.name;
    nameWrap.append(dot, txt);

    const pill = document.createElement("span");
    pill.className = "shiba-pill";
    pill.textContent = task.enabled ? task.collector : "已停用";
    top.append(nameWrap, pill);

    const sub = document.createElement("div");
    sub.className = "script-item-sub";
    sub.textContent = run?.ok
      ? `${run.value} · ${run.ranAt}`
      : run?.error
        ? `异常：${run.error}`
        : `pushKey: ${task.pushKey}`;

    item.append(top, sub);
    els.tasksContainer.appendChild(item);
  }
}

function renderDeadlines() {
  const list = stateCache.deadlines || [];
  els.navDeadlinesCount.textContent = String(list.length);
  els.deadlinesContainer.innerHTML = "";

  if (list.length === 0) {
    const empty = document.createElement("div");
    empty.className = "page-desc";
    empty.textContent = "暂无时间倒计时（可在网页选中时间后右键添加，或在上方新建）。";
    els.deadlinesContainer.appendChild(empty);
    return;
  }

  for (const dl of list) {
    const row = document.createElement("div");
    row.className = "list-row";
    const main = document.createElement("div");
    const diffDays = (Date.parse(dl.targetIso) - Date.now()) / 86_400_000;
    const title = document.createElement("div");
    title.style.fontWeight = "600";
    title.textContent = `${dl.title} — ${diffDays <= 0 ? "已到期" : `剩余 ${diffDays.toFixed(1)} 天`}`;
    const sub = document.createElement("div");
    sub.className = "page-desc";
    sub.textContent = `目标时间: ${new Date(dl.targetIso).toLocaleString()} · 红字阈值: <= ${dl.warningDays ?? 7} 天`;
    main.append(title, sub);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "shiba-btn sm danger";
    delBtn.textContent = "删除";
    delBtn.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "DELETE_DEADLINE", id: dl.id });
      await loadAll();
      setMsg(els.dlMsg, `已删除「${dl.title}」并更新 ShibaPlan`, "ok");
    });

    row.append(main, delBtn);
    els.deadlinesContainer.appendChild(row);
  }
}

function renderClips() {
  const clips = stateCache.clips || [];
  els.navClipsCount.textContent = String(clips.length);
  els.clipsContainer.innerHTML = "";

  if (clips.length === 0) {
    const empty = document.createElement("div");
    empty.className = "page-desc";
    empty.textContent = "暂无速记缓存。";
    els.clipsContainer.appendChild(empty);
    return;
  }

  for (const c of clips) {
    const row = document.createElement("div");
    row.className = "list-row";
    const main = document.createElement("div");
    const title = document.createElement("div");
    title.style.fontWeight = "600";
    title.textContent = c.title;
    const sub = document.createElement("div");
    sub.className = "page-desc";
    sub.textContent = `${c.subtitle || ""} · ${c.createdAt || ""}`;
    main.append(title, sub);
    row.appendChild(main);
    els.clipsContainer.appendChild(row);
  }
}

async function checkHealth() {
  try {
    const resp = await chrome.runtime.sendMessage({
      type: "TEST_HEALTH",
      baseUrl: els.baseUrl.value.trim(),
    });
    if (resp?.ok) {
      els.connPill.textContent = "已连接";
      els.connPill.className = "shiba-pill ok";
      return true;
    }
  } catch {}
  els.connPill.textContent = "未连接";
  els.connPill.className = "shiba-pill err";
  return false;
}

async function loadAll(preferredTaskId) {
  const resp = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  if (!resp?.ok) return;

  stateCache = resp;
  const s = resp.settings || {};
  applyTheme(s.theme || "auto");
  els.themeSelect.value = s.theme || "auto";
  els.baseUrl.value = s.baseUrl || "http://127.0.0.1:18421";
  els.token.value = s.token || "";
  els.clipsPushKey.value = s.clipsPushKey || "browser-clips";
  els.deadlinesPushKey.value = s.deadlinesPushKey || "browser-deadlines";

  renderDeadlines();
  renderClips();

  const tasks = resp.tasks || [];
  if (preferredTaskId === "new") {
    selectTask(null);
  } else {
    const targetId = preferredTaskId || selectedTaskId;
    const found = tasks.find((t) => t.id === targetId) || tasks[0] || null;
    selectTask(found);
  }
  await checkHealth();
}

function buildTaskFromForm() {
  const name = els.taskName.value.trim();
  const pushKey = els.taskPushKey.value.trim();
  const collector = els.taskCollector.value;
  if (!name || !pushKey) {
    throw new Error("脚本名称和 pushKey 不能为空");
  }

  const editorText = codeEditor.getValue();
  const task = {
    id: els.taskId.value || `task-${Date.now().toString(36)}`,
    name,
    cardTitle: name,
    enabled: els.taskEnabled.checked,
    collector,
    pushKey,
    targetUrl: els.taskTargetUrl.value.trim(),
    urlPattern: els.taskUrlPattern.value.trim(),
    runOnStartup: els.runOnStartup.checked,
    autoSyncOnVisit: els.autoSyncOnVisit.checked,
    scheduleMode: els.scheduleMode.value,
    intervalMinutes: Math.max(15, Number(els.intervalMinutes.value) || 60),
    dailyTime: els.dailyTime.value || "09:00",
  };

  if (collector === "custom_js") {
    if (!editorText.trim()) throw new Error("自定义 JS 脚本代码不能为空");
    task.customCode = editorText;
    task.customParseNumber = els.parseNumber.checked;
  } else if (collector === "selector") {
    let parsed;
    try {
      parsed = JSON.parse(editorText);
    } catch {
      throw new Error("选择器配置 JSON 格式无效");
    }
    if (!parsed?.selector || !String(parsed.selector).trim()) {
      throw new Error("selector 配置字段不能为空");
    }
    task.selectorConfig = {
      selector: String(parsed.selector).trim(),
      regex: String(parsed.regex || ""),
      unit: String(parsed.unit || ""),
      parseNumber: els.parseNumber.checked,
      extraFields: Array.isArray(parsed.extraFields) ? parsed.extraFields : [],
    };
  } else if (collector === "fetch") {
    let parsed;
    try {
      parsed = JSON.parse(editorText);
    } catch {
      throw new Error("Fetch 配置 JSON 格式无效");
    }
    if (!task.targetUrl) {
      throw new Error("纯后台接口抓取必须填写目标网址 (targetUrl)");
    }
    task.fetchConfig = {
      jsonPath: String(parsed?.jsonPath || ""),
      regex: String(parsed?.regex || ""),
      unit: String(parsed?.unit || ""),
      parseNumber: els.parseNumber.checked,
    };
  }

  return task;
}

async function saveCurrentTask() {
  try {
    const task = buildTaskFromForm();
    const resp = await chrome.runtime.sendMessage({ type: "UPSERT_TASK", task });
    if (!resp?.ok) throw new Error(resp?.error || "保存失败");
    await loadAll(task.id);
    setConsole(`已保存脚本「${task.name}」`, "ok");
    return task;
  } catch (err) {
    setConsole(err?.message || "保存失败", "err");
    return null;
  }
}

els.taskCollector.addEventListener("change", () => {
  const existing = stateCache.tasks.find((t) => t.id === els.taskId.value) || null;
  syncEditorForMode(els.taskCollector.value, existing);
});

els.templateSelect.addEventListener("change", () => {
  const key = els.templateSelect.value;
  if (key && CODE_TEMPLATES[key]) {
    codeEditor.setValue(CODE_TEMPLATES[key]);
    setConsole("已插入代码模板，可根据目标网页调整选择器或字段。", "ok");
  }
  els.templateSelect.value = "";
});

els.formatJsonBtn.addEventListener("click", () => {
  try {
    const formatted = JSON.stringify(JSON.parse(codeEditor.getValue()), null, 2);
    codeEditor.setValue(formatted);
    setConsole("JSON 已格式化", "ok");
  } catch (err) {
    setConsole(`JSON 语法错误：${err?.message || ""}`, "err");
  }
});

els.newTaskBtn.addEventListener("click", () => {
  switchTab("scripts");
  selectTask(null);
  els.taskName.focus();
});

els.saveTaskBtn.addEventListener("click", () => void saveCurrentTask());

els.runTaskBtn.addEventListener("click", async () => {
  const saved = await saveCurrentTask();
  if (!saved) return;
  els.runTaskBtn.disabled = true;
  setConsole(`正在后台运行「${saved.name}」并推送到 ShibaPlan...`);
  try {
    const resp = await chrome.runtime.sendMessage({ type: "SYNC_TASK", taskId: saved.id });
    if (!resp?.ok) throw new Error(resp?.error || "运行失败");
    await loadAll(saved.id);
    setConsole(`运行并推送成功：${resp.result.value} (${resp.result.ranAt})`, "ok");
  } catch (err) {
    await loadAll(saved.id);
    setConsole(`运行失败：${err?.message || "未知错误"}`, "err");
  } finally {
    els.runTaskBtn.disabled = false;
  }
});

els.deleteTaskBtn.addEventListener("click", async () => {
  const id = els.taskId.value;
  if (!id) return;
  if (els.deleteTaskBtn.dataset.armed !== "1") {
    els.deleteTaskBtn.dataset.armed = "1";
    els.deleteTaskBtn.textContent = "确认删除?";
    els.deleteTaskBtn.className = "shiba-btn sm danger-solid";
    window.setTimeout(() => {
      if (els.deleteTaskBtn.dataset.armed === "1") {
        els.deleteTaskBtn.dataset.armed = "0";
        els.deleteTaskBtn.textContent = "删除脚本";
        els.deleteTaskBtn.className = "shiba-btn sm danger";
      }
    }, 3000);
    return;
  }
  await chrome.runtime.sendMessage({ type: "DELETE_TASK", taskId: id });
  selectedTaskId = "";
  await loadAll();
  setConsole("已删除脚本及其本地历史记录", "ok");
});

els.syncAllTasksBtn.addEventListener("click", async () => {
  els.syncAllTasksBtn.disabled = true;
  setConsole("正在后台顺序运行所有启用脚本...");
  try {
    const resp = await chrome.runtime.sendMessage({ type: "SYNC_ALL_ENABLED" });
    await loadAll();
    const r = resp?.results || {};
    setConsole(
      resp?.ok
        ? `批量同步完成：成功 ${r.succeeded || 0} 个，失败 ${r.failed || 0} 个`
        : resp?.error || "批量同步失败",
      resp?.ok && !r.failed ? "ok" : "err"
    );
  } finally {
    els.syncAllTasksBtn.disabled = false;
  }
});

els.themeSelect.addEventListener("change", async () => {
  const theme = els.themeSelect.value;
  applyTheme(theme);
  await chrome.runtime.sendMessage({
    type: "SAVE_SETTINGS",
    settings: { theme },
  });
});

els.saveSettingsBtn.addEventListener("click", async () => {
  const resp = await chrome.runtime.sendMessage({
    type: "SAVE_SETTINGS",
    settings: {
      baseUrl: els.baseUrl.value.trim() || "http://127.0.0.1:18421",
      token: els.token.value.trim(),
      clipsPushKey: els.clipsPushKey.value.trim() || "browser-clips",
      deadlinesPushKey: els.deadlinesPushKey.value.trim() || "browser-deadlines",
    },
  });
  setMsg(
    els.settingsMsg,
    resp?.ok ? "连接配置已保存" : resp?.error || "保存失败",
    resp?.ok ? "ok" : "err"
  );
  await checkHealth();
});

els.testConnBtn.addEventListener("click", async () => {
  setMsg(els.settingsMsg, "正在连接 ShibaPlan...");
  const ok = await checkHealth();
  setMsg(
    els.settingsMsg,
    ok ? "ShibaPlan 推送服务连接正常" : "连接失败，请确认已开启 ShibaPlan 外部推送服务",
    ok ? "ok" : "err"
  );
});

els.addDeadlineBtn.addEventListener("click", async () => {
  const title = els.dlTitle.value.trim();
  const dtVal = els.dlTime.value;
  if (!title || !dtVal) {
    setMsg(els.dlMsg, "请填写事件名称与目标时间", "err");
    return;
  }
  const resp = await chrome.runtime.sendMessage({
    type: "ADD_DEADLINE",
    item: {
      title,
      targetIso: new Date(dtVal).toISOString(),
      warningDays: Math.max(0, Number(els.dlWarnDays.value) || 7),
    },
  });
  if (resp?.ok) {
    els.dlTitle.value = "";
    await loadAll();
    setMsg(els.dlMsg, `已添加并推送倒计时「${title}」`, "ok");
  } else {
    setMsg(els.dlMsg, resp?.error || "推送失败", "err");
  }
});

els.pushDeadlinesNowBtn.addEventListener("click", async () => {
  const resp = await chrome.runtime.sendMessage({ type: "PUSH_DEADLINES_NOW" });
  setMsg(
    els.dlMsg,
    resp?.ok ? "已刷新倒计时卡片" : resp?.error || "推送失败",
    resp?.ok ? "ok" : "err"
  );
});

els.clearClipsBtn.addEventListener("click", async () => {
  const resp = await chrome.runtime.sendMessage({ type: "CLEAR_CLIPS" });
  await loadAll();
  setMsg(
    els.clipsMsg,
    resp?.ok ? "已清空浏览器速记缓存" : resp?.error || "清空失败",
    resp?.ok ? "ok" : "err"
  );
});

els.exportBtn.addEventListener("click", async () => {
  const resp = await chrome.runtime.sendMessage({ type: "EXPORT_LOCAL_BACKUP" });
  if (!resp?.ok) return;
  const blob = new Blob([JSON.stringify(resp.data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `shibaplan-browser-backup-${new Date().toISOString().slice(0, 10)}.local.json`;
  a.click();
  URL.revokeObjectURL(url);
  setMsg(els.backupMsg, "已导出本地备份文件（*.local.json 已被 .gitignore 忽略）", "ok");
});

els.importBtn.addEventListener("click", () => els.importFile.click());
els.importFile.addEventListener("change", async () => {
  const file = els.importFile.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const resp = await chrome.runtime.sendMessage({
      type: "IMPORT_LOCAL_BACKUP",
      data: parsed,
    });
    if (!resp?.ok) throw new Error(resp?.error || "导入失败");
    await loadAll();
    setMsg(els.backupMsg, "备份已导入", "ok");
  } catch (err) {
    setMsg(els.backupMsg, err?.message || "导入失败", "err");
  } finally {
    els.importFile.value = "";
  }
});

codeEditor = window.ShibaCodeEditor.mount(els.codeEditorMount, {
  language: "javascript",
  value: CODE_TEMPLATES.dom_js,
  onSave: () => void saveCurrentTask(),
});

const hashMatch = /^#task=(.+)$/.exec(window.location.hash || "");
const initialTask = hashMatch ? decodeURIComponent(hashMatch[1]) : undefined;
loadAll(initialTask);
