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
  /** True when the user is a synthesized guest (no real Supabase session).
   *  Guest users CANNOT call authenticated RPCs — the server rejects them.
   *  Components that gate features on authentication MUST check `isGuest`
   *  rather than just `user != null`. */
  isGuest: boolean;
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

// Guest user factory. Guests have a stable id="guest" and role="guest"
// (NOT "authenticated") so client-side guards can distinguish them from real
// logged-in users. The server-side RLS still treats them as anonymous
// (auth.uid() IS NULL), so they cannot call authenticated RPCs anyway.
function makeGuestUser(): User {
  return {
    id: "guest",
    aud: "guest",
    role: "guest",
    email: "guest@lottacash.local",
    app_metadata: { provider: "guest" },
    user_metadata: { username: "Guest" },
    created_at: new Date().toISOString(),
  } as unknown as User;
}

// AUDIT-BYPASS: when VITE_AUDIT_BYPASS=1, synthesize a fake logged-in session
// so auth-gated pages (Settings, Deposit, Withdraw, Profile, Admin) can be
// viewed without real Supabase credentials. Only active in the audit build.
// PRODUCTION HARD-GUARD: this is FORBIDDEN in production via a build-time
// constant check. If NODE_ENV=production and VITE_AUDIT_BYPASS=1, we throw
// at module load to prevent an accidental deploy with bypass enabled.
const AUDIT_BYPASS = import.meta.env.VITE_AUDIT_BYPASS === "1"
  && import.meta.env.MODE !== "production";
if (import.meta.env.PROD && import.meta.env.VITE_AUDIT_BYPASS === "1") {
  // Refuse to load — an audit bypass in production is a critical security issue.
  throw new Error(
    "FATAL: VITE_AUDIT_BYPASS=1 is set in a production build. " +
    "This synthesizes a fake auth session and must NEVER be deployed. " +
    "Unset VITE_AUDIT_BYPASS before building for production."
  );
}
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
      // Guest mode: synthesize a guest user so game bet buttons are enabled
      // and the local-play fallback handles all game logic. The guest role
      // is "guest" (NOT "authenticated") so client guards can distinguish.
      setUser(makeGuestUser());
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session: current } }) => {
      setSession(current);
      setUser(current?.user ?? makeGuestUser());
      if (current?.access_token) {
        supabase.realtime.setAuth(current.access_token);
      }
      setLoading(false);
    }).catch(() => {
      // Supabase unreachable — fall back to guest mode so games are playable.
      setUser(makeGuestUser());
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? makeGuestUser());
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
      // A user is a guest iff they have no real Supabase session. Guests have
      // id="guest" and role="guest". Real users have a UUID id from auth.users.
      isGuest: !session || user?.id === "guest" || user?.role === "guest",
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
