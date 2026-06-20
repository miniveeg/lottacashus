import type { CSSProperties } from "react";

/**
 * BrandLogo — clean SVG "LC" monogram in a rounded square.
 *
 * Premium obsidian-gold redesign:
 *   • Gold gradient fill (linear, top-left bright → bottom-right deep)
 *   • Dark "LC" letterforms stroked on top for contrast
 *   • Subtle gold glow via CSS filter (see BrandLogo.css)
 *   • No PNG dependency — pure vector, scales cleanly 24px → 64px
 *
 * Scales:
 *   24px — compact UI (mobile topbar)
 *   32px — desktop topbar (default)
 *   48px — sidebar header
 *   64px — auth pages
 */

export const LOGO_SRC = "/logo.png";

type BrandLogoProps = {
  className?: string;
  size?: number;
  alt?: string;
};

export function BrandLogo({ className = "", size = 32, alt = "LottaCash" }: BrandLogoProps) {
  const px = Math.max(16, Math.round(size));
  const style: CSSProperties = {
    width: px,
    height: px,
    display: "block",
    flexShrink: 0,
  };

  // Unique gradient IDs so multiple logos on a page don't collide.
  const uid = `bl${px}`;

  return (
    <svg
      className={`brand-logo ${className}`.trim()}
      style={style}
      viewBox="0 0 64 64"
      role="img"
      aria-label={alt}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={`${uid}__grad`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fcd34d" />
          <stop offset="50%" stopColor="#f5b942" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
        <linearGradient id={`${uid}__highlight`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.40)" />
          <stop offset="55%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>

      {/* Rounded-square body with gold gradient + subtle inner highlight */}
      <rect x="2" y="2" width="60" height="60" rx="16" ry="16" fill={`url(#${uid}__grad)`} />
      <rect x="2" y="2" width="60" height="60" rx="16" ry="16" fill={`url(#${uid}__highlight)`} />

      {/* 1px inner border for crispness against dark backgrounds */}
      <rect
        x="2.5"
        y="2.5"
        width="59"
        height="59"
        rx="15.5"
        ry="15.5"
        fill="none"
        stroke="rgba(0,0,0,0.18)"
        strokeWidth="1"
      />

      {/* LC monogram — dark letters stroked on the gold plate */}
      <g
        fill="none"
        stroke="#1a1208"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.92"
      >
        {/* L */}
        <path d="M19 18 L19 44 L33 44" />
        {/* C — open arc to the right of L */}
        <path d="M48 24 A11 11 0 1 0 48 44" />
      </g>
    </svg>
  );
}
