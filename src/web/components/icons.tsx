// Inline SVG icons (stroke = currentColor). Decorative: always aria-hidden.
import type { ReactNode } from "react";

function Svg({ size = 18, strokeWidth = 2, children }: { size?: number; strokeWidth?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

type IconProps = { size?: number };

export const SearchIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
);
export const PlusIcon = ({ size = 16 }: IconProps) => (
  <Svg size={size} strokeWidth={2.2}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const CloseIcon = ({ size = 14 }: IconProps) => (
  <Svg size={size} strokeWidth={2.4}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const MenuIcon = ({ size = 22 }: IconProps) => (
  <Svg size={size}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);
export const ChevronDownIcon = ({ size = 14 }: IconProps) => (
  <Svg size={size} strokeWidth={2.2}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);
export const MoonIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </Svg>
);
export const SunIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
);
export const MonitorIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </Svg>
);
