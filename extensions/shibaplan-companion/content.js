(() => {
  const HOST_ID = "shiba-companion-host";

  function patternMatchesUrl(pattern, url) {
    const raw = String(pattern || "").trim();
    if (!raw) return false;
    const escaped = raw
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    try {
      return new RegExp(`^${escaped}$`, "i").test(url);
    } catch {
      return false;
    }
  }

  function taskMatchesCurrentPage(task) {
    if (!task) return false;
    const collectors = window.__SHIBA_COLLECTORS__ || {};
    const mod = collectors[task.collector];
    if (task.urlPattern && patternMatchesUrl(task.urlPattern, window.location.href)) {
      if (task.collector === "xiaohongshu" && mod?.matchesUrl) {
        return mod.matchesUrl(window.location.href, task);
      }
      return true;
    }
    if (mod?.matchesUrl) {
      return mod.matchesUrl(window.location.href, task);
    }
    return false;
  }

  async function runCollectorWithRetry(task, maxAttempts = 12, intervalMs = 500) {
    const collectors = window.__SHIBA_COLLECTORS__ || {};
    const mod = collectors[task?.collector];
    if (!mod || typeof mod.extract !== "function") {
      return { ok: false, needsLogin: false, reason: `未找到采集器: ${task?.collector || "unknown"}` };
    }

    let lastResult = null;
    for (let i = 0; i < maxAttempts; i++) {
      const res = mod.extract(task);
      if (res?.ok || res?.needsLogin) {
        return res;
      }
      lastResult = res;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    return (
      lastResult || {
        ok: false,
        needsLogin: false,
        reason: "未能在页面提取到目标数据",
      }
    );
  }

  async function runPassiveAutoSync() {
    try {
      const stored = await chrome.storage.local.get(["shiba_tasks"]);
      const tasks = Array.isArray(stored.shiba_tasks) ? stored.shiba_tasks : [];
      const matching = tasks.filter(
        (t) => t && t.enabled && t.autoSyncOnVisit !== false && taskMatchesCurrentPage(t)
      );
      if (matching.length === 0) return;

      for (const task of matching) {
        const res = await runCollectorWithRetry(task, 12, 500);
        if (res?.ok) {
          chrome.runtime.sendMessage({
            type: "TASK_COLLECTED",
            taskId: task.id,
            data: res.data,
          });
        }
      }
    } catch {
      // Keep quiet on passive page visits
    }
  }

  function getOrCreateShadowHost() {
    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement("div");
      host.id = HOST_ID;
      host.style.all = "initial";
      document.documentElement.appendChild(host);
    }
    if (!host.shadowRoot) {
      host.attachShadow({ mode: "open" });
    }
    return host;
  }

  function showToast(text, kind = "ok") {
    const host = getOrCreateShadowHost();
    const shadow = host.shadowRoot;

    const existing = shadow.getElementById("shiba-toast");
    if (existing) existing.remove();

    const el = document.createElement("div");
    el.id = "shiba-toast";
    el.textContent = text;
    Object.assign(el.style, {
      position: "fixed",
      right: "20px",
      bottom: "20px",
      zIndex: "2147483647",
      padding: "10px 14px",
      borderRadius: "10px",
      fontSize: "12.5px",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
      color: "#fff",
      background: kind === "error" ? "#dc2626" : "#18181b",
      border: kind === "error" ? "1px solid #f87171" : "1px solid rgba(255,255,255,0.16)",
      boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
      maxWidth: "340px",
      lineHeight: "1.45",
      pointerEvents: "none",
    });

    shadow.appendChild(el);
    window.setTimeout(() => {
      el.remove();
    }, 3200);
  }

  const MODAL_CSS = `
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      background: rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(2px);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
    }
    .panel {
      width: 390px;
      max-width: calc(100vw - 24px);
      background: #18181b;
      color: #f4f4f5;
      border: 1px solid #2e2e38;
      border-radius: 14px;
      padding: 16px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
      font-size: 12.5px;
    }
    .title {
      font-size: 14.5px;
      font-weight: 600;
      margin: 0 0 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .field {
      margin-bottom: 10px;
    }
    .field label {
      display: block;
      margin-bottom: 4px;
      font-size: 11.5px;
      color: #a1a1aa;
    }
    .field input[type="text"],
    .field input[type="number"],
    .field input[type="time"],
    .field input[type="datetime-local"],
    .field select {
      width: 100%;
      box-sizing: border-box;
      padding: 7px 9px;
      border-radius: 8px;
      border: 1px solid #32323d;
      background: #111115;
      color: #f4f4f5;
      font-size: 12px;
      outline: none;
    }
    .field input:focus, .field select:focus {
      border-color: #6366f1;
    }
    .preview-box {
      background: #111115;
      border: 1px solid #2a2a35;
      border-radius: 8px;
      padding: 7px 9px;
      font-size: 11.5px;
      color: #d4d4d8;
      max-height: 64px;
      overflow: hidden;
      word-break: break-all;
    }
    .check-row {
      display: flex;
      align-items: center;
      gap: 7px;
      margin-bottom: 10px;
      font-size: 12px;
      color: #e4e4e7;
    }
    .row-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 14px;
    }
    button {
      cursor: pointer;
      border-radius: 8px;
      border: 1px solid #32323d;
      background: #23232b;
      color: #f4f4f5;
      padding: 7px 12px;
      font-size: 12px;
      font-weight: 500;
    }
    button.primary {
      background: #5e6ad2;
      border-color: #5e6ad2;
      color: #fff;
    }
    button.primary:hover {
      background: #4f5bc4;
    }
    .err {
      color: #fb7185;
      font-size: 11.5px;
      margin-top: 6px;
      min-height: 16px;
    }
  `;

  function slugifyPushKey(prefix) {
    const hostPart = window.location.hostname
      .replace(/^www\./, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 18);
    const rand = Math.random().toString(36).slice(2, 6);
    return `${prefix}-${hostPart || "web"}-${rand}`.toLowerCase();
  }

  function openPickerConfirmModal(selector, previewText) {
    const host = getOrCreateShadowHost();
    const shadow = host.shadowRoot;
    const oldModal = shadow.getElementById("shiba-modal-root");
    if (oldModal) oldModal.remove();

    const wrap = document.createElement("div");
    wrap.id = "shiba-modal-root";
    const safeTitle = (document.title || window.location.hostname).slice(0, 24);
    const defaultUrlPattern = `${window.location.origin}${window.location.pathname}*`;

    wrap.innerHTML = `
      <style>${MODAL_CSS}</style>
      <div class="backdrop">
        <div class="panel">
          <div class="title">
            <span>添加到 ShibaPlan 监控脚本</span>
            <button type="button" id="closeBtn">✕</button>
          </div>
          <div class="field">
            <label>当前提取预览</label>
            <div class="preview-box" id="previewText"></div>
          </div>
          <div class="field">
            <label>CSS 选择器</label>
            <input type="text" id="selectorInput" />
          </div>
          <div class="row-2">
            <div class="field">
              <label>脚本 / 卡片名称</label>
              <input type="text" id="nameInput" />
            </div>
            <div class="field">
              <label>推送标识 (pushKey)</label>
              <input type="text" id="pushKeyInput" />
            </div>
          </div>
          <label class="check-row">
            <input type="checkbox" id="parseNumberInput" checked />
            <span>按数字解析（支持“1.2万”，自动计算今日涨跌与折线）</span>
          </label>
          <div class="row-2">
            <div class="field">
              <label>同步时机</label>
              <select id="scheduleModeInput">
                <option value="interval" selected>每隔 N 分钟后台自动获取</option>
                <option value="daily">每天固定时间后台获取</option>
                <option value="manual">仅访问此页 / 手动</option>
              </select>
            </div>
            <div class="field" id="scheduleParamBox" style="display:block;">
              <label id="scheduleParamLabel">间隔（分钟，最低 15）</label>
              <input type="number" id="intervalInput" min="15" max="1440" value="60" />
              <input type="time" id="dailyInput" value="09:00" style="display:none;" />
            </div>
          </div>
          <div class="err" id="errBox"></div>
          <div class="actions">
            <button type="button" id="cancelBtn">取消</button>
            <button type="button" class="primary" id="submitBtn">保存并推送到 ShibaPlan</button>
          </div>
        </div>
      </div>
    `;

    shadow.appendChild(wrap);

    const previewEl = shadow.getElementById("previewText");
    const selectorInput = shadow.getElementById("selectorInput");
    const nameInput = shadow.getElementById("nameInput");
    const pushKeyInput = shadow.getElementById("pushKeyInput");
    const parseNumberInput = shadow.getElementById("parseNumberInput");
    const scheduleModeInput = shadow.getElementById("scheduleModeInput");
    const scheduleParamBox = shadow.getElementById("scheduleParamBox");
    const scheduleParamLabel = shadow.getElementById("scheduleParamLabel");
    const intervalInput = shadow.getElementById("intervalInput");
    const dailyInput = shadow.getElementById("dailyInput");
    const errBox = shadow.getElementById("errBox");
    const submitBtn = shadow.getElementById("submitBtn");

    previewEl.textContent = previewText || "(空)";
    selectorInput.value = selector;
    nameInput.value = safeTitle;
    pushKeyInput.value = slugifyPushKey("watch");

    const close = () => wrap.remove();
    shadow.getElementById("closeBtn").addEventListener("click", close);
    shadow.getElementById("cancelBtn").addEventListener("click", close);

    scheduleModeInput.addEventListener("change", () => {
      const mode = scheduleModeInput.value;
      if (mode === "interval") {
        scheduleParamBox.style.display = "block";
        scheduleParamLabel.textContent = "间隔（分钟，最低 15）";
        intervalInput.style.display = "block";
        dailyInput.style.display = "none";
      } else if (mode === "daily") {
        scheduleParamBox.style.display = "block";
        scheduleParamLabel.textContent = "每日时间";
        intervalInput.style.display = "none";
        dailyInput.style.display = "block";
      } else {
        scheduleParamBox.style.display = "none";
      }
    });

    submitBtn.addEventListener("click", async () => {
      const sel = selectorInput.value.trim();
      const name = nameInput.value.trim();
      const pushKey = pushKeyInput.value.trim();
      if (!sel || !name || !pushKey) {
        errBox.textContent = "选择器、名称和 pushKey 均不能为空";
        return;
      }

      submitBtn.disabled = true;
      errBox.textContent = "";

      const task = {
        id: `task-${Date.now().toString(36)}`,
        name,
        cardTitle: name,
        enabled: true,
        collector: "selector",
        pushKey,
        urlPattern: defaultUrlPattern,
        targetUrl: window.location.href,
        autoSyncOnVisit: true,
        runOnStartup: true,
        scheduleMode: scheduleModeInput.value,
        intervalMinutes: Math.max(15, Number(intervalInput.value) || 60),
        dailyTime: dailyInput.value || "09:00",
        selectorConfig: {
          selector: sel,
          parseNumber: parseNumberInput.checked,
          regex: "",
          unit: "",
        },
      };

      try {
        const resp = await chrome.runtime.sendMessage({
          type: "CREATE_AND_SYNC_TASK",
          task,
        });
        if (!resp?.ok) {
          throw new Error(resp?.error || "保存或推送失败");
        }
        close();
        showToast(`已添加到 ShibaPlan 卡片「${name}」`);
      } catch (err) {
        errBox.textContent = err?.message || "推送失败";
        submitBtn.disabled = false;
      }
    });
  }

  let pickerCleanup = null;

  function startElementPicker() {
    if (pickerCleanup) pickerCleanup();

    const host = getOrCreateShadowHost();
    const shadow = host.shadowRoot;
    const oldBox = shadow.getElementById("shiba-picker-overlay");
    if (oldBox) oldBox.remove();

    const overlay = document.createElement("div");
    overlay.id = "shiba-picker-overlay";
    Object.assign(overlay.style, {
      position: "fixed",
      zIndex: "2147483646",
      pointerEvents: "none",
      border: "2px solid #5e6ad2",
      background: "rgba(94, 106, 210, 0.14)",
      borderRadius: "4px",
      display: "none",
    });

    const tip = document.createElement("div");
    tip.textContent = "移动鼠标点选要监控的数据元素 · 按 Esc 退出";
    Object.assign(tip.style, {
      position: "fixed",
      top: "14px",
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: "2147483647",
      padding: "7px 13px",
      borderRadius: "999px",
      background: "#18181b",
      color: "#f4f4f5",
      border: "1px solid #3f3f46",
      fontSize: "12px",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
      boxShadow: "0 10px 25px rgba(0,0,0,0.3)",
      pointerEvents: "none",
    });

    shadow.appendChild(overlay);
    shadow.appendChild(tip);

    let hoveredEl = null;

    const onMouseMove = (e) => {
      const target = e.target;
      if (!target || target === host || host.contains(target)) return;
      hoveredEl = target;
      const rect = target.getBoundingClientRect();
      Object.assign(overlay.style, {
        display: "block",
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
    };

    const cleanup = () => {
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      overlay.remove();
      tip.remove();
      pickerCleanup = null;
    };

    const onClick = (e) => {
      const target = e.target;
      if (!target || target === host || host.contains(target)) return;
      e.preventDefault();
      e.stopPropagation();

      const chosen = hoveredEl || target;
      const buildFn = window.__SHIBA_COLLECTORS__?.selector?.buildUniqueSelector;
      const selector = typeof buildFn === "function" ? buildFn(chosen) : "";
      const previewText = (chosen.innerText || chosen.textContent || "").trim().slice(0, 120);
      cleanup();
      openPickerConfirmModal(selector, previewText);
    };

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cleanup();
      }
    };

    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    pickerCleanup = cleanup;
  }

  function toDatetimeLocalValue(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
      date.getHours()
    )}:${pad(date.getMinutes())}`;
  }

  function parseDateTimeHint(text) {
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

  function openDeadlineModal(selectionText, pageUrl, pageTitle) {
    const host = getOrCreateShadowHost();
    const shadow = host.shadowRoot;
    const oldModal = shadow.getElementById("shiba-modal-root");
    if (oldModal) oldModal.remove();

    const parsedDate = parseDateTimeHint(selectionText);
    const fallbackDate = new Date(Date.now() + 7 * 86_400_000);
    fallbackDate.setHours(23, 59, 0, 0);
    const defaultDate = parsedDate || fallbackDate;

    const cleanSel = String(selectionText || "").trim();
    const defaultTitle =
      (cleanSel && cleanSel.length <= 28 ? cleanSel : "") ||
      String(pageTitle || document.title || "时间提醒").slice(0, 28);

    const wrap = document.createElement("div");
    wrap.id = "shiba-modal-root";
    wrap.innerHTML = `
      <style>${MODAL_CSS}</style>
      <div class="backdrop">
        <div class="panel">
          <div class="title">
            <span>推送时间倒计时到 ShibaPlan</span>
            <button type="button" id="closeBtn">✕</button>
          </div>
          ${
            cleanSel
              ? `<div class="field"><label>已选中内容</label><div class="preview-box" id="selBox"></div></div>`
              : ""
          }
          <div class="field">
            <label>事件 / 卡片条目名称</label>
            <input type="text" id="titleInput" />
          </div>
          <div class="row-2">
            <div class="field">
              <label>目标截止时间</label>
              <input type="datetime-local" id="dtInput" />
            </div>
            <div class="field">
              <label>红字告警阈值（天）</label>
              <input type="number" id="warnDaysInput" min="0" max="365" value="7" />
            </div>
          </div>
          <div class="err" id="errBox"></div>
          <div class="actions">
            <button type="button" id="cancelBtn">取消</button>
            <button type="button" class="primary" id="submitBtn">推送到 ShibaPlan</button>
          </div>
        </div>
      </div>
    `;

    shadow.appendChild(wrap);

    const selBox = shadow.getElementById("selBox");
    if (selBox) selBox.textContent = cleanSel.slice(0, 140);
    const titleInput = shadow.getElementById("titleInput");
    const dtInput = shadow.getElementById("dtInput");
    const warnDaysInput = shadow.getElementById("warnDaysInput");
    const errBox = shadow.getElementById("errBox");
    const submitBtn = shadow.getElementById("submitBtn");

    titleInput.value = defaultTitle;
    dtInput.value = toDatetimeLocalValue(defaultDate);

    const close = () => wrap.remove();
    shadow.getElementById("closeBtn").addEventListener("click", close);
    shadow.getElementById("cancelBtn").addEventListener("click", close);

    submitBtn.addEventListener("click", async () => {
      const title = titleInput.value.trim();
      const targetIso = dtInput.value;
      if (!title || !targetIso) {
        errBox.textContent = "请填写名称与目标时间";
        return;
      }

      submitBtn.disabled = true;
      errBox.textContent = "";

      try {
        const resp = await chrome.runtime.sendMessage({
          type: "ADD_DEADLINE",
          item: {
            title,
            targetIso: new Date(targetIso).toISOString(),
            warningDays: Math.max(0, Number(warnDaysInput.value) || 7),
            sourceText: cleanSel.slice(0, 200),
            sourceUrl: pageUrl || window.location.href,
            sourceTitle: pageTitle || document.title || "",
          },
        });
        if (!resp?.ok) {
          throw new Error(resp?.error || "推送失败");
        }
        close();
        showToast(`已推送倒计时「${title}」到 ShibaPlan`);
      } catch (err) {
        errBox.textContent = err?.message || "推送失败";
        submitBtn.disabled = false;
      }
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "RUN_COLLECTOR") {
      runCollectorWithRetry(message.task, 12, 500)
        .then((res) => sendResponse(res))
        .catch((err) =>
          sendResponse({
            ok: false,
            needsLogin: false,
            reason: err?.message || "提取页面数据异常",
          })
        );
      return true;
    }

    if (message?.type === "RUN_USER_SCRIPT_EVENT" && message.taskId) {
      const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const resultEvent = `shiba-script-result:${runId}`;
      let done = false;
      const timer = window.setTimeout(() => {
        if (done) return;
        done = true;
        window.removeEventListener(resultEvent, onResult);
        sendResponse({
          ok: false,
          reason: "脚本响应超时（请确认已在扩展详情页开启「允许用户脚本」并刷新页面）",
        });
      }, 10000);

      function onResult(ev) {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        window.removeEventListener(resultEvent, onResult);
        sendResponse(ev?.detail || { ok: false, reason: "脚本未返回数据" });
      }

      window.addEventListener(resultEvent, onResult);
      window.dispatchEvent(
        new CustomEvent(`shiba-run-script:${message.taskId}`, { detail: { runId } })
      );
      return true;
    }

    if (message?.type === "START_ELEMENT_PICKER") {
      startElementPicker();
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "OPEN_DEADLINE_MODAL") {
      openDeadlineModal(
        message.selectionText || "",
        message.pageUrl || window.location.href,
        message.pageTitle || document.title || ""
      );
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "SHOW_TOAST") {
      showToast(message.text || "", message.kind || "ok");
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    runPassiveAutoSync();
  }
})();
