import { useId } from "react";

/**
 * A `>` shell-prompt chevron (ADB is a command-line/shell tool at heart) with a trailing dot,
 * reading like a terminal prompt waiting for input. Same artwork as `public/favicon.svg`,
 * reimplemented as a component (rather than an `<img>` pointing at it) so it can be dropped inline
 * at any size without a network/asset request, and so each instance gets its own gradient IDs via
 * `useId()` — hardcoded IDs would collide if this ever renders twice on the same page (e.g.
 * header + an empty-state illustration).
 */
export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  const uid = useId();
  const strokeId = `${uid}-stroke`;
  const bgId = `${uid}-bg`;

  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden="true">
      <defs>
        <linearGradient id={strokeId} x1="10" y1="12" x2="50" y2="50" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5eead4" />
          <stop offset="1" stopColor="#059669" />
        </linearGradient>
        <linearGradient id={bgId} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#111827" />
          <stop offset="1" stopColor="#030712" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#${bgId})`} />
      <path
        d="M14 18L32 32L14 46"
        fill="none"
        stroke={`url(#${strokeId})`}
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="45" cy="46" r="6" fill={`url(#${strokeId})`} />
    </svg>
  );
}
