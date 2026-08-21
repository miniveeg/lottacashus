import { Link } from "react-router-dom";
import { PageLayout } from "../../components/PageLayout/PageLayout";
import { Seo } from "../../components/Seo/Seo";
import { GlassPanel } from "../../components/GlassPanel/GlassPanel";
import "./Example.css";

/**
 * Reference implementation of the canonical page template.
 *
 * Every route under AppShell should mirror this structure:
 *
 *   <PageLayout variant="…" title="…" subtitle="…">
 *     …page content…
 *   </PageLayout>
 *
 * AppShell (already wraps all routes) provides:
 *   Topbar · Sidebar · Footer · atmosphere · transitions
 *
 * PageLayout provides:
 *   Consistent padding · max-width · standard header · content body
 *
 * Variants:
 *   default  — full width of main column (Home, Originals, Promotions)
 *   medium   — ~960px (Settings, Leaderboard, Profile)
 *   narrow   — ~720px (Help, legal docs)
 *   game     — full width, compact header, fills viewport (Keno, Mines, …)
 *   auth     — centered card layout (Login, Signup, Forgot Password)
 *   wide     — same as default, explicit no max-width
 */
export function Example() {
  return (
    <PageLayout
      variant="medium"
      eyebrow="Template"
      title="Example page"
      subtitle="This is the layout every LottaCash page should follow. Same shell, same spacing, same header pattern."
    >
      <Seo title="Example layout" path="/_example" noindex />

      <GlassPanel className="example__panel" padding="lg">
        <h2 className="example__h2">What this page demonstrates</h2>
        <ul className="example__list">
          <li>
            <strong>AppShell</strong> — Topbar, sidebar, and footer are always present. Do not
            re-implement them inside a page.
          </li>
          <li>
            <strong>PageLayout</strong> — Use this component for padding, width, and the page
            header. Pick a <code>variant</code> that matches the content type.
          </li>
          <li>
            <strong>Header</strong> — Title + optional subtitle + optional eyebrow. Games use a
            compact header via <code>variant="game"</code>.
          </li>
          <li>
            <strong>Body</strong> — Your content only. Prefer <code>lc-panel</code> /{" "}
            <code>GlassPanel</code> for cards and <code>lc-btn</code> for actions.
          </li>
        </ul>
      </GlassPanel>

      <section className="example__variants">
        <h2 className="example__h2">Variant cheatsheet</h2>
        <div className="example__grid">
          {(
            [
              ["default", "Home, Originals, Promotions"],
              ["medium", "Settings, Profile, Leaderboard"],
              ["narrow", "Help, Privacy, Sweepstakes"],
              ["game", "Keno, Mines, Crash, …"],
              ["auth", "Login, Signup, Forgot password"],
            ] as const
          ).map(([name, use]) => (
            <div key={name} className="example__card">
              <code className="example__code">{name}</code>
              <p className="example__card-text">{use}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="example__actions">
        <Link to="/" className="lc-btn lc-btn--primary">
          Back to home
        </Link>
        <Link to="/help" className="lc-btn lc-btn--secondary">
          Help (narrow example)
        </Link>
        <Link to="/keno" className="lc-btn lc-btn--ghost">
          Keno (game example)
        </Link>
      </section>
    </PageLayout>
  );
}
