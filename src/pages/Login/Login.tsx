import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Coins, ShieldCheck, Sparkles } from "lucide-react";
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
        <div className="auth-form-side">
          <div className="lc-loading">
            <div className="lc-loading__pulse" aria-hidden />
            <p>Loading…</p>
          </div>
        </div>
      </div>
    );
  }

  if (user) {
    return <Navigate to={redirectTo} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const { error: authError } = await signIn(email.trim(), password);
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
      <aside className="auth-visual" aria-hidden="true">
        <div className="auth-visual__inner">
          <BrandLogo className="auth-visual__logo" size={56} />
          <h2 className="auth-visual__headline">Play smarter.<br />Cash out faster.</h2>
          <p className="auth-visual__lede">
            LottaCash is the obsidian-class social casino with instant crypto deposits,
            provably-fair games, and Sweeps Coins you can redeem for real cash.
          </p>
          <div className="auth-visual__props">
            <div className="auth-prop">
              <div className="auth-prop__icon"><Coins size={18} /></div>
              <div className="auth-prop__text">
                <p className="auth-prop__title">Dual-currency wallet</p>
                <p className="auth-prop__desc">Gold Coins for play, Sweeps Coins for cash.</p>
              </div>
            </div>
            <div className="auth-prop">
              <div className="auth-prop__icon"><ShieldCheck size={18} /></div>
              <div className="auth-prop__text">
                <p className="auth-prop__title">Provably fair</p>
                <p className="auth-prop__desc">Every spin, crash, and battle is verifiable.</p>
              </div>
            </div>
            <div className="auth-prop">
              <div className="auth-prop__icon"><Sparkles size={18} /></div>
              <div className="auth-prop__text">
                <p className="auth-prop__title">Level up & earn</p>
                <p className="auth-prop__desc">Wager more, climb tiers, unlock perks.</p>
              </div>
            </div>
          </div>
        </div>
      </aside>
      <div className="auth-form-side">
      <div className="auth-card">
        <BrandLogo className="auth-card__logo" size={48} />
        <h1 className="auth-card__title">Welcome back</h1>
        <p className="auth-card__subtitle">
          Log in to your LottaCash account to continue playing.
        </p>

        {!configured && (
          <p className="auth-config-warning">
            Supabase keys are missing. Copy <code>.env.example</code> to <code>.env</code> and add
            your project URL and anon key.
          </p>
        )}

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {error && (
            <p className="auth-error" role="alert" id="login-error">
              {error}
            </p>
          )}

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
    </div>
  );
}
