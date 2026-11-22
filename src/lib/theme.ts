export interface AccentColorPreset {
  id: string;
  label: string;
  hex: string; // empty string means theme default
}

export const ACCENT_COLOR_PRESETS: AccentColorPreset[] = [
  { id: "default", label: "默认琥珀", hex: "" },
  { id: "amber", label: "暖金", hex: "#f59e0b" },
  { id: "orange", label: "赤陶", hex: "#ea580c" },
  { id: "rose", label: "绯红", hex: "#e11d48" },
  { id: "violet", label: "紫罗兰", hex: "#7c3aed" },
  { id: "indigo", label: "靛青", hex: "#4f46e5" },
  { id: "sky", label: "晴空", hex: "#0284c7" },
  { id: "emerald", label: "青黛", hex: "#059669" },
  { id: "slate", label: "墨灰", hex: "#52525b" },
];

export function normalizeHex(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const raw = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return (
      "#" +
      raw
        .split("")
        .map((ch) => ch + ch)
        .join("")
        .toLowerCase()
    );
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) {
    return "#" + raw.toLowerCase();
  }
  return null;
}

export function hexToHslComponents(hex: string): {
  h: number;
  s: number;
  l: number;
  luminance: number;
} | null {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;

  const r = parseInt(normalized.slice(1, 3), 16) / 255;
  const g = parseInt(normalized.slice(3, 5), 16) / 255;
  const b = parseInt(normalized.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
  }

  // Relative luminance (WCAG) for readable primary-foreground contrast
  const toLinear = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const luminance =
    0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

  return {
    h: Math.round(h),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
    luminance,
  };
}

export function applyAccentColor(accentHex?: string): void {
  const root = document.documentElement;
  const parsed = accentHex ? hexToHslComponents(accentHex) : null;
  if (!parsed) {
    root.removeAttribute("data-custom-accent");
    root.style.removeProperty("--primary");
    root.style.removeProperty("--primary-foreground");
    root.style.removeProperty("--ring");
    return;
  }

  const hsl = `${parsed.h} ${parsed.s}% ${parsed.l}%`;
  // Use dark ink on bright accent colors, crisp white on darker accent colors
  const foreground = parsed.luminance > 0.42 ? "240 10% 8%" : "0 0% 98%";
  root.setAttribute("data-custom-accent", "on");
  root.style.setProperty("--primary", hsl);
  root.style.setProperty("--primary-foreground", foreground);
  root.style.setProperty("--ring", hsl);
}
