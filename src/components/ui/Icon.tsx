/** Minimal stroke icons drawn for WikiHole (no icon font, no emoji). */

type IconName = "bookmark" | "bookmark-filled" | "search" | "arrow-right" | "arrow-up-right" | "refresh" | "close" | "shuffle" | "corner-down-right";

const PATHS: Record<IconName, React.ReactNode> = {
  bookmark: <path d="M4.5 2.5h7v11l-3.5-2.6-3.5 2.6z" />,
  "bookmark-filled": <path d="M4.5 2.5h7v11l-3.5-2.6-3.5 2.6z" fill="currentColor" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.25" />
      <path d="m10.2 10.2 3.3 3.3" />
    </>
  ),
  "arrow-right": <path d="M2.5 8h11M9.5 4l4 4-4 4" />,
  "arrow-up-right": <path d="M5 11 11 5M6 4.5h5.5V10" />,
  refresh: <path d="M13 8a5 5 0 1 1-1.5-3.55M13 2.5v3h-3" />,
  close: <path d="m4 4 8 8M12 4l-8 8" />,
  shuffle: <path d="M2.5 4.5h2.2c3.6 0 3.6 7 7.2 7h1.6M2.5 11.5h2.2c1.3 0 2.1-.9 2.8-2M11.5 9.5l2 2-2 2M9.4 6.3c.6-1 1.3-1.8 2.5-1.8h1.6M11.5 2.5l2 2-2 2" />,
  "corner-down-right": <path d="M3 3v5.5h10M9.5 5l3.5 3.5L9.5 12" />,
};

export function Icon({ name, size = 14, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
