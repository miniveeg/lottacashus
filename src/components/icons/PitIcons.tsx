import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

function stroke(props: P) {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
    ...props,
  };
}

export function IconBomb(props: P) {
  return (
    <svg {...stroke(props)}>
      <circle cx="12" cy="13" r="6" />
      <path d="M16 8.5l1.5-1.5" />
      <path d="M17.5 7c.6-1.2.4-2.2 0-3" />
    </svg>
  );
}

export function IconVault(props: P) {
  return (
    <svg {...stroke(props)}>
      <rect x="4" y="7" width="16" height="12" rx="1" />
      <path d="M5 7V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1" />
      <circle cx="12" cy="13" r="1.25" />
      <path d="M9 13h6" />
    </svg>
  );
}

export function IconChart(props: P) {
  return (
    <svg {...stroke(props)}>
      <path d="M4 18h16" />
      <path d="M5 14l4-4 3 2 5-7 3 3" />
    </svg>
  );
}

export function IconWheel(props: P) {
  return (
    <svg {...stroke(props)}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 4v4M12 16v4M4 12h4M16 12h4" />
    </svg>
  );
}

export function IconCards(props: P) {
  return (
    <svg {...stroke(props)}>
      <rect x="7" y="4" width="10" height="14" rx="1" />
      <path d="M5 8v10a1 1 0 0 0 1 1h9" />
    </svg>
  );
}

export function IconGem(props: P) {
  return (
    <svg {...stroke(props)}>
      <path d="M12 3.5l7 5-7 12.5L5 8.5z" />
      <path d="M5 8.5h14" />
    </svg>
  );
}

export function IconCrate(props: P) {
  return (
    <svg {...stroke(props)}>
      <rect x="4" y="9" width="16" height="11" rx="1" />
      <path d="M4 9l8-4 8 4" />
      <path d="M12 5v15" />
    </svg>
  );
}

export function IconSwords(props: P) {
  return (
    <svg {...stroke(props)}>
      <path d="M6 19L16 6" />
      <path d="M18 19L8 6" />
      <path d="M5 16l3 3M16 19l3-3" />
    </svg>
  );
}

export function IconWallet(props: P) {
  return (
    <svg {...stroke(props)}>
      <rect x="3.5" y="7" width="17" height="12" rx="1.5" />
      <path d="M4 7l1.5-2.5h13L20 7" />
      <rect x="14" y="12" width="6.5" height="3.5" rx="0.5" />
    </svg>
  );
}

export function IconLogin(props: P) {
  return (
    <svg {...stroke(props)}>
      <path d="M14 5h5v14h-5" />
      <path d="M4 12h12" />
      <path d="M12 8l4 4-4 4" />
    </svg>
  );
}
