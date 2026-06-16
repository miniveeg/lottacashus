import { useCallback, useEffect, useId, useRef, useState } from "react";
import "./LcSelect.css";

export type LcSelectOption<T extends string = string> = {
  value: T;
  label: string;
};

type LcSelectProps<T extends string> = {
  value: T;
  options: readonly LcSelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
};

export function LcSelect<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  className = "",
  "aria-label": ariaLabel,
}: LcSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value) ?? options[0];

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  function pick(next: T) {
    onChange(next);
    close();
  }

  function handleTriggerKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen((v) => !v);
    }
    if (e.key === "ArrowDown" && !open) {
      e.preventDefault();
      setOpen(true);
    }
  }

  return (
    <div
      ref={rootRef}
      className={`lc-select-root${open ? " lc-select-root--open" : ""}${disabled ? " lc-select-root--disabled" : ""}${className ? ` ${className}` : ""}`}
    >
      <button
        type="button"
        className="lc-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="lc-select-trigger__label">{selected?.label}</span>
        <span className="lc-select-trigger__chevron" aria-hidden="true" />
      </button>

      {open && (
        <ul
          id={listId}
          className="lc-select-menu"
          role="listbox"
          aria-label={ariaLabel}
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <li key={opt.value} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`lc-select-option${isSelected ? " lc-select-option--selected" : ""}`}
                  onClick={() => pick(opt.value)}
                >
                  <span className="lc-select-option__label">{opt.label}</span>
                  {isSelected && (
                    <span className="lc-select-option__check" aria-hidden="true" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
