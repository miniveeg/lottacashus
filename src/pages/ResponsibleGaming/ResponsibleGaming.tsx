import { Link } from "react-router-dom";
import { Shield, Clock, Ban, Phone, AlertTriangle, ExternalLink } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { loginUrl } from "../../lib/authRedirect";
import { Seo } from "../../components/Seo/Seo";
import { GlassPanel } from "../../components/GlassPanel/GlassPanel";
import "./ResponsibleGaming.css";

export function ResponsibleGaming() {
  const { user } = useAuth();

  return (
    <div className="lc-page lc-page--narrow responsible-gaming">
      <Seo
        title="Responsible Gaming"
        description="Set deposit limits, take a cooling-off break, or self-exclude. Resources for problem gambling and crisis support."
        path="/responsible-gaming"
      />

      <header className="lc-page__header">
        <h1 className="lc-page__title">Responsible Gaming</h1>
        <p className="lc-page__subtitle">
          LottaCash is built for entertainment. If gambling stops being fun, the tools below let you
          pause, set hard limits, or step away entirely — no support ticket required.
        </p>
      </header>

      <GlassPanel className="responsible-gaming__panel">
        <div className="responsible-gaming__panel-head">
          <Shield size={28} aria-hidden />
          <div>
            <h2 className="responsible-gaming__panel-title">Set your own limits</h2>
            <p className="responsible-gaming__panel-text">
              Deposit limits and self-exclusion are already built into your account settings. You can
              cap how much you deposit per day or per week, or lock yourself out for 30, 90, or 180
              days. Limits cannot be lowered instantly — increases take 24 hours to take effect so
              you have time to reconsider.
            </p>
          </div>
        </div>

        <ul className="responsible-gaming__tools">
          <li>
            <Clock size={20} aria-hidden />
            <div>
              <h3 className="responsible-gaming__tool-title">Deposit limits</h3>
              <p className="responsible-gaming__tool-text">
                Cap daily and weekly crypto deposits. Once a limit is set, deposits that would exceed
                it are blocked at the chain-scan layer.
              </p>
            </div>
          </li>
          <li>
            <Ban size={20} aria-hidden />
            <div>
              <h3 className="responsible-gaming__tool-title">Self-exclusion</h3>
              <p className="responsible-gaming__tool-text">
                Lock your account for 30, 90, or 180 days. During exclusion you cannot log in,
                deposit, or place bets. The exclusion cannot be lifted early.
              </p>
            </div>
          </li>
          <li>
            <AlertTriangle size={20} aria-hidden />
            <div>
              <h3 className="responsible-gaming__tool-title">Session reminders</h3>
              <p className="responsible-gaming__tool-text">
                After one hour of continuous play you will see a non-blocking reminder to take a
                break. The reminder respects your session length, not your wager size.
              </p>
            </div>
          </li>
        </ul>

        {user ? (
          <Link to="/settings#responsible-gaming" className="lc-btn lc-btn--primary responsible-gaming__cta">
            Open limit settings
          </Link>
        ) : (
          <Link to={loginUrl("/settings")} className="lc-btn lc-btn--primary responsible-gaming__cta">
            Log in to manage limits
          </Link>
        )}
      </GlassPanel>

      <GlassPanel className="responsible-gaming__panel">
        <h2 className="responsible-gaming__panel-title">If gambling is causing harm</h2>
        <p className="responsible-gaming__panel-text">
          Problem gambling is a recognized mental health condition. If you or someone you know is
          struggling, free confidential help is available 24/7 from the organizations below. They
          are independent of LottaCash and will not share your information with us.
        </p>

        <ul className="responsible-gaming__resources">
          <li>
            <Phone size={18} aria-hidden />
            <div>
              <h3 className="responsible-gaming__resource-title">
                National Council on Problem Gambling (US)
              </h3>
              <p className="responsible-gaming__resource-text">
                Call <a href="tel:18005224700">1-800-522-4700</a> (24/7, free, confidential) or chat
                online at{" "}
                <a
                  href="https://www.ncpgambling.org/chat"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ncpgambling.org/chat
                </a>
                .
              </p>
            </div>
          </li>
          <li>
            <Phone size={18} aria-hidden />
            <div>
              <h3 className="responsible-gaming__resource-title">
                SAMHSA National Helpline (US)
              </h3>
              <p className="responsible-gaming__resource-text">
                Call <a href="tel:18006624357">1-800-662-4357</a> for free referrals to local
                treatment for gambling, substance use, and mental health.
              </p>
            </div>
          </li>
          <li>
            <ExternalLink size={18} aria-hidden />
            <div>
              <h3 className="responsible-gaming__resource-title">Gamblers Anonymous</h3>
              <p className="responsible-gaming__resource-text">
                Peer-support meetings (in-person and virtual) at{" "}
                <a
                  href="https://www.gamblersanonymous.org"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  gamblersanonymous.org
                </a>
                .
              </p>
            </div>
          </li>
          <li>
            <ExternalLink size={18} aria-hidden />
            <div>
              <h3 className="responsible-gaming__resource-title">GamCare (UK)</h3>
              <p className="responsible-gaming__resource-text">
                Call <a href="tel:08088026520">0808 8020 133</a> or visit{" "}
                <a href="https://www.gamcare.org.uk" target="_blank" rel="noopener noreferrer">
                  gamcare.org.uk
                </a>
                .
              </p>
            </div>
          </li>
        </ul>
      </GlassPanel>

      <GlassPanel className="responsible-gaming__panel responsible-gaming__panel--crisis">
        <h2 className="responsible-gaming__panel-title">In immediate crisis</h2>
        <p className="responsible-gaming__panel-text">
          If you are thinking about harming yourself or someone else, stop and contact emergency
          services now. In the US, call or text <a href="tel:988">988</a> to reach the Suicide &
          Crisis Lifeline. In the UK, call <a href="tel:999">999</a> or{" "}
          <a href="tel:111">111</a>. Elsewhere, contact your local emergency number.
        </p>
      </GlassPanel>

      <GlassPanel className="responsible-gaming__panel">
        <h2 className="responsible-gaming__panel-title">Our commitments</h2>
        <ul className="responsible-gaming__commitments">
          <li>Accounts are restricted to players 18 years or older (or the legal age in your jurisdiction, whichever is higher).</li>
          <li>We do not advertise to self-excluded users and we will not send promotional emails during an active exclusion.</li>
          <li>Deposit limits are enforced server-side; client-side controls cannot be bypassed by modifying the page.</li>
          <li>Self-exclusion is irreversible for the duration you select — there is no &ldquo;early lift&rdquo; path, even via support.</li>
          <li>If we detect patterns consistent with harmful play, we may proactively reach out to suggest a break or limits.</li>
        </ul>
      </GlassPanel>
    </div>
  );
}
