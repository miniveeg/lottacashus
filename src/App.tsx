import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/layout/Layout";
import { AuthProvider } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import { WalletProvider } from "./context/WalletContext";
import { Lobby } from "./pages/Lobby";

const Mines = lazy(() => import("./pages/Mines").then((m) => ({ default: m.Mines })));
const Tower = lazy(() => import("./pages/Tower").then((m) => ({ default: m.Tower })));
const Limbo = lazy(() => import("./pages/Limbo").then((m) => ({ default: m.Limbo })));
const Roulette = lazy(() => import("./pages/Roulette").then((m) => ({ default: m.Roulette })));
const Blackjack = lazy(() => import("./pages/Blackjack").then((m) => ({ default: m.Blackjack })));
const Upgrader = lazy(() => import("./pages/Upgrader").then((m) => ({ default: m.Upgrader })));
const Cases = lazy(() => import("./pages/Cases").then((m) => ({ default: m.Cases })));
const Battles = lazy(() => import("./pages/Battles").then((m) => ({ default: m.Battles })));
const BattleRoom = lazy(() => import("./pages/BattleRoom").then((m) => ({ default: m.BattleRoom })));
const Wallet = lazy(() => import("./pages/Wallet").then((m) => ({ default: m.Wallet })));
const Login = lazy(() => import("./pages/Login").then((m) => ({ default: m.Login })));
const Responsible = lazy(() => import("./pages/Responsible").then((m) => ({ default: m.Responsible })));
const Privacy = lazy(() => import("./pages/Privacy").then((m) => ({ default: m.Privacy })));
const Terms = lazy(() => import("./pages/Terms").then((m) => ({ default: m.Terms })));
const NotFound = lazy(() => import("./pages/NotFound").then((m) => ({ default: m.NotFound })));

function BootFallback() {
  return (
    <div className="boot-screen">
      <div>
        <img src="/art/chip.webp" alt="" className="boot-chip" width={56} height={56} />
        <div className="boot-wordmark">LottaCash</div>
        <p className="boot-lede">Opening tables…</p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <WalletProvider>
        <ToastProvider>
          <BrowserRouter>
            <Suspense fallback={<BootFallback />}>
              <Routes>
                <Route element={<Layout />}>
                  <Route index element={<Lobby />} />
                  <Route path="mines" element={<Mines />} />
                  <Route path="tower" element={<Tower />} />
                  <Route path="limbo" element={<Limbo />} />
                  <Route path="roulette" element={<Roulette />} />
                  <Route path="blackjack" element={<Blackjack />} />
                  <Route path="upgrader" element={<Upgrader />} />
                  <Route path="cases" element={<Cases />} />
                  <Route path="battles" element={<Battles />} />
                  <Route path="battles/:id" element={<BattleRoom />} />
                  <Route path="wallet" element={<Wallet />} />
                  <Route path="login" element={<Login />} />
                  <Route path="responsible" element={<Responsible />} />
                  <Route path="privacy" element={<Privacy />} />
                  <Route path="terms" element={<Terms />} />
                  <Route path="home" element={<Navigate to="/" replace />} />
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Routes>
            </Suspense>
          </BrowserRouter>
        </ToastProvider>
      </WalletProvider>
    </AuthProvider>
  );
}
