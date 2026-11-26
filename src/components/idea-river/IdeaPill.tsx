import React from "react";
import { IdeaItem, IdeaWeather, ThemeMode } from "../../types";
import { getHourAtmosphere, getWeatherClassName } from "../../lib/atmosphere";
import { computeCardWidth, renderWeatherIcon } from "./constants";

export interface IdeaCardHandlers {
  onDragStart: (e: React.DragEvent, idea: IdeaItem) => void;
  onEnter: (idea: IdeaItem, e: React.MouseEvent<HTMLDivElement>) => void;
  onLeave: () => void;
  onSelect: (ideaId: string) => void;
  onContextMenu: (e: React.MouseEvent, ideaId: string) => void;
}

export interface IdeaPillProps extends IdeaCardHandlers {
  idea: IdeaItem;
  riverAtmosphere: boolean;
  currentTheme: ThemeMode;
  liveWeather: IdeaWeather | null;
}

/** A single flowing speech-bubble card in River view. Memoized: only re-renders when its own idea / atmosphere inputs change. */
export const IdeaPill = React.memo(function IdeaPill({
  idea,
  riverAtmosphere,
  currentTheme,
  liveWeather,
  onDragStart,
  onEnter,
  onLeave,
  onSelect,
  onContextMenu,
}: IdeaPillProps) {
  const width = computeCardWidth(idea) + (riverAtmosphere ? 16 : 0);
  const atmo = riverAtmosphere
    ? getHourAtmosphere(idea.createdAt, currentTheme)
    : null;
  const effectiveWeather = idea.weather ?? (riverAtmosphere ? liveWeather : null);
  const weatherCls =
    riverAtmosphere && atmo
      ? getWeatherClassName(effectiveWeather?.kind, atmo.isNight)
      : "";
  const tailFill = atmo
    ? atmo.background.match(/#[0-9a-fA-F]{6}/)?.[0] ?? "#1a1a1f"
    : currentTheme === "dark"
      ? "#1a1a1f"
      : currentTheme === "paper"
        ? "#faf6ee"
        : "#ffffff";

  return (
    <div
      data-idea-pill="true"
      draggable
      onDragStart={(e) => onDragStart(e, idea)}
      style={{
        width,
        ...(atmo
          ? { background: atmo.background, color: atmo.textColor }
          : {}),
      }}
      onMouseEnter={(e) => onEnter(idea, e)}
      onMouseLeave={onLeave}
      onClick={() => onSelect(idea.id)}
      onContextMenu={(e) => onContextMenu(e, idea.id)}
      className={`idea-speech-bubble group relative flex h-11 shrink-0 cursor-grab active:cursor-grabbing items-center gap-2.5 px-3.5 shadow-[0_2px_10px_rgba(0,0,0,0.24)] transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_6px_18px_rgba(0,0,0,0.38)] ${
        atmo ? "" : "bg-[#1a1a1f] hover:bg-[#24242c]"
      }`}
    >
      {/* Speech-bubble curved corner tail */}
      <svg
        viewBox="0 0 12 12"
        className="pointer-events-none absolute -left-[6px] bottom-0 h-3 w-3"
        aria-hidden="true"
      >
        <path d="M12 0 V12 H0 C5 12 9 8 12 0 Z" fill={tailFill} />
      </svg>

      {/* Animated Weather Overlay Layer (clipped to bubble interior) */}
      {weatherCls && (
        <div
          className={`pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] ${weatherCls}`}
        />
      )}

      {idea.imagePreview && (
        <img
          src={idea.imagePreview}
          alt="thumbnail"
          className="relative z-10 h-8 w-8 shrink-0 rounded-lg object-cover ring-1 ring-white/[0.12]"
        />
      )}

      <div className="relative z-10 min-w-0 flex-1">
        <p
          style={atmo ? { color: atmo.textColor } : undefined}
          className={`truncate text-[13px] ${atmo ? "" : "text-zinc-200"}`}
        >
          {idea.content}
        </p>
      </div>

      {riverAtmosphere && atmo && (
        <span
          style={{ color: atmo.mutedColor }}
          title={`${atmo.periodLabel}${
            effectiveWeather?.label ? ` · ${effectiveWeather.label}` : ""
          }${
            typeof effectiveWeather?.tempC === "number"
              ? ` ${effectiveWeather.tempC}°C`
              : ""
          }`}
          className="relative z-10 flex shrink-0 items-center"
        >
          {renderWeatherIcon(effectiveWeather?.kind, atmo.isNight, "h-3.5 w-3.5")}
        </span>
      )}

      <span
        style={
          atmo
            ? { backgroundColor: atmo.badgeBg, color: atmo.mutedColor }
            : undefined
        }
        className={`relative z-10 shrink-0 rounded-md px-1.5 py-0.5 text-xs ${
          atmo ? "" : "bg-white/[0.05] text-zinc-400"
        }`}
      >
        {idea.tag || "灵感"}
      </span>
    </div>
  );
});
