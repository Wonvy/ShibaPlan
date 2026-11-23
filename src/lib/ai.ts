import { AIConfig, BoardColumn, EffortSize, IdeaItem, TaskItem } from "../types";

export interface AIProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  defaultModel: string;
  models: string[];
  needsKey: boolean;
}

export const AI_PROVIDER_PRESETS: AIProviderPreset[] = [
  {
    id: "zhipu",
    label: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
    models: [
      "glm-4-flash",
      "glm-4-plus",
      "glm-4-air",
      "glm-4-airx",
      "glm-4-long",
      "glm-4v-flash",
      "glm-z1-flash",
    ],
    needsKey: true,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    needsKey: true,
  },
  {
    id: "qwen",
    label: "通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    models: [
      "qwen-plus",
      "qwen-turbo",
      "qwen-max",
      "qwen-long",
      "qwen2.5-72b-instruct",
    ],
    needsKey: true,
  },
  {
    id: "kimi",
    label: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    needsKey: true,
  },
  {
    id: "gemini",
    label: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.0-flash",
    models: [
      "gemini-2.0-flash",
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-1.5-flash",
    ],
    needsKey: true,
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "o3-mini"],
    needsKey: true,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "anthropic/claude-3.5-sonnet",
    models: [
      "anthropic/claude-3.5-sonnet",
      "openai/gpt-4o-mini",
      "google/gemini-2.0-flash-001",
      "deepseek/deepseek-chat",
    ],
    needsKey: true,
  },
  {
    id: "ollama",
    label: "Ollama 本地",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "qwen2.5:7b",
    models: ["qwen2.5:7b", "deepseek-r1:8b", "llama3.2:latest", "gemma2:9b"],
    needsKey: false,
  },
];

export const DEFAULT_AI_CONFIG: AIConfig = {
  baseUrl: AI_PROVIDER_PRESETS[0].baseUrl,
  apiKey: "",
  model: AI_PROVIDER_PRESETS[0].defaultModel,
};

/**
 * Detect provider from unmistakable API key signatures so pasting a Zhipu /
 * Gemini / OpenRouter key never accidentally routes to OpenAI.
 */
export function detectProviderFromApiKey(
  apiKey: string
): AIProviderPreset | null {
  const trimmed = apiKey.trim();
  if (!trimmed) return null;
  // Zhipu GLM keys have the format: <hex_id>.<secret> (e.g. 32 hex chars + '.' + 16 chars)
  if (/^[0-9a-f]{24,64}\.[A-Za-z0-9_-]{8,}$/i.test(trimmed)) {
    return AI_PROVIDER_PRESETS.find((p) => p.id === "zhipu") ?? null;
  }
  // Google Gemini API keys start with AIza
  if (/^AIza[0-9A-Za-z_-]{20,}$/.test(trimmed)) {
    return AI_PROVIDER_PRESETS.find((p) => p.id === "gemini") ?? null;
  }
  // OpenRouter keys start with sk-or-v1-
  if (/^sk-or-v1-[0-9a-f]{24,}$/i.test(trimmed)) {
    return AI_PROVIDER_PRESETS.find((p) => p.id === "openrouter") ?? null;
  }
  return null;
}

export function resolveEffectiveAIConfig(config: AIConfig): AIConfig {
  let baseUrl = (config.baseUrl || "").trim().replace(/\/+$/, "");
  let model = (config.model || "").trim();
  const apiKey = (config.apiKey || "").trim();

  const detected = detectProviderFromApiKey(apiKey);
  if (
    detected &&
    (!baseUrl || baseUrl.toLowerCase().includes("api.openai.com"))
  ) {
    baseUrl = detected.baseUrl;
    if (!model || /^gpt-|^o[13]-/i.test(model)) {
      model = detected.defaultModel;
    }
  }

  return { baseUrl, apiKey, model };
}

export interface AIBreakdownTask {
  title: string;
  notes?: string;
  effort: EffortSize;
}

function isLocalEndpoint(baseUrl: string): boolean {
  const lower = baseUrl.toLowerCase();
  return (
    lower.includes("localhost") ||
    lower.includes("127.0.0.1") ||
    lower.includes("0.0.0.0") ||
    lower.includes("192.168.") ||
    lower.includes("10.")
  );
}

async function callChatCompletion(
  config: AIConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const resolved = resolveEffectiveAIConfig(config);
  const baseUrl = resolved.baseUrl;
  const model = resolved.model;
  const apiKey = resolved.apiKey;
  if (!baseUrl || !model) {
    throw new Error("请先在「设置 → AI 模型」中配置接口地址与模型名称");
  }
  if (!apiKey && !isLocalEndpoint(baseUrl)) {
    throw new Error(
      "尚未填写 API Key，请前往「设置 → AI 模型」选择平台（如智谱 GLM / DeepSeek）并填写 API Key 后保存"
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      temperature: 0.4,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    let hostLabel = baseUrl;
    try {
      hostLabel = new URL(baseUrl).host;
    } catch {
      // ignore
    }
    throw new Error(
      `AI 请求失败 (${res.status} @ ${hostLabel}): ${errText.slice(0, 140)}`
    );
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("AI 返回内容为空");
  }
  return content.trim();
}

export async function breakdownIdeaWithAI(
  idea: IdeaItem,
  config: AIConfig
): Promise<AIBreakdownTask[]> {
  const systemPrompt = `You are a concise product & engineering planner. Break the user's raw idea into 3 to 5 actionable Kanban tasks.
Respond ONLY with a valid JSON array of objects, with no markdown fences or extra prose:
[{"title": "short actionable task title", "notes": "brief detail", "effort": "S" | "M" | "L"}]
Where S=30m, M=90m, L=180m. Respond in the same language as the user's idea.`;

  const userPrompt = `灵感标签: ${idea.tag || "未分类"}\n灵感内容:\n${idea.content}`;
  const raw = await callChatCompletion(config, systemPrompt, userPrompt);

  // Extract JSON array safely even if wrapped in code fences
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("无法解析 AI 返回的任务列表");
  }
  const parsed = JSON.parse(jsonMatch[0]) as Partial<AIBreakdownTask>[];
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("AI 未返回有效任务");
  }

  return parsed
    .filter((item) => typeof item.title === "string" && item.title.trim())
    .slice(0, 6)
    .map((item) => ({
      title: item.title!.trim().slice(0, 80),
      notes: typeof item.notes === "string" ? item.notes.trim() : undefined,
      effort:
        item.effort === "S" || item.effort === "M" || item.effort === "L"
          ? item.effort
          : "S",
    }));
}

export async function suggestTodayPlanWithAI(
  tasks: TaskItem[],
  columns: BoardColumn[],
  config: AIConfig
): Promise<string> {
  const pending = tasks.filter((t) => t.status !== "done");
  if (pending.length === 0) {
    return "当前没有待办任务，可以先把灵感流里的想法拖进看板，或直接新建今天的任务。";
  }

  const colMap = new Map(columns.map((c) => [c.id, c.title]));
  const today = new Date().toISOString().slice(0, 10);
  const taskLines = pending.slice(0, 30).map((t, idx) => {
    const colName = colMap.get(t.columnId) ?? "看板";
    const due = t.dueDate
      ? `截止:${t.dueDate}${t.startTime ? ` ${t.startTime}` : ""}`
      : "未排期";
    const star = t.importance === 3 ? "[核心]" : "";
    return `${idx + 1}. ${star}[${colName}] ${t.title} (${t.estimatedMinutes}m, ${due})`;
  });

  const systemPrompt = `你是高效个人工作节奏顾问。请结合用户当前的待办任务列表（设计/开发/评测），给出清晰、克制、直接可执行的「今日优先顺序与时间段建议」。
要求：
1. 不要使用任何表情符号。
2. 先给出「今日 Top 3 优先推进」及理由。
3. 按同类任务聚合（减少上下文切换）给出上午/下午的时间块建议。
4. 保持简短利落。`;

  const userPrompt = `今天日期: ${today}\n待办任务列表:\n${taskLines.join("\n")}`;
  return await callChatCompletion(config, systemPrompt, userPrompt);
}

export async function testAIConnection(config: AIConfig): Promise<string> {
  const reply = await callChatCompletion(
    config,
    "Reply with OK only.",
    "ping"
  );
  return reply.slice(0, 40);
}

function extractModelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;
  const list = Array.isArray(obj.data)
    ? obj.data
    : Array.isArray(obj.models)
      ? obj.models
      : Array.isArray(payload)
        ? (payload as unknown[])
        : [];

  const ids = new Set<string>();
  for (const item of list) {
    if (typeof item === "string" && item.trim()) {
      ids.add(item.trim());
    } else if (item && typeof item === "object") {
      const rec = item as Record<string, unknown>;
      const rawId =
        typeof rec.id === "string"
          ? rec.id
          : typeof rec.name === "string"
            ? rec.name
            : typeof rec.model === "string"
              ? rec.model
              : "";
      const cleaned = rawId.replace(/^models\//, "").trim();
      if (cleaned) ids.add(cleaned);
    }
  }
  return Array.from(ids).sort((a, b) => a.localeCompare(b));
}

export async function fetchAvailableModels(
  config: Pick<AIConfig, "baseUrl" | "apiKey">
): Promise<string[]> {
  const resolved = resolveEffectiveAIConfig({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: "",
  });
  const baseUrl = resolved.baseUrl;
  const apiKey = resolved.apiKey;
  if (!baseUrl) {
    throw new Error("请先填写 Base URL");
  }
  if (!apiKey && !isLocalEndpoint(baseUrl)) {
    throw new Error("请先填写该平台的 API Key 后再自动获取模型列表");
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const candidates = [`${baseUrl}/models`];
  if (baseUrl.includes("11434")) {
    const origin = baseUrl.replace(/\/v1$/i, "");
    candidates.push(`${origin}/api/tags`);
  }

  let lastError = "未能获取到可用模型列表";
  for (const url of candidates) {
    try {
      const res = await fetch(url, { method: "GET", headers });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        lastError = `获取模型失败 (${res.status}): ${errText.slice(0, 120)}`;
        continue;
      }
      const data = await res.json();
      const models = extractModelIds(data);
      if (models.length > 0) {
        return models;
      }
      lastError = "接口返回成功，但模型列表为空";
    } catch (err) {
      lastError =
        err instanceof Error ? `请求失败: ${err.message}` : "网络请求失败";
    }
  }

  throw new Error(lastError);
}
