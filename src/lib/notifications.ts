import { supabase } from "./supabase";
import type { NotificationType, UserNotification } from "../types/notification";

export async function createUserNotification(
  type: NotificationType,
  title: string,
  body: string,
  metadata: Record<string, unknown> = {}
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not logged in." };

  const { error } = await supabase.rpc("create_user_notification", {
    p_user_id: user.id,
    p_type: type,
    p_title: title,
    p_body: body,
    p_metadata: metadata,
  });

  return { error: error?.message ?? null };
}

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
