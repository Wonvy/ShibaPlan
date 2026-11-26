import React from "react";
import { GripVertical, Trash2 } from "lucide-react";
import { IdeaItem } from "../../types";
import { IdeaCardHandlers } from "./IdeaPill";
import { formatShortDateTime } from "./constants";

export interface IdeaListRowProps extends IdeaCardHandlers {
  idea: IdeaItem;
  onTrash: (idea: IdeaItem) => void;
}

/** A single row in the paginated List view. Memoized. */
export const IdeaListRow = React.memo(function IdeaListRow({
  idea,
  onDragStart,
  onEnter,
  onLeave,
  onSelect,
  onContextMenu,
  onTrash,
}: IdeaListRowProps) {
  return (
    <div
      data-idea-pill="true"
      draggable
      onDragStart={(e) => onDragStart(e, idea)}
      onMouseEnter={(e) => onEnter(idea, e)}
      onMouseLeave={onLeave}
      onClick={() => onSelect(idea.id)}
      onContextMenu={(e) => onContextMenu(e, idea.id)}
      className="group flex h-9 cursor-grab active:cursor-grabbing items-center justify-between gap-3 rounded-xl bg-[#1a1a1f] px-3 shadow-[0_1px_4px_rgba(0,0,0,0.2)] transition-all duration-150 hover:bg-[#24242c] hover:shadow-[0_4px_12px_rgba(0,0,0,0.32)]"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <GripVertical className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
        {idea.imagePreview && (
          <img
            src={idea.imagePreview}
            alt="thumb"
            className="h-6 w-6 shrink-0 rounded object-cover ring-1 ring-white/[0.1]"
          />
        )}
        <span className="truncate text-xs text-zinc-200">{idea.content}</span>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <span className="rounded bg-white/[0.05] px-1.5 py-0.5 text-xs text-zinc-400">
          {idea.tag || "灵感"}
        </span>
        <span className="text-xs text-zinc-500">
          {formatShortDateTime(idea.createdAt)}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTrash(idea);
          }}
          className="rounded p-1 text-zinc-500 opacity-0 transition group-hover:opacity-100 hover:bg-white/[0.08] hover:text-rose-400"
          title="移入回收站"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
});
