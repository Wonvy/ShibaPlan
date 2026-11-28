import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  X,
} from "lucide-react";
import { cn } from "../../lib/utils";

interface PopoverPos {
  left: number;
  top?: number;
  bottom?: number;
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function parseDateValue(
  val?: string
): { year: number; month: number; day: number } | null {
  if (!val) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(val.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  return { year, month, day };
}

export function formatDateValue(year: number, month: number, day: number): string {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

export function getOffsetDateStr(offsetDays: number): string {
  const dt = new Date();
  dt.setDate(dt.getDate() + offsetDays);
  return formatDateValue(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

export function getNextMondayDateStr(): string {
  const dt = new Date();
  const day = dt.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  dt.setDate(dt.getDate() + diff);
  return formatDateValue(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

export function parseTimeValue(
  val?: string
): { hour: string; minute: string } | null {
  if (!val) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(val.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { hour: pad2(h), minute: pad2(min) };
}

function useFloatingPopover(
  popoverWidth: number,
  estHeight: number,
  onOpenChange?: (open: boolean) => void
) {
  const [open, setOpenState] = useState(false);
  const [pos, setPos] = useState<PopoverPos>({ left: 8, top: 8 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      onOpenChange?.(next);
    },
    [onOpenChange]
  );

  const computePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const left = Math.max(
      8,
      Math.min(rect.left, window.innerWidth - popoverWidth - 8)
    );
    if (spaceBelow < estHeight && spaceAbove > spaceBelow) {
      setPos({
        left,
        bottom: Math.max(8, window.innerHeight - rect.top + 4),
      });
    } else {
      setPos({
        left,
        top: Math.max(8, rect.bottom + 4),
      });
    }
  }, [estHeight, popoverWidth]);

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
      }
    };

    const handleScrollOrResize = (e: Event) => {
      if (
        e.type === "scroll" &&
        e.target instanceof Node &&
        menuRef.current?.contains(e.target)
      ) {
        return;
      }
      setOpen(false);
    };

    document.addEventListener("mousedown", handleMouseDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("resize", handleScrollOrResize);
    window.addEventListener("scroll", handleScrollOrResize, true);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", handleScrollOrResize);
      window.removeEventListener("scroll", handleScrollOrResize, true);
    };
  }, [open, setOpen]);

  return { open, setOpen, pos, computePosition, triggerRef, menuRef };
}

export interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  clearable?: boolean;
  autoOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"] as const;

export interface InlineCalendarGridProps {
  value: string;
  onSelect: (dateStr: string) => void;
  compact?: boolean;
}

export const InlineCalendarGrid: React.FC<InlineCalendarGridProps> = ({
  value,
  onSelect,
  compact = false,
}) => {
  const parsed = parseDateValue(value);
  const now = new Date();
  const [viewYear, setViewYear] = useState(parsed?.year ?? now.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.month ?? now.getMonth());

  useEffect(() => {
    const p = parseDateValue(value);
    if (p) {
      setViewYear(p.year);
      setViewMonth(p.month);
    }
  }, [value]);

  const todayStr = getOffsetDateStr(0);

  const calendarCells = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    const leadingCount = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const prevMonthLastDay = new Date(viewYear, viewMonth, 0).getDate();

    const cells: Array<{
      dateStr: string;
      day: number;
      inCurrentMonth: boolean;
    }> = [];

    for (let i = leadingCount - 1; i >= 0; i--) {
      const prevYear = viewMonth === 0 ? viewYear - 1 : viewYear;
      const prevMonth = viewMonth === 0 ? 11 : viewMonth - 1;
      const d = prevMonthLastDay - i;
      cells.push({
        dateStr: formatDateValue(prevYear, prevMonth, d),
        day: d,
        inCurrentMonth: false,
      });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({
        dateStr: formatDateValue(viewYear, viewMonth, d),
        day: d,
        inCurrentMonth: true,
      });
    }

    let nextDay = 1;
    while (cells.length < 42) {
      const nextYear = viewMonth === 11 ? viewYear + 1 : viewYear;
      const nextMonth = viewMonth === 11 ? 0 : viewMonth + 1;
      cells.push({
        dateStr: formatDateValue(nextYear, nextMonth, nextDay),
        day: nextDay,
        inCurrentMonth: false,
      });
      nextDay += 1;
    }

    return cells;
  }, [viewYear, viewMonth]);

  const stepMonth = (delta: number) => {
    const dt = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(dt.getFullYear());
    setViewMonth(dt.getMonth());
  };

  return (
    <div>
      {/* Month / Year Navigation */}
      <div
        className={cn(
          "flex items-center justify-between gap-1",
          compact ? "mb-1.5" : "mb-2"
        )}
      >
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setViewYear((y) => y - 1)}
            title="上一年"
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => stepMonth(-1)}
            title="上个月"
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>
        <span className="text-xs font-semibold tabular-nums text-foreground">
          {viewYear}年 {viewMonth + 1}月
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => stepMonth(1)}
            title="下个月"
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setViewYear((y) => y + 1)}
            title="下一年"
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronsRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Weekday Header */}
      <div className="mb-0.5 grid grid-cols-7 text-center text-[10.5px] font-medium text-muted-foreground">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-0.5">
            {w}
          </div>
        ))}
      </div>

      {/* 42-Day Grid */}
      <div className="grid grid-cols-7 gap-0.5">
        {calendarCells.map((cell) => {
          const isSelected = value === cell.dateStr;
          const isToday = todayStr === cell.dateStr;
          return (
            <button
              key={cell.dateStr}
              type="button"
              onClick={() => onSelect(cell.dateStr)}
              className={cn(
                "flex items-center justify-center rounded-md text-xs tabular-nums transition-colors",
                compact ? "h-6 text-[11.5px]" : "h-7",
                isSelected
                  ? "bg-primary font-semibold text-primary-foreground"
                  : isToday
                    ? "ring-1 ring-inset ring-primary/65 font-medium text-primary hover:bg-primary/12"
                    : cell.inCurrentMonth
                      ? "text-foreground hover:bg-accent"
                      : "text-muted-foreground/45 hover:bg-accent/60 hover:text-muted-foreground"
              )}
            >
              {cell.day}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export const DatePicker: React.FC<DatePickerProps> = ({
  value,
  onChange,
  placeholder = "选择日期",
  className,
  ariaLabel,
  clearable = true,
  autoOpen = false,
  onOpenChange,
}) => {
  const { open, setOpen, pos, computePosition, triggerRef, menuRef } =
    useFloatingPopover(264, 304, onOpenChange);

  const openPopover = useCallback(() => {
    computePosition();
    setOpen(true);
  }, [computePosition, setOpen]);

  const didAutoOpenRef = useRef(false);
  useEffect(() => {
    if (autoOpen && !didAutoOpenRef.current) {
      let cancelled = false;
      const raf = window.requestAnimationFrame(() => {
        if (cancelled) return;
        didAutoOpenRef.current = true;
        openPopover();
      });
      return () => {
        cancelled = true;
        window.cancelAnimationFrame(raf);
      };
    }
    if (!autoOpen) {
      didAutoOpenRef.current = false;
    }
  }, [autoOpen, openPopover]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel ?? placeholder}
        aria-expanded={open}
        onClick={() => {
          if (open) setOpen(false);
          else openPopover();
        }}
        className={cn(
          "flex h-8 w-full items-center justify-between gap-1.5 rounded-md border border-border bg-background px-2.5 text-left text-[13px] text-foreground transition-colors hover:border-ring/50 focus-visible:outline-none focus-visible:border-ring/70 focus-visible:ring-1 focus-visible:ring-ring/40",
          open && "border-ring/70 ring-1 ring-ring/40",
          className
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <Calendar className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span
            className={cn(
              "truncate tabular-nums",
              value ? "font-mono text-foreground" : "text-muted-foreground/70"
            )}
          >
            {value || placeholder}
          </span>
        </span>
        {clearable && value && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="清除日期"
            title="清除日期"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
              setOpen(false);
            }}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </span>
        )}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            data-custom-select-menu="true"
            style={{
              left: pos.left,
              top: pos.top,
              bottom: pos.bottom,
              width: 264,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="pointer-events-auto fixed z-[100] rounded-lg border border-border bg-popover p-2.5 text-popover-foreground shadow-popover-soft animate-fade-in select-none"
          >
            <InlineCalendarGrid
              value={value}
              onSelect={(dateStr) => {
                onChange(dateStr);
                setOpen(false);
              }}
            />

            {/* Footer Shortcuts */}
            <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-2">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    onChange(getOffsetDateStr(0));
                    setOpen(false);
                  }}
                  className="rounded px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/12"
                >
                  今天
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onChange(getOffsetDateStr(1));
                    setOpen(false);
                  }}
                  className="rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  明天
                </button>
              </div>
              {value && (
                <button
                  type="button"
                  onClick={() => {
                    onChange("");
                    setOpen(false);
                  }}
                  className="rounded px-2 py-0.5 text-[11px] text-destructive hover:bg-destructive/12"
                >
                  清除
                </button>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

export interface TimePickerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  clearable?: boolean;
}

const HOURS = Array.from({ length: 24 }, (_, i) => pad2(i));
const MINUTES = Array.from({ length: 12 }, (_, i) => pad2(i * 5));
const TIME_PRESETS = ["09:00", "14:00", "18:00", "20:00"] as const;

export const TimePicker: React.FC<TimePickerProps> = ({
  value,
  onChange,
  placeholder = "选择时间",
  className,
  ariaLabel,
  clearable = true,
}) => {
  const { open, setOpen, pos, computePosition, triggerRef, menuRef } =
    useFloatingPopover(236, 268);

  const parsed = parseTimeValue(value);
  const selectedHour = parsed?.hour ?? "";
  const selectedMinute = parsed?.minute ?? "";
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (open) {
      setDraft(value);
    }
  }, [open, value]);

  const applyManualDraft = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      onChange("");
      setOpen(false);
      return;
    }
    const p = parseTimeValue(trimmed);
    if (p) {
      onChange(`${p.hour}:${p.minute}`);
      setOpen(false);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel ?? placeholder}
        aria-expanded={open}
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            computePosition();
            setOpen(true);
          }
        }}
        className={cn(
          "flex h-8 w-full items-center justify-between gap-1.5 rounded-md border border-border bg-background px-2.5 text-left text-[13px] text-foreground transition-colors hover:border-ring/50 focus-visible:outline-none focus-visible:border-ring/70 focus-visible:ring-1 focus-visible:ring-ring/40",
          open && "border-ring/70 ring-1 ring-ring/40",
          className
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span
            className={cn(
              "truncate tabular-nums",
              value ? "font-mono text-foreground" : "text-muted-foreground/70"
            )}
          >
            {value || placeholder}
          </span>
        </span>
        {clearable && value && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="清除时间"
            title="清除时间"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
              setOpen(false);
            }}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </span>
        )}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            data-custom-select-menu="true"
            style={{
              left: pos.left,
              top: pos.top,
              bottom: pos.bottom,
              width: 236,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="pointer-events-auto fixed z-[100] rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-popover-soft animate-fade-in select-none"
          >
            {/* Quick Presets */}
            <div className="mb-2 grid grid-cols-4 gap-1">
              {TIME_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    onChange(preset);
                    setOpen(false);
                  }}
                  className={cn(
                    "rounded py-1 font-mono text-[11px] transition-colors",
                    value === preset
                      ? "bg-primary font-medium text-primary-foreground"
                      : "bg-muted/60 text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  {preset}
                </button>
              ))}
            </div>

            {/* Hour & Minute Columns */}
            <div className="grid grid-cols-2 gap-1.5 border-y border-border/60 py-1.5">
              <div>
                <div className="mb-1 text-center text-[10px] font-medium text-muted-foreground">
                  小时
                </div>
                <div
                  onWheel={(e) => e.stopPropagation()}
                  className="h-40 space-y-0.5 overflow-y-auto pr-0.5"
                >
                  {HOURS.map((h) => {
                    const active = selectedHour === h;
                    return (
                      <button
                        key={h}
                        type="button"
                        onClick={() => {
                          const next = `${h}:${selectedMinute || "00"}`;
                          onChange(next);
                          setDraft(next);
                        }}
                        className={cn(
                          "flex h-6 w-full items-center justify-center rounded font-mono text-xs transition-colors",
                          active
                            ? "bg-primary font-semibold text-primary-foreground"
                            : "text-foreground/90 hover:bg-accent"
                        )}
                      >
                        {h}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="mb-1 text-center text-[10px] font-medium text-muted-foreground">
                  分钟
                </div>
                <div
                  onWheel={(e) => e.stopPropagation()}
                  className="h-40 space-y-0.5 overflow-y-auto pr-0.5"
                >
                  {MINUTES.map((m) => {
                    const active = selectedMinute === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          const next = `${selectedHour || "09"}:${m}`;
                          onChange(next);
                          setOpen(false);
                        }}
                        className={cn(
                          "flex h-6 w-full items-center justify-center rounded font-mono text-xs transition-colors",
                          active
                            ? "bg-primary font-semibold text-primary-foreground"
                            : "text-foreground/90 hover:bg-accent"
                        )}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Manual Input + Now + Clear + Confirm */}
            <div className="mt-2 flex items-center gap-1">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    applyManualDraft();
                  }
                }}
                placeholder="HH:mm"
                aria-label="手动输入时间"
                className="h-6 min-w-0 flex-1 rounded border border-border bg-background px-1.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/50 focus:border-ring/70 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  const dt = new Date();
                  onChange(`${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`);
                  setOpen(false);
                }}
                className="rounded px-1.5 py-1 text-[11px] text-primary hover:bg-primary/12"
              >
                现在
              </button>
              {value && (
                <button
                  type="button"
                  onClick={() => {
                    onChange("");
                    setOpen(false);
                  }}
                  className="rounded px-1.5 py-1 text-[11px] text-destructive hover:bg-destructive/12"
                >
                  清除
                </button>
              )}
              <button
                type="button"
                onClick={applyManualDraft}
                className="rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
              >
                确定
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
