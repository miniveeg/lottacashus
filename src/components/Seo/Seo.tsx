import { Helmet } from "react-helmet-async";

interface SeoProps {
  title: string;
  description?: string;
  /** Path-relative URL (e.g. "/mines"); defaults to "/". */
  path?: string;
  /** Optional OG image override (path-relative or absolute URL). */
  image?: string;
  /** When true, emits <meta name="robots" content="noindex,nofollow"> so
   *  auth-gated / admin / legal-transactional pages are not indexed. */
  noindex?: boolean;
  /** Optional JSON-LD structured-data object rendered as a
   *  <script type="application/ld+json"> (e.g. a FAQPage, BreadcrumbList,
   *  or VideoObject schema). The Organization schema for the home page is
   *  emitted automatically when `path === "/"`; pass `jsonLd` for any
   *  additional per-page structured data. */
  jsonLd?: object;
}

const DEFAULT_DESCRIPTION =
  "LottaCash — play eight provably fair house games with one wallet. Deposit SOL, LTC, or ETH. Cash out Sweeps Coins for real crypto.";
const DEFAULT_OG_IMAGE = "/og-card.png";
const SITE_URL = "https://lottacash.us";

/** Organization schema emitted on the home page so search engines can
 *  surface brand metadata, logo, and support contact in rich results. */
const ORGANIZATION_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "LottaCash",
  url: SITE_URL,
  logo: `${SITE_URL}/logo.png`,
  description: DEFAULT_DESCRIPTION,
  contactPoint: {
    "@type": "ContactPoint",
    contactType: "customer support",
    email: "support@lottacash.us",
    url: `${SITE_URL}/help`,
  },
} as const;

/**
 * Per-page SEO head tags. Renders a normalized <title>, meta description,
 * canonical URL, Open Graph tags, and Twitter card tags.
 *
 * Title is automatically suffixed with " — LottaCash" unless the page is
 * the home page (which uses the brand-first pattern "LottaCash — Crypto Casino").
 *
 * Pass `noindex` for pages that should not appear in search results:
 * auth pages (login/signup/forgot), account pages (settings/deposit/withdraw/
 * redeem), and the admin panel. These are either transactional (no value to
 * searchers) or expose user state.
 *
 * On the home page (`path === "/"`), an Organization JSON-LD block is emitted
 * automatically. Pass `jsonLd` to attach additional structured data on any
 * page (e.g. FAQPage on /help).
 */
export function Seo({
  title,
  description = DEFAULT_DESCRIPTION,
  path = "/",
  image = DEFAULT_OG_IMAGE,
  noindex = false,
  jsonLd,
}: SeoProps) {
  const isHome = path === "/";
  const fullTitle = isHome ? "LottaCash — Crypto Casino" : `${title} — LottaCash`;
  const url = `${SITE_URL}${path}`;
  const imageUrl = image.startsWith("http") ? image : `${SITE_URL}${image}`;

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      {noindex && <meta name="robots" content="noindex,nofollow" />}

      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="LottaCash" />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={imageUrl} />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={imageUrl} />

      {/* Structured data. Organization schema is emitted automatically on the
          home page; callers pass additional blocks (e.g. FAQPage) via jsonLd. */}
      {isHome && (
        <script type="application/ld+json">
          {JSON.stringify(ORGANIZATION_SCHEMA)}
        </script>
      )}
      {jsonLd && (
        <script type="application/ld+json">
          {JSON.stringify(jsonLd)}
        </script>
      )}
    </Helmet>
  );
}
