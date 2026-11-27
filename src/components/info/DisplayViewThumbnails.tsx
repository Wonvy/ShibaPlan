import React from "react";
import type { InfoDisplayView } from "../../types";

interface DisplayViewThumbnailProps {
  view: InfoDisplayView;
  active?: boolean;
}

/**
 * Schematic SVG wireframe preview for each Info card display layout.
 * Uses currentColor + opacity levels so it adapts cleanly across dark/light/paper themes.
 */
export const DisplayViewThumbnail: React.FC<DisplayViewThumbnailProps> = ({
  view,
}) => {
  switch (view) {
    case "auto":
      return (
        <svg viewBox="0 0 64 36" className="h-7 w-full" fill="none" aria-hidden="true">
          <rect x="2" y="2" width="28" height="14" rx="2.5" fill="currentColor" fillOpacity="0.14" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1" />
          <rect x="6" y="6" width="12" height="3.5" rx="1" fill="currentColor" fillOpacity="0.7" />
          <path d="M6 13 L11 10.5 L16 12 L22 8.5 L26 10" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />

          <rect x="34" y="2" width="28" height="14" rx="2.5" fill="currentColor" fillOpacity="0.14" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1" />
          <rect x="38" y="6" width="14" height="3.5" rx="1" fill="currentColor" fillOpacity="0.7" />
          <path d="M38 12.5 L44 9.5 L50 11.5 L58 8" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />

          <circle cx="5" cy="23" r="1.5" fill="currentColor" fillOpacity="0.7" />
          <rect x="9" y="21.5" width="32" height="2.5" rx="1" fill="currentColor" fillOpacity="0.45" />
          <rect x="48" y="21.5" width="12" height="2.5" rx="1" fill="currentColor" fillOpacity="0.25" />

          <circle cx="5" cy="30" r="1.5" fill="currentColor" fillOpacity="0.7" />
          <rect x="9" y="28.5" width="26" height="2.5" rx="1" fill="currentColor" fillOpacity="0.45" />
          <rect x="48" y="28.5" width="12" height="2.5" rx="1" fill="currentColor" fillOpacity="0.25" />
        </svg>
      );

    case "metrics":
      return (
        <svg viewBox="0 0 64 36" className="h-7 w-full" fill="none" aria-hidden="true">
          {[2, 23, 44].map((x, idx) => (
            <g key={x}>
              <rect
                x={x}
                y="3"
                width="18"
                height="30"
                rx="2.5"
                fill="currentColor"
                fillOpacity="0.12"
                stroke="currentColor"
                strokeOpacity="0.28"
                strokeWidth="1"
              />
              <rect x={x + 3} y="7" width="8" height="2" rx="1" fill="currentColor" fillOpacity="0.35" />
              <rect x={x + 3} y="12" width="11" height="4.5" rx="1" fill="currentColor" fillOpacity="0.75" />
              <path
                d={
                  idx === 0
                    ? `M${x + 3} 27 L${x + 7} 23 L${x + 11} 25 L${x + 15} 20`
                    : idx === 1
                      ? `M${x + 3} 25 L${x + 7} 26 L${x + 11} 21 L${x + 15} 22`
                      : `M${x + 3} 26 L${x + 7} 22 L${x + 11} 24 L${x + 15} 19`
                }
                stroke="currentColor"
                strokeOpacity="0.65"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          ))}
        </svg>
      );

    case "list":
      return (
        <svg viewBox="0 0 64 36" className="h-7 w-full" fill="none" aria-hidden="true">
          {[5, 16, 27].map((y, idx) => (
            <g key={y}>
              <circle cx="6" cy={y + 2.5} r="2" fill="currentColor" fillOpacity={idx === 1 ? "0.45" : "0.75"} />
              <rect x="11" y={y} width={idx === 1 ? 26 : 32} height="2.6" rx="1" fill="currentColor" fillOpacity="0.68" />
              <rect x="11" y={y + 4} width="18" height="1.8" rx="0.9" fill="currentColor" fillOpacity="0.28" />
              <rect x="49" y={y + 0.5} width="11" height="3.5" rx="1.2" fill="currentColor" fillOpacity="0.2" />
            </g>
          ))}
        </svg>
      );

    case "kv":
      return (
        <svg viewBox="0 0 64 36" className="h-7 w-full" fill="none" aria-hidden="true">
          {[5, 13, 21, 29].map((y, idx) => (
            <g key={y}>
              <rect x="4" y={y} width={idx % 2 === 0 ? 16 : 20} height="2.8" rx="1" fill="currentColor" fillOpacity="0.32" />
              <rect
                x={idx % 2 === 0 ? 34 : 38}
                y={y}
                width={idx % 2 === 0 ? 26 : 22}
                height="2.8"
                rx="1"
                fill="currentColor"
                fillOpacity="0.72"
              />
              {idx < 3 && (
                <line x1="4" y1={y + 5.3} x2="60" y2={y + 5.3} stroke="currentColor" strokeOpacity="0.12" strokeWidth="0.8" />
              )}
            </g>
          ))}
        </svg>
      );

    case "table":
      return (
        <svg viewBox="0 0 64 36" className="h-7 w-full" fill="none" aria-hidden="true">
          <rect x="3" y="4" width="58" height="28" rx="2.5" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1" />
          <rect x="3.5" y="4.5" width="57" height="7" rx="2" fill="currentColor" fillOpacity="0.15" />
          <line x1="23" y1="4" x2="23" y2="32" stroke="currentColor" strokeOpacity="0.16" strokeWidth="0.9" />
          <line x1="43" y1="4" x2="43" y2="32" stroke="currentColor" strokeOpacity="0.16" strokeWidth="0.9" />
          <line x1="3" y1="18" x2="61" y2="18" stroke="currentColor" strokeOpacity="0.14" strokeWidth="0.9" />
          <line x1="3" y1="25" x2="61" y2="25" stroke="currentColor" strokeOpacity="0.14" strokeWidth="0.9" />
          <rect x="6" y="7" width="12" height="2" rx="1" fill="currentColor" fillOpacity="0.7" />
          <rect x="26" y="7" width="12" height="2" rx="1" fill="currentColor" fillOpacity="0.7" />
          <rect x="46" y="7" width="10" height="2" rx="1" fill="currentColor" fillOpacity="0.7" />
          {[14, 21, 28].map((y) => (
            <g key={y}>
              <rect x="6" y={y} width="13" height="2" rx="0.9" fill="currentColor" fillOpacity="0.45" />
              <rect x="26" y={y} width="10" height="2" rx="0.9" fill="currentColor" fillOpacity="0.45" />
              <rect x="46" y={y} width="9" height="2" rx="0.9" fill="currentColor" fillOpacity="0.45" />
            </g>
          ))}
        </svg>
      );

    case "markdown":
      return (
        <svg viewBox="0 0 64 36" className="h-7 w-full" fill="none" aria-hidden="true">
          <rect x="4" y="4" width="28" height="4" rx="1.2" fill="currentColor" fillOpacity="0.8" />
          <rect x="4" y="11" width="54" height="2.4" rx="1" fill="currentColor" fillOpacity="0.38" />
          <rect x="4" y="15.5" width="42" height="2.4" rx="1" fill="currentColor" fillOpacity="0.38" />
          <circle cx="6.5" cy="23" r="1.4" fill="currentColor" fillOpacity="0.65" />
          <rect x="10" y="21.8" width="38" height="2.2" rx="1" fill="currentColor" fillOpacity="0.55" />
          <circle cx="6.5" cy="29" r="1.4" fill="currentColor" fillOpacity="0.65" />
          <rect x="10" y="27.8" width="30" height="2.2" rx="1" fill="currentColor" fillOpacity="0.55" />
        </svg>
      );

    case "text":
      return (
        <svg viewBox="0 0 64 36" className="h-7 w-full" fill="none" aria-hidden="true">
          <rect x="3" y="3" width="58" height="30" rx="2.5" fill="currentColor" fillOpacity="0.09" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1" />
          <rect x="7" y="8" width="4" height="2.4" rx="0.8" fill="currentColor" fillOpacity="0.7" />
          <rect x="13" y="8" width="36" height="2.4" rx="0.8" fill="currentColor" fillOpacity="0.45" />
          <rect x="7" y="14" width="46" height="2.2" rx="0.8" fill="currentColor" fillOpacity="0.35" />
          <rect x="7" y="20" width="32" height="2.2" rx="0.8" fill="currentColor" fillOpacity="0.35" />
          <rect x="7" y="26" width="40" height="2.2" rx="0.8" fill="currentColor" fillOpacity="0.35" />
        </svg>
      );
  }
};
