import { useEffect, useState, useRef, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { safeRedirectPath } from "../../lib/authRedirect";
import { BrandLogo } from "../../components/BrandLogo/BrandLogo";
import { PageLayout } from "../../components/PageLayout/PageLayout";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { analytics } from "../../lib/analytics";
import { FormAlert } from "../../components/FormAlert/FormAlert";
import { Seo } from "../../components/Seo/Seo";
import "../../components/BrandLogo/BrandLogo.css";
import "../Auth/Auth.css";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;

type AttemptEntry = { at: number };

export function Login() {
  const { signIn, user, loading, configured, isGuest } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = safeRedirectPath(searchParams.get("redirect"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const attemptsRef = useRef<AttemptEntry[]>([]);

  const submittingRef = useRef(false);
  submittingRef.current = submitting;
  const configuredRef = useRef(configured);
  configuredRef.current = configured;
  const formRef = useRef<HTMLFormElement | null>(null);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key !== "Enter") return;
      if (e.altKey || e.shiftKey) return;
      if (submittingRef.current || !configuredRef.current) return;
      const f = formRef.current;
      if (!f) return;
      e.preventDefault();
      f.requestSubmit();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (loading) {
    return (
      <PageLayout variant="auth" className="auth-page" hideHeader>
        <div className="lc-loading">
          <div className="lc-loading__pulse" aria-hidden />
          <p>Loading…</p>
        </div>
      </PageLayout>
    );
  }

  if (user && !isGuest) {
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

    const now = Date.now();
    attemptsRef.current = attemptsRef.current.filter((a) => now - a.at < WINDOW_MS);
    if (attemptsRef.current.length >= MAX_ATTEMPTS) {
      const oldest = attemptsRef.current[0]!.at;
      const retryIn = Math.ceil((WINDOW_MS - (now - oldest)) / 1000);
      const msg = `Too many login attempts. Try again in ${retryIn} second${retryIn === 1 ? "" : "s"}.`;
      setError(msg);
      toast.error(msg);
      return;
    }
    attemptsRef.current.push({ at: now });

    setSubmitting(true);
    const { error: authError } = await signIn(trimmedEmail, password);
    setSubmitting(false);

    if (authError) {
      setError(authError);
      toast.error(authError);
      return;
    }

    attemptsRef.current = [];
    analytics.login.success();
    toast.success("Welcome back!");
    navigate(redirectTo, { replace: true });
  }

  return (
    <PageLayout variant="auth" className="auth-page" hideHeader>
      <Seo title="Log in" path="/login" noindex />
      <div className="auth-card">
        <BrandLogo className="auth-card__logo" size={72} />
        <h1 className="auth-card__title">Welcome back</h1>
        <p className="auth-card__subtitle">Log in to your LottaCash account</p>

        {!configured && (
          <FormAlert kind="warning">
            {import.meta.env.PROD ? (
              "Service temporarily unavailable. Please try again later."
            ) : (
              <>
                Supabase is not configured. Add your project URL and anon key to the{" "}
                <code>.env</code> file to enable authentication.
              </>
            )}
          </FormAlert>
        )}

        <form className="auth-form" onSubmit={handleSubmit} noValidate ref={formRef}>
          {error && <FormAlert id="login-error">{error}</FormAlert>}

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
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={error ? "login-error" : undefined}
            />
            <div className="auth-field__row">
              <label className="auth-checkbox auth-checkbox--inline">
                <input
                  type="checkbox"
                  checked={showPassword}
                  onChange={(e) => setShowPassword(e.target.checked)}
                  aria-label="Show password while typing"
                />
                <span>Show password</span>
              </label>
              <p className="auth-forgot">
                <Link to="/forgot-password">Forgot password?</Link>
              </p>
            </div>
          </div>

          <button type="submit" className="auth-submit" disabled={submitting || !configured}>
            {submitting && <span className="auth-submit__spinner" aria-hidden="true" />}
            {submitting ? "Logging in…" : "Log in"}
          </button>
        </form>

        <p className="lc-hotkey-hint" role="note">
          <span className="lc-hotkey-hint__combo">
            <kbd>{typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl"}</kbd>
            <kbd>↵</kbd>
          </span>
          <span>log in</span>
        </p>

        <p className="auth-footer">
          Don't have an account? <Link to="/signup">Sign up</Link>
        </p>
      </div>
    </PageLayout>
  );
}
