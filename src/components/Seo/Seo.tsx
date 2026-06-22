import { Helmet } from "react-helmet-async";

interface SeoProps {
  title: string;
  description?: string;
  /** Path-relative URL (e.g. "/mines"); defaults to "/". */
  path?: string;
  /** Optional OG image override (path-relative or absolute URL). */
  image?: string;
}

const DEFAULT_DESCRIPTION =
  "LottaCash — play eight provably fair house games with one wallet. Deposit SOL, LTC, or ETH. Cash out Sweeps Coins for real crypto.";
const DEFAULT_OG_IMAGE = "/og-card.png";
const SITE_URL = "https://lottacash.us";

/**
 * Per-page SEO head tags. Renders a normalized <title>, meta description,
 * canonical URL, Open Graph tags, and Twitter card tags.
 *
 * Title is automatically suffixed with " — LottaCash" unless the page is
 * the home page (which uses the brand-first pattern "LottaCash — Crypto Casino").
 */
export function Seo({ title, description = DEFAULT_DESCRIPTION, path = "/", image = DEFAULT_OG_IMAGE }: SeoProps) {
  const isHome = path === "/";
  const fullTitle = isHome ? "LottaCash — Crypto Casino" : `${title} — LottaCash`;
  const url = `${SITE_URL}${path}`;
  const imageUrl = image.startsWith("http") ? image : `${SITE_URL}${image}`;

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />

      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="LottaCash" />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={imageUrl} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={imageUrl} />
    </Helmet>
  );
}
