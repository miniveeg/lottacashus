import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { RouletteColor } from "../../lib/games/roulette";
import {
  EUROPEAN_WHEEL_ORDER,
  WHEEL_SEGMENT_DEG,
  pocketColorForWheel,
  rotationForPocket,
} from "./wheelOrder";

const CX = 100;
const CY = 100;
const R_OUTER = 92;
const R_INNER = 58;
const R_TEXT = 76;

type Props = {
  spinning: boolean;
  resultPocket: number | null;
  resultColor: RouletteColor | null;
};

function segmentPath(index: number): string {
  const start = ((index * WHEEL_SEGMENT_DEG - 90) * Math.PI) / 180;
  const end = (((index + 1) * WHEEL_SEGMENT_DEG - 90) * Math.PI) / 180;
  const x1 = CX + R_OUTER * Math.cos(start);
  const y1 = CY + R_OUTER * Math.sin(start);
  const x2 = CX + R_OUTER * Math.cos(end);
  const y2 = CY + R_OUTER * Math.sin(end);
  const x3 = CX + R_INNER * Math.cos(end);
  const y3 = CY + R_INNER * Math.sin(end);
  const x4 = CX + R_INNER * Math.cos(start);
  const y4 = CY + R_INNER * Math.sin(start);
  return `M ${x1} ${y1} A ${R_OUTER} ${R_OUTER} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${R_INNER} ${R_INNER} 0 0 0 ${x4} ${y4} Z`;
}

function labelPosition(index: number): { x: number; y: number; rotate: number } {
  const mid = (index + 0.5) * WHEEL_SEGMENT_DEG - 90;
  const rad = (mid * Math.PI) / 180;
  return {
    x: CX + R_TEXT * Math.cos(rad),
    y: CY + R_TEXT * Math.sin(rad),
    rotate: mid + 90,
  };
}

const FILL: Record<RouletteColor, string> = {
  red: "#b91c1c",
  black: "#1a1f2e",
  green: "#15803d",
};

export function RouletteWheel({ spinning, resultPocket, resultColor }: Props) {
  const [rotation, setRotation] = useState(0);
  const [settling, setSettling] = useState(false);

  const targetRotation = useMemo(() => {
    if (resultPocket === null) return null;
    return rotationForPocket(resultPocket, 5);
  }, [resultPocket]);

  useEffect(() => {
    if (spinning) {
      setSettling(false);
      return;
    }
    if (targetRotation !== null) {
      setSettling(true);
      setRotation(targetRotation);
    }
  }, [spinning, targetRotation]);

  const hubColor = resultColor ?? "neutral";
  const hubNumber = spinning ? null : resultPocket;
  const spinFrom = rotation % 360;

  return (
    <div className="roulette-wheel">
      <div className="roulette-wheel__rim" aria-hidden="true" />
      <div
        className={`roulette-wheel__disc-wrap${spinning ? " roulette-wheel__disc-wrap--spinning" : ""}${settling ? " roulette-wheel__disc-wrap--settling" : ""}`}
      >
        <div
          className="roulette-wheel__disc"
          style={
            spinning
              ? ({ "--spin-from": `${spinFrom}deg` } as CSSProperties)
              : { transform: `rotate(${rotation}deg)` }
          }
        >
          <svg viewBox="0 0 200 200" className="roulette-wheel__svg" aria-hidden="true">
            <circle cx={CX} cy={CY} r={R_OUTER + 2} fill="#2a2418" />
            {EUROPEAN_WHEEL_ORDER.map((pocket, i) => {
              const color = pocketColorForWheel(pocket);
              const pos = labelPosition(i);
              return (
                <g key={pocket}>
                  <path d={segmentPath(i)} fill={FILL[color]} stroke="#0d0f14" strokeWidth="0.35" />
                  <text
                    x={pos.x}
                    y={pos.y}
                    fill="#f8fafc"
                    fontSize={pocket >= 10 ? "5.5" : "6.5"}
                    fontWeight="700"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    transform={`rotate(${pos.rotate}, ${pos.x}, ${pos.y})`}
                    opacity="0.95"
                  >
                    {pocket}
                  </text>
                </g>
              );
            })}
            <circle cx={CX} cy={CY} r={R_INNER - 1} fill="#141820" stroke="#3d4658" strokeWidth="1" />
          </svg>
        </div>
      </div>

      <div className="roulette-wheel__ball-marker" aria-hidden="true">
        <span className="roulette-wheel__ball" />
        <span className="roulette-wheel__pointer" />
      </div>

      <div
        className={`roulette-wheel__hub roulette-wheel__hub--${hubColor}`}
        aria-live="polite"
      >
        {spinning ? (
          <>
            <span className="roulette-wheel__hub-label">Spinning</span>
            <span className="roulette-wheel__hub-dots" aria-hidden="true">
              <span /><span /><span />
            </span>
          </>
        ) : hubNumber !== null ? (
          <>
            <span className="roulette-wheel__hub-number">{hubNumber}</span>
            <span className="roulette-wheel__hub-color">
              {resultColor ? resultColor.charAt(0).toUpperCase() + resultColor.slice(1) : ""}
            </span>
          </>
        ) : (
          <span className="roulette-wheel__hub-label">—</span>
        )}
      </div>
    </div>
  );
}
