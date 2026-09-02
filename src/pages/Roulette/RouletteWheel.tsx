import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { RouletteColor } from "../../lib/games/roulette";
import {
  EUROPEAN_WHEEL_ORDER,
  WHEEL_SEGMENT_DEG,
  pocketColorForWheel,
} from "./wheelOrder";

const CX = 100;
const CY = 100;
const R_OUTER = 92;
const R_INNER = 58;
const R_TEXT = 76;

type WheelPhase = "idle" | "spinning" | "settling" | "won" | "loss";

type Props = {
  phase: WheelPhase;
  resultPocket: number | null;
  resultColor: RouletteColor | null;
  reduceMotion?: boolean;
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
  red: "#9b2335",
  black: "#141820",
  green: "#0f5c3a",
};

function targetRotationForPocket(
  pocket: number,
  currentAccumulated: number,
  extraTurns: number
): number {
  const index = EUROPEAN_WHEEL_ORDER.indexOf(
    pocket as (typeof EUROPEAN_WHEEL_ORDER)[number]
  );
  const idx = index >= 0 ? index : 0;
  const segmentCenter = idx * WHEEL_SEGMENT_DEG + WHEEL_SEGMENT_DEG / 2;
  const landAngle = (360 - segmentCenter) % 360;
  const currentBase = currentAccumulated % 360;
  const delta = (((landAngle - currentBase) % 360) + 360) % 360;
  return currentAccumulated + extraTurns * 360 + (delta === 0 ? 360 : delta);
}

export function RouletteWheel({
  phase,
  resultPocket,
  resultColor,
  reduceMotion = false,
}: Props) {
  const accumulatedRotationRef = useRef(0);
  const spinGenRef = useRef(0);
  const settledGenRef = useRef(0);
  const wasSpinningRef = useRef(false);

  const [rotation, setRotation] = useState(0);
  const [settling, setSettling] = useState(false);
  const [spinFrom, setSpinFrom] = useState(0);

  const spinning = phase === "spinning";

  useEffect(() => {
    if (spinning) {
      if (!wasSpinningRef.current) {
        spinGenRef.current += 1;
        wasSpinningRef.current = true;
      }
      setSpinFrom(accumulatedRotationRef.current % 360);
      setSettling(false);
      return;
    }

    wasSpinningRef.current = false;

    if (
      resultPocket === null ||
      spinGenRef.current === 0 ||
      settledGenRef.current === spinGenRef.current
    ) {
      return;
    }

    settledGenRef.current = spinGenRef.current;
    const extraTurns = reduceMotion ? 0 : 4;
    const target = targetRotationForPocket(
      resultPocket,
      accumulatedRotationRef.current,
      extraTurns
    );
    accumulatedRotationRef.current = target;

    if (reduceMotion) {
      setSettling(false);
      setRotation(target);
      return;
    }

    setSettling(true);
    setRotation(target);
  }, [spinning, phase, resultPocket, reduceMotion]);

  const showResult =
    !spinning && resultPocket !== null && (phase === "settling" || phase === "won" || phase === "loss");
  const hubColor = showResult && resultColor ? resultColor : "neutral";
  const hubNumber = showResult ? resultPocket : null;

  return (
    <div className="roulette-wheel" data-phase={phase}>
      <div className="roulette-wheel__rim" aria-hidden="true" />
      <div
        className={[
          "roulette-wheel__disc-wrap",
          spinning && !reduceMotion && "roulette-wheel__disc-wrap--spinning",
          settling && !spinning && !reduceMotion && "roulette-wheel__disc-wrap--settling",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div
          className="roulette-wheel__disc"
          style={
            spinning && !reduceMotion
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
                  <path
                    d={segmentPath(i)}
                    fill={FILL[color]}
                    stroke="#0d0f14"
                    strokeWidth="0.35"
                  />
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
            <circle
              cx={CX}
              cy={CY}
              r={R_INNER - 1}
              fill="#141820"
              stroke="#3d4658"
              strokeWidth="1"
            />
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
            {!reduceMotion && (
              <span className="roulette-wheel__hub-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            )}
          </>
        ) : hubNumber !== null ? (
          <>
            <span className="roulette-wheel__hub-number">{hubNumber}</span>
            <span className="roulette-wheel__hub-color">
              {resultColor
                ? resultColor.charAt(0).toUpperCase() + resultColor.slice(1)
                : ""}
            </span>
          </>
        ) : (
          <span className="roulette-wheel__hub-label">—</span>
        )}
      </div>
    </div>
  );
}
