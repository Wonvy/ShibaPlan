import { InfoLayoutMode, InfoWidget, InfoWidgetLayout } from "../types";

export const DEFAULT_GRID_COLS = 12;
export const DEFAULT_ROW_HEIGHT = 52;
export const GRID_GAP = 12;

export const MIN_WIDGET_PX_W = 220;
export const MIN_WIDGET_PX_H = 120;
export const SNAP_THRESHOLD = 8;
export const SNAP_GAP = 16;
export const DOT_GRID_STEP = 16;

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SnapGuide {
  orientation: "v" | "h";
  pos: number;
  start: number;
  end: number;
  label?: string;
}

// ============================================================================
// Grid Coordinate Helpers (Used in "grid" / "compact" mode & mode conversion)
// ============================================================================

export function clampRect(
  rect: InfoWidgetLayout,
  cols = DEFAULT_GRID_COLS
): InfoWidgetLayout {
  const minW = Math.max(1, Math.min(cols, rect.minW ?? 2));
  const minH = Math.max(1, rect.minH ?? 2);
  const w = Math.max(minW, Math.min(cols, Math.round(rect.w)));
  const h = Math.max(minH, Math.min(24, Math.round(rect.h)));
  const x = Math.max(0, Math.min(cols - w, Math.round(rect.x)));
  const y = Math.max(0, Math.round(rect.y));
  return { ...rect, x, y, w, h, minW, minH };
}

export function rectsOverlap(a: InfoWidgetLayout, b: InfoWidgetLayout): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

export function findNearestFreeSlot(
  widgets: InfoWidget[],
  w: number,
  h: number,
  cols = DEFAULT_GRID_COLS,
  preferredX = 0,
  preferredY = 0
): { x: number; y: number } {
  const clampedW = Math.max(1, Math.min(cols, w));
  const clampedH = Math.max(1, h);
  const startX = Math.max(0, Math.min(cols - clampedW, Math.round(preferredX)));
  const startY = Math.max(0, Math.round(preferredY));

  const tryPos = (tx: number, ty: number) => {
    const candidate: InfoWidgetLayout = { x: tx, y: ty, w: clampedW, h: clampedH };
    return !widgets.some((item) => rectsOverlap(candidate, item.layout));
  };

  if (tryPos(startX, startY)) {
    return { x: startX, y: startY };
  }

  const maxY = widgets.reduce((m, item) => Math.max(m, item.layout.y + item.layout.h), 0);
  for (let y = 0; y <= maxY + 12; y++) {
    for (let x = 0; x <= cols - clampedW; x++) {
      if (tryPos(x, y)) {
        return { x, y };
      }
    }
  }
  return { x: 0, y: maxY };
}

function compactUpward(
  widgets: InfoWidget[],
  cols: number,
  pinnedId?: string
): InfoWidget[] {
  const sorted = [...widgets].sort((a, b) =>
    a.layout.y !== b.layout.y
      ? a.layout.y - b.layout.y
      : a.layout.x - b.layout.x
  );
  const placed: InfoWidget[] = [];

  for (const w of sorted) {
    const cur = clampRect(w.layout, cols);
    if (w.id === pinnedId) {
      placed.push({ ...w, layout: cur });
      continue;
    }
    let bestY = cur.y;
    for (let tryY = 0; tryY < cur.y; tryY++) {
      const candidate = { ...cur, y: tryY };
      if (!placed.some((p) => rectsOverlap(candidate, p.layout))) {
        bestY = tryY;
        break;
      }
    }
    placed.push({ ...w, layout: { ...cur, y: bestY } });
  }

  const map = new Map(placed.map((p) => [p.id, p]));
  return widgets.map((w) => map.get(w.id) ?? w);
}

/**
 * Resolves grid collisions after moving or resizing `activeId` to `targetRect`.
 */
export function resolveGridCollision(
  widgets: InfoWidget[],
  activeId: string,
  targetRect: InfoWidgetLayout,
  cols = DEFAULT_GRID_COLS,
  mode: InfoLayoutMode = "free"
): InfoWidget[] {
  const clampedTarget = clampRect(targetRect, cols);
  const activeWidget = widgets.find((w) => w.id === activeId);
  if (!activeWidget) return widgets;

  const placed: InfoWidget[] = [{ ...activeWidget, layout: clampedTarget }];
  const others = widgets
    .filter((w) => w.id !== activeId)
    .sort((a, b) =>
      a.layout.y !== b.layout.y
        ? a.layout.y - b.layout.y
        : a.layout.x - b.layout.x
    );

  for (const other of others) {
    let cur = clampRect(other.layout, cols);
    let guard = 0;
    while (guard < 200) {
      const blocker = placed.find((p) => rectsOverlap(cur, p.layout));
      if (!blocker) break;
      cur = { ...cur, y: blocker.layout.y + blocker.layout.h };
      guard++;
    }
    placed.push({ ...other, layout: cur });
  }

  const resolvedMap = new Map(placed.map((p) => [p.id, p]));
  const result = widgets.map((w) => resolvedMap.get(w.id) ?? w);

  return mode === "compact" ? compactUpward(result, cols) : result;
}

export function autoArrangeWidgets(
  widgets: InfoWidget[],
  cols = DEFAULT_GRID_COLS,
  colWidth?: number,
  rowHeight = DEFAULT_ROW_HEIGHT,
  gap = GRID_GAP
): InfoWidget[] {
  const sorted = [...widgets].sort((a, b) => {
    const ay = a.layout.py ?? a.layout.y * (rowHeight + gap);
    const by = b.layout.py ?? b.layout.y * (rowHeight + gap);
    if (Math.abs(ay - by) > 12) return ay - by;
    const ax = a.layout.px ?? a.layout.x;
    const bx = b.layout.px ?? b.layout.x;
    return ax - bx;
  });
  const placed: InfoWidget[] = [];
  for (const w of sorted) {
    const clamped = clampRect(w.layout, cols);
    const slot = findNearestFreeSlot(placed, clamped.w, clamped.h, cols, 0, 0);
    const nextLayout: InfoWidgetLayout = {
      ...clamped,
      x: slot.x,
      y: slot.y,
    };
    if (colWidth && colWidth > 0) {
      const pxRect = gridLayoutToPixelRect(nextLayout, colWidth, rowHeight, gap);
      nextLayout.px = Math.round(pxRect.x);
      nextLayout.py = Math.round(pxRect.y);
      nextLayout.pw = Math.round(pxRect.w);
      nextLayout.ph = Math.round(pxRect.h);
    } else {
      delete nextLayout.px;
      delete nextLayout.py;
      delete nextLayout.pw;
      delete nextLayout.ph;
    }
    placed.push({ ...w, layout: nextLayout });
  }
  const map = new Map(placed.map((p) => [p.id, p]));
  return widgets.map((w) => map.get(w.id) ?? w);
}

// ============================================================================
// Pixel Geometry, Magnetic Snapping & Guide Lines (Free Placement Engine)
// ============================================================================

export function gridLayoutToPixelRect(
  layout: InfoWidgetLayout,
  colWidth: number,
  rowHeight: number,
  gap = GRID_GAP
): PixelRect {
  return {
    x: Math.round(layout.x * (colWidth + gap)),
    y: Math.round(layout.y * (rowHeight + gap)),
    w: Math.max(
      MIN_WIDGET_PX_W,
      Math.round(layout.w * colWidth + Math.max(0, layout.w - 1) * gap)
    ),
    h: Math.max(
      MIN_WIDGET_PX_H,
      Math.round(layout.h * rowHeight + Math.max(0, layout.h - 1) * gap)
    ),
  };
}

export function getWidgetPixelRect(
  widget: InfoWidget,
  colWidth: number,
  rowHeight: number,
  gap = GRID_GAP,
  forceGrid = false
): PixelRect {
  const l = widget.layout;
  if (
    !forceGrid &&
    typeof l.px === "number" &&
    typeof l.py === "number" &&
    typeof l.pw === "number" &&
    typeof l.ph === "number"
  ) {
    return {
      x: Math.max(0, l.px),
      y: Math.max(0, l.py),
      w: Math.max(MIN_WIDGET_PX_W, l.pw),
      h: Math.max(MIN_WIDGET_PX_H, l.ph),
    };
  }
  return gridLayoutToPixelRect(l, colWidth, rowHeight, gap);
}

export function syncLayoutFromPixelRect(
  prev: InfoWidgetLayout,
  rect: PixelRect,
  colWidth: number,
  rowHeight: number,
  gap = GRID_GAP,
  cols = DEFAULT_GRID_COLS
): InfoWidgetLayout {
  const stepX = Math.max(1, colWidth + gap);
  const stepY = Math.max(1, rowHeight + gap);
  const approxW = Math.max(1, Math.min(cols, Math.round((rect.w + gap) / stepX)));
  const approxH = Math.max(1, Math.round((rect.h + gap) / stepY));
  const approxX = Math.max(0, Math.min(cols - approxW, Math.round(rect.x / stepX)));
  const approxY = Math.max(0, Math.round(rect.y / stepY));

  return {
    ...prev,
    x: approxX,
    y: approxY,
    w: approxW,
    h: approxH,
    px: Math.max(0, Math.round(rect.x)),
    py: Math.max(0, Math.round(rect.y)),
    pw: Math.max(MIN_WIDGET_PX_W, Math.round(rect.w)),
    ph: Math.max(MIN_WIDGET_PX_H, Math.round(rect.h)),
  };
}

export function pixelRectsOverlap(a: PixelRect, b: PixelRect, pad = 0): boolean {
  return (
    a.x < b.x + b.w + pad &&
    a.x + a.w + pad > b.x &&
    a.y < b.y + b.h + pad &&
    a.y + a.h + pad > b.y
  );
}

export function resolvePixelOverlap(
  rects: Map<string, PixelRect>,
  activeId: string,
  gap = SNAP_GAP
): Map<string, PixelRect> {
  const active = rects.get(activeId);
  if (!active) return rects;

  const placed: { id: string; rect: PixelRect }[] = [
    { id: activeId, rect: active },
  ];
  const others = Array.from(rects.entries())
    .filter(([id]) => id !== activeId)
    .map(([id, rect]) => ({ id, rect }))
    .sort((a, b) =>
      a.rect.y !== b.rect.y ? a.rect.y - b.rect.y : a.rect.x - b.rect.x
    );

  for (const item of others) {
    let cur = { ...item.rect };
    let guard = 0;
    while (guard < 200) {
      const blocker = placed.find((p) => pixelRectsOverlap(cur, p.rect, 2));
      if (!blocker) break;
      cur = { ...cur, y: Math.round(blocker.rect.y + blocker.rect.h + gap) };
      guard++;
    }
    placed.push({ id: item.id, rect: cur });
  }

  const out = new Map<string, PixelRect>();
  for (const p of placed) out.set(p.id, p.rect);
  return out;
}

export function findFreePixelSlot(
  existingRects: PixelRect[],
  w: number,
  h: number,
  containerWidth: number,
  preferredX = 0,
  preferredY = 0,
  gap = SNAP_GAP
): { x: number; y: number } {
  const maxW = Math.max(w, containerWidth);
  const startX = Math.max(0, Math.min(maxW - w, Math.round(preferredX)));
  const startY = Math.max(0, Math.round(preferredY));

  const isFree = (cx: number, cy: number) =>
    !existingRects.some((r) => pixelRectsOverlap({ x: cx, y: cy, w, h }, r, 4));

  if (isFree(startX, startY)) {
    return { x: startX, y: startY };
  }

  const maxY = existingRects.reduce((m, r) => Math.max(m, r.y + r.h), 0);
  const step = 24;
  for (let y = 0; y <= maxY + h + gap * 4; y += step) {
    for (let x = 0; x <= Math.max(0, containerWidth - w); x += step) {
      if (isFree(x, y)) return { x, y };
    }
  }
  return { x: 0, y: maxY + gap };
}

export function snapMovePixelRect(
  raw: PixelRect,
  others: PixelRect[],
  opts: { snapEnabled: boolean; bypassSnap: boolean; gridStep?: number }
): { rect: PixelRect; guides: SnapGuide[] } {
  const clamped: PixelRect = {
    x: Math.max(0, raw.x),
    y: Math.max(0, raw.y),
    w: raw.w,
    h: raw.h,
  };

  if (!opts.snapEnabled || opts.bypassSnap) {
    return { rect: clamped, guides: [] };
  }

  const guides: SnapGuide[] = [];
  let snappedX = clamped.x;
  let snappedY = clamped.y;

  // --- X Axis Candidates ---
  let bestDx = SNAP_THRESHOLD + 1;
  let bestXGuide: SnapGuide | null = null;

  // Origin x = 0
  if (Math.abs(clamped.x) <= SNAP_THRESHOLD) {
    bestDx = Math.abs(clamped.x);
    snappedX = 0;
    bestXGuide = {
      orientation: "v",
      pos: 0,
      start: clamped.y,
      end: clamped.y + clamped.h,
    };
  }

  for (const o of others) {
    const oRight = o.x + o.w;
    const oCenter = o.x + o.w / 2;
    const checks: { cx: number; guidePos: number; label?: string }[] = [
      { cx: o.x, guidePos: o.x },
      { cx: oRight - clamped.w, guidePos: oRight },
      { cx: oCenter - clamped.w / 2, guidePos: oCenter },
      { cx: oRight + SNAP_GAP, guidePos: oRight + SNAP_GAP, label: `${SNAP_GAP}px` },
      { cx: o.x - SNAP_GAP - clamped.w, guidePos: o.x - SNAP_GAP, label: `${SNAP_GAP}px` },
      { cx: oRight, guidePos: oRight },
      { cx: o.x - clamped.w, guidePos: o.x },
    ];
    for (const chk of checks) {
      if (chk.cx < 0) continue;
      const diff = Math.abs(clamped.x - chk.cx);
      if (diff < bestDx) {
        bestDx = diff;
        snappedX = chk.cx;
        bestXGuide = {
          orientation: "v",
          pos: Math.round(chk.guidePos),
          start: Math.min(clamped.y, o.y) - 8,
          end: Math.max(clamped.y + clamped.h, o.y + o.h) + 8,
          label: chk.label,
        };
      }
    }
  }

  if (bestXGuide) {
    guides.push(bestXGuide);
  } else if (opts.gridStep && opts.gridStep > 0) {
    const nearest = Math.round(clamped.x / opts.gridStep) * opts.gridStep;
    if (Math.abs(clamped.x - nearest) <= 4) snappedX = nearest;
  }

  // --- Y Axis Candidates ---
  let bestDy = SNAP_THRESHOLD + 1;
  let bestYGuide: SnapGuide | null = null;

  // Origin y = 0
  if (Math.abs(clamped.y) <= SNAP_THRESHOLD) {
    bestDy = Math.abs(clamped.y);
    snappedY = 0;
    bestYGuide = {
      orientation: "h",
      pos: 0,
      start: snappedX,
      end: snappedX + clamped.w,
    };
  }

  for (const o of others) {
    const oBottom = o.y + o.h;
    const oCenter = o.y + o.h / 2;
    const checks: { cy: number; guidePos: number; label?: string }[] = [
      { cy: o.y, guidePos: o.y },
      { cy: oBottom - clamped.h, guidePos: oBottom },
      { cy: oCenter - clamped.h / 2, guidePos: oCenter },
      { cy: oBottom + SNAP_GAP, guidePos: oBottom + SNAP_GAP, label: `${SNAP_GAP}px` },
      { cy: o.y - SNAP_GAP - clamped.h, guidePos: o.y - SNAP_GAP, label: `${SNAP_GAP}px` },
      { cy: oBottom, guidePos: oBottom },
      { cy: o.y - clamped.h, guidePos: o.y },
    ];
    for (const chk of checks) {
      if (chk.cy < 0) continue;
      const diff = Math.abs(clamped.y - chk.cy);
      if (diff < bestDy) {
        bestDy = diff;
        snappedY = chk.cy;
        bestYGuide = {
          orientation: "h",
          pos: Math.round(chk.guidePos),
          start: Math.min(snappedX, o.x) - 8,
          end: Math.max(snappedX + clamped.w, o.x + o.w) + 8,
          label: chk.label,
        };
      }
    }
  }

  if (bestYGuide) {
    guides.push(bestYGuide);
  } else if (opts.gridStep && opts.gridStep > 0) {
    const nearest = Math.round(clamped.y / opts.gridStep) * opts.gridStep;
    if (Math.abs(clamped.y - nearest) <= 4) snappedY = nearest;
  }

  return {
    rect: {
      x: Math.round(snappedX),
      y: Math.round(snappedY),
      w: Math.round(clamped.w),
      h: Math.round(clamped.h),
    },
    guides,
  };
}

export function snapResizePixelRect(
  raw: PixelRect,
  edge: "e" | "s" | "se" | "w" | "n",
  others: PixelRect[],
  opts: { snapEnabled: boolean; bypassSnap: boolean }
): { rect: PixelRect; guides: SnapGuide[] } {
  let x = Math.max(0, raw.x);
  let y = Math.max(0, raw.y);
  let w = Math.max(MIN_WIDGET_PX_W, raw.w);
  let h = Math.max(MIN_WIDGET_PX_H, raw.h);

  const guides: SnapGuide[] = [];
  if (!opts.snapEnabled || opts.bypassSnap) {
    return {
      rect: {
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(w),
        h: Math.round(h),
      },
      guides,
    };
  }

  const hasE = edge === "e" || edge === "se";
  const hasW = edge === "w";
  const hasS = edge === "s" || edge === "se";
  const hasN = edge === "n";

  if (hasE) {
    const rawRight = x + w;
    let bestDiff = SNAP_THRESHOLD + 1;
    let bestRight = rawRight;
    let guide: SnapGuide | null = null;
    for (const o of others) {
      const oRight = o.x + o.w;
      const targets = [
        { pos: oRight, label: undefined },
        { pos: o.x - SNAP_GAP, label: `${SNAP_GAP}px` },
        { pos: o.x, label: undefined },
      ];
      for (const t of targets) {
        if (t.pos - x < MIN_WIDGET_PX_W) continue;
        const diff = Math.abs(rawRight - t.pos);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestRight = t.pos;
          guide = {
            orientation: "v",
            pos: Math.round(t.pos),
            start: Math.min(y, o.y) - 8,
            end: Math.max(y + h, o.y + o.h) + 8,
            label: t.label,
          };
        }
      }
    }
    w = Math.max(MIN_WIDGET_PX_W, bestRight - x);
    if (guide) guides.push(guide);
  }

  if (hasW) {
    const fixedRight = x + w;
    let bestDiff = SNAP_THRESHOLD + 1;
    let bestX = x;
    let guide: SnapGuide | null = null;

    if (Math.abs(x) <= SNAP_THRESHOLD && fixedRight >= MIN_WIDGET_PX_W) {
      bestDiff = Math.abs(x);
      bestX = 0;
      guide = { orientation: "v", pos: 0, start: y, end: y + h };
    }
    for (const o of others) {
      const oRight = o.x + o.w;
      const targets = [
        { pos: o.x, label: undefined },
        { pos: oRight + SNAP_GAP, label: `${SNAP_GAP}px` },
        { pos: oRight, label: undefined },
      ];
      for (const t of targets) {
        if (t.pos < 0 || fixedRight - t.pos < MIN_WIDGET_PX_W) continue;
        const diff = Math.abs(x - t.pos);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestX = t.pos;
          guide = {
            orientation: "v",
            pos: Math.round(t.pos),
            start: Math.min(y, o.y) - 8,
            end: Math.max(y + h, o.y + o.h) + 8,
            label: t.label,
          };
        }
      }
    }
    x = bestX;
    w = Math.max(MIN_WIDGET_PX_W, fixedRight - x);
    if (guide) guides.push(guide);
  }

  if (hasS) {
    const rawBottom = y + h;
    let bestDiff = SNAP_THRESHOLD + 1;
    let bestBottom = rawBottom;
    let guide: SnapGuide | null = null;
    for (const o of others) {
      const oBottom = o.y + o.h;
      const targets = [
        { pos: oBottom, label: undefined },
        { pos: o.y - SNAP_GAP, label: `${SNAP_GAP}px` },
        { pos: o.y, label: undefined },
      ];
      for (const t of targets) {
        if (t.pos - y < MIN_WIDGET_PX_H) continue;
        const diff = Math.abs(rawBottom - t.pos);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestBottom = t.pos;
          guide = {
            orientation: "h",
            pos: Math.round(t.pos),
            start: Math.min(x, o.x) - 8,
            end: Math.max(x + w, o.x + o.w) + 8,
            label: t.label,
          };
        }
      }
    }
    h = Math.max(MIN_WIDGET_PX_H, bestBottom - y);
    if (guide) guides.push(guide);
  }

  if (hasN) {
    const fixedBottom = y + h;
    let bestDiff = SNAP_THRESHOLD + 1;
    let bestY = y;
    let guide: SnapGuide | null = null;

    if (Math.abs(y) <= SNAP_THRESHOLD && fixedBottom >= MIN_WIDGET_PX_H) {
      bestDiff = Math.abs(y);
      bestY = 0;
      guide = { orientation: "h", pos: 0, start: x, end: x + w };
    }
    for (const o of others) {
      const oBottom = o.y + o.h;
      const targets = [
        { pos: o.y, label: undefined },
        { pos: oBottom + SNAP_GAP, label: `${SNAP_GAP}px` },
        { pos: oBottom, label: undefined },
      ];
      for (const t of targets) {
        if (t.pos < 0 || fixedBottom - t.pos < MIN_WIDGET_PX_H) continue;
        const diff = Math.abs(y - t.pos);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestY = t.pos;
          guide = {
            orientation: "h",
            pos: Math.round(t.pos),
            start: Math.min(x, o.x) - 8,
            end: Math.max(x + w, o.x + o.w) + 8,
            label: t.label,
          };
        }
      }
    }
    y = bestY;
    h = Math.max(MIN_WIDGET_PX_H, fixedBottom - y);
    if (guide) guides.push(guide);
  }

  return {
    rect: {
      x: Math.round(x),
      y: Math.round(y),
      w: Math.round(w),
      h: Math.round(h),
    },
    guides,
  };
}
