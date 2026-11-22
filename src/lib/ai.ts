import { AIConfig, BoardColumn, EffortSize, IdeaItem, TaskItem } from "../types";

export interface AIProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  defaultModel: string;
  needsKey: boolean;
}

export const AI_PROVIDER_PRESETS: AIProviderPreset[] = [
  {
    id: "zhipu",
    label: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
    needsKey: true,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    needsKey: true,
  },
  {
    id: "qwen",
    label: "通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    needsKey: true,
  },
  {
    id: "kimi",
    label: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
    needsKey: true,
  },
  {
    id: "gemini",
    label: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.0-flash",
    needsKey: true,
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    needsKey: true,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "anthropic/claude-3.5-sonnet",
    needsKey: true,
  },
  {
    id: "ollama",
    label: "Ollama 本地",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "qwen2.5:7b",
    needsKey: false,
  },
];

export interface AIBreakdownTask {
  title: string;
  notes?: string;
  effort: EffortSize;
}

async function callChatCompletion(
  config: AIConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const baseUrl = (config.baseUrl || "").trim().replace(/\/+$/, "");
  const model = (config.model || "").trim();
  if (!baseUrl || !model) {
    throw new Error("请先在设置中配置 AI 接口地址与模型名称");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey?.trim()) {
    headers["Authorization"] = `Bearer ${config.apiKey.trim()}`;
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
    throw new Error(`AI 请求失败 (${res.status}): ${errText.slice(0, 140)}`);
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
