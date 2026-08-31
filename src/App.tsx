import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/layout/Layout";
import { AuthProvider } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import { WalletProvider } from "./context/WalletContext";
import { Lobby } from "./pages/Lobby";
import { Mines } from "./pages/Mines";
import { Tower } from "./pages/Tower";
import { Limbo } from "./pages/Limbo";
import { Roulette } from "./pages/Roulette";
import { Blackjack } from "./pages/Blackjack";
import { Upgrader } from "./pages/Upgrader";
import { Cases } from "./pages/Cases";
import { Battles } from "./pages/Battles";
import { BattleRoom } from "./pages/BattleRoom";
import { Wallet } from "./pages/Wallet";
import { Login } from "./pages/Login";
import { Responsible } from "./pages/Responsible";
import { Privacy } from "./pages/Privacy";
import { Terms } from "./pages/Terms";
import { NotFound } from "./pages/NotFound";

export default function App() {
  return (
    <AuthProvider>
      <WalletProvider>
        <ToastProvider>
          <BrowserRouter>
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
          </BrowserRouter>
        </ToastProvider>
      </WalletProvider>
    </AuthProvider>
  );
}
