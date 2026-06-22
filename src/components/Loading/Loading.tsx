/**
 * Loading indicator — pulsing crimson/violet square with optional label.
 *
 * The styles for `.lc-loading` and `.lc-loading__pulse` previously lived in
 * `src/styles/global.css` alongside resets and base styles. They have been
 * moved here so the loading pattern is co-located with its component and
 * can be imported on demand rather than relying on the global cascade.
 *
 * The keyframe `lc-loading-pulse` is also defined here (it was duplicated
 * in global.css).
 */
import "./Loading.css";

interface LoadingProps {
  /** Optional message shown under the pulse. */
  label?: string;
  /** Minimum height so the loading state occupies layout even when empty. */
  minHeight?: string;
}

export function Loading({ label = "Loading…", minHeight }: LoadingProps) {
  return (
    <div
      className="lc-loading"
      role="status"
      aria-live="polite"
      style={minHeight ? { minHeight } : undefined}
    >
      <div className="lc-loading__pulse" aria-hidden />
      <p>{label}</p>
    </div>
  );
}
