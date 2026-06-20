import { lazy, Suspense } from "react";
import type { CSSProperties } from "react";
import "../../styles/atmosphere.css";

const ObsidianSceneLazy = lazy(() =>
  import("./ObsidianScene").then((m) => ({ default: m.ObsidianScene }))
);

type AtmosphericLayerProps = {
  show3d?: boolean;
};

/**
 * AtmosphericLayer — fixed, pointer-events:none background atmosphere.
 *
 * Obsidian Gold redesign:
 *   • Wrapper inherits position/z-index from `.lc-atmosphere` (in atmosphere.css)
 *   • Adds a self-contained gold radial glow at top (0.03 opacity) + violet at
 *     bottom (0.02 opacity) via inline styles so the look is consistent
 *     regardless of whether the shared atmosphere.css has been updated.
 *   • Keeps the noise + vignette layers from atmosphere.css for texture.
 *   • 3D obsidian scene only renders when `show3d` is true (home page).
 */
export function AtmosphericLayer({ show3d = true }: AtmosphericLayerProps) {
  // Inline-styled glow layer — guarantees the gold/violet palette even if
  // atmosphere.css still has the old crimson gradients.
  const glowStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    background:
      "radial-gradient(ellipse 120% 70% at 50% -10%, rgba(245, 185, 66, 0.03) 0%, transparent 55%)," +
      "radial-gradient(ellipse 80% 60% at 90% 100%, rgba(139, 92, 246, 0.02) 0%, transparent 55%)",
  };

  return (
    <div className="lc-atmosphere" aria-hidden="true">
      {show3d ? (
        <Suspense fallback={null}>
          <ObsidianSceneLazy className="lc-atmosphere__canvas" />
        </Suspense>
      ) : null}
      <div className="lc-atmosphere__fog" />
      <div style={glowStyle} />
      <div className="lc-atmosphere__noise" />
      <div className="lc-atmosphere__vignette" />
    </div>
  );
}
