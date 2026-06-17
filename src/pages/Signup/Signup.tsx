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
import "../../components/BrandLogo/BrandLogo.css";
import "../Auth/Auth.css";

type Step = "details" | "verify";

export function Signup() {
  const { sendSignupCode, completeSignup, user, loading, configured } = useAuth();
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
  const [birthDate, setBirthDate] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [code, setCode] = useState("");
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

  async function handleSendCode(e: FormEvent) {
    e.preventDefault();
    setError(null);

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
      email.trim(),
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

    analytics.signup.completed(username);
    toast.success("Account created — welcome to LottaCash!");
    clearStoredAffiliateRef();
    navigate(redirectTo, { replace: true });
  }

  async function handleResend() {
    setError(null);
    setSubmitting(true);
    const trimmedUsername = username.trim();
    const { error: sendError } = await sendSignupCode(
      email.trim(),
      trimmedUsername ? normalizeUsername(trimmedUsername) : undefined
    );
    setSubmitting(false);
    if (sendError) setError(sendError);
  }

  return (
    <div className="auth-page lc-page--auth">
      <div className="auth-card">
        <BrandLogo className="auth-card__logo" size={72} />
        <h1 className="auth-card__title">Join LottaCash</h1>
        <p className="auth-card__subtitle">
          {step === "details"
            ? "Create your account and claim your welcome bonus"
            : `Enter the 6-digit code we sent to ${email}`}
        </p>

        {!configured && (
          <p className="auth-config-warning">
            Supabase keys are missing. Copy <code>.env.example</code> to <code>.env</code> and add
            your project URL and anon key.
          </p>
        )}

        {step === "details" ? (
          <form className="auth-form" onSubmit={handleSendCode}>
            {error && <p className="auth-error" role="alert">{error}</p>}

            <div className="auth-field">
              <label htmlFor="signup-username">Username</label>
              <input
                id="signup-username"
                type="text"
                autoComplete="username"
                placeholder="Your display name"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                maxLength={MAX_USERNAME_LENGTH}
              />
              <p className="auth-field-hint">Up to {MAX_USERNAME_LENGTH} characters</p>
            </div>

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
              />
            </div>

            <div className="auth-field">
              <label htmlFor="signup-password">Password</label>
              <input
                id="signup-password"
                type="password"
                autoComplete="new-password"
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>

            <div className="auth-field">
              <label htmlFor="signup-referral">Affiliate / referral code (optional)</label>
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
            </div>

            <div className="auth-field">
              <label htmlFor="signup-confirm">Confirm password</label>
              <input
                id="signup-confirm"
                type="password"
                autoComplete="new-password"
                placeholder="Repeat password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>

            <div className="auth-field">
              <label htmlFor="signup-birthdate">Date of birth</label>
              <input
                id="signup-birthdate"
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                required
              />
            </div>

            <label className="auth-checkbox">
              <input
                type="checkbox"
                checked={ageConfirmed}
                onChange={(e) => setAgeConfirmed(e.target.checked)}
                required
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

            <button type="submit" className="auth-submit" disabled={submitting || !configured}>
              {submitting ? "Sending code…" : "Send verification code"}
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={handleVerify}>
            {error && <p className="auth-error" role="alert">{error}</p>}

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
              />
            </div>

            <button type="submit" className="auth-submit" disabled={submitting || !configured}>
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
