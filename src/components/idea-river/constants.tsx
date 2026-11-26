import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  Moon,
  Sun,
} from "lucide-react";
import { IdeaItem, WeatherKind } from "../../types";

export type RiverSpeed = "slow" | "normal" | "fast";
export type IdeaViewMode = "river" | "list";

export const SPEED_PX_PER_SEC: Record<RiverSpeed, number> = {
  slow: 22,
  normal: 42,
  fast: 76,
};

export const SPEED_LABEL: Record<RiverSpeed, string> = {
  slow: "慢速",
  normal: "中速",
  fast: "快速",
};

export const LANE_SPEED_FACTORS = [1.0, 0.78, 1.18, 0.88, 1.08, 0.82];

export function computeCardWidth(idea: IdeaItem): number {
  let hash = 0;
  for (let i = 0; i < idea.id.length; i++) {
    hash = (hash * 31 + idea.id.charCodeAt(i)) | 0;
  }
  const jitter = (Math.abs(hash) % 72) - 24;
  const charCount = idea.content.length;
  const base =
    170 + Math.min(charCount, 48) * 3.6 + (idea.imagePreview ? 44 : 0);
  return Math.round(Math.max(176, Math.min(390, base + jitter)));
}

export const formatShortDateTime = (iso: string) =>
  new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export const renderWeatherIcon = (
  kind?: WeatherKind,
  isNight?: boolean,
  className = "h-3.5 w-3.5 shrink-0"
) => {
  switch (kind) {
    case "rain":
      return <CloudRain className={className} />;
    case "storm":
      return <CloudLightning className={className} />;
    case "snow":
      return <CloudSnow className={className} />;
    case "fog":
      return <CloudFog className={className} />;
    case "cloudy":
      return <Cloud className={className} />;
    case "clear":
      return isNight ? (
        <Moon className={className} />
      ) : (
        <Sun className={className} />
      );
    default:
      return isNight ? (
        <Moon className={className} />
      ) : (
        <Sun className={className} />
      );
  }
};
