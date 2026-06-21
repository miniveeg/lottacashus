import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { BrandLogo } from "../../components/BrandLogo/BrandLogo";
import { useAuth } from "../../contexts/AuthContext";
import { requestPasswordResetCode, resetPasswordWithCode } from "../../lib/passwordReset";
import "../../components/BrandLogo/BrandLogo.css";
import "../Auth/Auth.css";

type Step = "email" | "code" | "password" | "done";

export function ForgotPassword() {
  const { signIn, user, loading: authLoading, configured } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (authLoading) {
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
    return <Navigate to="/" replace />;
  }

  async function handleSendCode(e: FormEvent) {
    e.preventDefault();
    if (!configured) return;
    setError(null);
    setInfo(null);

    const trimmedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Enter a valid email address.");
      return;
    }

    setSubmitting(true);
    const { error: sendError } = await requestPasswordResetCode(trimmedEmail);
    setSubmitting(false);
    if (sendError) {
      setError(sendError);
      return;
    }
    setInfo("If an account exists for this email, we sent a 6-digit code. It expires in 10 minutes.");
    setStep("code");
    setCode("");
  }

  function handleCodeContinue(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setStep("password");
    setPassword("");
    setConfirmPassword("");
  }

  async function handleResetPassword(e: FormEvent) {
    e.preventDefault();
    if (!configured) return;
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setSubmitting(true);
    const { error: resetError } = await resetPasswordWithCode(email.trim(), code, password);
    if (resetError) {
      setSubmitting(false);
      setError(resetError);
      return;
    }

    const { error: signInError } = await signIn(email.trim(), password);
    setSubmitting(false);

    if (signInError) {
      setStep("done");
      setInfo("Password updated. You can log in with your new password.");
      return;
    }

    navigate("/", { replace: true });
  }

  async function handleResend() {
    if (!configured) return;
    setError(null);
    setSubmitting(true);
    const { error: sendError } = await requestPasswordResetCode(email.trim());
    setSubmitting(false);
    if (sendError) setError(sendError);
    else setInfo("A new code has been sent.");
  }

  return (
    <div className="auth-page lc-page--auth">
      <div className="auth-card">
        <BrandLogo className="auth-card__logo" size={72} />
        <h1 className="auth-card__title">Reset password</h1>
        <p className="auth-card__subtitle">
          {step === "email" && "Enter your account email"}
          {step === "code" && `Enter the code we sent to ${email}`}
          {step === "password" && "Choose a new password"}
          {step === "done" && "You're all set"}
        </p>

        {!configured && (
          <p className="auth-config-warning" role="note">
            Supabase is not configured. Add your project URL and anon key to the{" "}
            <code>.env</code> file to enable authentication.
          </p>
        )}

        {step === "email" && (
          <form className="auth-form" onSubmit={handleSendCode} noValidate>
            {error && <p className="auth-error" role="alert" id="reset-error">{error}</p>}
            <div className="auth-field">
              <label htmlFor="reset-email">Email</label>
              <input
                id="reset-email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={error ? "reset-error" : undefined}
              />
            </div>
            <button type="submit" className="auth-submit" disabled={submitting || !configured}>
              {submitting && <span className="auth-submit__spinner" aria-hidden="true" />}
              {submitting ? "Sending…" : "Send reset code"}
            </button>
          </form>
        )}

        {step === "code" && (
          <form className="auth-form" onSubmit={handleCodeContinue} noValidate>
            {error && <p className="auth-error" role="alert" id="reset-code-error">{error}</p>}
            {info && <p className="auth-success" role="status">{info}</p>}
            <p className="auth-hint">Code expires in 10 minutes.</p>
            <div className="auth-field">
              <label htmlFor="reset-code">Reset code</label>
              <input
                id="reset-code"
                className="auth-code-input"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                maxLength={6}
                required
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={error ? "reset-code-error" : undefined}
              />
            </div>
            <button type="submit" className="auth-submit" disabled={submitting || !configured}>
              Continue
            </button>
            <div className="auth-secondary-actions">
              <button type="button" className="auth-link-btn" onClick={() => setStep("email")}>
                ← Change email
              </button>
              <button
                type="button"
                className="auth-link-btn"
                onClick={handleResend}
                disabled={submitting}
              >
                {submitting && <span className="auth-submit__spinner" aria-hidden="true" />}
                Resend code
              </button>
            </div>
          </form>
        )}

        {step === "password" && (
          <form className="auth-form" onSubmit={handleResetPassword} noValidate>
            {error && <p className="auth-error" role="alert" id="reset-pwd-error">{error}</p>}
            <p className="auth-hint">
              For security, your old password cannot be shown. Set a new one below.
            </p>

            <label className="auth-checkbox">
              <input
                type="checkbox"
                checked={showPassword}
                onChange={(e) => setShowPassword(e.target.checked)}
              />
              <span>Show password while typing</span>
            </label>

            <div className="auth-field">
              <label htmlFor="reset-password">New password</label>
              <input
                id="reset-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={error ? "reset-pwd-error" : undefined}
              />
            </div>

            <div className="auth-field">
              <label htmlFor="reset-confirm">Confirm new password</label>
              <input
                id="reset-confirm"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Repeat password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={error ? "reset-pwd-error" : undefined}
              />
            </div>

            <button type="submit" className="auth-submit" disabled={submitting || !configured}>
              {submitting && <span className="auth-submit__spinner" aria-hidden="true" />}
              {submitting ? "Updating…" : "Update password"}
            </button>
            <div className="auth-secondary-actions">
              <button type="button" className="auth-link-btn" onClick={() => setStep("code")}>
                ← Back to code
              </button>
            </div>
          </form>
        )}

        {step === "done" && info && (
          <p className="auth-success" role="status">
            {info}
          </p>
        )}

        <p className="auth-footer">
          <Link to="/login">← Back to log in</Link>
        </p>
      </div>
    </div>
  );
}
