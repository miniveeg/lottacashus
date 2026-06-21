/** Site logo asset (public/logo.png) */
export const LOGO_SRC = "/logo.png";

type BrandLogoProps = {
  className?: string;
  size?: number;
  alt?: string;
};

export function BrandLogo({ className = "", size = 36, alt = "LottaCash" }: BrandLogoProps) {
  return (
    <img
      src={LOGO_SRC}
      alt={alt}
      className={`brand-logo ${className}`.trim()}
      style={{ height: size, width: "auto" }}
      decoding="async"
    />
  );
}
