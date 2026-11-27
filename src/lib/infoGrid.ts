import type { InfoWebDeviceMode, InfoWidget, InfoWidgetLayout } from "../types";

export const DEFAULT_GRID_COLS = 12;
export const DEFAULT_ROW_HEIGHT = 52;
export const GRID_GAP = 12;

// Legacy grid -> pixel fallback conversion constants
export const LEGACY_COL_W = 92;
export const LEGACY_ROW_H = 52;
export const LEGACY_GAP = 12;

export const DEFAULT_WIDGET_PX_W = 380;
export const DEFAULT_WIDGET_PX_H = 260;
export const DEFAULT_CONTAINER_PX_W = 420;
export const DEFAULT_CONTAINER_PX_H = 280;
export const DEFAULT_CONTROL_SWITCH_W = 136;
export const DEFAULT_CONTROL_SWITCH_H = 72;
export const DEFAULT_CONTROL_ICON_W = 76;
export const DEFAULT_CONTROL_ICON_H = 72;
export const DEFAULT_WEB_BOOKMARK_W = 196;
export const DEFAULT_WEB_BOOKMARK_H = 68;
export const DEFAULT_WEB_EMBED_W = 460;
export const DEFAULT_WEB_EMBED_H = 340;

export interface WebDevicePreset {
  id: InfoWebDeviceMode;
  label: string;
  shortLabel: string;
  width: number | null;
  cardWidth: number;
  cardHeight: number;
  desc: string;
}

export const WEB_DEVICE_PRESETS: readonly WebDevicePreset[] = [
  {
    id: "auto",
    label: "自适应",
    shortLabel: "自适应",
    width: null,
    cardWidth: DEFAULT_WEB_EMBED_W,
    cardHeight: DEFAULT_WEB_EMBED_H,
    desc: "跟随卡片尺寸",
  },
  {
    id: "mobile",
    label: "手机",
    shortLabel: "手机",
    width: 390,
    cardWidth: 392,
    cardHeight: 720,
    desc: "390px 手机视口 (392×720)",
  },
  {
    id: "tablet",
    label: "平板 (iPad)",
    shortLabel: "iPad",
    width: 768,
    cardWidth: 580,
    cardHeight: 760,
    desc: "768px 平板视口 (580×760)",
  },
  {
    id: "desktop",
    label: "桌面",
    shortLabel: "桌面",
    width: 1280,
    cardWidth: 680,
    cardHeight: 460,
    desc: "1280px PC 视口缩放 (680×460)",
  },
] as const;

export function getWebDevicePreset(mode?: InfoWebDeviceMode): WebDevicePreset {
  return (
    WEB_DEVICE_PRESETS.find((item) => item.id === mode) ??
    WEB_DEVICE_PRESETS[0]
  );
}
export const MIN_WIDGET_PX_W = 64;
export const MIN_WIDGET_PX_H = 44;
export const COLLAPSED_WIDGET_PX_H = 40;
export const SNAP_THRESHOLD = 8;
export const SNAP_GAP = 16;
export const DOT_GRID_STEP = 20;

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

export type ResizeHandleEdge = "n" | "s" | "e" | "w" | "se";

export function gridLayoutToPixelRect(
  layout: Pick<InfoWidgetLayout, "x" | "y" | "w" | "h" | "minW" | "minH">,
  colW = LEGACY_COL_W,
  rowH = LEGACY_ROW_H,
  gap = LEGACY_GAP
): PixelRect {
  const gx = Number.isFinite(layout.x) ? layout.x : 0;
  const gy = Number.isFinite(layout.y) ? layout.y : 0;
  const gw = Math.max(layout.minW ?? 2, Number.isFinite(layout.w) ? layout.w : 4);
  const gh = Math.max(layout.minH ?? 2, Number.isFinite(layout.h) ? layout.h : 4);

  return {
    x: Math.round(gx * (colW + gap)),
    y: Math.round(gy * (rowH + gap)),
    w: Math.max(MIN_WIDGET_PX_W, Math.round(gw * colW + Math.max(0, gw - 1) * gap)),
    h: Math.max(MIN_WIDGET_PX_H, Math.round(gh * rowH + Math.max(0, gh - 1) * gap)),
  };
}

/**
 * Returns the canvas world-space PixelRect for a widget.
 * Preserves negative infinite-canvas coordinates verbatim once `px`/`py`/`pw`/`ph` exist,
 * and falls back cleanly for legacy grid-based widgets.
 */
export function getWidgetPixelRect(
  widget: Pick<InfoWidget, "layout">,
  colW = LEGACY_COL_W,
  rowH = LEGACY_ROW_H,
  gap = LEGACY_GAP
): PixelRect {
  const { layout } = widget;
  if (
    typeof layout.px === "number" &&
    Number.isFinite(layout.px) &&
    typeof layout.py === "number" &&
    Number.isFinite(layout.py) &&
    typeof layout.pw === "number" &&
    Number.isFinite(layout.pw) &&
    typeof layout.ph === "number" &&
    Number.isFinite(layout.ph)
  ) {
    return {
      x: Math.round(layout.px),
      y: Math.round(layout.py),
      w: Math.max(MIN_WIDGET_PX_W, Math.round(layout.pw)),
      h: Math.max(MIN_WIDGET_PX_H, Math.round(layout.ph)),
    };
  }
  return gridLayoutToPixelRect(layout, colW, rowH, gap);
}

/**
 * Finds the top-most blank container widget whose bounds cover the center point of `cardRect`.
 */
export function findTargetContainerId(
  cardRect: PixelRect,
  containers: Array<{ id: string; rect: PixelRect }>
): string | undefined {
  const cx = cardRect.x + cardRect.w / 2;
  const cy = cardRect.y + cardRect.h / 2;
  for (let i = containers.length - 1; i >= 0; i--) {
    const { id, rect } = containers[i];
    if (
      cx >= rect.x &&
      cx <= rect.x + rect.w &&
      cy >= rect.y &&
      cy <= rect.y + rect.h
    ) {
      return id;
    }
  }
  return undefined;
}

/**
 * Packs child cards row-by-row inside a container's inner bounds.
 */
export function arrangeWidgetsInsideContainer(
  containerRect: PixelRect,
  hasHeader: boolean,
  children: Array<{ id: string; rect: PixelRect }>,
  gap = 10,
  pad = 12
): Map<string, PixelRect> {
  const sorted = [...children].sort(
    (a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x
  );
  const startX = containerRect.x + pad;
  const startY = containerRect.y + (hasHeader ? 36 + pad : pad);
  const maxRight = containerRect.x + containerRect.w - pad;

  const result = new Map<string, PixelRect>();
  let curX = startX;
  let curY = startY;
  let rowMaxH = 0;

  for (const child of sorted) {
    if (curX > startX && curX + child.rect.w > maxRight) {
      curX = startX;
      curY += rowMaxH + gap;
      rowMaxH = 0;
    }
    result.set(child.id, {
      x: Math.round(curX),
      y: Math.round(curY),
      w: child.rect.w,
      h: child.rect.h,
    });
    curX += child.rect.w + gap;
    rowMaxH = Math.max(rowMaxH, child.rect.h);
  }
  return result;
}

export function applyPixelRectToLayout(
  prev: InfoWidgetLayout,
  rect: PixelRect
): InfoWidgetLayout {
  return {
    ...prev,
    px: Math.round(rect.x),
    py: Math.round(rect.y),
    pw: Math.max(MIN_WIDGET_PX_W, Math.round(rect.w)),
    ph: Math.max(MIN_WIDGET_PX_H, Math.round(rect.h)),
  };
}

export const syncLayoutFromPixelRect = applyPixelRectToLayout;

export function pixelRectsOverlap(
  a: PixelRect,
  b: PixelRect,
  gap = 0
): boolean {
  return !(
    a.x + a.w + gap <= b.x ||
    b.x + b.w + gap <= a.x ||
    a.y + a.h + gap <= b.y ||
    b.y + b.h + gap <= a.y
  );
}

/**
 * Pushes overlapping widgets downwards/sideways when overlap prevention is enabled.
 * Infinite canvas: does not clamp coordinates to >= 0 or a container right edge.
 */
export function resolvePixelOverlap(
  movedId: string,
  movedRect: PixelRect,
  allRects: Array<{ id: string; rect: PixelRect }>,
  gap = SNAP_GAP
): Array<{ id: string; rect: PixelRect }> {
  const map = new Map<string, PixelRect>();
  for (const item of allRects) {
    map.set(item.id, { ...item.rect });
  }
  map.set(movedId, { ...movedRect });

  const ids = Array.from(map.keys());
  // Sort deterministically by Y then X so pushes ripple cleanly downwards
  ids.sort((a, b) => {
    if (a === movedId) return -1;
    if (b === movedId) return 1;
    const ra = map.get(a)!;
    const rb = map.get(b)!;
    return ra.y - rb.y || ra.x - rb.x;
  });

  const maxIterations = Math.max(6, ids.length * 3);
  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;
    for (let i = 0; i < ids.length; i++) {
      const idA = ids[i];
      const rectA = map.get(idA)!;
      for (let j = i + 1; j < ids.length; j++) {
        const idB = ids[j];
        if (idB === movedId) continue;
        const rectB = map.get(idB)!;
        if (!pixelRectsOverlap(rectA, rectB, gap)) continue;

        const overlapX = Math.min(
          rectA.x + rectA.w + gap - rectB.x,
          rectB.x + rectB.w + gap - rectA.x
        );
        const overlapY = Math.min(
          rectA.y + rectA.h + gap - rectB.y,
          rectB.y + rectB.h + gap - rectA.y
        );

        if (overlapX > 0 && overlapY > 0) {
          if (overlapY <= overlapX || idA === movedId) {
            rectB.y = Math.round(rectA.y + rectA.h + gap);
          } else {
            const centerA = rectA.x + rectA.w / 2;
            const centerB = rectB.x + rectB.w / 2;
            if (centerB >= centerA) {
              rectB.x = Math.round(rectA.x + rectA.w + gap);
            } else {
              rectB.x = Math.round(rectA.x - rectB.w - gap);
            }
          }
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  return Array.from(map.entries()).map(([id, rect]) => ({ id, rect }));
}

/**
 * Finds the first non-overlapping free position on the infinite canvas around (preferredX, preferredY).
 */
export function findFreePixelSlot(
  existingRects: PixelRect[],
  w = DEFAULT_WIDGET_PX_W,
  h = DEFAULT_WIDGET_PX_H,
  preferredX = 0,
  preferredY = 0,
  gap = SNAP_GAP,
  maxRowWidth = 1200
): { x: number; y: number } {
  const startX = Math.round(preferredX);
  const startY = Math.round(preferredY);

  const tryDirect = { x: startX, y: startY, w, h };
  if (!existingRects.some((r) => pixelRectsOverlap(tryDirect, r, gap))) {
    return { x: startX, y: startY };
  }

  const stepX = Math.max(40, Math.round((w + gap) / 2));
  const stepY = 40;
  const maxXOffset = Math.max(0, maxRowWidth - w);

  for (let dy = 0; dy <= 4000; dy += stepY) {
    for (let dx = 0; dx <= maxXOffset; dx += stepX) {
      const cand: PixelRect = { x: startX + dx, y: startY + dy, w, h };
      if (!existingRects.some((r) => pixelRectsOverlap(cand, r, gap))) {
        return { x: cand.x, y: cand.y };
      }
    }
  }

  let maxBottom = startY;
  for (const r of existingRects) {
    maxBottom = Math.max(maxBottom, r.y + r.h + gap);
  }
  return { x: startX, y: Math.round(maxBottom) };
}

interface AxisSnapCandidate {
  target: number;
  guidePos: number;
  spanStart: number;
  spanEnd: number;
  label?: string;
}

/**
 * Snaps a dragged card to other cards' edges/centers/gaps and the origin axis (0,0),
 * or falls back to dot-grid step snapping. Works across infinite negative/positive space.
 */
export function snapMovePixelRect(
  movingId: string,
  rawRect: PixelRect,
  others: Array<{ id: string; rect: PixelRect }>,
  options?: {
    snapEnabled?: boolean;
    altBypass?: boolean;
    gap?: number;
    threshold?: number;
    gridStep?: number;
  }
): { rect: PixelRect; guides: SnapGuide[] } {
  const w = Math.max(MIN_WIDGET_PX_W, Math.round(rawRect.w));
  const h = Math.max(MIN_WIDGET_PX_H, Math.round(rawRect.h));
  const rawX = Math.round(rawRect.x);
  const rawY = Math.round(rawRect.y);

  const snapEnabled = options?.snapEnabled ?? true;
  const altBypass = options?.altBypass ?? false;
  if (!snapEnabled || altBypass) {
    return { rect: { x: rawX, y: rawY, w, h }, guides: [] };
  }

  const gap = options?.gap ?? SNAP_GAP;
  const threshold = options?.threshold ?? SNAP_THRESHOLD;
  const gridStep = options?.gridStep ?? DOT_GRID_STEP;

  const filtered = others.filter((o) => o.id !== movingId);

  const xCandidates: AxisSnapCandidate[] = [
    {
      target: 0,
      guidePos: 0,
      spanStart: Math.min(0, rawY) - 24,
      spanEnd: Math.max(0, rawY + h) + 24,
    },
  ];
  const yCandidates: AxisSnapCandidate[] = [
    {
      target: 0,
      guidePos: 0,
      spanStart: Math.min(0, rawX) - 24,
      spanEnd: Math.max(0, rawX + w) + 24,
    },
  ];

  for (const { rect: o } of filtered) {
    const vStart = Math.min(rawY, o.y) - 12;
    const vEnd = Math.max(rawY + h, o.y + o.h) + 12;
    const hStart = Math.min(rawX, o.x) - 12;
    const hEnd = Math.max(rawX + w, o.x + o.w) + 12;

    // X alignment: left-left, right-right, center-center, left-right+gap, right-left-gap
    xCandidates.push(
      { target: o.x, guidePos: o.x, spanStart: vStart, spanEnd: vEnd },
      { target: o.x + o.w - w, guidePos: o.x + o.w, spanStart: vStart, spanEnd: vEnd },
      {
        target: Math.round(o.x + o.w / 2 - w / 2),
        guidePos: Math.round(o.x + o.w / 2),
        spanStart: vStart,
        spanEnd: vEnd,
      },
      {
        target: o.x + o.w + gap,
        guidePos: o.x + o.w + gap,
        spanStart: vStart,
        spanEnd: vEnd,
        label: `${gap}px`,
      },
      {
        target: o.x - gap - w,
        guidePos: o.x - gap,
        spanStart: vStart,
        spanEnd: vEnd,
        label: `${gap}px`,
      }
    );

    // Y alignment: top-top, bottom-bottom, middle-middle, top-bottom+gap, bottom-top-gap
    yCandidates.push(
      { target: o.y, guidePos: o.y, spanStart: hStart, spanEnd: hEnd },
      { target: o.y + o.h - h, guidePos: o.y + o.h, spanStart: hStart, spanEnd: hEnd },
      {
        target: Math.round(o.y + o.h / 2 - h / 2),
        guidePos: Math.round(o.y + o.h / 2),
        spanStart: hStart,
        spanEnd: hEnd,
      },
      {
        target: o.y + o.h + gap,
        guidePos: o.y + o.h + gap,
        spanStart: hStart,
        spanEnd: hEnd,
        label: `${gap}px`,
      },
      {
        target: o.y - gap - h,
        guidePos: o.y - gap,
        spanStart: hStart,
        spanEnd: hEnd,
        label: `${gap}px`,
      }
    );
  }

  let bestX: { dist: number; cand: AxisSnapCandidate } | null = null;
  for (const cand of xCandidates) {
    const dist = Math.abs(rawX - cand.target);
    if (dist <= threshold && (!bestX || dist < bestX.dist)) {
      bestX = { dist, cand };
    }
  }

  let bestY: { dist: number; cand: AxisSnapCandidate } | null = null;
  for (const cand of yCandidates) {
    const dist = Math.abs(rawY - cand.target);
    if (dist <= threshold && (!bestY || dist < bestY.dist)) {
      bestY = { dist, cand };
    }
  }

  const snappedX = bestX
    ? bestX.cand.target
    : Math.round(rawX / gridStep) * gridStep;
  const snappedY = bestY
    ? bestY.cand.target
    : Math.round(rawY / gridStep) * gridStep;

  const guides: SnapGuide[] = [];
  if (bestX) {
    guides.push({
      orientation: "v",
      pos: bestX.cand.guidePos,
      start: bestX.cand.spanStart,
      end: bestX.cand.spanEnd,
      label: bestX.cand.label,
    });
  }
  if (bestY) {
    guides.push({
      orientation: "h",
      pos: bestY.cand.guidePos,
      start: bestY.cand.spanStart,
      end: bestY.cand.spanEnd,
      label: bestY.cand.label,
    });
  }

  return {
    rect: { x: snappedX, y: snappedY, w, h },
    guides,
  };
}

/**
 * Snaps resized edges against neighboring cards' edges/sizes/origin across infinite coordinates.
 */
export function snapResizePixelRect(
  resizingId: string,
  rawRect: PixelRect,
  handle: ResizeHandleEdge,
  others: Array<{ id: string; rect: PixelRect }>,
  options?: {
    snapEnabled?: boolean;
    altBypass?: boolean;
    gap?: number;
    threshold?: number;
    gridStep?: number;
    minW?: number;
    minH?: number;
  }
): { rect: PixelRect; guides: SnapGuide[] } {
  const minW = options?.minW ?? MIN_WIDGET_PX_W;
  const minH = options?.minH ?? MIN_WIDGET_PX_H;
  const snapEnabled = options?.snapEnabled ?? true;
  const altBypass = options?.altBypass ?? false;
  const gap = options?.gap ?? SNAP_GAP;
  const threshold = options?.threshold ?? SNAP_THRESHOLD;
  const gridStep = options?.gridStep ?? DOT_GRID_STEP;

  let left = Math.round(rawRect.x);
  let top = Math.round(rawRect.y);
  let right = Math.round(rawRect.x + rawRect.w);
  let bottom = Math.round(rawRect.y + rawRect.h);

  const resizesLeft = handle === "w";
  const resizesRight = handle === "e" || handle === "se";
  const resizesTop = handle === "n";
  const resizesBottom = handle === "s" || handle === "se";

  // Enforce minimum dimensions keeping the opposite anchor fixed
  if (resizesLeft && right - left < minW) left = right - minW;
  if (resizesRight && right - left < minW) right = left + minW;
  if (resizesTop && bottom - top < minH) top = bottom - minH;
  if (resizesBottom && bottom - top < minH) bottom = top + minH;

  if (!snapEnabled || altBypass) {
    return {
      rect: { x: left, y: top, w: right - left, h: bottom - top },
      guides: [],
    };
  }

  const filtered = others.filter((o) => o.id !== resizingId);
  const guides: SnapGuide[] = [];

  if (resizesRight) {
    const candidates: Array<{ edge: number; spanStart: number; spanEnd: number; label?: string }> = [];
    for (const { rect: o } of filtered) {
      const vStart = Math.min(top, o.y) - 12;
      const vEnd = Math.max(bottom, o.y + o.h) + 12;
      candidates.push(
        { edge: o.x + o.w, spanStart: vStart, spanEnd: vEnd },
        { edge: o.x - gap, spanStart: vStart, spanEnd: vEnd, label: `${gap}px` },
        { edge: left + o.w, spanStart: top - 12, spanEnd: bottom + 12, label: `同宽 ${o.w}` }
      );
    }
    let best: { dist: number; edge: number; spanStart: number; spanEnd: number; label?: string } | null = null;
    for (const c of candidates) {
      if (c.edge - left < minW) continue;
      const dist = Math.abs(right - c.edge);
      if (dist <= threshold && (!best || dist < best.dist)) {
        best = { dist, ...c };
      }
    }
    if (best) {
      right = best.edge;
      guides.push({
        orientation: "v",
        pos: best.edge,
        start: best.spanStart,
        end: best.spanEnd,
        label: best.label,
      });
    } else {
      const gridRight = Math.round(right / gridStep) * gridStep;
      if (gridRight - left >= minW) right = gridRight;
    }
  } else if (resizesLeft) {
    const candidates: Array<{ edge: number; spanStart: number; spanEnd: number; label?: string }> = [
      { edge: 0, spanStart: Math.min(0, top) - 24, spanEnd: Math.max(0, bottom) + 24 },
    ];
    for (const { rect: o } of filtered) {
      const vStart = Math.min(top, o.y) - 12;
      const vEnd = Math.max(bottom, o.y + o.h) + 12;
      candidates.push(
        { edge: o.x, spanStart: vStart, spanEnd: vEnd },
        { edge: o.x + o.w + gap, spanStart: vStart, spanEnd: vEnd, label: `${gap}px` }
      );
    }
    let best: { dist: number; edge: number; spanStart: number; spanEnd: number; label?: string } | null = null;
    for (const c of candidates) {
      if (right - c.edge < minW) continue;
      const dist = Math.abs(left - c.edge);
      if (dist <= threshold && (!best || dist < best.dist)) {
        best = { dist, ...c };
      }
    }
    if (best) {
      left = best.edge;
      guides.push({
        orientation: "v",
        pos: best.edge,
        start: best.spanStart,
        end: best.spanEnd,
        label: best.label,
      });
    } else {
      const gridLeft = Math.round(left / gridStep) * gridStep;
      if (right - gridLeft >= minW) left = gridLeft;
    }
  }

  if (resizesBottom) {
    const candidates: Array<{ edge: number; spanStart: number; spanEnd: number; label?: string }> = [];
    for (const { rect: o } of filtered) {
      const hStart = Math.min(left, o.x) - 12;
      const hEnd = Math.max(right, o.x + o.w) + 12;
      candidates.push(
        { edge: o.y + o.h, spanStart: hStart, spanEnd: hEnd },
        { edge: o.y - gap, spanStart: hStart, spanEnd: hEnd, label: `${gap}px` },
        { edge: top + o.h, spanStart: left - 12, spanEnd: right + 12, label: `同高 ${o.h}` }
      );
    }
    let best: { dist: number; edge: number; spanStart: number; spanEnd: number; label?: string } | null = null;
    for (const c of candidates) {
      if (c.edge - top < minH) continue;
      const dist = Math.abs(bottom - c.edge);
      if (dist <= threshold && (!best || dist < best.dist)) {
        best = { dist, ...c };
      }
    }
    if (best) {
      bottom = best.edge;
      guides.push({
        orientation: "h",
        pos: best.edge,
        start: best.spanStart,
        end: best.spanEnd,
        label: best.label,
      });
    } else {
      const gridBottom = Math.round(bottom / gridStep) * gridStep;
      if (gridBottom - top >= minH) bottom = gridBottom;
    }
  } else if (resizesTop) {
    const candidates: Array<{ edge: number; spanStart: number; spanEnd: number; label?: string }> = [
      { edge: 0, spanStart: Math.min(0, left) - 24, spanEnd: Math.max(0, right) + 24 },
    ];
    for (const { rect: o } of filtered) {
      const hStart = Math.min(left, o.x) - 12;
      const hEnd = Math.max(right, o.x + o.w) + 12;
      candidates.push(
        { edge: o.y, spanStart: hStart, spanEnd: hEnd },
        { edge: o.y + o.h + gap, spanStart: hStart, spanEnd: hEnd, label: `${gap}px` }
      );
    }
    let best: { dist: number; edge: number; spanStart: number; spanEnd: number; label?: string } | null = null;
    for (const c of candidates) {
      if (bottom - c.edge < minH) continue;
      const dist = Math.abs(top - c.edge);
      if (dist <= threshold && (!best || dist < best.dist)) {
        best = { dist, ...c };
      }
    }
    if (best) {
      top = best.edge;
      guides.push({
        orientation: "h",
        pos: best.edge,
        start: best.spanStart,
        end: best.spanEnd,
        label: best.label,
      });
    } else {
      const gridTop = Math.round(top / gridStep) * gridStep;
      if (bottom - gridTop >= minH) top = gridTop;
    }
  }

  return {
    rect: {
      x: left,
      y: top,
      w: Math.max(minW, right - left),
      h: Math.max(minH, bottom - top),
    },
    guides,
  };
}

/**
 * Neatly packs top-level cards row-by-row starting from world origin (0, 0) while preserving
 * nested children inside each container at their relative offsets.
 */
export function autoArrangeFreeformWidgets(
  widgets: InfoWidget[],
  maxRowWidth = 1200,
  gap = SNAP_GAP
): Map<string, PixelRect> {
  const widgetIds = new Set(widgets.map((w) => w.id));
  const topLevel = widgets.filter((w) => !w.parentId || !widgetIds.has(w.parentId));
  const childrenByParent = new Map<string, InfoWidget[]>();
  for (const w of widgets) {
    if (w.parentId && widgetIds.has(w.parentId)) {
      const list = childrenByParent.get(w.parentId) ?? [];
      list.push(w);
      childrenByParent.set(w.parentId, list);
    }
  }

  const sorted = [...topLevel].sort((a, b) => {
    const ra = getWidgetPixelRect(a);
    const rb = getWidgetPixelRect(b);
    return ra.y - rb.y || ra.x - rb.x;
  });

  const result = new Map<string, PixelRect>();
  let curX = 0;
  let curY = 0;
  let rowMaxH = 0;

  for (const w of sorted) {
    const r = getWidgetPixelRect(w);
    if (curX > 0 && curX + r.w > maxRowWidth) {
      curX = 0;
      curY += rowMaxH + gap;
      rowMaxH = 0;
    }
    result.set(w.id, { x: curX, y: curY, w: r.w, h: r.h });

    const dx = curX - r.x;
    const dy = curY - r.y;
    const children = childrenByParent.get(w.id);
    if (children) {
      for (const child of children) {
        const cr = getWidgetPixelRect(child);
        result.set(child.id, {
          x: cr.x + dx,
          y: cr.y + dy,
          w: cr.w,
          h: cr.h,
        });
      }
    }

    curX += r.w + gap;
    rowMaxH = Math.max(rowMaxH, r.h);
  }

  return result;
}
