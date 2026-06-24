import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { requestSignupCode, verifySignupCode } from "../lib/signupVerification";

type AuthResult = { error: string | null };

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  configured: boolean;
  sendSignupCode: (email: string, username?: string, birthDate?: string) => Promise<AuthResult>;
  completeSignup: (
    email: string,
    code: string,
    password: string,
    username?: string,
    referralCode?: string,
    birthDate?: string
  ) => Promise<AuthResult>;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function mapAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("invalid login credentials")) {
    return "Incorrect email or password.";
  }
  if (lower.includes("user already registered")) {
    return "An account with this email already exists.";
  }
  if (lower.includes("password")) {
    return message;
  }
  return message;
}

// AUDIT-BYPASS: when VITE_AUDIT_BYPASS=1, synthesize a fake logged-in session
// so auth-gated pages (Settings, Deposit, Withdraw, Profile, Admin) can be
// viewed without real Supabase credentials. Only active in the audit build.
const AUDIT_BYPASS = import.meta.env.VITE_AUDIT_BYPASS === "1";
const AUDIT_USER: User | null = AUDIT_BYPASS
  ? ({
      id: "audit-user-00000000",
      aud: "authenticated",
      role: "authenticated",
      email: "auditor@lottacash.local",
      app_metadata: { provider: "email" },
      user_metadata: { username: "AuditViewer" },
      created_at: new Date().toISOString(),
    } as unknown as User)
  : null;
const AUDIT_SESSION: Session | null = AUDIT_BYPASS
  ? ({
      access_token: "audit-fake-access-token",
      refresh_token: "audit-fake-refresh-token",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: "bearer",
      user: AUDIT_USER,
    } as unknown as Session)
  : null;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(AUDIT_USER);
  const [session, setSession] = useState<Session | null>(AUDIT_SESSION);
  const [loading, setLoading] = useState(AUDIT_BYPASS ? false : true);

  useEffect(() => {
    if (AUDIT_BYPASS) return;
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session: current } }) => {
      setSession(current);
      setUser(current?.user ?? null);
      if (current?.access_token) {
        supabase.realtime.setAuth(current.access_token);
      }
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      if (nextSession?.access_token) {
        supabase.realtime.setAuth(nextSession.access_token);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const sendSignupCode = useCallback(async (email: string, username?: string, birthDate?: string): Promise<AuthResult> => {
    const { error } = await requestSignupCode(email, username, birthDate);
    if (error) return { error };
    return { error: null };
  }, []);

  const completeSignup = useCallback(
    async (
      email: string,
      code: string,
      password: string,
      username?: string,
      referralCode?: string,
      birthDate?: string
    ): Promise<AuthResult> => {
      const { error: verifyError } = await verifySignupCode(
        email,
        code,
        password,
        username,
        referralCode,
        birthDate
      );
      if (verifyError) return { error: verifyError };

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) return { error: mapAuthError(signInError.message) };
      return { error: null };
    },
    []
  );

  const signIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    if (!isSupabaseConfigured) {
      return { error: "Supabase is not configured. Add your keys to .env." };
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: mapAuthError(error.message) };
    return { error: null };
  }, []);

  const signOut = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    await supabase.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({
      user,
      session,
      loading,
      configured: isSupabaseConfigured,
      sendSignupCode,
      completeSignup,
      signIn,
      signOut,
    }),
    [user, session, loading, sendSignupCode, completeSignup, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
