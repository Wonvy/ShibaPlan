import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

export interface CustomSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  description?: string;
}

export interface CustomSelectProps {
  value: string;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  menuClassName?: string;
  ariaLabel?: string;
  title?: string;
}

interface MenuPosition {
  left: number;
  top?: number;
  bottom?: number;
  minWidth: number;
  maxWidth: number;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  value,
  options,
  onChange,
  placeholder,
  disabled = false,
  className,
  menuClassName,
  ariaLabel,
  title,
}) => {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPosition>({
    left: 0,
    top: 0,
    minWidth: 132,
    maxWidth: 320,
  });
  const [highlightIndex, setHighlightIndex] = useState<number>(-1);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const selectedOption = useMemo(
    () => options.find((opt) => opt.value === value),
    [options, value]
  );

  const computePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const minWidth = Math.max(rect.width, 132);
    const maxWidth = Math.min(Math.max(rect.width + 80, 260), window.innerWidth - 16);
    const estH = Math.min(options.length * 32 + 10, 248);
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const left = Math.max(
      8,
      Math.min(rect.left, window.innerWidth - minWidth - 8)
    );

    if (spaceBelow < estH && spaceAbove > spaceBelow) {
      setMenuPos({
        left,
        bottom: window.innerHeight - rect.top + 4,
        minWidth,
        maxWidth,
      });
    } else {
      setMenuPos({
        left,
        top: rect.bottom + 4,
        minWidth,
        maxWidth,
      });
    }
  }, [options.length]);

  const openMenu = useCallback(() => {
    if (disabled || options.length === 0) return;
    computePosition();
    const selectedIdx = options.findIndex((o) => o.value === value && !o.disabled);
    const fallbackIdx = options.findIndex((o) => !o.disabled);
    setHighlightIndex(selectedIdx >= 0 ? selectedIdx : fallbackIdx);
    setOpen(true);
  }, [computePosition, disabled, options, value]);

  const handleToggle = () => {
    if (open) {
      setOpen(false);
    } else {
      openMenu();
    }
  };

  const handleSelect = useCallback(
    (opt: CustomSelectOption) => {
      if (opt.disabled) return;
      onChange(opt.value);
      setOpen(false);
    },
    [onChange]
  );

  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        return;
      }

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        if (options.length === 0) return;
        const step = e.key === "ArrowDown" ? 1 : -1;
        let idx = highlightIndex;
        for (let attempt = 0; attempt < options.length; attempt++) {
          idx = (idx + step + options.length) % options.length;
          if (!options[idx].disabled) {
            setHighlightIndex(idx);
            break;
          }
        }
        return;
      }

      if (e.key === "Enter" && highlightIndex >= 0 && highlightIndex < options.length) {
        const opt = options[highlightIndex];
        if (opt && !opt.disabled) {
          e.preventDefault();
          e.stopPropagation();
          handleSelect(opt);
        }
      }
    };

    const handleScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) {
        return;
      }
      setOpen(false);
    };

    const handleResize = () => setOpen(false);

    document.addEventListener("mousedown", handleMouseDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
    };
  }, [handleSelect, highlightIndex, open, options]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={title ?? selectedOption?.label ?? placeholder}
        onClick={handleToggle}
        className={cn(
          "inline-flex items-center justify-between gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs text-foreground transition-colors hover:border-foreground/25 hover:bg-accent/40 focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
      >
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-left leading-tight",
            !selectedOption && "text-muted-foreground"
          )}
        >
          {selectedOption ? selectedOption.label : placeholder ?? ""}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
            open && "rotate-180 text-foreground"
          )}
        />
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            data-custom-select-menu="true"
            role="listbox"
            style={{
              left: menuPos.left,
              top: menuPos.top,
              bottom: menuPos.bottom,
              minWidth: menuPos.minWidth,
              maxWidth: menuPos.maxWidth,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className={cn(
              "pointer-events-auto fixed z-[100] overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-popover-soft animate-fade-in",
              menuClassName
            )}
          >
            <div
              onWheel={(e) => e.stopPropagation()}
              className="max-h-60 space-y-0.5 overflow-y-auto"
            >
              {options.map((opt, idx) => {
                const active = opt.value === value;
                const highlighted = idx === highlightIndex;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={active}
                    disabled={opt.disabled}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => {
                      if (!opt.disabled) setHighlightIndex(idx);
                    }}
                    onClick={() => handleSelect(opt)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs leading-snug transition-colors",
                      active
                        ? "bg-accent/90 font-medium text-foreground"
                        : highlighted
                          ? "bg-accent/60 text-foreground"
                          : "text-foreground/90 hover:bg-accent/60 hover:text-foreground",
                      opt.disabled && "cursor-not-allowed opacity-45"
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{opt.label}</div>
                      {opt.description && (
                        <div className="truncate text-[10.5px] text-muted-foreground">
                          {opt.description}
                        </div>
                      )}
                    </div>
                    <Check
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 transition-opacity",
                        active ? "text-primary opacity-100" : "opacity-0"
                      )}
                    />
                  </button>
                );
              })}
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
