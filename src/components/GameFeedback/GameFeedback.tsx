import { motion, AnimatePresence } from "framer-motion";
import { formatCoins, type CoinType } from "../../lib/format";
import "./GameFeedback.css";

interface GameFeedbackProps {
  type: "win" | "loss" | "big-win";
  amount?: number;
  multiplier?: number;
  coinType?: CoinType;
}

export function GameFeedback({ type, amount, multiplier, coinType = "balance" }: GameFeedbackProps) {
  const isBigWin = type === "big-win";
  const isWin = type === "win" || isBigWin;

  return (
    <AnimatePresence>
      <motion.div
        className={`game-feedback game-feedback--${type}`}
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
          <p className="game-feedback__label">
            {isBigWin ? "🔥 Big Win!" : isWin ? "Win!" : "Loss"}
          </p>
          {multiplier && (
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
