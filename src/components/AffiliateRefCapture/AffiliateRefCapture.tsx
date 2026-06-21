import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { normalizeAffiliateCode, storeAffiliateRef } from "../../lib/affiliateRef";

/**
 *  Globally-mounted URL-param capture component. Persists `?ref=CODE` from
 *  any route so the Signup page can attach the referral code to the new
 *  account.
 *
 *  With BrowserRouter, `useSearchParams()` reads the query string from the
 *  real URL path — so a single effect handles both `/?ref=CODE` (root) and
 *  `/signup?ref=CODE` (in-app navigation) correctly. (The HashRouter version
 *  of this component needed a separate `window.location.search` read for the
 *  root-URL case; BrowserRouter does not.)
 */
export function AffiliateRefCapture() {
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const fromUrl = searchParams.get("ref");
    if (!fromUrl) return;
    const code = normalizeAffiliateCode(fromUrl);
    if (code) storeAffiliateRef(code);
  }, [searchParams]);

  return null;
}
