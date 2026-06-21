import { Navigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { loginUrl } from "../../lib/authRedirect";

/**
 * Gate for the `/admin` route.
 *
 * - While the auth check OR profile fetch is in flight, render a loading state
 *   (never a flash of admin content).
 * - If the user is not logged in, redirect to `/login?redirect=/admin`.
 *   The redirect path is hardcoded (NOT `useLocation().pathname`) for the same
 *   reason documented in `pages/Settings/Settings.tsx`: when this component
 *   returns `<Navigate>`, React Router updates the location, but this
 *   component stays mounted for one more render — so `useLocation()` would
 *   return the NEW pathname (`/login`) on that second render, clobbering the
 *   original `?redirect=%2Fadmin` param with `?redirect=%2Flogin` and breaking
 *   the post-login deep link back to `/admin`.
 * - If the user is logged in but is not an admin, redirect to home.
 *
 * NOTE: This is a client-side convenience check only. Real authorization MUST
 * be enforced server-side via Supabase RLS policies and `is_current_user_admin`
 * on every admin RPC — client checks can be bypassed by anyone who opens DevTools.
 */
export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { profile, profileLoading } = useProfile();

  // Treat "user set but profile not yet arrived" as still-loading so we don't
  // briefly flash a redirect-to-home on the render between AuthContext setting
  // `user` and ProfileContext's first `setProfile(...)` landing.
  const waitingForProfile = Boolean(user) && !profile;

  if (authLoading || profileLoading || waitingForProfile) {
    return (
      <div className="lc-loading admin-route-loading" role="status" aria-live="polite">
        <div className="lc-loading__pulse" aria-hidden />
        <p>Loading…</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to={loginUrl("/admin")} replace />;
  }

  if (!profile?.isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
