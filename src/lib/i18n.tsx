import React, { createContext, useContext, useMemo } from "react";

export interface CustomLocalePack {
  code: string;
  name: string;
  strings: Record<string, string>;
}

export const ZH_CN: Record<string, string> = {
  // Header & Nav
  "nav.kanban": "看板",
  "nav.calendar": "时间",
  "nav.memos": "笔记",
  "nav.info": "信息",
  "nav.quickCapture": "全局闪念",
  "nav.docs": "使用与接口文档",
  "nav.settings": "设置与同步",
  "common.loading": "加载中...",
  "common.save": "保存",
  "common.saved": "已保存",
  "common.cancel": "取消",
  "common.delete": "删除",
  "common.clear": "清除",
  "common.close": "关闭",
  "common.today": "今天",
  "common.tomorrow": "明天",
  "common.more": "更多",
  "common.items": "项",

  // Settings & Language
  "settings.title": "设置与多语言",
  "settings.shortcutTitle": "全局闪念快捷键",
  "settings.shortcutDesc": "Alt + Space（被占用时自动切为 Ctrl + Shift + Space）",
  "settings.syncDirLabel": "本地数据 & Markdown 同步目录",
  "settings.syncDirHint": "设为 OneDrive / iCloud / Git 目录即可实现 Win 与 Mac 自动同步",
  "settings.languageLabel": "界面语言",
  "settings.exportLang": "导出语言文件",
  "settings.importLang": "导入语言文件",
  "settings.langHint": "导出 JSON 翻译后重新导入，即可添加任意自定义语言",
  "settings.langImported": "已导入并切换语言：",
  "settings.langInvalid": "语言文件格式无效，请检查 JSON 结构",
  "settings.themeLabel": "界面主题",
  "theme.dark": "深色",
  "theme.light": "浅色",
  "theme.paper": "纸张质感",

  // Kanban
  "kanban.subtitle": "自定义看板 · 自由创建列、拖拽或悬停 Ctrl+V 粘贴",
  "kanban.newColumn": "新建看板列",
  "kanban.emptyTitle": "还没有看板列",
  "kanban.emptyDesc": "按你自己的工作节奏自由创建列，例如「待处理」「设计稿」「开发中」「待评测」",
  "kanban.createFirst": "创建第一列",
  "kanban.showDone": "已完成",
  "kanban.hideDone": "隐藏已完成",
  "kanban.tabAll": "全部任务",
  "kanban.tabDone": "已完成",
  "kanban.noDoneTasks": "还没有已完成的任务",
  "kanban.completedAt": "完成于",
  "kanban.addCard": "添加卡片",
  "kanban.addCardPlaceholder": "输入任务标题，回车确认...",
  "kanban.dropHint": "拖入卡片或点 + 新增",
  "kanban.renameTip": "双击重命名",
  "kanban.renameCard": "重命名",
  "kanban.copyLink": "复制链接",
  "kanban.deleteColumn": "删除此列",
  "kanban.confirmDeleteTitle": "确认删除看板列",
  "kanban.confirmDeleteDesc": "确定要删除「{name}」吗？该列下的 {count} 张卡片也会一并移除，此操作无法撤销。",
  "kanban.confirmDeleteEmpty": "确定要删除看板列「{name}」吗？",
  "kanban.confirmDeleteCardTitle": "确认删除卡片",
  "kanban.confirmDeleteCardDesc": "确定要删除「{name}」吗？此操作无法撤销。",
  "kanban.colNamePlaceholder": "列名称（如：设计 / 开发 / 评测）",
  "kanban.confirmAdd": "确认添加",
  "kanban.usedMinutes": "已用",
  "kanban.finish": "完成",
  "kanban.pause": "暂停",
  "kanban.resume": "继续",
  "kanban.focus": "开始专注",
  "kanban.schedule": "关联日期与时间",
  "kanban.star": "标为核心优先",
  "kanban.markDone": "标记完成",
  "kanban.restoreTodo": "恢复待办",
  "kanban.taskModalTitle": "任务详情与关联时间",
  "kanban.taskTitlePlaceholder": "任务标题",
  "kanban.taskNotesPlaceholder": "补充备注（可选）...",
  "kanban.dateAndTime": "关联日期与时间",
  "kanban.screenshotTask": "截图任务",
  "kanban.openFolder": "打开文件夹",
  "kanban.refreshFolder": "刷新文件列表",
  "kanban.folderEmpty": "文件夹为空",
  "kanban.folderLoading": "读取文件列表中...",
  "kanban.folderTauriOnly": "桌面端支持实时读取与打开本地文件夹",
  "kanban.expandFolder": "展开查看文件",
  "kanban.collapseFolder": "折叠文件列表",
  "kanban.ctxShowEffort": "显示耗时",
  "kanban.ctxShowDate": "显示关联时间",
  "kanban.ctxShowNotes": "显示备注",
  "kanban.ctxShowImage": "显示图片",
  "kanban.ctxRename": "重命名",
  "kanban.ctxResetWidth": "恢复默认宽度",

  // Calendar
  "calendar.yearMonth": "{year} 年 {month} 月",
  "calendar.prevMonth": "上个月",
  "calendar.nextMonth": "下个月",
  "calendar.hint": "悬停日期预览当天任务，点击快速安排",
  "calendar.unscheduled": "未排期",
  "calendar.weekdayPrefix": "周",
  "calendar.weekdays": "一,二,三,四,五,六,日",
  "calendar.noTasksHover": "当天暂无排期任务，点击可快速添加",
  "calendar.noTasksDay": "当天暂无任务",
  "calendar.addForDayPlaceholder": "为这一天新增任务...",
  "calendar.add": "添加",
  "calendar.needColumnHint": "请先在「看板」视图创建一个列，即可直接在这里按日期排期",
  "calendar.est": "预估",
  "calendar.tasksCount": "项任务",

  // Idea River
  "river.title": "灵感流",
  "river.rowsHint": "{rows} 行 · 拖到上方看板即可转任务",
  "river.listHint": "滚轮快速翻页 · 拖到上方看板即可转任务",
  "river.modeRiver": "河流",
  "river.modeList": "列表",
  "river.pause": "暂停",
  "river.resume": "继续",
  "river.speedSlow": "慢速",
  "river.speedNormal": "中速",
  "river.speedFast": "快速",
  "river.addIdea": "记灵感",
  "river.emptyRiver": "点击「记灵感」或悬停此处按 Ctrl+V，让想法在这里缓缓流动",
  "river.emptyList": "暂无灵感记录，点击「记灵感」或悬停此处按 Ctrl+V 添加",
  "river.pageInfo": "每页 {size} 条 · 滚轮翻页",
  "river.hoverAction": "拖入看板或点击查看",
  "river.defaultTag": "灵感",
  "river.editIdea": "编辑灵感",
  "river.newIdea": "记录新灵感",
  "river.ideaPlaceholder": "写下你的想法、设计思路或评测发现...（支持 Ctrl+V 粘贴截图）",
  "river.tagPlaceholder": "标签",
  "river.pasteTip": "Ctrl+V 贴图",
  "river.enterSave": "按 Enter 直接保存",
  "river.ctrlEnterSave": "按 Ctrl+Enter 保存",
  "river.detailTitle": "灵感详情与 AI Prompt",
  "river.sendToKanban": "转入看板",
  "river.needColumnForIdea": "新建看板列后可一键转入",
  "river.exportMd": "导出 .md",
  "river.copyForAi": "复制给 AI",
  "river.copied": "已复制",
  "river.exportedTo": "已导出到",
  "river.downloadedMd": "已下载 .md 文件",
  "river.trashTitle": "灵感回收站",
  "river.emptyTrashBtn": "清空",
  "river.trashEmptyDesc": "回收站为空（删除或已拖入看板的灵感会暂存在这里）",
  "river.reasonUsed": "已转入看板",
  "river.reasonDeleted": "已删除",
  "river.restore": "恢复到灵感流",
  "river.permanentDelete": "彻底删除",

  // Quick Capture Window
  "capture.title": "ShibaPlan 闪念",
  "capture.placeholder": "写下灵感或评测发现...（Ctrl+V 贴图，Ctrl+Enter 保存）",
  "capture.escClose": "Esc 关闭",
  "capture.saving": "保存中...",
};

export const EN_US: Record<string, string> = {
  "nav.kanban": "Board",
  "nav.calendar": "Timeline",
  "nav.memos": "Notes",
  "nav.info": "Info",
  "nav.quickCapture": "Quick Capture",
  "nav.docs": "Docs & API",
  "nav.settings": "Settings & Sync",
  "common.loading": "Loading...",
  "common.save": "Save",
  "common.saved": "Saved",
  "common.cancel": "Cancel",
  "common.delete": "Delete",
  "common.clear": "Clear",
  "common.close": "Close",
  "common.today": "Today",
  "common.tomorrow": "Tomorrow",
  "common.more": "more",
  "common.items": "items",

  "settings.title": "Settings & Languages",
  "settings.shortcutTitle": "Global Quick Capture Shortcut",
  "settings.shortcutDesc": "Alt + Space (auto-falls back to Ctrl + Shift + Space if occupied)",
  "settings.syncDirLabel": "Local Data & Markdown Sync Folder",
  "settings.syncDirHint": "Point to OneDrive / iCloud / Git for seamless Win & macOS sync",
  "settings.languageLabel": "Interface Language",
  "settings.exportLang": "Export Language JSON",
  "settings.importLang": "Import Language JSON",
  "settings.langHint": "Export a JSON file, translate it, and re-import to add any language",
  "settings.langImported": "Imported and switched to: ",
  "settings.langInvalid": "Invalid language JSON file format",
  "settings.themeLabel": "Appearance Theme",
  "theme.dark": "Dark",
  "theme.light": "Light",
  "theme.paper": "Paper",

  "kanban.subtitle": "Custom Board · Create columns, drag cards, or hover + Ctrl+V to paste",
  "kanban.newColumn": "New Column",
  "kanban.emptyTitle": "No board columns yet",
  "kanban.emptyDesc": "Create columns that fit your workflow, such as Backlog, Design, Dev, or Eval",
  "kanban.createFirst": "Create First Column",
  "kanban.showDone": "Done",
  "kanban.hideDone": "Hide Done",
  "kanban.tabAll": "All Tasks",
  "kanban.tabDone": "Completed",
  "kanban.noDoneTasks": "No completed tasks yet",
  "kanban.completedAt": "Completed",
  "kanban.addCard": "Add card",
  "kanban.addCardPlaceholder": "Task title, press Enter...",
  "kanban.dropHint": "Drop cards or click +",
  "kanban.renameTip": "Double-click to rename",
  "kanban.renameCard": "Rename",
  "kanban.copyLink": "Copy link",
  "kanban.deleteColumn": "Delete column",
  "kanban.confirmDeleteTitle": "Delete Column",
  "kanban.confirmDeleteDesc": "Delete \"{name}\"? All {count} card(s) inside this column will also be removed. This cannot be undone.",
  "kanban.confirmDeleteEmpty": "Delete column \"{name}\"?",
  "kanban.confirmDeleteCardTitle": "Delete Card",
  "kanban.confirmDeleteCardDesc": "Are you sure you want to delete \"{name}\"? This cannot be undone.",
  "kanban.colNamePlaceholder": "Column name (e.g. Design / Dev / Eval)",
  "kanban.confirmAdd": "Add Column",
  "kanban.usedMinutes": "Logged",
  "kanban.finish": "Done",
  "kanban.pause": "Pause",
  "kanban.resume": "Resume",
  "kanban.focus": "Start Focus",
  "kanban.schedule": "Schedule Date & Time",
  "kanban.star": "Toggle Priority Star",
  "kanban.markDone": "Mark Done",
  "kanban.restoreTodo": "Restore Task",
  "kanban.taskModalTitle": "Task Details & Schedule",
  "kanban.taskTitlePlaceholder": "Task title",
  "kanban.taskNotesPlaceholder": "Additional notes (optional)...",
  "kanban.dateAndTime": "Date & Time",
  "kanban.screenshotTask": "Screenshot Task",
  "kanban.openFolder": "Open Folder",
  "kanban.refreshFolder": "Refresh Files",
  "kanban.folderEmpty": "Folder is empty",
  "kanban.folderLoading": "Loading files...",
  "kanban.folderTauriOnly": "Live local folder browsing works in the desktop app",
  "kanban.expandFolder": "Expand files",
  "kanban.collapseFolder": "Collapse files",
  "kanban.ctxShowEffort": "Show effort",
  "kanban.ctxShowDate": "Show schedule",
  "kanban.ctxShowNotes": "Show notes",
  "kanban.ctxShowImage": "Show images",
  "kanban.ctxRename": "Rename column",
  "kanban.ctxResetWidth": "Reset width",

  "calendar.yearMonth": "{year} / {month}",
  "calendar.prevMonth": "Previous month",
  "calendar.nextMonth": "Next month",
  "calendar.hint": "Hover a day to preview tasks, click to schedule",
  "calendar.unscheduled": "Unscheduled",
  "calendar.weekdayPrefix": "",
  "calendar.weekdays": "Mon,Tue,Wed,Thu,Fri,Sat,Sun",
  "calendar.noTasksHover": "No tasks scheduled. Click to add.",
  "calendar.noTasksDay": "No tasks on this day",
  "calendar.addForDayPlaceholder": "Add a task for this day...",
  "calendar.add": "Add",
  "calendar.needColumnHint": "Create a column in Board view first to schedule tasks here",
  "calendar.est": "Est.",
  "calendar.tasksCount": "tasks",

  "river.title": "Idea River",
  "river.rowsHint": "{rows} rows · Drag into board to convert",
  "river.listHint": "Wheel to flip pages · Drag into board",
  "river.modeRiver": "River",
  "river.modeList": "List",
  "river.pause": "Pause",
  "river.resume": "Flow",
  "river.speedSlow": "Slow",
  "river.speedNormal": "Medium",
  "river.speedFast": "Fast",
  "river.addIdea": "New Idea",
  "river.emptyRiver": "Click New Idea or hover here + Ctrl+V to let ideas drift by",
  "river.emptyList": "No ideas yet. Click New Idea or hover + Ctrl+V to add",
  "river.pageInfo": "{size}/page · Scroll wheel to flip",
  "river.hoverAction": "Drag to board or click",
  "river.defaultTag": "Idea",
  "river.editIdea": "Edit Idea",
  "river.newIdea": "Capture Idea",
  "river.ideaPlaceholder": "Write an idea, design note, or eval finding... (Ctrl+V to paste image)",
  "river.tagPlaceholder": "Tag",
  "river.pasteTip": "Ctrl+V image",
  "river.enterSave": "Press Enter to save",
  "river.ctrlEnterSave": "Press Ctrl+Enter to save",
  "river.detailTitle": "Idea Details & AI Prompt",
  "river.sendToKanban": "Send to Board",
  "river.needColumnForIdea": "Create a board column first",
  "river.exportMd": "Export .md",
  "river.copyForAi": "Copy for AI",
  "river.copied": "Copied",
  "river.exportedTo": "Exported to",
  "river.downloadedMd": "Downloaded .md file",
  "river.trashTitle": "Idea Recycle Bin",
  "river.emptyTrashBtn": "Empty",
  "river.trashEmptyDesc": "Recycle bin is empty (deleted or board-converted ideas stay here)",
  "river.reasonUsed": "Sent to Board",
  "river.reasonDeleted": "Deleted",
  "river.restore": "Restore to Idea River",
  "river.permanentDelete": "Delete permanently",

  "capture.title": "ShibaPlan Capture",
  "capture.placeholder": "Capture an idea or finding... (Ctrl+V image, Ctrl+Enter save)",
  "capture.escClose": "Esc to close",
  "capture.saving": "Saving...",
};

export const BUILTIN_LOCALES: { code: string; name: string; strings: Record<string, string> }[] = [
  { code: "zh-CN", name: "简体中文", strings: ZH_CN },
  { code: "en-US", name: "English", strings: EN_US },
];

interface I18nContextValue {
  locale: string;
  availableLocales: { code: string; name: string; builtin: boolean }[];
  t: (key: string, params?: Record<string, string | number>) => string;
  setLocale: (code: string) => void;
  exportCurrentLocale: () => void;
  importLocaleFile: (file: File) => Promise<{ ok: boolean; message: string }>;
  removeCustomLocale: (code: string) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

interface I18nProviderProps {
  locale: string;
  customLocales: CustomLocalePack[];
  onChangeLocale: (code: string) => void;
  onChangeCustomLocales: (packs: CustomLocalePack[], switchTo?: string) => void;
  children: React.ReactNode;
}

export const I18nProvider: React.FC<I18nProviderProps> = ({
  locale,
  customLocales,
  onChangeLocale,
  onChangeCustomLocales,
  children,
}) => {
  const allPacks = useMemo(() => {
    const map = new Map<string, { code: string; name: string; strings: Record<string, string>; builtin: boolean }>();
    BUILTIN_LOCALES.forEach((b) =>
      map.set(b.code, { ...b, builtin: true })
    );
    customLocales.forEach((c) =>
      map.set(c.code, { ...c, builtin: false })
    );
    return map;
  }, [customLocales]);

  const activePack = allPacks.get(locale) ?? allPacks.get("zh-CN")!;

  const t = (key: string, params?: Record<string, string | number>): string => {
    let text =
      activePack.strings[key] ?? ZH_CN[key] ?? EN_US[key] ?? key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(`{${k}}`, String(v));
      });
    }
    return text;
  };

  const exportCurrentLocale = () => {
    const payload: CustomLocalePack = {
      code: activePack.code,
      name: activePack.name,
      strings: { ...ZH_CN, ...activePack.strings },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shibaplan-lang-${payload.code}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importLocaleFile = async (
    file: File
  ): Promise<{ ok: boolean; message: string }> => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<CustomLocalePack>;
      if (
        !parsed ||
        typeof parsed.code !== "string" ||
        !parsed.code.trim() ||
        typeof parsed.name !== "string" ||
        !parsed.name.trim() ||
        !parsed.strings ||
        typeof parsed.strings !== "object"
      ) {
        return { ok: false, message: t("settings.langInvalid") };
      }

      const cleanPack: CustomLocalePack = {
        code: parsed.code.trim(),
        name: parsed.name.trim(),
        strings: parsed.strings,
      };
      const filtered = customLocales.filter((c) => c.code !== cleanPack.code);
      onChangeCustomLocales([...filtered, cleanPack], cleanPack.code);
      return {
        ok: true,
        message: `${t("settings.langImported")}${cleanPack.name}`,
      };
    } catch {
      return { ok: false, message: t("settings.langInvalid") };
    }
  };

  const removeCustomLocale = (code: string) => {
    const next = customLocales.filter((c) => c.code !== code);
    onChangeCustomLocales(next, locale === code ? "zh-CN" : undefined);
  };

  const availableLocales = useMemo(
    () =>
      Array.from(allPacks.values()).map(({ code, name, builtin }) => ({
        code,
        name,
        builtin,
      })),
    [allPacks]
  );

  return (
    <I18nContext.Provider
      value={{
        locale,
        availableLocales,
        t,
        setLocale: onChangeLocale,
        exportCurrentLocale,
        importLocaleFile,
        removeCustomLocale,
      }}
    >
      {children}
    </I18nContext.Provider>
  );
};

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return ctx;
}
