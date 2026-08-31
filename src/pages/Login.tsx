import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

export function Login() {
  const { configured, user } = useAuth();
  const { push } = useToast();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"in" | "up">("in");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    const fn =
      mode === "in"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({ email, password });
    const { error } = await fn;
    setBusy(false);
    if (error) {
      push(error.message, "error");
      return;
    }
    push(mode === "in" ? "Welcome back." : "Check your inbox if confirmation is on.", "win");
    nav("/");
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    push("Signed out", "info");
  }

  if (!configured) {
    return (
      <div className="game-page">
        <h1>Demo floor</h1>
        <p className="lede">
          Supabase is not configured in this build. You are playing with a local 1,000 SC stack. Set VITE_SUPABASE_URL and
          VITE_SUPABASE_ANON_KEY to enable accounts.
        </p>
      </div>
    );
  }

  if (user) {
    return (
      <div className="game-page">
        <h1>Account</h1>
        <p className="lede">{user.email}</p>
        <button className="btn" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="game-page">
      <h1>{mode === "in" ? "Login" : "Create account"}</h1>
      <p className="lede">Same SC wallet once you are in. Password auth through Supabase.</p>
      <form className="panel" style={{ maxWidth: 420 }} onSubmit={(e) => void submit(e)}>
        <div className="field">
          <label htmlFor="login-email">Email</label>
          <input id="login-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </div>
        <div className="field">
          <label htmlFor="login-password">Password</label>
          <input id="login-password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        <button className="btn btn-gold" disabled={busy} type="submit">
          {mode === "in" ? "Enter" : "Sign up"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ marginLeft: 8 }}
          onClick={() => setMode(mode === "in" ? "up" : "in")}
        >
          {mode === "in" ? "Need an account" : "Have an account"}
        </button>
      </form>
    </div>
  );
}
