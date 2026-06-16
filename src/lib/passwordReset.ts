import { invokeEdgeFunction } from "./edgeFunctions";

export async function requestPasswordResetCode(email: string) {
  return invokeEdgeFunction<{ success: boolean; expiresInMinutes: number; message?: string }>(
    "send-password-reset-code",
    { email: email.trim() }
  );
}

export async function resetPasswordWithCode(
  email: string,
  code: string,
  newPassword: string
) {
  return invokeEdgeFunction<{ success: boolean }>("reset-password-with-code", {
    email: email.trim(),
    code: code.trim(),
    newPassword,
  });
}
