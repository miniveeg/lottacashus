export const MAX_USERNAME_LENGTH = 16;

export function normalizeUsername(value: string): string {
  return value.trim().slice(0, MAX_USERNAME_LENGTH);
}

export function validateUsername(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Username cannot be empty.";
  if (trimmed.length > MAX_USERNAME_LENGTH) {
    return `Username cannot be longer than ${MAX_USERNAME_LENGTH} characters.`;
  }
  return null;
}
