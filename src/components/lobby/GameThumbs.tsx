import type { CSSProperties } from "react";

const MINES_CELLS = [1, 0, 2, 0, 1, 0, 1, 0, 0, 2, 0, 1, 1, 0, 2, 0] as const;
const TOWER_WIDTHS = [42, 50, 58, 68, 78, 88] as const;
const LIMBO_POINTS = "0,52 18,48 34,40 48,30 62,18 74,8 86,22 100,46";

export function GameThumb({ id }: { id: string }) {
  if (id === "mines") {
    return (
      <div className="thumb thumb-mines" aria-hidden="true">
        {MINES_CELLS.map((c, i) => (
          <i key={i} data-c={c} />
        ))}
      </div>
    );
  }
  if (id === "tower") {
    return (
      <div className="thumb thumb-tower" aria-hidden="true">
        {TOWER_WIDTHS.map((w, i) => (
          <i key={i} style={{ width: `${w}%` } as CSSProperties} />
        ))}
      </div>
    );
  }
  if (id === "limbo") {
    return (
      <div className="thumb thumb-limbo" aria-hidden="true">
        <svg viewBox="0 0 100 56" preserveAspectRatio="none">
          <polyline points={LIMBO_POINTS} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
          <line x1="0" y1="20" x2="100" y2="20" stroke="#e8c36a" strokeWidth="1" strokeDasharray="3 4" opacity="0.55" />
        </svg>
      </div>
    );
  }
  if (id === "roulette") {
    return (
      <div className="thumb thumb-roulette" aria-hidden="true">
        <span className="thumb-wheel" />
        <span className="thumb-wheel-hub">LC</span>
        <span className="thumb-wheel-pin" />
      </div>
    );
  }
  if (id === "blackjack") {
    return (
      <div className="thumb thumb-cards" aria-hidden="true">
        <span className="thumb-card c1" />
        <span className="thumb-card c2" />
      </div>
    );
  }
  if (id === "upgrader") {
    return (
      <div className="thumb thumb-upgrade" aria-hidden="true">
        <span className="thumb-dial" />
        <span className="thumb-needle" />
        <span className="thumb-dial-core" />
      </div>
    );
  }
  if (id === "cases") {
    return (
      <div className="thumb thumb-crate" aria-hidden="true">
        <span className="mini-crate" />
      </div>
    );
  }
  return (
    <div className="thumb thumb-swords" aria-hidden="true">
      <span className="blade b1" />
      <span className="blade b2" />
      <span className="mini-crate" />
    </div>
  );
}
