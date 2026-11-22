import React, { useEffect, useRef, useState } from "react";
import { Check, CheckSquare, ChevronUp, Image as ImageIcon, Sparkles, Tag, X } from "lucide-react";
import {
  EFFORT_MINUTES,
  IdeaItem,
  TaskItem,
  WorkspaceData,
} from "../types";
import {
  hideCaptureWindow,
  isTauriRuntime,
  loadWorkspace,
  savePastedImage,
  saveWorkspace,
  uid,
} from "../lib/storage";

export const QuickCapture: React.FC = () => {
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [content, setContent] = useState("");
  const [tag, setTag] = useState("灵感");
  const [alsoCreateTask, setAlsoCreateTask] = useState(false);
  const [targetColId, setTargetColId] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageExt, setImageExt] = useState<string>("png");
  const [saving, setSaving] = useState(false);
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const enterToSave = workspace?.settings.enterToSave ?? true;

  const setEnterToSave = async (val: boolean) => {
    setSaveMenuOpen(false);
    if (!workspace) return;
    const next = {
      ...workspace,
      settings: {
        ...workspace.settings,
        enterToSave: val,
      },
    };
    setWorkspace(next);
    await saveWorkspace(next);
  };

  const refreshData = async () => {
    const data = await loadWorkspace();
    setWorkspace(data);
    document.documentElement.setAttribute(
      "data-theme",
      data.settings.theme || "dark"
    );
    document.documentElement.setAttribute(
      "data-grain",
      (data.settings.paperGrain ?? true) ? "on" : "off"
    );
    if (data.columns.length > 0 && !targetColId) {
      setTargetColId(data.columns[0].id);
    }
  };

  useEffect(() => {
    refreshData();
    textareaRef.current?.focus();

    let unlisten: (() => void) | undefined;
    if (isTauriRuntime()) {
      import("@tauri-apps/api/event").then(({ listen }) => {
        listen("capture-opened", () => {
          refreshData();
          setTimeout(() => textareaRef.current?.focus(), 40);
        }).then((fn) => {
          unlisten = fn;
        });
      });
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") hideCaptureWindow();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (unlisten) unlisten();
    };
  }, []);

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (!file) continue;
        const ext = item.type.split("/")[1] || "png";
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") {
            setImagePreview(reader.result);
            setImageExt(ext);
          }
        };
        reader.readAsDataURL(file);
        e.preventDefault();
        break;
      }
    }
  };

  const handleSave = async () => {
    const trimmed = content.trim();
    if (!trimmed && !imagePreview) return;
    setSaving(true);
    try {
      const latest = await loadWorkspace(workspace?.settings.customDataDir);
      let savedImagePath: string | undefined;
      if (imagePreview) {
        const p = await savePastedImage(
          imagePreview,
          imageExt,
          latest.settings.customDataDir
        );
        if (p) savedImagePath = p;
      }

      const now = new Date().toISOString();
      const ideaId = uid("idea");
      let convertedTaskId: string | undefined;

      const nextTasks = [...latest.tasks];
      const colId = targetColId || latest.columns[0]?.id;
      if (alsoCreateTask && colId) {
        convertedTaskId = uid("task");
        const firstLine = trimmed.split("\n")[0].slice(0, 60) || "截图灵感跟进";
        const newTask: TaskItem = {
          id: convertedTaskId,
          title: firstLine,
          notes: trimmed,
          columnId: colId,
          importance: 2,
          effort: "S",
          estimatedMinutes: EFFORT_MINUTES.S,
          actualMinutes: 0,
          status: "todo",
          createdAt: now,
          sourceIdeaId: ideaId,
        };
        nextTasks.unshift(newTask);
      }

      const newIdea: IdeaItem = {
        id: ideaId,
        content: trimmed || "[截图灵感]",
        tag: tag.trim() || "灵感",
        imagePreview: imagePreview || undefined,
        imagePath: savedImagePath,
        convertedTaskId,
        createdAt: now,
      };

      await saveWorkspace({
        ...latest,
        ideas: [newIdea, ...latest.ideas],
        tasks: nextTasks,
      });

      setContent("");
      setImagePreview(null);
      setAlsoCreateTask(false);
      await hideCaptureWindow();
    } finally {
      setSaving(false);
    }
  };

  const columns = workspace?.columns ?? [];

  return (
    <div className="flex h-screen w-screen flex-col bg-[#161619] text-zinc-100 ring-1 ring-white/[0.1]">
      <div
        data-tauri-drag-region
        className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5 select-none cursor-move"
      >
        <div className="flex items-center gap-2 pointer-events-none">
          <Sparkles className="h-3.5 w-3.5 text-shiba-400" />
          <span className="text-xs font-medium text-zinc-200">
            ShibaPlan 闪念
          </span>
        </div>
        <button
          onClick={() => hideCaptureWindow()}
          className="rounded-md p-1 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-2.5 p-4 overflow-hidden">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (enterToSave) {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSave();
              }
            } else {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                handleSave();
              }
            }
          }}
          placeholder={
            enterToSave
              ? "写下灵感或评测发现...（Ctrl+V 贴图，Enter 保存，Shift+Enter 换行）"
              : "写下灵感或评测发现...（Ctrl+V 贴图，Ctrl+Enter 保存）"
          }
          className="flex-1 w-full resize-none bg-transparent text-sm leading-relaxed text-zinc-100 placeholder-zinc-500 focus:outline-none"
        />

        {imagePreview && (
          <div className="relative inline-flex items-center gap-2 self-start rounded-xl bg-[#111113] p-1.5 ring-1 ring-white/[0.08]">
            <img
              src={imagePreview}
              alt="screenshot"
              className="h-14 w-24 rounded-lg object-cover"
            />
            <button
              onClick={() => setImagePreview(null)}
              className="absolute -right-1.5 -top-1.5 rounded-full bg-zinc-800 p-0.5 text-zinc-300 hover:text-white"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-white/[0.06] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-md bg-[#111113] px-2 py-1 ring-1 ring-white/[0.07]">
            <Tag className="h-3 w-3 text-zinc-500" />
            <input
              type="text"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="标签"
              className="w-16 bg-transparent text-xs text-zinc-200 focus:outline-none"
            />
          </div>

          {columns.length > 0 && (
            <>
              <button
                onClick={() => setAlsoCreateTask((v) => !v)}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition ${
                  alsoCreateTask
                    ? "bg-shiba-500/20 text-shiba-300"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <CheckSquare className="h-3.5 w-3.5" />
                转入看板
              </button>

              {alsoCreateTask && (
                <select
                  value={targetColId}
                  onChange={(e) => setTargetColId(e.target.value)}
                  className="rounded-md bg-[#111113] px-2 py-1 text-xs text-zinc-300 ring-1 ring-white/[0.08] focus:outline-none"
                >
                  {columns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-zinc-500">
            <ImageIcon className="h-3 w-3" />
            Esc 关闭
          </span>
          <div className="relative flex items-center">
            {saveMenuOpen && (
              <div className="absolute bottom-full right-0 mb-1.5 w-44 rounded-xl bg-[#1f1f24] p-1 ring-1 ring-white/[0.12] shadow-xl">
                <button
                  type="button"
                  onClick={() => setEnterToSave(true)}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 hover:bg-white/[0.08]"
                >
                  <span>按 Enter 直接保存</span>
                  {enterToSave && (
                    <Check className="h-3.5 w-3.5 text-shiba-400" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setEnterToSave(false)}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 hover:bg-white/[0.08]"
                >
                  <span>按 Ctrl+Enter 保存</span>
                  {!enterToSave && (
                    <Check className="h-3.5 w-3.5 text-shiba-400" />
                  )}
                </button>
              </div>
            )}

            <div className="flex items-stretch overflow-hidden rounded-lg bg-shiba-500 text-zinc-950">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || (!content.trim() && !imagePreview)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold hover:bg-shiba-400 disabled:opacity-35"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {saving ? "保存中..." : "保存"}
              </button>
              <button
                type="button"
                onClick={() => setSaveMenuOpen((v) => !v)}
                className="flex items-center justify-center border-l border-zinc-950/20 px-1.5 hover:bg-shiba-400"
                title="切换回车保存方式"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
