import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Database,
  Shield,
  Radio,
  Mail,
  MessageCircle,
  Server,
  Globe,
  Wallet,
} from "lucide-react";
import { Seo } from "../../components/Seo/Seo";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";
import "./AdminStatus.css";

type ServiceState = "ok" | "warn" | "down" | "checking" | "unknown";

type ServiceRow = {
  id: string;
  name: string;
  description: string;
  icon: typeof Database;
  state: ServiceState;
  detail: string;
  latencyMs?: number;
};

function statusLabel(s: ServiceState): string {
  switch (s) {
    case "ok":
      return "Operational";
    case "warn":
      return "Degraded";
    case "down":
      return "Down";
    case "checking":
      return "Checking…";
    default:
      return "Unknown";
  }
}

function StatusIcon({ state }: { state: ServiceState }) {
  if (state === "ok") return <CheckCircle2 size={18} className="admin-status__icon--ok" />;
  if (state === "warn") return <AlertTriangle size={18} className="admin-status__icon--warn" />;
  if (state === "down") return <XCircle size={18} className="admin-status__icon--down" />;
  return <Activity size={18} className="admin-status__icon--checking" />;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const t0 = performance.now();
  const result = await fn();
  return { result, ms: Math.round(performance.now() - t0) };
}

export function AdminStatus() {
  const [rows, setRows] = useState<ServiceRow[]>([]);
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const runChecks = useCallback(async () => {
    setChecking(true);

    const initial: ServiceRow[] = [
      {
        id: "supabase-config",
        name: "Supabase config",
        description: "VITE_SUPABASE_URL + anon key present",
        icon: Database,
        state: "checking",
        detail: "…",
      },
      {
        id: "supabase-api",
        name: "Supabase API",
        description: "REST / RPC reachability",
        icon: Server,
        state: "checking",
        detail: "…",
      },
      {
        id: "auth",
        name: "Auth (GoTrue)",
        description: "Session / auth endpoint",
        icon: Shield,
        state: "checking",
        detail: "…",
      },
      {
        id: "realtime",
        name: "Realtime",
        description: "WebSocket channel subscribe",
        icon: Radio,
        state: "checking",
        detail: "…",
      },
      {
        id: "edge",
        name: "Edge Functions",
        description: "Function gateway reachable",
        icon: Globe,
        state: "checking",
        detail: "…",
      },
      {
        id: "discord",
        name: "Discord OAuth",
        description: "Client ID configured",
        icon: MessageCircle,
        state: "checking",
        detail: "…",
      },
      {
        id: "smtp",
        name: "Email (SMTP)",
        description: "Signup codes require edge SMTP secrets",
        icon: Mail,
        state: "checking",
        detail: "…",
      },
      {
        id: "wallet",
        name: "Crypto wallets",
        description: "Deposit / withdraw edge stack",
        icon: Wallet,
        state: "checking",
        detail: "…",
      },
    ];
    setRows(initial);

    const next = [...initial];

    // 1) Config
    const cfgIdx = 0;
    if (isSupabaseConfigured) {
      next[cfgIdx] = {
        ...next[cfgIdx]!,
        state: "ok",
        detail: "Env vars look valid (not placeholder).",
      };
    } else {
      next[cfgIdx] = {
        ...next[cfgIdx]!,
        state: "down",
        detail: "Missing or placeholder VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.",
      };
    }
    setRows([...next]);

    // 2) API — lightweight RPC
    const apiIdx = 1;
    if (!isSupabaseConfigured) {
      next[apiIdx] = {
        ...next[apiIdx]!,
        state: "down",
        detail: "Skipped — Supabase not configured.",
      };
    } else {
      try {
        const { result, ms } = await timed(async () => {
          // is_current_user_admin is a cheap boolean RPC available to authenticated admins
          const { error } = await supabase.rpc("is_current_user_admin");
          return error;
        });
        if (result) {
          next[apiIdx] = {
            ...next[apiIdx]!,
            state: "warn",
            detail: result.message || "RPC returned an error.",
            latencyMs: ms,
          };
        } else {
          next[apiIdx] = {
            ...next[apiIdx]!,
            state: "ok",
            detail: `RPC ok (${ms} ms).`,
            latencyMs: ms,
          };
        }
      } catch (e) {
        next[apiIdx] = {
          ...next[apiIdx]!,
          state: "down",
          detail: e instanceof Error ? e.message : "Network error.",
        };
      }
    }
    setRows([...next]);

    // 3) Auth
    const authIdx = 2;
    if (!isSupabaseConfigured) {
      next[authIdx] = {
        ...next[authIdx]!,
        state: "down",
        detail: "Skipped — Supabase not configured.",
      };
    } else {
      try {
        const { result, ms } = await timed(async () => {
          const { data, error } = await supabase.auth.getSession();
          return { data, error };
        });
        if (result.error) {
          next[authIdx] = {
            ...next[authIdx]!,
            state: "warn",
            detail: result.error.message,
            latencyMs: ms,
          };
        } else {
          next[authIdx] = {
            ...next[authIdx]!,
            state: "ok",
            detail: result.data.session
              ? `Session active (${ms} ms).`
              : `Auth reachable, no session (${ms} ms).`,
            latencyMs: ms,
          };
        }
      } catch (e) {
        next[authIdx] = {
          ...next[authIdx]!,
          state: "down",
          detail: e instanceof Error ? e.message : "Auth unreachable.",
        };
      }
    }
    setRows([...next]);

    // 4) Realtime
    const rtIdx = 3;
    if (!isSupabaseConfigured) {
      next[rtIdx] = {
        ...next[rtIdx]!,
        state: "down",
        detail: "Skipped — Supabase not configured.",
      };
    } else {
      try {
        const { ms } = await timed(
          () =>
            new Promise<void>((resolve, reject) => {
              const ch = supabase.channel(`admin-status-probe-${Date.now()}`);
              const timeout = window.setTimeout(() => {
                void supabase.removeChannel(ch);
                reject(new Error("Realtime subscribe timed out (4s)."));
              }, 4000);
              ch.subscribe((status) => {
                if (status === "SUBSCRIBED") {
                  window.clearTimeout(timeout);
                  void supabase.removeChannel(ch);
                  resolve();
                }
                if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                  window.clearTimeout(timeout);
                  void supabase.removeChannel(ch);
                  reject(new Error(`Realtime status: ${status}`));
                }
              });
            })
        );
        next[rtIdx] = {
          ...next[rtIdx]!,
          state: "ok",
          detail: `Subscribed (${ms} ms).`,
          latencyMs: ms,
        };
      } catch (e) {
        next[rtIdx] = {
          ...next[rtIdx]!,
          state: "warn",
          detail: e instanceof Error ? e.message : "Realtime probe failed.",
        };
      }
    }
    setRows([...next]);

    // 5) Edge Functions gateway — invoke a known function name; 404 still means gateway is up
    const edgeIdx = 4;
    if (!isSupabaseConfigured) {
      next[edgeIdx] = {
        ...next[edgeIdx]!,
        state: "down",
        detail: "Skipped — Supabase not configured.",
      };
    } else {
      try {
        const { result, ms } = await timed(async () => {
          const { error } = await supabase.functions.invoke("__health_probe__", {
            body: {},
          });
          return error;
        });
        // Any HTTP response from the gateway counts as reachable
        const msg = result?.message ?? "";
        if (/Failed to send|network|fetch/i.test(msg)) {
          next[edgeIdx] = {
            ...next[edgeIdx]!,
            state: "down",
            detail: msg || "Gateway unreachable.",
            latencyMs: ms,
          };
        } else {
          next[edgeIdx] = {
            ...next[edgeIdx]!,
            state: "ok",
            detail: `Gateway reachable (${ms} ms). Individual functions must still be deployed.`,
            latencyMs: ms,
          };
        }
      } catch (e) {
        next[edgeIdx] = {
          ...next[edgeIdx]!,
          state: "down",
          detail: e instanceof Error ? e.message : "Edge probe failed.",
        };
      }
    }
    setRows([...next]);

    // 6) Discord client ID
    const discordIdx = 5;
    const discordId = import.meta.env.VITE_DISCORD_CLIENT_ID as string | undefined;
    if (discordId && !discordId.includes("your-discord") && discordId.length > 5) {
      next[discordIdx] = {
        ...next[discordIdx]!,
        state: "ok",
        detail: "VITE_DISCORD_CLIENT_ID is set.",
      };
    } else {
      next[discordIdx] = {
        ...next[discordIdx]!,
        state: "warn",
        detail: "Discord client ID not set — OAuth link will be disabled.",
      };
    }
    setRows([...next]);

    // 7) SMTP — cannot read edge secrets from the browser; informational only
    next[6] = {
      ...next[6]!,
      state: "unknown",
      detail:
        "SMTP lives in Edge Function secrets (SMTP_HOST, SMTP_USER, …). Cannot probe from the browser.",
    };

    // 8) Crypto wallets — same limitation
    next[7] = {
      ...next[7]!,
      state: "unknown",
      detail:
        "Wallet keys are Edge secrets (CRYPTO_MASTER_MNEMONIC, MAIN_*_WALLET). Cannot probe from the browser.",
    };

    setRows([...next]);
    setLastChecked(new Date());
    setChecking(false);
  }, []);

  useEffect(() => {
    void runChecks();
  }, [runChecks]);

  const okCount = rows.filter((r) => r.state === "ok").length;
  const downCount = rows.filter((r) => r.state === "down").length;
  const warnCount = rows.filter((r) => r.state === "warn").length;

  return (
    <div className="admin-status lc-page lc-page--wide">
      <Seo title="System status" path="/admin/status" noindex />

      <header className="admin-status__header">
        <div>
          <p className="admin-status__eyebrow">Admin</p>
          <h1 className="admin-status__title">System status</h1>
          <p className="admin-status__subtitle">
            Live checks for the services this site depends on. Edge secrets (SMTP, wallets) cannot be
            verified from the browser.
          </p>
        </div>
        <div className="admin-status__header-actions">
          <Link to="/admin" className="admin-status__back">
            ← Dashboard
          </Link>
          <button
            type="button"
            className="admin-status__refresh"
            onClick={() => void runChecks()}
            disabled={checking}
          >
            <RefreshCw size={16} className={checking ? "admin-status__spin" : ""} />
            {checking ? "Checking…" : "Re-check"}
          </button>
        </div>
      </header>

      <div className="admin-status__summary">
        <div className="admin-status__pill admin-status__pill--ok">{okCount} ok</div>
        <div className="admin-status__pill admin-status__pill--warn">{warnCount} warn</div>
        <div className="admin-status__pill admin-status__pill--down">{downCount} down</div>
        {lastChecked && (
          <span className="admin-status__checked-at">
            Last checked {lastChecked.toLocaleTimeString()}
          </span>
        )}
      </div>

      <ul className="admin-status__list">
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <li key={row.id} className={`admin-status__row admin-status__row--${row.state}`}>
              <div className="admin-status__row-icon">
                <Icon size={20} />
              </div>
              <div className="admin-status__row-body">
                <div className="admin-status__row-top">
                  <strong>{row.name}</strong>
                  <span className={`admin-status__badge admin-status__badge--${row.state}`}>
                    <StatusIcon state={row.state} />
                    {statusLabel(row.state)}
                  </span>
                </div>
                <p className="admin-status__row-desc">{row.description}</p>
                <p className="admin-status__row-detail">
                  {row.detail}
                  {row.latencyMs != null ? ` · ${row.latencyMs} ms` : ""}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      <section className="admin-status__notes">
        <h2>Notes</h2>
        <ul>
          <li>
            <strong>Supabase</strong> powers auth, profiles, bets, deposits, and realtime balance
            updates.
          </li>
          <li>
            <strong>Edge Functions</strong> handle game bets, signup email codes, crypto deposits,
            and withdrawals. Deploy with{" "}
            <code>npx supabase functions deploy</code>.
          </li>
          <li>
            <strong>SMTP</strong> and <strong>wallet mnemonics</strong> are server-only secrets — set
            them in the Supabase dashboard under Edge Function secrets.
          </li>
        </ul>
      </section>
    </div>
  );
}
