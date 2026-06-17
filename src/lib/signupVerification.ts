import { invokeEdgeFunction } from "./edgeFunctions";

export async function requestSignupCode(email: string, username?: string, birthDate?: string) {
  return invokeEdgeFunction<{ success: boolean; expiresInMinutes: number }>("send-signup-code", {
    email: email.trim(),
    username,
    birth_date: birthDate,
  });
}

export async function verifySignupCode(
  email: string,
  code: string,
  password: string,
  username?: string,
  referralCode?: string,
  birthDate?: string
) {
  return invokeEdgeFunction<{ success: boolean }>("verify-signup-code", {
    email: email.trim(),
    code: code.trim(),
    password,
    username,
    referralCode: referralCode?.trim() || undefined,
    birth_date: birthDate,
  });
}
