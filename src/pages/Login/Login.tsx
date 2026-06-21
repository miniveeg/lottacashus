import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { safeRedirectPath } from "../../lib/authRedirect";
import { BrandLogo } from "../../components/BrandLogo/BrandLogo";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { analytics } from "../../lib/analytics";
import "../../components/BrandLogo/BrandLogo.css";
import "../Auth/Auth.css";

export function Login() {
  const { signIn, user, loading, configured } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = safeRedirectPath(searchParams.get("redirect"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <div className="auth-page lc-page--auth">
        <div className="lc-loading">
          <div className="lc-loading__pulse" aria-hidden />
          <p>Loading…</p>
        </div>
      </div>
    );
  }

  if (user) {
    return <Navigate to={redirectTo} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!configured) return;
    setError(null);

    const trimmedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }

    setSubmitting(true);
    const { error: authError } = await signIn(trimmedEmail, password);
    setSubmitting(false);

    if (authError) {
      setError(authError);
      toast.error(authError);
      return;
    }

    analytics.login.success();
    toast.success("Welcome back!");
    navigate(redirectTo, { replace: true });
  }

  return (
    <div className="auth-page lc-page--auth">
      <div className="auth-card">
        <BrandLogo className="auth-card__logo" size={72} />
        <h1 className="auth-card__title">Welcome back</h1>
        <p className="auth-card__subtitle">Log in to your LottaCash account</p>

        {!configured && (
          <p className="auth-config-warning" role="note">
            Supabase is not configured. Add your project URL and anon key to the{" "}
            <code>.env</code> file to enable authentication.
          </p>
        )}

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {error && <p className="auth-error" role="alert" id="login-error">{error}</p>}

          <div className="auth-field">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={error ? "login-error" : undefined}
            />
          </div>

          <div className="auth-field">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={error ? "login-error" : undefined}
            />
            <p className="auth-forgot">
              <Link to="/forgot-password">Forgot password?</Link>
            </p>
          </div>

          <button type="submit" className="auth-submit" disabled={submitting || !configured}>
            {submitting && <span className="auth-submit__spinner" aria-hidden="true" />}
            {submitting ? "Logging in…" : "Log in"}
          </button>
        </form>

        <p className="auth-footer">
          Don&apos;t have an account? <Link to="/signup">Sign up</Link>
        </p>
      </div>
    </div>
  );
}
