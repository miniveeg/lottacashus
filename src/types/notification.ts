export type NotificationType =
  | "deposit_detected"
  | "deposit_credited"
  | "withdrawal_started"
  | "withdrawal_completed"
  | "withdrawal_failed"
  | "discord_linked"
  | "discord_link_failed";

export type UserNotification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

export const NOTIFICATION_ICONS: Record<NotificationType, string> = {
  deposit_detected: "↓",
  deposit_credited: "✓",
  withdrawal_started: "↗",
  withdrawal_completed: "✓",
  withdrawal_failed: "✕",
  discord_linked: "◎",
  discord_link_failed: "✕",
};
