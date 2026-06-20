import type { CSSProperties } from "react";

/**
 * BrandLogo — stylized "LC" monogram in a rounded square with a crimson
 * gradient. Renders as inline SVG so it scales crisply from 28px (footer)
 * to 32px (topbar) to 72px (auth pages) without raster artifacts.
 *
 * The previous PNG asset (/logo.png) is kept as a fallback for any external
 * consumers, but the React shell now uses this vector version for a sharper,
 * more premium look that matches the redesigned topbar/brand.
 */

export const LOGO_SRC = "/logo.png";

type BrandLogoProps = {
  className?: string;
  size?: number;
  alt?: string;
};

export function BrandLogo({ className = "", size = 36, alt = "LottaCash" }: BrandLogoProps) {
  const px = Math.max(16, Math.round(size));
  const style: CSSProperties = {
    width: px,
    height: px,
    display: "block",
    flexShrink: 0,
  };

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
        <linearGradient id="brand-logo__grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ff2d55" />
          <stop offset="55%" stopColor="#dc143c" />
          <stop offset="100%" stopColor="#a81030" />
        </linearGradient>
        <linearGradient id="brand-logo__highlight" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.32)" />
          <stop offset="50%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
        <filter id="brand-logo__glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Rounded-square body with crimson gradient + subtle inner highlight */}
      <rect
        x="2"
        y="2"
        width="60"
        height="60"
        rx="16"
        ry="16"
        fill="url(#brand-logo__grad)"
      />
      <rect
        x="2"
        y="2"
        width="60"
        height="60"
        rx="16"
        ry="16"
        fill="url(#brand-logo__highlight)"
      />
      {/* Subtle 1px inner border for crispness against dark backgrounds */}
      <rect
        x="2.5"
        y="2.5"
        width="59"
        height="59"
        rx="15.5"
        ry="15.5"
        fill="none"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="1"
      />

      {/* LC monogram — clean, geometric, generous counter spaces */}
      <g
        filter="url(#brand-logo__glow)"
        fill="none"
        stroke="#ffffff"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* L */}
        <path d="M19 18 L19 44 L33 44" />
        {/* C — open arc to the right of L */}
        <path d="M48 24 A11 11 0 1 0 48 44" />
      </g>
    </svg>
  );
}
