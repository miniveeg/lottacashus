import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { NotificationsProvider } from "./contexts/NotificationsContext";
import { PlayModeProvider } from "./contexts/PlayModeContext";
import { ProfileProvider } from "./contexts/ProfileContext";
import { ToastProvider } from "./contexts/ToastContext";
import { ToastRegion } from "./components/Toast/Toast";
import { AppShell } from "./components/AppShell/AppShell";
import { Home } from "./pages/Home/Home";
import { Login } from "./pages/Login/Login";
import { Signup } from "./pages/Signup/Signup";
import { Settings } from "./pages/Settings/Settings";
import { ForgotPassword } from "./pages/ForgotPassword/ForgotPassword";
import { Deposit } from "./pages/Deposit/Deposit";
import { Withdraw } from "./pages/Withdraw/Withdraw";
import { Help } from "./pages/Help/Help";
import { Keno } from "./pages/Keno/Keno";
import { Mines } from "./pages/Mines/Mines";
import { Limbo } from "./pages/Limbo/Limbo";
import { Roulette } from "./pages/Roulette/Roulette";
import { Blackjack } from "./pages/Blackjack/Blackjack";
import { Crash } from "./pages/Crash/Crash";
import { Originals } from "./pages/Originals/Originals";
const CaseBattlesCreate = lazy(() =>
  import("./pages/CaseBattles/CaseBattlesCreate").then((m) => ({ default: m.CaseBattlesCreate }))
);
const CaseBattlesHub = lazy(() =>
  import("./pages/CaseBattles/CaseBattlesHub").then((m) => ({ default: m.CaseBattlesHub }))
);
const CaseBattlesRoom = lazy(() =>
  import("./pages/CaseBattles/CaseBattlesRoom").then((m) => ({ default: m.CaseBattlesRoom }))
);

function CaseBattlesFallback() {
  return (
    <div className="lc-page" style={{ padding: "2rem", color: "var(--lc-text-muted)" }}>
      Loading Case Battles…
    </div>
  );
}
import { Admin } from "./pages/Admin/Admin";
import { Promotions } from "./pages/Promotions/Promotions";
import { Leaderboard } from "./pages/Leaderboard/Leaderboard";
import { ProfilePage } from "./pages/Profile/Profile";
import { NotFound } from "./pages/NotFound/NotFound";
import { AdminRoute } from "./components/AdminRoute/AdminRoute";
import { Privacy } from "./pages/Privacy/Privacy";
import { SweepstakesRules } from "./pages/SweepstakesRules/SweepstakesRules";
import { FreeEntry } from "./pages/FreeEntry/FreeEntry";
import Redeem from "./pages/Redeem/Redeem";
import Slots from "./pages/Slots/Slots";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ProfileProvider>
          <PlayModeProvider>
          <NotificationsProvider>
          <ToastProvider>
          <ToastRegion />
          <Routes>
            <Route
              path="/"
              element={
                <AppShell>
                  <Home />
                </AppShell>
              }
            />
            <Route
              path="/login"
              element={
                <AppShell>
                  <Login />
                </AppShell>
              }
            />
            <Route
              path="/signup"
              element={
                <AppShell>
                  <Signup />
                </AppShell>
              }
            />
            <Route
              path="/settings"
              element={
                <AppShell>
                  <Settings />
                </AppShell>
              }
            />
            <Route
              path="/forgot-password"
              element={
                <AppShell>
                  <ForgotPassword />
                </AppShell>
              }
            />
            <Route
              path="/deposit"
              element={
                <AppShell>
                  <Deposit />
                </AppShell>
              }
            />
            <Route
              path="/withdraw"
              element={
                <AppShell>
                  <Withdraw />
                </AppShell>
              }
            />
            <Route
              path="/help"
              element={
                <AppShell>
                  <Help />
                </AppShell>
              }
            />
            <Route
              path="/promotions"
              element={
                <AppShell>
                  <Promotions />
                </AppShell>
              }
            />
            <Route
              path="/originals"
              element={
                <AppShell>
                  <Originals />
                </AppShell>
              }
            />
            <Route
              path="/keno"
              element={
                <AppShell>
                  <Keno />
                </AppShell>
              }
            />
            <Route
              path="/mines"
              element={
                <AppShell>
                  <Mines />
                </AppShell>
              }
            />
            <Route
              path="/limbo"
              element={
                <AppShell>
                  <Limbo />
                </AppShell>
              }
            />
            <Route
              path="/roulette"
              element={
                <AppShell>
                  <Roulette />
                </AppShell>
              }
            />
            <Route
              path="/blackjack"
              element={
                <AppShell>
                  <Blackjack />
                </AppShell>
              }
            />
            <Route
              path="/crash"
              element={
                <AppShell>
                  <Crash />
                </AppShell>
              }
            />
            <Route
              path="/case-battles"
              element={
                <AppShell>
                  <Suspense fallback={<CaseBattlesFallback />}>
                    <CaseBattlesHub />
                  </Suspense>
                </AppShell>
              }
            />
            <Route
              path="/case-battles/create"
              element={
                <AppShell>
                  <Suspense fallback={<CaseBattlesFallback />}>
                    <CaseBattlesCreate />
                  </Suspense>
                </AppShell>
              }
            />
            <Route
              path="/case-battles/:battleId"
              element={
                <AppShell>
                  <Suspense fallback={<CaseBattlesFallback />}>
                    <CaseBattlesRoom />
                  </Suspense>
                </AppShell>
              }
            />
            <Route
              path="/leaderboard"
              element={
                <AppShell>
                  <Leaderboard />
                </AppShell>
              }
            />
            <Route
              path="/profile"
              element={
                <AppShell>
                  <ProfilePage />
                </AppShell>
              }
            />
            <Route
              path="/profile/:username"
              element={
                <AppShell>
                  <ProfilePage />
                </AppShell>
              }
            />
            <Route
              path="/admin"
              element={
                <AppShell>
                  <AdminRoute>
                    <Admin />
                  </AdminRoute>
                </AppShell>
              }
            />
            <Route
              path="/privacy"
              element={
                <AppShell>
                  <Privacy />
                </AppShell>
              }
            />
            <Route
              path="/sweepstakes"
              element={
                <AppShell>
                  <SweepstakesRules />
                </AppShell>
              }
            />
            <Route
              path="/free-entry"
              element={
                <AppShell>
                  <FreeEntry />
                </AppShell>
              }
            />
            <Route path="/responsible-gaming" element={<Navigate to="/settings" replace />} />
            <Route
              path="/slots"
              element={
                <AppShell>
                  <Slots />
                </AppShell>
              }
            />
            <Route
              path="/redeem"
              element={
                <AppShell>
                  <Redeem />
                </AppShell>
              }
            />
            <Route
              path="*"
              element={
                <AppShell>
                  <NotFound />
                </AppShell>
              }
            />
          </Routes>
          </ToastProvider>
          </NotificationsProvider>
          </PlayModeProvider>
        </ProfileProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
