import React from "react";
import {
  Bell,
  Cpu,
  Database,
  FolderOpen,
  Globe,
  Heart,
  Moon,
  Play,
  Power,
  RefreshCw,
  Rocket,
  Shield,
  Sun,
  Terminal,
  Wifi,
  Zap,
} from "lucide-react";

export interface ControlIconOption {
  id: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}

export const CONTROL_ICON_OPTIONS: ControlIconOption[] = [
  { id: "power", label: "电源", Icon: Power },
  { id: "zap", label: "闪电", Icon: Zap },
  { id: "play", label: "运行", Icon: Play },
  { id: "terminal", label: "终端", Icon: Terminal },
  { id: "rocket", label: "启动", Icon: Rocket },
  { id: "refresh", label: "刷新", Icon: RefreshCw },
  { id: "bell", label: "提醒", Icon: Bell },
  { id: "wifi", label: "网络", Icon: Wifi },
  { id: "shield", label: "防护", Icon: Shield },
  { id: "globe", label: "网页", Icon: Globe },
  { id: "folder", label: "目录", Icon: FolderOpen },
  { id: "sun", label: "浅色", Icon: Sun },
  { id: "moon", label: "夜间", Icon: Moon },
  { id: "cpu", label: "系统", Icon: Cpu },
  { id: "database", label: "数据", Icon: Database },
  { id: "heart", label: "健康", Icon: Heart },
];

export function renderControlIcon(
  name?: string,
  className = "h-5 w-5"
): React.ReactNode {
  const found =
    CONTROL_ICON_OPTIONS.find((item) => item.id === name) ??
    CONTROL_ICON_OPTIONS[0];
  const IconComp = found.Icon;
  return <IconComp className={className} />;
}
