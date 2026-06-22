import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { normalizeAffiliateCode, storeAffiliateRef } from "../../lib/affiliateRef";
export function AffiliateRefCapture() { const [searchParams] = useSearchParams(); useEffect(() => { const fromUrl = searchParams.get("ref"); if (!fromUrl) return; const code = normalizeAffiliateCode(fromUrl); if (code) storeAffiliateRef(code); }, [searchParams]); return null; }
