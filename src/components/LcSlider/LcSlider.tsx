import type { InputHTMLAttributes, CSSProperties } from "react";
import "./LcSlider.css";

type LcSliderProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "onChange"
> & {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** Optional display value next to the track */
  displayValue?: string | number;
  className?: string;
};

/** Custom range slider with filled track driven by CSS variable. */
export function LcSlider({
  value,
  min,
  max,
  onChange,
  displayValue,
  className = "",
  style,
  disabled,
  ...rest
}: LcSliderProps) {
  const span = max - min;
  const pct = span <= 0 ? 0 : Math.min(100, Math.max(0, ((value - min) / span) * 100));

  const mergedStyle: CSSProperties = {
    ...style,
    ["--lc-slider-fill" as string]: `${pct}%`,
  };

  return (
    <div className={`lc-slider-wrap${className ? ` ${className}` : ""}`}>
      <input
        type="range"
        className="lc-slider"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        style={mergedStyle}
        onChange={(e) => onChange(Number(e.target.value))}
        {...rest}
      />
      {displayValue != null && (
        <span className="lc-slider__value" aria-hidden="true">
          {displayValue}
        </span>
      )}
    </div>
  );
}
