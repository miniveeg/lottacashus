import { useRef } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { loginUrl } from "../../lib/authRedirect";

/**
 * Gate for any auth-required route. Currently unused in App.tsx (each page
 * that needs auth renders its own `<Navigate to={loginUrl(...)}>` with a
 * hardcoded redirect path), but kept as a reusable utility for future
 * protected routes.
 *
 * - Shows a loading state while the auth bootstrap is in flight (no flash of
 *   protected content).
 * - When the user is not logged in, redirects to
 *   `/login?redirect=<current-path>`. The pathname is captured on the FIRST
 *   render via a ref — once we return <Navigate>, React Router updates the
 *   location but this component stays mounted for one more render, so
 *   `useLocation().pathname` would read the NEW pathname (`/login`) on that
 *   second render and clobber the original redirect param. The ref freezes
 *   the original pathname so the second Navigate is a no-op (same URL).
 *   `loginUrl()` runs the path through `safeRedirectPath` to reject
 *   open-redirect patterns like `//evil.com`.
 */
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isGuest } = useAuth();
  const { pathname } = useLocation();
  const pathnameRef = useRef<string>(pathname);
  // Update the ref whenever we're rendering at a non-/login route (i.e. the
  // "real" protected route). Once we've redirected to /login, the ref stays
  // pinned to the original protected pathname.
  if (pathname !== "/login" && pathname !== pathnameRef.current) {
    pathnameRef.current = pathname;
  }

  if (loading) {
    return (
      <div className="lc-page" style={{ padding: "2rem", color: "var(--lc-text-muted)" }}>
        <div className="lc-loading" role="status" aria-live="polite">
          <div className="lc-loading__pulse" aria-hidden />
          <p>Loading…</p>
        </div>
      </div>
    );
  }

  if (!user || isGuest) {
    return <Navigate to={loginUrl(pathnameRef.current)} replace />;
  }

  return <>{children}</>;
}
