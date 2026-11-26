import React, { useCallback } from "react";
import { IdeaItem, IdeaWeather, ThemeMode } from "../../types";
import { IdeaCardHandlers, IdeaPill } from "./IdeaPill";

export interface IdeaLaneProps extends IdeaCardHandlers {
  rowIdx: number;
  items: { idea: IdeaItem; key: string }[];
  riverAtmosphere: boolean;
  currentTheme: ThemeMode;
  liveWeather: IdeaWeather | null;
  /** Stable registrars so the parent's rAF loop can drive transforms directly on the DOM. */
  registerTrack: (rowIdx: number, el: HTMLDivElement | null) => void;
  registerGroup: (rowIdx: number, el: HTMLDivElement | null) => void;
}

/**
 * One horizontal lane of the river. The lane's translate3d is mutated imperatively
 * by the parent's requestAnimationFrame loop (never through React state), so this
 * component only re-renders when its items or display inputs change.
 */
export const IdeaLane = React.memo(function IdeaLane({
  rowIdx,
  items,
  riverAtmosphere,
  currentTheme,
  liveWeather,
  registerTrack,
  registerGroup,
  onDragStart,
  onEnter,
  onLeave,
  onSelect,
  onContextMenu,
}: IdeaLaneProps) {
  const trackRef = useCallback(
    (el: HTMLDivElement | null) => registerTrack(rowIdx, el),
    [registerTrack, rowIdx]
  );
  const groupRef = useCallback(
    (el: HTMLDivElement | null) => registerGroup(rowIdx, el),
    [registerGroup, rowIdx]
  );

  return (
    <div className="flex h-14 items-center overflow-hidden py-1">
      <div ref={trackRef} className="flex items-center will-change-transform">
        <div ref={groupRef} className="flex shrink-0 items-center gap-3 pr-3">
          {items.map(({ idea, key }) => (
            <IdeaPill
              key={key}
              idea={idea}
              riverAtmosphere={riverAtmosphere}
              currentTheme={currentTheme}
              liveWeather={liveWeather}
              onDragStart={onDragStart}
              onEnter={onEnter}
              onLeave={onLeave}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      </div>
    </div>
  );
});
