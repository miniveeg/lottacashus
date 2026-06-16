import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { loginUrl } from "../../lib/authRedirect";

export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { profile, profileLoading } = useProfile();
  const { pathname } = useLocation();

  if (authLoading || profileLoading) {
    return (
      <div className="lc-loading admin-route-loading" role="status" aria-live="polite">
        <div className="lc-loading__pulse" aria-hidden />
        <p>Loading…</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to={loginUrl(pathname)} replace />;
  }

  if (!profile?.isAdmin) {
    return <Navigate to="/" replace />;
  }

  return children;
}
