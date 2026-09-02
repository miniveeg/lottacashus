/**
 * Inline SVG slot symbols.
 *
 * Replaces the previous emoji-based symbol glyphs (🍒 🔔 💰 etc.) which
 * rendered inconsistently across OSes and at different sizes. These SVGs
 * render identically on every platform and can be tinted via `color`.
 *
 * Each symbol is keyed by the same numeric ID used by the server and the
 * existing game engine (see `SYMBOL_GLYPH` in the old Slots.tsx).
 */

import type React from "react";

interface SymbolProps {
  size?: number;
  className?: string;
}

const DEFAULT_SIZE = 64;

function svgProps(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 64 64",
    className,
    "aria-hidden": true,
    focusable: false as const,
  };
}

/** 0 — Cherry */
export function CherrySymbol({ size = DEFAULT_SIZE, className }: SymbolProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M28 14c2 6 8 10 14 10" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M28 14c-2 4-2 8 0 12" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <circle cx="22" cy="38" r="9" fill="#dc143c" stroke="#7a0a1f" strokeWidth="2" />
      <circle cx="38" cy="42" r="9" fill="#dc143c" stroke="#7a0a1f" strokeWidth="2" />
      <ellipse cx="19" cy="34" rx="3" ry="2" fill="#ff8fa3" opacity="0.7" />
      <ellipse cx="35" cy="38" rx="3" ry="2" fill="#ff8fa3" opacity="0.7" />
      <path d="M44 16c4 0 8 2 10 6" stroke="#2d7a2d" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M44 16c-2-2-4-2-6 0" stroke="#2d7a2d" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** 1 — Bell */
export function BellSymbol({ size = DEFAULT_SIZE, className }: SymbolProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M20 44 L20 28 a12 12 0 0 1 24 0 L44 44 Z" fill="#f5b942" stroke="#7a5a0a" strokeWidth="2" />
      <rect x="18" y="44" width="28" height="4" rx="2" fill="#c9900a" stroke="#7a5a0a" strokeWidth="1.5" />
      <circle cx="32" cy="14" r="2.5" fill="#c9900a" stroke="#7a5a0a" strokeWidth="1.5" />
      <ellipse cx="26" cy="30" rx="3" ry="6" fill="#ffd166" opacity="0.6" />
      <circle cx="32" cy="54" r="3.5" fill="#f5b942" stroke="#7a5a0a" strokeWidth="1.5" />
    </svg>
  );
}

/** 2 — Lucky 7 */
export function SevenSymbol({ size = DEFAULT_SIZE, className }: SymbolProps) {
  return (
    <svg {...svgProps(size, className)}>
      <text
        x="32"
        y="46"
        textAnchor="middle"
        fontFamily="Syne, sans-serif"
        fontWeight="800"
        fontSize="44"
        fill="#dc143c"
        stroke="#7a0a1f"
        strokeWidth="1.5"
      >
        7
      </text>
    </svg>
  );
}

/** 3 — Bar (cash bag glyph; server label is Bar) */
export function BarSymbol({ size = DEFAULT_SIZE, className }: SymbolProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M22 26 L42 26 L46 50 L18 50 Z" fill="#2d7a2d" stroke="#0a3a0a" strokeWidth="2" />
      <rect x="28" y="20" width="8" height="6" fill="#5a9a5a" stroke="#0a3a0a" strokeWidth="1.5" />
      <text
        x="32"
        y="46"
        textAnchor="middle"
        fontFamily="Syne, sans-serif"
        fontWeight="800"
        fontSize="20"
        fill="#f5b942"
        stroke="#7a5a0a"
        strokeWidth="1"
      >
        $
      </text>
      <ellipse cx="26" cy="34" rx="2" ry="5" fill="#7acc7a" opacity="0.6" />
    </svg>
  );
}

/** @deprecated Prefer BarSymbol — server / paytable label is Bar. */
export const DollarSymbol = BarSymbol;

/** 4 — Watermelon */
export function MelonSymbol({ size = DEFAULT_SIZE, className }: SymbolProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M8 44 a24 24 0 0 1 48 0 Z" fill="#2d7a2d" stroke="#0a3a0a" strokeWidth="2" />
      <path d="M12 44 a20 20 0 0 1 40 0 Z" fill="#e63946" stroke="#7a0a1f" strokeWidth="1.5" />
      <ellipse cx="22" cy="38" rx="1.5" ry="3" fill="#1a1a1a" />
      <ellipse cx="32" cy="36" rx="1.5" ry="3" fill="#1a1a1a" />
      <ellipse cx="42" cy="38" rx="1.5" ry="3" fill="#1a1a1a" />
      <ellipse cx="27" cy="42" rx="1.5" ry="3" fill="#1a1a1a" />
      <ellipse cx="37" cy="42" rx="1.5" ry="3" fill="#1a1a1a" />
    </svg>
  );
}

/** 5 — Star */
export function StarSymbol({ size = DEFAULT_SIZE, className }: SymbolProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path
        d="M32 8 L39 24 L56 26 L43 38 L47 56 L32 47 L17 56 L21 38 L8 26 L25 24 Z"
        fill="#f5b942"
        stroke="#7a5a0a"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M32 8 L39 24 L56 26 L43 38 L47 56 L32 47 Z"
        fill="#ffd166"
        opacity="0.5"
      />
    </svg>
  );
}

/** 6 — Crown */
export function CrownSymbol({ size = DEFAULT_SIZE, className }: SymbolProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path
        d="M8 22 L18 38 L24 28 L32 42 L40 28 L46 38 L56 22 L52 50 L12 50 Z"
        fill="#f5b942"
        stroke="#7a5a0a"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <rect x="12" y="50" width="40" height="4" fill="#c9900a" stroke="#7a5a0a" strokeWidth="1.5" />
      <circle cx="8" cy="22" r="3" fill="#dc143c" stroke="#7a0a1f" strokeWidth="1.5" />
      <circle cx="32" cy="14" r="3" fill="#dc143c" stroke="#7a0a1f" strokeWidth="1.5" />
      <circle cx="56" cy="22" r="3" fill="#dc143c" stroke="#7a0a1f" strokeWidth="1.5" />
    </svg>
  );
}

const SYMBOL_COMPONENTS: Record<number, (props: SymbolProps) => React.ReactElement> = {
  0: CherrySymbol,
  1: BellSymbol,
  2: SevenSymbol,
  3: BarSymbol,
  4: MelonSymbol,
  5: StarSymbol,
  6: CrownSymbol,
};

/** Render the SVG symbol for the given numeric symbol ID. */
export function SlotSymbol({ id, size, className }: { id: number; size?: number; className?: string }) {
  const Cmp = SYMBOL_COMPONENTS[id];
  if (!Cmp) return null;
  return <Cmp size={size} className={className} />;
}
