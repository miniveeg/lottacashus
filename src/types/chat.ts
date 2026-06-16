export type ChatMessage = {
  id: string;
  user_id: string;
  username: string;
  body: string;
  created_at: string;
  level?: number;
};

export const MAX_CHAT_MESSAGE_LENGTH = 500;
