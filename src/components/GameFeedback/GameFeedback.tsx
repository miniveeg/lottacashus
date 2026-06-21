import { useEffect, useId, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { formatCoins, type CoinType } from "../../lib/format";
import "./GameFeedback.css";

interface GameFeedbackProps {
  type: "win" | "loss" | "big-win";
  amount?: number;
  multiplier?: number;
  coinType?: CoinType;
  /** Auto-dismiss after the given milliseconds. When provided, an
   *  `onDismiss` callback MUST also be supplied so the parent clears the
   *  `<GameFeedback />` from its render tree. The timer is cleared on
   *  unmount to prevent setState-on-unmounted-component warnings. */
  durationMs?: number;
  onDismiss?: () => void;
}

/**
 *  Ephemeral win/loss feedback overlay (rendered on top of a game board).
 *
 *  Accessibility:
 *  - `role="status"` + `aria-live="assertive"` announces the outcome to
 *    screen-reader users the moment the element mounts.
 *  - `aria-labelledby` points at the visible label ("Win!" / "Loss" / "Big
 *    Win!") so the announcement matches what sighted users see.
 *
 *  Mount/unmount is owned by the PARENT (it conditionally renders
 *  `<GameFeedback />` based on its own state). For the exit animation to
 *  actually fire, the parent MUST wrap its conditional `<GameFeedback />`
 *  in its own `<AnimatePresence>` (framer-motion only runs `exit` variants
 *  for direct children of `<AnimatePresence>` that are removed from inside
 *  it). The internal `<AnimatePresence>` below does NOT enable exit
 *  animations — it is retained only so that a parent which forgets to wrap
 *  the conditional still gets the enter animation; it cannot intercept the
 *  unmount of this whole component.
 */
export function GameFeedback({
  type,
  amount,
  multiplier,
  coinType = "balance",
  durationMs,
  onDismiss,
}: GameFeedbackProps) {
  const isBigWin = type === "big-win";
  const isWin = type === "win" || isBigWin;
  const labelId = useId();

  // Keep the latest `onDismiss` in a ref so the auto-dismiss timer effect
  // can depend on `[durationMs]` only. Without this, parents that pass an
  // inline (non-`useCallback`-memoized) `onDismiss` would cause the timer
  // to be cleared and re-created on every parent render — restarting the
  // countdown whenever any parent state changed (e.g., the parent's
  // `amount` or `multiplier` updating as part of the same win sequence).
  // The timer would then effectively never elapse if the parent re-rendered
  // frequently during the dismiss window.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  // Auto-dismiss timer — cleared on unmount. Only fires when both
  // `durationMs` and `onDismiss` are provided (defensive: a duration with
  // no callback would just leave the component mounted forever).
  useEffect(() => {
    if (!durationMs || !onDismissRef.current) return;
    if (durationMs <= 0) return;
    const timer = setTimeout(() => onDismissRef.current?.(), durationMs);
    return () => clearTimeout(timer);
  }, [durationMs]);

  const label = isBigWin ? "🔥 Big Win!" : isWin ? "Win!" : "Loss";

  return (
    <AnimatePresence>
      <motion.div
        className={`game-feedback game-feedback--${type}`}
        role="status"
        aria-live="assertive"
        aria-labelledby={labelId}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        <motion.div
          className="game-feedback__overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: isWin ? 0.7 : 0.5 }}
          transition={{ duration: 0.3 }}
        />
        <motion.div
          className="game-feedback__content"
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{
            type: "spring",
            stiffness: 300,
            damping: 20,
            delay: 0.1,
          }}
        >
          <p className="game-feedback__label" id={labelId}>
            {label}
          </p>
          {multiplier !== undefined && Number.isFinite(multiplier) && (
            <p className="game-feedback__multiplier">{multiplier.toFixed(2)}×</p>
          )}
          {amount !== undefined && amount > 0 && (
            <p className="game-feedback__amount">{formatCoins(amount, coinType)}</p>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
