import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { normalizeAffiliateCode, storeAffiliateRef } from "../../lib/affiliateRef";

/** Persist ?ref= from any route so signup can attach the referral. */
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
