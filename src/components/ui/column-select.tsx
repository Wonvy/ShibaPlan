import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { BoardColumn } from "../../types";

interface ColumnSelectProps {
  columns: BoardColumn[];
  value: string;
  onChange: (colId: string) => void;
  className?: string;
  compact?: boolean;
}

export const ColumnSelect: React.FC<ColumnSelectProps> = ({
  columns,
  value,
  onChange,
  className = "",
  compact = false,
}) => {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    minWidth: number;
  }>({ left: 0, minWidth: 132 });
  const btnRef = useRef<HTMLButtonElement | null>(null);

  const selected = columns.find((c) => c.id === value) ?? columns[0];

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const estMenuH = Math.min(220, columns.length * 32 + 12);
      const minWidth = Math.max(128, rect.width);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - minWidth - 12));
      const spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow < estMenuH + 10 && rect.top > estMenuH + 10) {
        setMenuPos({
          left,
          bottom: window.innerHeight - rect.top + 6,
          minWidth,
        });
      } else {
        setMenuPos({
          left,
          top: rect.bottom + 6,
          minWidth,
        });
      }
    }
    setOpen((v) => !v);
  };

  if (columns.length === 0) return null;

  return (
    <div className="relative inline-flex">
      <button
        ref={btnRef}
        type="button"
        onClick={handleToggle}
        className={`inline-flex items-center justify-between gap-2 rounded-lg border border-border bg-background text-xs font-medium text-foreground transition-colors hover:border-foreground/20 hover:bg-accent/50 focus:outline-none focus:ring-1 focus:ring-primary/40 ${
          compact ? "h-7 min-w-[96px] px-2.5" : "h-8 min-w-[116px] px-2.5"
        } ${className}`}
      >
        <span className="flex min-w-0 flex-1 items-center justify-center gap-1.5 truncate">
          {selected?.color && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: selected.color }}
            />
          )}
          <span className="truncate">{selected?.title ?? ""}</span>
        </span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-150 ${
            open ? "rotate-180 text-foreground" : ""
          }`}
        />
      </button>

      {open && (
        <div
          style={{
            left: menuPos.left,
            top: menuPos.top,
            bottom: menuPos.bottom,
            minWidth: menuPos.minWidth,
          }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 rounded-lg border border-border bg-popover p-1 shadow-popover-soft"
        >
          <div className="max-h-52 space-y-0.5 overflow-y-auto">
            {columns.map((c) => {
              const active = c.id === selected?.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    onChange(c.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${
                    active
                      ? "bg-accent font-medium text-foreground"
                      : "text-popover-foreground hover:bg-accent/70"
                  }`}
                >
                  <span className="flex min-w-0 flex-1 items-center justify-center gap-1.5 truncate">
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: c.color }}
                    />
                    <span className="truncate">{c.title}</span>
                  </span>
                  <Check
                    className={`h-3 w-3 shrink-0 ${
                      active ? "text-primary opacity-100" : "opacity-0"
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
