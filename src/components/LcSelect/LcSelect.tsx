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
  const [activeIndex, setActiveIndex] = useState<number>(() =>
    Math.max(0, options.findIndex((o) => o.value === value))
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listId = useId();
  const getOptionId = useCallback((idx: number) => `${listId}-opt-${idx}`, [listId]);

  const selected = options.find((o) => o.value === value) ?? options[0];

  const close = useCallback(() => setOpen(false), []);

  // Keep the active index in sync with the value when closed.
  useEffect(() => {
    if (open) return;
    const idx = options.findIndex((o) => o.value === value);
    if (idx >= 0) setActiveIndex(idx);
  }, [value, options, open]);

  // When the menu opens, jump to the currently selected option so keyboard
  // users have a sensible starting point.
  useEffect(() => {
    if (!open) return;
    const idx = options.findIndex((o) => o.value === value);
    setActiveIndex(idx >= 0 ? idx : 0);
  }, [open, value, options]);

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

  // Keep the active option in view when navigating by keyboard.
  useEffect(() => {
    if (!open) return;
    const el = optionRefs.current[activeIndex];
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function pick(next: T) {
    onChange(next);
    close();
  }

  function handleTriggerKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    switch (e.key) {
      case "Enter":
        e.preventDefault();
        if (open) {
          const opt = options[activeIndex];
          if (opt) pick(opt.value);
        } else {
          setOpen(true);
        }
        break;
      case " ":
        e.preventDefault();
        if (!open) {
          setOpen(true);
        } else {
          const opt = options[activeIndex];
          if (opt) pick(opt.value);
        }
        break;
      case "ArrowDown":
        e.preventDefault();
        if (!open) {
          setOpen(true);
        } else {
          setActiveIndex((i) => (i + 1) % options.length);
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!open) {
          setOpen(true);
        } else {
          setActiveIndex((i) => (i - 1 + options.length) % options.length);
        }
        break;
      case "Home":
        if (open) {
          e.preventDefault();
          setActiveIndex(0);
        }
        break;
      case "End":
        if (open) {
          e.preventDefault();
          setActiveIndex(options.length - 1);
        }
        break;
      case "Tab":
        if (open) close();
        break;
      default:
        break;
    }
  }

  function handleOptionKeyDown(e: React.KeyboardEvent, idx: number) {
    switch (e.key) {
      case "Enter":
      case " ":
        e.preventDefault();
        pick(options[idx]!.value);
        break;
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % options.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + options.length) % options.length);
        break;
      case "Home":
        e.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        e.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <div
      ref={rootRef}
      className={`lc-select-root${open ? " lc-select-root--open" : ""}${disabled ? " lc-select-root--disabled" : ""}${className ? ` ${className}` : ""}`}
    >
      <button
        type="button"
        role="combobox"
        className="lc-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? getOptionId(activeIndex) : undefined}
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
          {options.map((opt, idx) => {
            const isSelected = opt.value === value;
            const isActive = idx === activeIndex;
            return (
              <li key={opt.value} role="presentation">
                <button
                  ref={(el) => {
                    optionRefs.current[idx] = el;
                  }}
                  type="button"
                  role="option"
                  id={getOptionId(idx)}
                  aria-selected={isSelected}
                  className={`lc-select-option${isSelected ? " lc-select-option--selected" : ""}${isActive ? " lc-select-option--active" : ""}`}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => pick(opt.value)}
                  onKeyDown={(e) => handleOptionKeyDown(e, idx)}
                  tabIndex={-1}
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
