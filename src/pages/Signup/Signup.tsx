import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { loginUrlFromSearchParams, safeRedirectPath } from "../../lib/authRedirect";
import {
  clearStoredAffiliateRef,
  getStoredAffiliateRef,
  normalizeAffiliateCode,
  storeAffiliateRef,
} from "../../lib/affiliateRef";
import { BrandLogo } from "../../components/BrandLogo/BrandLogo";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { analytics } from "../../lib/analytics";
import { MAX_USERNAME_LENGTH, normalizeUsername, validateUsername } from "../../lib/username";
import { FormAlert } from "../../components/FormAlert/FormAlert";
import { Seo } from "../../components/Seo/Seo";
import "../../components/BrandLogo/BrandLogo.css";
import "../Auth/Auth.css";

type Step = "details" | "verify";

export function Signup() {
  const { sendSignupCode, completeSignup, user, loading, configured, isGuest } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = safeRedirectPath(searchParams.get("redirect"));
  const [referralCode, setReferralCode] = useState(() => getStoredAffiliateRef() ?? "");

  useEffect(() => {
    const fromUrl = searchParams.get("ref");
    if (!fromUrl) return;
    const code = normalizeAffiliateCode(fromUrl);
    if (code) {
      storeAffiliateRef(code);
      setReferralCode(code);
    }
  }, [searchParams]);

  const [step, setStep] = useState<Step>("details");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [birthDate, setBirthDate] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <div className="auth-page lc-page lc-page--auth">
        <div className="lc-loading">
          <div className="lc-loading__pulse" aria-hidden />
          <p>Loading…</p>
        </div>
      </div>
    );
  }

  // Offline guests are still "users" for local play — only real sessions skip signup.
  if (user && !isGuest) {
    return <Navigate to={redirectTo} replace />;
  }

  async function handleSendCode(e: FormEvent) {
    e.preventDefault();
    if (!configured) return;
    setError(null);

    const trimmedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Enter a valid email address.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    if (!ageConfirmed) {
      setError("You must confirm that you are 18 or older.");
      return;
    }

    if (!birthDate) {
      setError("Enter your date of birth.");
      return;
    }

    const birth = new Date(birthDate);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    if (age < 18) {
      setError("You must be at least 18 years old to register.");
      return;
    }

    const trimmedUsername = username.trim();
    if (trimmedUsername) {
      const usernameError = validateUsername(trimmedUsername);
      if (usernameError) {
        setError(usernameError);
        return;
      }
    }

    setSubmitting(true);
    analytics.signup.started();
    const { error: sendError } = await sendSignupCode(
      trimmedEmail,
      trimmedUsername ? normalizeUsername(trimmedUsername) : undefined,
      birthDate || undefined
    );
    setSubmitting(false);

    if (sendError) {
      setError(sendError);
      return;
    }

    setStep("verify");
    setCode("");
  }

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    if (!configured) return;
    setError(null);

    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your email.");
      return;
    }

    const trimmedUsername = username.trim();
    if (trimmedUsername) {
      const usernameError = validateUsername(trimmedUsername);
      if (usernameError) {
        setError(usernameError);
        return;
      }
    }

    setSubmitting(true);
    const ref = referralCode.trim() ? normalizeAffiliateCode(referralCode) : undefined;
    const { error: verifyError } = await completeSignup(
      email.trim(),
      code,
      password,
      trimmedUsername ? normalizeUsername(trimmedUsername) : undefined,
      ref || undefined,
      birthDate || undefined
    );
    setSubmitting(false);

    if (verifyError) {
      setError(verifyError);
      toast.error(verifyError);
      return;
    }

    analytics.signup.completed(trimmedUsername || undefined);
    toast.success("Account created — welcome to LottaCash!");
    clearStoredAffiliateRef();
    navigate(redirectTo, { replace: true });
  }

  async function handleResend() {
    if (!configured) return;
    setError(null);
    setSubmitting(true);
    const trimmedUsername = username.trim();
    const { error: sendError } = await sendSignupCode(
      email.trim(),
      trimmedUsername ? normalizeUsername(trimmedUsername) : undefined
    );
    setSubmitting(false);
    if (sendError) setError(sendError);
    else toast.success("A new code has been sent to your email.");
  }

  return (
    <div className="auth-page lc-page lc-page--auth">
      <Seo title="Create account" path="/signup" noindex />
      <div className="auth-card">
        <BrandLogo className="auth-card__logo" size={72} />
        <h1 className="auth-card__title">Join LottaCash</h1>
        <p className="auth-card__subtitle">
          {step === "details"
            ? "Create your account and claim your welcome bonus"
            : `Enter the 6-digit code we sent to ${email}`}
        </p>

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

        <div className="auth-steps" aria-hidden="true">
          <span className={`auth-steps__dot${step === "details" ? " auth-steps__dot--active" : " auth-steps__dot--done"}`}>1</span>
          <span className="auth-steps__sep" />
          <span className={`auth-steps__dot${step === "verify" ? " auth-steps__dot--active" : ""}`}>2</span>
        </div>

        {step === "details" ? (
          <form className="auth-form" onSubmit={handleSendCode} noValidate>
            {error && <FormAlert id="signup-error">{error}</FormAlert>}

            <div className="auth-field">
              <label htmlFor="signup-email">Email</label>
              <input
                id="signup-email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={error ? "signup-error" : undefined}
              />
            </div>

            <div className="auth-field">
              <label htmlFor="signup-username">Username (optional)</label>
              <input
                id="signup-username"
                type="text"
                autoComplete="username"
                placeholder="Your display name"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                maxLength={MAX_USERNAME_LENGTH}
                aria-describedby="signup-username-hint"
              />
              <p className="auth-field-hint" id="signup-username-hint">
                {username.length}/{MAX_USERNAME_LENGTH} characters
              </p>
            </div>

            <div className="auth-field">
              <label htmlFor="signup-password">Password</label>
              <input
                id="signup-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={error ? "signup-error" : undefined}
              />
            </div>

            <div className="auth-field">
              <label htmlFor="signup-confirm">Confirm password</label>
              <input
                id="signup-confirm"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Repeat password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={error ? "signup-error" : undefined}
              />
            </div>

            <label className="auth-checkbox">
              <input
                type="checkbox"
                checked={showPassword}
                onChange={(e) => setShowPassword(e.target.checked)}
                aria-label="Show password while typing"
              />
              <span>Show passwords while typing</span>
            </label>

            <div className="auth-field">
              <label htmlFor="signup-birthdate">Date of birth</label>
              <input
                id="signup-birthdate"
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                required
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={error ? "signup-error" : undefined}
              />
            </div>

            <label className="auth-checkbox">
              <input
                type="checkbox"
                checked={ageConfirmed}
                onChange={(e) => setAgeConfirmed(e.target.checked)}
                required
                aria-invalid={Boolean(error) || undefined}
              />
              <span>I confirm that I am 18 years or older and agree to the{" "}
                <Link to="/sweepstakes" target="_blank" className="auth-checkbox-link">
                  Sweepstakes Rules
                </Link>
                {" "}and{" "}
                <Link to="/privacy" target="_blank" className="auth-checkbox-link">
                  Privacy Policy
                </Link>
              </span>
            </label>

            <details className="auth-field auth-field--optional">
              <summary className="auth-field__summary">Affiliate / referral code (optional)</summary>
              <input
                id="signup-referral"
                type="text"
                autoComplete="off"
                placeholder="e.g. ABC12DEF"
                value={referralCode}
                onChange={(e) => setReferralCode(normalizeAffiliateCode(e.target.value))}
                maxLength={32}
              />
              <p className="auth-field-hint">
                {referralCode
                  ? "This code will be linked to your account when you finish signup."
                  : "Have a friend's code? Enter it now — you can only set it once."}
              </p>
            </details>

            <button type="submit" className="auth-submit" disabled={submitting || !configured}>
              {submitting && <span className="auth-submit__spinner" aria-hidden="true" />}
              {submitting ? "Sending code…" : "Send verification code"}
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={handleVerify} noValidate>
            {error && <FormAlert id="signup-verify-error">{error}</FormAlert>}

            <p className="auth-hint">Code expires in 10 minutes.</p>

            <div className="auth-field">
              <label htmlFor="signup-referral-verify">Affiliate / referral code (optional)</label>
              <input
                id="signup-referral-verify"
                type="text"
                autoComplete="off"
                placeholder="Friend's code"
                value={referralCode}
                onChange={(e) => setReferralCode(normalizeAffiliateCode(e.target.value))}
                maxLength={32}
              />
              <p className="auth-field-hint">
                {referralCode
                  ? `Using code "${referralCode}" — change it here if needed before you verify.`
                  : "You can still add a referral code before creating your account."}
              </p>
            </div>

            <div className="auth-field">
              <label htmlFor="signup-code">Verification code</label>
              <input
                id="signup-code"
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
                aria-describedby={error ? "signup-verify-error" : undefined}
              />
            </div>

            <button type="submit" className="auth-submit" disabled={submitting || !configured}>
              {submitting && <span className="auth-submit__spinner" aria-hidden="true" />}
              {submitting ? "Verifying…" : "Verify & create account"}
            </button>

            <div className="auth-secondary-actions">
              <button
                type="button"
                className="auth-link-btn"
                onClick={() => {
                  setStep("details");
                  setError(null);
                }}
                disabled={submitting}
              >
                ← Change email
              </button>
              <button
                type="button"
                className="auth-link-btn"
                onClick={handleResend}
                disabled={submitting}
              >
                Resend code
              </button>
            </div>
          </form>
        )}

        <p className="auth-footer">
          Already have an account? <Link to={loginUrlFromSearchParams(searchParams)}>Log in</Link>
        </p>
      </div>
    </div>
  );
}
