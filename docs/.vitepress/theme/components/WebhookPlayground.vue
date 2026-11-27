<script setup lang="ts">
import { computed, ref } from "vue";

const props = withDefaults(
  defineProps<{
    lang?: "zh" | "en";
  }>(),
  { lang: "zh" }
);

const isEn = computed(() => props.lang === "en");

const baseUrl = ref("http://127.0.0.1:18421");
const pushKey = ref("demo-service");
const cardTitle = ref(isEn.value ? "Build & Service Monitor" : "构建与服务监控");
const token = ref("");
const sending = ref(false);
const resultStatus = ref<string | null>(null);
const resultOk = ref(false);
const resultBody = ref("");

const presets = computed(() => ({
  metrics: JSON.stringify(
    {
      schema: "shibaplan-info/v1",
      status: "ok",
      badge: isEn.value ? "Healthy" : "运行正常",
      blocks: [
        {
          type: "metrics",
          items: [
            {
              label: "CPU",
              value: 23,
              unit: "%",
              trend: "-4%",
              tone: "ok",
              sparkline: [34, 30, 28, 25, 23],
            },
            {
              label: isEn.value ? "Memory" : "内存占用",
              value: "6.4",
              unit: "GB",
              tone: "info",
            },
            {
              label: isEn.value ? "Queue" : "待处理队列",
              value: 2,
              tone: "warn",
            },
          ],
        },
      ],
    },
    null,
    2
  ),
  list: JSON.stringify(
    {
      schema: "shibaplan-info/v1",
      status: "info",
      badge: "CI/CD",
      blocks: [
        {
          type: "list",
          items: [
            {
              title: isEn.value ? "Desktop v0.2.7 packaged" : "桌面端 v0.2.7 构建完成",
              subtitle: "main · 2m ago",
              tag: "PASS",
              tone: "ok",
            },
            {
              title: isEn.value ? "Nightly benchmark queued" : "夜间性能回归排队中",
              subtitle: "runner-win-02",
              tag: "QUEUE",
              tone: "info",
            },
          ],
        },
      ],
    },
    null,
    2
  ),
  markdown: isEn.value
    ? "### Daily Summary\n- **API Latency**: `42ms`\n- **Backup**: Completed (`workspace-today.json`)"
    : "### 每日巡检摘要\n- **接口平均延迟**: `42ms`\n- **自动快照**: 已完成 (`workspace-today.json`)",
}));

const payload = ref(presets.value.metrics);

function loadPreset(kind: "metrics" | "list" | "markdown") {
  payload.value = presets.value[kind];
}

const fullEndpoint = computed(() => {
  const cleanBase = baseUrl.value.trim().replace(/\/+$/, "");
  const cleanKey = encodeURIComponent(pushKey.value.trim() || "demo-service");
  const q = cardTitle.value.trim()
    ? `?title=${encodeURIComponent(cardTitle.value.trim())}`
    : "";
  return `${cleanBase}/api/info/push/${cleanKey}${q}`;
});

async function checkHealth() {
  sending.value = true;
  resultStatus.value = null;
  resultBody.value = "";
  try {
    const cleanBase = baseUrl.value.trim().replace(/\/+$/, "");
    const res = await fetch(`${cleanBase}/api/info/health`);
    const text = await res.text();
    resultOk.value = res.ok;
    resultStatus.value = `GET /api/info/health → HTTP ${res.status}`;
    resultBody.value = text;
  } catch (err) {
    resultOk.value = false;
    resultStatus.value = isEn.value
      ? "Connection failed (make sure ShibaPlan Push Server is enabled on this port)"
      : "连接失败（请确认 ShibaPlan 已启动且已开启信息推送接收服务）";
    resultBody.value = err instanceof Error ? err.message : String(err);
  } finally {
    sending.value = false;
  }
}

async function sendPush() {
  sending.value = true;
  resultStatus.value = null;
  resultBody.value = "";
  try {
    const trimmed = payload.value.trim();
    const isJson = trimmed.startsWith("{") || trimmed.startsWith("[");
    const headers: Record<string, string> = {
      "Content-Type": isJson
        ? "application/json; charset=utf-8"
        : "text/plain; charset=utf-8",
    };
    if (token.value.trim()) {
      headers["Authorization"] = `Bearer ${token.value.trim()}`;
    }
    const res = await fetch(fullEndpoint.value, {
      method: "POST",
      headers,
      body: payload.value,
    });
    const text = await res.text();
    resultOk.value = res.ok;
    resultStatus.value = `POST → HTTP ${res.status}`;
    resultBody.value = text;
  } catch (err) {
    resultOk.value = false;
    resultStatus.value = isEn.value
      ? "Request failed (ensure ShibaPlan desktop is running with Push Server enabled)"
      : "请求失败（请确认 ShibaPlan 桌面端正在运行，且信息页已开启推送接收服务）";
    resultBody.value = err instanceof Error ? err.message : String(err);
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <div class="sp-playground">
    <div class="sp-pg-header">
      <strong>{{ isEn ? "Interactive Local Webhook Debugger" : "本地推送接口在线调试器" }}</strong>
      <span class="sp-pg-sub">
        {{
          isEn
            ? "Directly sends HTTP requests from this page to your running ShibaPlan instance"
            : "直接从当前文档页向本机运行中的 ShibaPlan 发送真实推送请求"
        }}
      </span>
    </div>

    <div class="sp-pg-grid">
      <label>
        <span>{{ isEn ? "Server Base URL" : "服务地址 (Base URL)" }}</span>
        <input v-model="baseUrl" type="text" placeholder="http://127.0.0.1:18421" />
      </label>
      <label>
        <span>{{ isEn ? "Card Key (pushKey)" : "卡片标识 (pushKey)" }}</span>
        <input v-model="pushKey" type="text" placeholder="demo-service" />
      </label>
      <label>
        <span>{{ isEn ? "Card Title (optional)" : "自动建卡标题 (可选)" }}</span>
        <input v-model="cardTitle" type="text" />
      </label>
      <label>
        <span>{{ isEn ? "Access Token (optional)" : "访问令牌 Token (可选)" }}</span>
        <input v-model="token" type="password" :placeholder="isEn ? 'Leave empty if not set' : '未设置可留空'" />
      </label>
    </div>

    <div class="sp-pg-url">
      <code>POST {{ fullEndpoint }}</code>
    </div>

    <div class="sp-pg-presets">
      <span>{{ isEn ? "Sample Payload:" : "快速填充示例：" }}</span>
      <button type="button" @click="loadPreset('metrics')">
        {{ isEn ? "KPI Metrics" : "KPI 指标卡" }}
      </button>
      <button type="button" @click="loadPreset('list')">
        {{ isEn ? "Event List" : "状态列表" }}
      </button>
      <button type="button" @click="loadPreset('markdown')">Markdown</button>
    </div>

    <textarea v-model="payload" rows="9" class="sp-pg-body" spellcheck="false" />

    <div class="sp-pg-actions">
      <button type="button" class="sp-btn-secondary" :disabled="sending" @click="checkHealth">
        {{ isEn ? "Check /health" : "检测服务状态 (/health)" }}
      </button>
      <button type="button" class="sp-btn-primary" :disabled="sending" @click="sendPush">
        {{ sending ? (isEn ? "Sending..." : "发送中...") : isEn ? "Send Live Push" : "发送测试推送" }}
      </button>
    </div>

    <div v-if="resultStatus" :class="['sp-pg-result', resultOk ? 'ok' : 'err']">
      <div class="sp-pg-status">{{ resultStatus }}</div>
      <pre v-if="resultBody">{{ resultBody }}</pre>
    </div>
  </div>
</template>

<style scoped>
.sp-playground {
  margin: 18px 0;
  padding: 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  font-size: 13px;
}
.sp-pg-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 12px;
}
.sp-pg-sub {
  font-size: 12px;
  color: var(--vp-c-text-2);
}
.sp-pg-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 10px;
}
.sp-pg-grid label {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sp-pg-grid label span {
  font-size: 12px;
  color: var(--vp-c-text-2);
}
.sp-pg-grid input,
.sp-pg-body {
  width: 100%;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
}
.sp-pg-url {
  margin: 10px 0;
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--vp-c-bg);
  border: 1px dashed var(--vp-c-divider);
  overflow-x: auto;
}
.sp-pg-presets {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--vp-c-text-2);
}
.sp-pg-presets button {
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  cursor: pointer;
  font-size: 12px;
}
.sp-pg-presets button:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}
.sp-pg-body {
  line-height: 1.5;
  resize: vertical;
}
.sp-pg-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}
.sp-btn-primary,
.sp-btn-secondary {
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.15s;
}
.sp-btn-primary {
  background: var(--vp-c-brand-1);
  color: #fff;
  border: none;
}
.sp-btn-secondary {
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border: 1px solid var(--vp-c-divider);
}
.sp-btn-primary:disabled,
.sp-btn-secondary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.sp-pg-result {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
}
.sp-pg-result.ok {
  border: 1px solid rgba(16, 185, 129, 0.35);
  background: rgba(16, 185, 129, 0.08);
}
.sp-pg-result.err {
  border: 1px solid rgba(244, 63, 94, 0.35);
  background: rgba(244, 63, 94, 0.08);
}
.sp-pg-status {
  font-weight: 600;
  margin-bottom: 4px;
}
.sp-pg-result pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
