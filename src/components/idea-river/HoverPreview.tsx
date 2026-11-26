import React from "react";
import { Sparkles } from "lucide-react";
import { IdeaItem } from "../../types";
import { formatShortDateTime } from "./constants";

export interface HoverPreviewProps {
  idea: IdeaItem;
  x: number;
  y: number;
}

/** Hover full-content preview popover. */
export const HoverPreview: React.FC<HoverPreviewProps> = ({ idea, x, y }) => (
  <div
    style={{
      left: x,
      top: y,
      transform: "translateY(-100%)",
    }}
    className="pointer-events-none fixed z-40 w-[320px] rounded-2xl bg-[#1c1c21]/95 p-3.5 ring-1 ring-white/[0.12] shadow-2xl backdrop-blur-md"
  >
    {idea.imagePreview && (
      <img
        src={idea.imagePreview}
        alt="full preview"
        className="mb-2.5 max-h-36 w-full rounded-xl object-cover ring-1 ring-white/[0.08]"
      />
    )}
    <p className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-100">
      {idea.content}
    </p>
    <div className="mt-2.5 flex items-center justify-between border-t border-white/[0.06] pt-2 text-xs text-zinc-500">
      <span>
        {idea.tag || "灵感"} · {formatShortDateTime(idea.createdAt)}
      </span>
      <span className="flex items-center gap-1 text-shiba-400">
        <Sparkles className="h-2.5 w-2.5" />
        拖入看板或点击查看
      </span>
    </div>
  </div>
);
