export type RoleType = "design" | "dev" | "eval";

export type EffortSize = "S" | "M" | "L";

export type TaskStatus = "todo" | "in_progress" | "done";

export interface ColumnDisplayOptions {
  showEffort?: boolean;
  showDate?: boolean;
  showNotes?: boolean;
  showImage?: boolean;
}

export interface BoardColumn {
  id: string;
  title: string;
  color: string;
  width?: number;
  collapsed?: boolean;
  collapsedHeight?: number;
  x?: number;
  y?: number;
  display?: ColumnDisplayOptions;
}

export interface ProjectItem {
  id: string;
  name: string;
  color: string;
  description?: string;
}

export interface TaskItem {
  id: string;
  title: string;
  notes?: string;
  columnId: string;
  role?: RoleType;
  projectId?: string;
  importance: 1 | 2 | 3;
  effort: EffortSize;
  estimatedMinutes: number;
  actualMinutes: number;
  status: TaskStatus;
  dueDate?: string; // YYYY-MM-DD
  startTime?: string; // HH:mm
  imagePreview?: string;
  imagePath?: string;
  folderPath?: string;
  filePath?: string;
  cachedFiles?: { name: string; path: string; is_dir: boolean }[];
  createdAt: string;
  completedAt?: string;
  sourceIdeaId?: string;
}

export interface IdeaItem {
  id: string;
  content: string;
  tag?: string;
  lane?: number;
  role?: RoleType;
  projectId?: string;
  imagePreview?: string;
  imagePath?: string;
  exportedMdPath?: string;
  convertedTaskId?: string;
  createdAt: string;
}

export interface TrashedIdeaItem extends IdeaItem {
  deletedAt: string;
  reason: "deleted" | "used";
}

export interface FocusLog {
  id: string;
  taskId: string;
  taskTitle: string;
  minutes: number;
  startedAt: string;
  endedAt: string;
}

import type { CustomLocalePack } from "./lib/i18n";

export type ThemeMode = "dark" | "light" | "paper";

export interface AIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AppSettings {
  customDataDir: string;
  shortcutLabel: string;
  locale: string;
  customLocales: CustomLocalePack[];
  theme: ThemeMode;
  paperGrain?: boolean;
  accentColor?: string;
  enterToSave: boolean;
  columnGap?: number;
  ai?: AIConfig;
}

export interface WorkspaceData {
  columns: BoardColumn[];
  projects: ProjectItem[];
  tasks: TaskItem[];
  ideas: IdeaItem[];
  trashedIdeas: TrashedIdeaItem[];
  focusLogs: FocusLog[];
  settings: AppSettings;
}

export const COLUMN_COLORS = [
  "#a78bfa", // violet
  "#38bdf8", // sky
  "#34d399", // emerald
  "#f59e0b", // amber
  "#fb7185", // rose
  "#94a3b8", // slate
];

export const EFFORT_MINUTES: Record<EffortSize, number> = {
  S: 30,
  M: 90,
  L: 180,
};
