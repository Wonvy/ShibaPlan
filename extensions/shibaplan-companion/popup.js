const COLLECTOR_LABELS = {
  xiaohongshu: "小红书",
  selector: "元素",
  fetch: "API",
  custom_js: "JS",
};

const els = {
  connBadge: document.getElementById("connBadge"),
  openOptionsBtn: document.getElementById("openOptionsBtn"),
  newScriptBtn: document.getElementById("newScriptBtn"),
  syncAllBtn: document.getElementById("syncAllBtn"),
  pickElBtn: document.getElementById("pickElBtn"),
  deadlineBtn: document.getElementById("deadlineBtn"),
  pushPageBtn: document.getElementById("pushPageBtn"),
  testConnBtn: document.getElementById("testConnBtn"),
  taskCount: document.getElementById("taskCount"),
  taskList: document.getElementById("taskList"),
  msgBox: document.getElementById("msgBox"),
};

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme || "auto");
}

function setMsg(text, kind = "") {
  els.msgBox.textContent = text;
  els.msgBox.className = `msg ${kind}`.trim();
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function checkHealth() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: "TEST_HEALTH" });
    if (resp?.ok) {
      els.connBadge.textContent = "已连接";
      els.connBadge.className = "shiba-pill ok";
      return true;
    }
  } catch {}
  els.connBadge.textContent = "未连接";
  els.connBadge.className = "shiba-pill err";
  return false;
}

function openOptionsForTask(taskId) {
  const url = chrome.runtime.getURL(
    taskId ? `options.html#task=${encodeURIComponent(taskId)}` : "options.html"
  );
  chrome.tabs.create({ url });
}

function describeScheduleShort(task) {
  if (task.scheduleMode === "interval") return `每${task.intervalMinutes || 60}m`;
  if (task.scheduleMode === "daily") return `每天${task.dailyTime || "09:00"}`;
  return "手动";
}

function renderTasks(tasks, lastRuns) {
  els.taskCount.textContent = String(tasks.length);
  els.taskList.innerHTML = "";

  if (tasks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "task-meta";
    empty.style.padding = "8px 2px";
    empty.textContent = "暂无采集脚本，可点选网页元素或点击右上角「+ 编写 JS 脚本」。";
    els.taskList.appendChild(empty);
    return;
  }

  for (const task of tasks) {
    const row = document.createElement("div");
    row.className = "task-row";

    const run = lastRuns[task.id];

    const top = document.createElement("div");
    top.className = "task-top";

    const titleWrap = document.createElement("div");
    titleWrap.className = "task-title-wrap";

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = Boolean(task.enabled);
    toggle.title = "启用/停用该脚本";
    toggle.addEventListener("change", async () => {
      await chrome.runtime.sendMessage({
        type: "UPSERT_TASK",
        task: { ...task, enabled: toggle.checked },
      });
      await refreshState();
      setMsg(toggle.checked ? `已启用「${task.name}」` : `已停用「${task.name}」`, "ok");
    });

    const dot = document.createElement("span");
    dot.className = `dot ${run?.ok ? "ok" : run?.error ? "err" : ""}`.trim();

    const nameEl = document.createElement("span");
    nameEl.className = "task-name";
    nameEl.textContent = task.name;
    nameEl.title = `${task.name} (pushKey: ${task.pushKey})`;

    const tag = document.createElement("span");
    tag.className = "type-tag";
    tag.textContent = COLLECTOR_LABELS[task.collector] || task.collector;

    titleWrap.append(toggle, dot, nameEl, tag);

    const actions = document.createElement("div");
    actions.className = "task-actions";

    const bindBtn = document.createElement("button");
    bindBtn.type = "button";
    bindBtn.className = "shiba-btn sm ghost";
    bindBtn.textContent = "绑定页";
    bindBtn.title = "将当前打开的网页设为目标页";
    bindBtn.addEventListener("click", async () => {
      const tab = await getActiveTab();
      if (!tab?.url || !tab.url.startsWith("http")) {
        setMsg("当前标签页不是有效网页", "err");
        return;
      }
      const u = new URL(tab.url);
      await chrome.runtime.sendMessage({
        type: "UPSERT_TASK",
        task: {
          ...task,
          enabled: true,
          targetUrl: tab.url,
          urlPattern: `${u.origin}${u.pathname}*`,
        },
      });
      await refreshState();
      setMsg(`已将当前页绑定到「${task.name}」`, "ok");
    });

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "shiba-btn sm ghost";
    editBtn.textContent = "编辑";
    editBtn.addEventListener("click", () => openOptionsForTask(task.id));

    const syncBtn = document.createElement("button");
    syncBtn.type = "button";
    syncBtn.className = "shiba-btn sm";
    syncBtn.textContent = "同步";
    syncBtn.addEventListener("click", async () => {
      syncBtn.disabled = true;
      setMsg(`正在同步「${task.name}」...`);
      try {
        const tab = await getActiveTab();
        const resp = await chrome.runtime.sendMessage({
          type: "SYNC_TASK",
          taskId: task.id,
          tabId: tab?.id || null,
        });
        if (!resp?.ok) throw new Error(resp?.error || "同步失败");
        await refreshState();
        setMsg(`「${task.name}」同步成功：${resp.result.value}`, "ok");
      } catch (err) {
        await refreshState();
        setMsg(err?.message || "同步失败", "err");
      } finally {
        syncBtn.disabled = false;
      }
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "shiba-btn sm danger";
    delBtn.textContent = "删除";
    let confirmTimer = null;
    delBtn.addEventListener("click", async () => {
      if (delBtn.dataset.armed !== "1") {
        delBtn.dataset.armed = "1";
        delBtn.textContent = "确认?";
        delBtn.className = "shiba-btn sm danger-solid";
        confirmTimer = window.setTimeout(() => {
          delBtn.dataset.armed = "0";
          delBtn.textContent = "删除";
          delBtn.className = "shiba-btn sm danger";
        }, 3000);
        return;
      }
      if (confirmTimer) window.clearTimeout(confirmTimer);
      await chrome.runtime.sendMessage({ type: "DELETE_TASK", taskId: task.id });
      await refreshState();
      setMsg(`已删除脚本「${task.name}」`, "ok");
    });

    actions.append(bindBtn, editBtn, syncBtn, delBtn);
    top.append(titleWrap, actions);

    const bottom = document.createElement("div");
    bottom.className = "task-bottom";

    const meta = document.createElement("div");
    meta.className = `task-meta ${run?.error ? "err" : ""}`.trim();
    if (run?.ok) {
      meta.textContent = `${run.value}${run.trend ? ` · ${run.trend}` : ""} · ${describeScheduleShort(task)} · ${run.ranAt}`;
    } else if (run?.error) {
      meta.textContent = `异常：${run.error}`;
    } else {
      meta.textContent = `pushKey: ${task.pushKey} · ${describeScheduleShort(task)}`;
    }

    bottom.appendChild(meta);
    row.append(top, bottom);
    els.taskList.appendChild(row);
  }
}

async function refreshState() {
  const resp = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  if (resp?.ok) {
    applyTheme(resp.settings?.theme || "auto");
    renderTasks(resp.tasks || [], resp.lastRuns || {});
  }
}

els.openOptionsBtn.addEventListener("click", () => openOptionsForTask());
els.newScriptBtn.addEventListener("click", () => openOptionsForTask("new"));

els.pickElBtn.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url?.startsWith("http")) {
    setMsg("请先切到需要监控的普通网页", "err");
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "START_ELEMENT_PICKER" });
    window.close();
  } catch {
    setMsg("无法注入当前页面，请刷新该网页后重试", "err");
  }
});

els.deadlineBtn.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url?.startsWith("http")) {
    openOptionsForTask();
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: "OPEN_DEADLINE_MODAL",
      selectionText: "",
      pageUrl: tab.url,
      pageTitle: tab.title || "",
    });
    window.close();
  } catch {
    openOptionsForTask();
  }
});

els.pushPageBtn.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab?.url || !tab.url.startsWith("http")) {
    setMsg("当前标签页不是有效网页", "err");
    return;
  }
  els.pushPageBtn.disabled = true;
  try {
    const resp = await chrome.runtime.sendMessage({
      type: "PUSH_PAGE_NOW",
      url: tab.url,
      pageTitle: tab.title || tab.url,
    });
    if (!resp?.ok) throw new Error(resp?.error || "推送失败");
    setMsg(`已推送「${resp.clip.title}」到 ShibaPlan`, "ok");
  } catch (err) {
    setMsg(err?.message || "推送失败", "err");
  } finally {
    els.pushPageBtn.disabled = false;
  }
});

els.syncAllBtn.addEventListener("click", async () => {
  els.syncAllBtn.disabled = true;
  setMsg("正在后台顺序采集并推送所有启用脚本...");
  try {
    const resp = await chrome.runtime.sendMessage({ type: "SYNC_ALL_ENABLED" });
    if (!resp?.ok) throw new Error(resp?.error || "批量同步失败");
    await refreshState();
    const r = resp.results || {};
    if (r.total === 0) {
      setMsg("暂无已启用的采集脚本", "err");
    } else if (r.failed > 0) {
      setMsg(`同步完成：成功 ${r.succeeded} 个，失败 ${r.failed} 个`, "err");
    } else {
      setMsg(`全部 ${r.succeeded} 个脚本后台同步成功`, "ok");
    }
  } catch (err) {
    setMsg(err?.message || "批量同步失败", "err");
  } finally {
    els.syncAllBtn.disabled = false;
  }
});

els.testConnBtn.addEventListener("click", async () => {
  const ok = await checkHealth();
  setMsg(
    ok ? "ShibaPlan 推送服务连接正常" : "无法连接 ShibaPlan，请先开启外部推送服务",
    ok ? "ok" : "err"
  );
});

Promise.all([checkHealth(), refreshState()]);
