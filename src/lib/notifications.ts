import { isSupabaseConfigured, supabase } from "./supabase";
import type { NotificationType, UserNotification } from "../types/notification";

export interface CreateNotificationResult {
  /** `null` on success; a human-readable message on failure. */
  error: string | null;
}

/**
 * Insert a row into the `user_notifications` table for the currently
 * authenticated user via the `create_user_notification` RPC.
 *
 * Returns `{ error: null }` on success or `{ error: "<message>" }` on failure
 * — including when Supabase is unconfigured or no user is signed in, so callers
 * can simply `await` and check `result.error` without a try/catch.
 */
export async function createUserNotification(
  type: NotificationType,
  title: string,
  body: string,
  metadata: Record<string, unknown> = {}
): Promise<CreateNotificationResult> {
  if (!isSupabaseConfigured) {
    return { error: "Notifications are unavailable — Supabase is not configured." };
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    return { error: authError.message };
  }
  if (!user) {
    return { error: "Not logged in." };
  }

  const { error } = await supabase.rpc("create_user_notification", {
    p_user_id: user.id,
    p_type: type,
    p_title: title,
    p_body: body,
    p_metadata: metadata,
  });

  return { error: error?.message ?? null };
}

/**
 * Cast a Supabase row (from the `user_notifications` table or a realtime
 * payload) into a typed `UserNotification`. The caller is responsible for
 * ensuring the row's shape matches the table schema (the context's
 * `.select()` column list and the realtime payload's `new` field both do).
 */
export function rowToNotification(row: Record<string, unknown>): UserNotification {
  return {
    id: row.id as string,
    type: row.type as NotificationType,
    title: row.title as string,
    body: row.body as string,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    read_at: (row.read_at as string | null) ?? null,
    created_at: row.created_at as string,
  };
}
