# OG Card Image

The audit (issue #5) calls for a branded 1200×630 Open Graph / Twitter Card
image at `/public/og-card.png`. This is a design asset — it should be created
by a designer (or generated via the image-generation skill in a separate
session) using the brand guidelines:

- Dimensions: 1200 × 630 pixels
- Background: obsidian `#040406` with subtle crimson glow `rgba(220, 20, 60, 0.22)`
- Brand: "LottaCash" wordmark in Syne 800 (white → crimson gradient)
- Tagline: "Eight games. One wallet. Your level, forever."
- Optional: small lucide-style icons representing the 8 games

Once the asset is in place at `/public/og-card.png`, the OG / Twitter meta
tags in `index.html` and `src/components/Seo/Seo.tsx` will resolve correctly.
Until then, social shares will show no preview image.

## Temporary fallback

If you need a placeholder right now, you can generate one with ImageMagick:

```bash
convert -size 1200x630 xc:'#040406' \
  -font 'Syne-Bold' -pointsize 96 -fill '#dc143c' \
  -gravity center -annotate +0-30 'LottaCash' \
  -font 'Inter' -pointsize 32 -fill '#9494b0' \
  -gravity center -annotate +0+60 'Eight games. One wallet. Your level, forever.' \
  public/og-card.png
```
