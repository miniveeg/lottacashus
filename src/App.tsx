
import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { AuthProvider } from "./contexts/AuthContext";
import { NotificationsProvider } from "./contexts/NotificationsContext";
import { PlayModeProvider } from "./contexts/PlayModeContext";
import { ProfileProvider } from "./contexts/ProfileContext";
import { ToastProvider } from "./contexts/ToastContext";
import { ToastRegion } from "./components/Toast/Toast";
import { AppShell } from "./components/AppShell/AppShell";
import { AdminRoute } from "./components/AdminRoute/AdminRoute";
import { Home } from "./pages/Home/Home";
import { Login } from "./pages/Login/Login";
import { Signup } from "./pages/Signup/Signup";
import { Settings } from "./pages/Settings/Settings";
import { ForgotPassword } from "./pages/ForgotPassword/ForgotPassword";
import { Deposit } from "./pages/Deposit/Deposit";
import { Withdraw } from "./pages/Withdraw/Withdraw";
import { Help } from "./pages/Help/Help";
import { Originals } from "./pages/Originals/Originals";

const Keno = lazy(() => import("./pages/Keno/Keno").then((m) => ({ default: m.Keno })));
const Mines = lazy(() => import("./pages/Mines/Mines").then((m) => ({ default: m.Mines })));
const Limbo = lazy(() => import("./pages/Limbo/Limbo").then((m) => ({ default: m.Limbo })));
const Roulette = lazy(() => import("./pages/Roulette/Roulette").then((m) => ({ default: m.Roulette })));
const Blackjack = lazy(() => import("./pages/Blackjack/Blackjack").then((m) => ({ default: m.Blackjack })));
const Crash = lazy(() => import("./pages/Crash/Crash").then((m) => ({ default: m.Crash })));
const Slots = lazy(() => import("./pages/Slots/Slots"));
const CaseBattlesCreate = lazy(() =>
  import("./pages/CaseBattles/CaseBattlesCreateV2").then((m) => ({ default: m.CaseBattlesCreateV2 }))
);
const CaseBattlesHub = lazy(() =>
  import("./pages/CaseBattles/CaseBattlesHubV2").then((m) => ({ default: m.CaseBattlesHubV2 }))
);
const CaseBattlesRoom = lazy(() =>
  import("./pages/CaseBattles/CaseBattlesRoomV2").then((m) => ({ default: m.CaseBattlesRoomV2 }))
);
const Admin = lazy(() => import("./pages/Admin/Admin").then((m) => ({ default: m.Admin })));
const Promotions = lazy(() => import("./pages/Promotions/Promotions").then((m) => ({ default: m.Promotions })));
const Leaderboard = lazy(() => import("./pages/Leaderboard/Leaderboard").then((m) => ({ default: m.Leaderboard })));
const ProfilePage = lazy(() => import("./pages/Profile/Profile").then((m) => ({ default: m.ProfilePage })));
const NotFound = lazy(() => import("./pages/NotFound/NotFound").then((m) => ({ default: m.NotFound })));
const Privacy = lazy(() => import("./pages/Privacy/Privacy").then((m) => ({ default: m.Privacy })));
const SweepstakesRules = lazy(() =>
  import("./pages/SweepstakesRules/SweepstakesRules").then((m) => ({ default: m.SweepstakesRules }))
);
const Redeem = lazy(() => import("./pages/Redeem/Redeem"));
const ResponsibleGaming = lazy(() =>
  import("./pages/ResponsibleGaming/ResponsibleGaming").then((m) => ({ default: m.ResponsibleGaming }))
);
const Example = lazy(() => import("./pages/Example/Example").then((m) => ({ default: m.Example })));

function PageFallback() {
  return (
    <div className="lc-page">
      <div className="lc-loading" role="status" aria-live="polite">
        <div className="lc-loading__pulse" aria-hidden />
        <p>Loading…</p>
      </div>
    </div>
  );
}

function LazyPage({ children }: { children: ReactNode; label?: string }) {
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>;
}

function Shell({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

export default function App() {
  return (
    <BrowserRouter>
      <HelmetProvider>
        <AuthProvider>
          <ProfileProvider>
            <PlayModeProvider>
              <NotificationsProvider>
                <ToastProvider>
                  <ToastRegion />
                  <Routes>
                  <Route path="/" element={<Shell><Home /></Shell>} />
                  <Route path="/login" element={<Shell><Login /></Shell>} />
                  <Route path="/signup" element={<Shell><Signup /></Shell>} />
                  <Route path="/settings" element={<Shell><Settings /></Shell>} />
                  <Route path="/forgot-password" element={<Shell><ForgotPassword /></Shell>} />
                  <Route path="/deposit" element={<Shell><Deposit /></Shell>} />
                  <Route path="/withdraw" element={<Shell><Withdraw /></Shell>} />
                  <Route path="/help" element={<Shell><Help /></Shell>} />
                  <Route path="/originals" element={<Shell><Originals /></Shell>} />

                  {/* Canonical layout reference — same shell as every other route */}
                  <Route
                    path="/_example"
                    element={<Shell><LazyPage><Example /></LazyPage></Shell>}
                  />

                  <Route
                    path="/keno"
                    element={<Shell><LazyPage label="Loading Keno…"><Keno /></LazyPage></Shell>}
                  />
                  <Route
                    path="/mines"
                    element={<Shell><LazyPage label="Loading Mines…"><Mines /></LazyPage></Shell>}
                  />
                  <Route
                    path="/limbo"
                    element={<Shell><LazyPage label="Loading Limbo…"><Limbo /></LazyPage></Shell>}
                  />
                  <Route
                    path="/roulette"
                    element={<Shell><LazyPage label="Loading Roulette…"><Roulette /></LazyPage></Shell>}
                  />
                  <Route
                    path="/blackjack"
                    element={<Shell><LazyPage label="Loading Blackjack…"><Blackjack /></LazyPage></Shell>}
                  />
                  <Route
                    path="/crash"
                    element={<Shell><LazyPage label="Loading Crash…"><Crash /></LazyPage></Shell>}
                  />
                  <Route
                    path="/case-battles"
                    element={<Shell><LazyPage label="Loading Case Battles…"><CaseBattlesHub /></LazyPage></Shell>}
                  />
                  <Route
                    path="/case-battles/create"
                    element={<Shell><LazyPage label="Loading Case Battles…"><CaseBattlesCreate /></LazyPage></Shell>}
                  />
                  <Route
                    path="/case-battles/:battleId"
                    element={<Shell><LazyPage label="Loading Case Battles…"><CaseBattlesRoom /></LazyPage></Shell>}
                  />
                  <Route
                    path="/slots"
                    element={<Shell><LazyPage label="Loading Slots…"><Slots /></LazyPage></Shell>}
                  />

                  <Route
                    path="/promotions"
                    element={<Shell><LazyPage label="Loading promotions…"><Promotions /></LazyPage></Shell>}
                  />
                  <Route
                    path="/leaderboard"
                    element={<Shell><LazyPage label="Loading leaderboard…"><Leaderboard /></LazyPage></Shell>}
                  />
                  <Route
                    path="/profile"
                    element={<Shell><LazyPage label="Loading profile…"><ProfilePage /></LazyPage></Shell>}
                  />
                  <Route
                    path="/profile/:username"
                    element={<Shell><LazyPage label="Loading profile…"><ProfilePage /></LazyPage></Shell>}
                  />
                  <Route
                    path="/admin"
                    element={
                      <Shell>
                        <AdminRoute>
                          <LazyPage label="Loading admin…"><Admin /></LazyPage>
                        </AdminRoute>
                      </Shell>
                    }
                  />
                  <Route
                    path="/privacy"
                    element={<Shell><LazyPage><Privacy /></LazyPage></Shell>}
                  />
                  <Route
                    path="/sweepstakes"
                    element={<Shell><LazyPage><SweepstakesRules /></LazyPage></Shell>}
                  />
                  <Route
                    path="/responsible-gaming"
                    element={<Shell><LazyPage><ResponsibleGaming /></LazyPage></Shell>}
                  />
                  <Route
                    path="/redeem"
                    element={<Shell><LazyPage><Redeem /></LazyPage></Shell>}
                  />
                  <Route
                    path="/free-entry"
                    element={<Shell><Navigate to="/sweepstakes" replace /></Shell>}
                  />
                  <Route
                    path="*"
                    element={<Shell><LazyPage><NotFound /></LazyPage></Shell>}
                  />
                </Routes>
              </ToastProvider>
            </NotificationsProvider>
          </PlayModeProvider>
        </ProfileProvider>
      </AuthProvider>
      </HelmetProvider>
    </BrowserRouter>
  );
}
