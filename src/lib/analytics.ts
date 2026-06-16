/**
 * LottaCash Analytics & Observability
 *
 * Lightweight, zero-dependency instrumentation layer.
 * Drop-in ready: all events go to console.debug in dev mode.
 * To wire up real providers, replace the `_send` stub at the bottom
 * with your preferred SDK (PostHog, Segment, Mixpanel, Sentry, etc.)
 *
 * Usage:
 *   import { analytics } from "@/lib/analytics";
 *   analytics.track("bet_placed", { game: "mines", amount: 5.00 });
 *   analytics.error(err, { context: "Deposit" });
 */

// ─── Event catalogue ────────────────────────────────────────────────────────

export type AnalyticsEvent =
  // Auth
  | { name: "signup_started" }
  | { name: "signup_completed"; properties: { username?: string } }
  | { name: "login"; properties: { method: "email" } }
  | { name: "logout" }
  // Wallet
  | { name: "wallet_opened"; properties: { tab: "deposit" | "withdraw" } }
  | { name: "deposit_initiated"; properties: { chain: string } }
  | { name: "deposit_detected"; properties: { chain: string; usd_amount: number } }
  | { name: "withdraw_initiated"; properties: { chain: string; usd_amount: number } }
  | { name: "withdraw_completed"; properties: { chain: string; usd_amount: number } }
  // Games
  | { name: "game_entered"; properties: { game: string } }
  | { name: "bet_placed"; properties: { game: string; amount: number; meta?: Record<string, unknown> } }
  | { name: "bet_won"; properties: { game: string; amount: number; payout: number; multiplier?: number } }
  | { name: "bet_lost"; properties: { game: string; amount: number } }
  | { name: "big_win"; properties: { game: string; payout: number; multiplier: number } }
  // Case Battles
  | { name: "case_battle_created"; properties: { player_count: number; case_count: number; total_value: number } }
  | { name: "case_battle_joined"; properties: { battle_id: string } }
  // Affiliate
  | { name: "affiliate_claimed"; properties: { amount: number } }
  | { name: "affiliate_code_copied" }
  // UI
  | { name: "clipboard_copy"; properties: { context: string } }
  // Generic
  | { name: "network_error"; properties: { context: string; message?: string } }
  | { name: string; properties?: Record<string, unknown> };

// ─── Error capture types ─────────────────────────────────────────────────────

export interface ErrorContext {
  context?: string;
  userId?: string;
  extra?: Record<string, unknown>;
}

// ─── Core analytics object ───────────────────────────────────────────────────

const isDev = import.meta.env.DEV;
let _userId: string | null = null;

function _send(eventName: string, properties?: Record<string, unknown>) {
  // ── Slot your real provider here ──────────────────────────────────────────
  //
  // PostHog:
  //   window.posthog?.capture(eventName, { ...properties, $user_id: _userId });
  //
  // Segment:
  //   window.analytics?.track(eventName, { ...properties, userId: _userId });
  //
  // Mixpanel:
  //   window.mixpanel?.track(eventName, { ...properties, distinct_id: _userId });
  //
  // ─────────────────────────────────────────────────────────────────────────

  if (isDev) {
    // eslint-disable-next-line no-console
    console.debug(
      `%c[analytics] %c${eventName}`,
      "color:#8b5cf6;font-weight:700",
      "color:#f5b942",
      properties ?? ""
    );
  }
}

function _sendError(err: unknown, ctx?: ErrorContext) {
  // ── Slot your real error tracker here ─────────────────────────────────────
  //
  // Sentry:
  //   Sentry.withScope((scope) => {
  //     if (ctx?.userId) scope.setUser({ id: ctx.userId });
  //     if (ctx?.context) scope.setTag("context", ctx.context);
  //     if (ctx?.extra) scope.setExtras(ctx.extra);
  //     Sentry.captureException(err);
  //   });
  //
  // ─────────────────────────────────────────────────────────────────────────

  if (isDev) {
    // eslint-disable-next-line no-console
    console.error(`%c[error]%c ${ctx?.context ?? "unknown"}`, "color:#ef4444;font-weight:700", "", err, ctx?.extra ?? "");
  }
}

// ─── Performance timing ───────────────────────────────────────────────────────

function _sendPerf(name: string, durationMs: number, meta?: Record<string, unknown>) {
  // ── Web Vitals / performance monitoring ───────────────────────────────────
  //
  // Datadog RUM:
  //   window.DD_RUM?.addTiming(name);
  //
  // LogRocket, New Relic, etc.:
  //   Similar pattern.
  //
  // ─────────────────────────────────────────────────────────────────────────

  if (isDev) {
    // eslint-disable-next-line no-console
    console.debug(
      `%c[perf] %c${name} %c${durationMs.toFixed(1)}ms`,
      "color:#22c55e;font-weight:700",
      "color:#f4f4f5",
      "color:#a1a1aa",
      meta ?? ""
    );
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const analytics = {
  /** Identify the current user. Call after login/signup. */
  identify(userId: string, traits?: Record<string, unknown>) {
    _userId = userId;
    // posthog?.identify(userId, traits);
    // analytics?.identify(userId, { traits });
    if (isDev) {
      // eslint-disable-next-line no-console
      console.debug(`%c[analytics] identify`, "color:#8b5cf6;font-weight:700", userId, traits ?? "");
    }
  },

  /** Reset identity on logout. */
  reset() {
    _userId = null;
    // posthog?.reset();
    if (isDev) {
      // eslint-disable-next-line no-console
      console.debug(`%c[analytics] reset`, "color:#8b5cf6;font-weight:700");
    }
  },

  /** Track a named event. */
  track(eventName: string, properties?: Record<string, unknown>) {
    _send(eventName, properties);
  },

  /** Capture an error. */
  error(err: unknown, ctx?: ErrorContext) {
    _sendError(err, { userId: _userId ?? undefined, ...ctx });
  },

  /** Measure duration of an async operation. */
  async measure<T>(name: string, fn: () => Promise<T>, meta?: Record<string, unknown>): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      _sendPerf(name, performance.now() - start, meta);
      return result;
    } catch (err) {
      _sendPerf(`${name}_failed`, performance.now() - start, meta);
      throw err;
    }
  },

  /** Convenience shortcuts for catalogue events */
  signup: {
    started: () => analytics.track("signup_started"),
    completed: (username?: string) => analytics.track("signup_completed", { username }),
  },
  login: {
    success: () => analytics.track("login", { method: "email" }),
  },
  logout: () => analytics.track("logout"),
  wallet: {
    opened: (tab: "deposit" | "withdraw") => analytics.track("wallet_opened", { tab }),
    depositInitiated: (chain: string) => analytics.track("deposit_initiated", { chain }),
    depositDetected: (chain: string, usd_amount: number) =>
      analytics.track("deposit_detected", { chain, usd_amount }),
    withdrawInitiated: (chain: string, usd_amount: number) =>
      analytics.track("withdraw_initiated", { chain, usd_amount }),
    withdrawCompleted: (chain: string, usd_amount: number) =>
      analytics.track("withdraw_completed", { chain, usd_amount }),
  },
  game: {
    entered: (game: string) => analytics.track("game_entered", { game }),
    betPlaced: (game: string, amount: number, meta?: Record<string, unknown>) =>
      analytics.track("bet_placed", { game, amount, ...meta }),
    betWon: (game: string, amount: number, payout: number, multiplier?: number) =>
      analytics.track("bet_won", { game, amount, payout, multiplier }),
    betLost: (game: string, amount: number) => analytics.track("bet_lost", { game, amount }),
    bigWin: (game: string, payout: number, multiplier: number) =>
      analytics.track("big_win", { game, payout, multiplier }),
  },
  battle: {
    created: (player_count: number, case_count: number, total_value: number) =>
      analytics.track("case_battle_created", { player_count, case_count, total_value }),
    joined: (battle_id: string) => analytics.track("case_battle_joined", { battle_id }),
  },
  affiliate: {
    claimed: (amount: number) => analytics.track("affiliate_claimed", { amount }),
    codeCopied: () => analytics.track("affiliate_code_copied"),
  },
  clipboard: (context: string) => analytics.track("clipboard_copy", { context }),
  networkError: (context: string, message?: string) =>
    analytics.track("network_error", { context, message }),
};
