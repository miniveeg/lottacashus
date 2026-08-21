import type { InputHTMLAttributes, ReactNode } from "react";
import "./LcCheckbox.css";

type LcCheckboxProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "children"
> & {
  label: ReactNode;
  className?: string;
};

/** Custom checkbox — never uses native browser chrome. */
export function LcCheckbox({ label, className = "", id, ...rest }: LcCheckboxProps) {
  const inputId = id ?? (typeof label === "string" ? `lc-cb-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);

  return (
    <label className={`lc-checkbox${className ? ` ${className}` : ""}`} htmlFor={inputId}>
      <input id={inputId} type="checkbox" {...rest} />
      <span className="lc-checkbox__label">{label}</span>
    </label>
  );
}
