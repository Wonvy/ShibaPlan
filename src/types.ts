export type RoleType = "design" | "dev" | "eval";

export type EffortSize = "S" | "M" | "L";

export type TaskStatus = "todo" | "in_progress" | "done";

export type TaskPriorityColor = "urgent" | "important" | "normal";

export interface TaskAttachment {
  path: string;
  name: string;
  is_dir: boolean;
}

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
  gapAfter?: number;
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
  priorityColor?: TaskPriorityColor;
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
  attachments?: TaskAttachment[];
  cachedFiles?: { name: string; path: string; is_dir: boolean }[];
  createdAt: string;
  completedAt?: string;
  sourceIdeaId?: string;
}

export type WeatherKind =
  | "clear"
  | "cloudy"
  | "rain"
  | "snow"
  | "fog"
  | "storm";

export interface IdeaWeather {
  kind: WeatherKind;
  tempC?: number;
  label?: string;
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
  weather?: IdeaWeather;
  createdAt: string;
}

export interface TrashedIdeaItem extends IdeaItem {
  deletedAt: string;
  reason: "deleted" | "used";
}

export interface MemoFolder {
  id: string;
  name: string;
  collapsed?: boolean;
  createdAt: string;
}

export interface MemoItem {
  id: string;
  title: string;
  tag: string;
  folderId?: string;
  expiresAt?: string; // YYYY-MM-DD
  renewDays?: number; // e.g. 30 | 90 | 365
  dailyDate?: string; // YYYY-MM-DD (for daily notes)
  pinned?: boolean;
  content: string;
  createdAt: string;
  updatedAt: string;
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

export interface AIProviderProfile {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AIConfig {
  providerId?: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  profiles?: Record<string, AIProviderProfile>;
}

export interface ProjectArchiveDir {
  id: string;
  path: string;
  label?: string;
  enabled?: boolean;
}

export type ProjectDateMode = "name_first" | "files_first" | "name_only";

export type InfoSourceKind =
  | "script"
  | "command"
  | "http"
  | "push"
  | "container"
  | "control"
  | "web";

export type InfoWebDisplayMode = "bookmark" | "embed";

export type InfoWebDeviceMode = "auto" | "mobile" | "tablet" | "desktop";

export type InfoControlType = "switch" | "icon";

export type InfoControlActionKind = "none" | "script" | "command" | "url" | "path";

export type InfoScriptLang =
  | "python"
  | "powershell"
  | "node"
  | "batch"
  | "bash"
  | "json";

export type InfoScheduleMode = "manual" | "interval" | "cron";

export type InfoLayoutMode = "free" | "grid" | "compact";

export type InfoCardStatus = "ok" | "info" | "warn" | "error";

export type InfoDisplayView =
  | "auto"
  | "metrics"
  | "list"
  | "kv"
  | "table"
  | "markdown"
  | "text";

export interface InfoWidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  px?: number;
  py?: number;
  pw?: number;
  ph?: number;
}

export interface InfoWidgetSchedule {
  mode: InfoScheduleMode;
  intervalSeconds?: number;
  cron?: string;
  runOnStartup?: boolean;
  paused?: boolean;
}

export interface InfoWidgetSource {
  kind: InfoSourceKind;
  scriptPath?: string;
  inlineCode?: string;
  scriptLang?: InfoScriptLang;
  interpreter?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  useShell?: boolean;
  url?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
  jsonPath?: string;
  env?: Record<string, string>;
  params?: Record<string, string>;
  timeoutSec?: number;
  pushKey?: string;
  pushToken?: string;
  staleAfterMinutes?: number;
  // Atomic control widget fields (when kind === "control")
  controlType?: InfoControlType;
  controlState?: boolean;
  controlIcon?: string;
  controlLabel?: string;
  controlLabelPosition?: "bottom" | "right";
  controlActionKind?: InfoControlActionKind;
  controlTarget?: string;
  // Website widget fields (when kind === "web")
  webFavicon?: string;
  webDisplayMode?: InfoWebDisplayMode;
  webDeviceMode?: InfoWebDeviceMode;
}

export interface InfoPushServerConfig {
  enabled: boolean;
  port: number;
  allowLan?: boolean;
  autoCreate?: boolean;
}

export interface InfoWidgetAppearance {
  accentColor?: string;
  hideHeader?: boolean;
  compactPadding?: boolean;
  displayView?: InfoDisplayView;
  collapsed?: boolean;
}

export interface InfoWidget {
  id: string;
  boardId: string;
  parentId?: string;
  title: string;
  description?: string;
  source: InfoWidgetSource;
  schedule: InfoWidgetSchedule;
  layout: InfoWidgetLayout;
  appearance?: InfoWidgetAppearance;
  createdAt: string;
  updatedAt: string;
}

export interface InfoBoard {
  id: string;
  name: string;
  layoutMode?: InfoLayoutMode;
  showGrid?: boolean;
  locked?: boolean;
  snapEnabled?: boolean;
  preventOverlap?: boolean;
  cols?: number;
  rowHeight?: number;
}

export interface AppSettings {
  customDataDir: string;
  shortcutLabel: string;
  locale: string;
  customLocales: CustomLocalePack[];
  theme: ThemeMode;
  paperGrain?: boolean;
  riverAtmosphere?: boolean;
  accentColor?: string;
  enterToSave: boolean;
  columnGap?: number;
  ai?: AIConfig;
  projectArchiveDirs?: ProjectArchiveDir[];
  projectDateMode?: ProjectDateMode;
  starredProjects?: string[];
  infoPush?: InfoPushServerConfig;
}

export interface WorkspaceData {
  columns: BoardColumn[];
  projects: ProjectItem[];
  tasks: TaskItem[];
  ideas: IdeaItem[];
  trashedIdeas: TrashedIdeaItem[];
  memos: MemoItem[];
  memoFolders: MemoFolder[];
  focusLogs: FocusLog[];
  infoBoards?: InfoBoard[];
  infoWidgets?: InfoWidget[];
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
