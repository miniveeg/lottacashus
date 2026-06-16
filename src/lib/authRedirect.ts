/** Reject open redirects; only allow same-origin path navigation. */
export function safeRedirectPath(raw: string | null | undefined, fallback = "/"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return fallback;
  return raw;
}

export function loginUrl(redirectPath: string): string {
  return `/login?redirect=${encodeURIComponent(safeRedirectPath(redirectPath, "/"))}`;
}

export function signupUrl(redirectPath: string): string {
  return `/signup?redirect=${encodeURIComponent(safeRedirectPath(redirectPath, "/"))}`;
}

/** Preserve redirect/ref when linking between auth pages. */
export function loginUrlFromSearchParams(searchParams: URLSearchParams): string {
  const params = new URLSearchParams();
  const redirect = searchParams.get("redirect");
  if (redirect) params.set("redirect", safeRedirectPath(redirect));
  const ref = searchParams.get("ref");
  if (ref) params.set("ref", ref);
  const qs = params.toString();
  return qs ? `/login?${qs}` : "/login";
}
