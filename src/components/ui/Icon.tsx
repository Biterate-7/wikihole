/** Small filled icons in the style of Wikipedia's Codex icon set (no icon font, no emoji). */

type IconName =
  | "bookmark"
  | "bookmark-filled"
  | "search"
  | "arrow-right"
  | "arrow-up-right"
  | "refresh"
  | "close"
  | "shuffle"
  | "corner-down-right"
  | "article"
  | "star"
  | "star-filled"
  | "language";

const PATHS: Record<IconName, React.ReactNode> = {
  bookmark: <path d="M5 1a2 2 0 0 0-2 2v16l7-5 7 5V3a2 2 0 0 0-2-2zm10 14.25-5-3.5-5 3.5V3h10z" />,
  "bookmark-filled": <path d="M5 1a2 2 0 0 0-2 2v16l7-5 7 5V3a2 2 0 0 0-2-2z" />,
  search: <path d="M12.2 13.6a7 7 0 1 1 1.4-1.4l5.4 5.4-1.4 1.4zM3 8a5 5 0 1 0 10 0A5 5 0 0 0 3 8" />,
  "arrow-right": <path d="M8.59 3.42 14.17 9H2v2h12.17l-5.58 5.59L10 18l8-8-8-8z" />,
  "arrow-up-right": <path d="M17 17H3V3h5V1H3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5h-2zM19 1h-8l3.29 3.29-5.73 5.73 1.42 1.42 5.73-5.73L19 9z" />,
  refresh: <path d="M15.65 4.35A8 8 0 1 0 17.4 13h-2.22a6 6 0 1 1-1-7.22L11 9h7V2z" />,
  close: <path d="m4.34 2.93 12.73 12.73-1.41 1.41L2.93 4.35zm11.32 0 1.41 1.41L4.35 17.07l-1.41-1.41z" />,
  shuffle: <path d="m15 3 4 3.5-4 3.5V7.5h-1.6c-1.1 0-1.9.6-2.6 1.6L9.9 10.4 8.7 8.8l.5-.8c1-1.5 2.3-2.5 4.2-2.5H15zM1 5.5h3.6c1.9 0 3.2 1 4.2 2.5l2.4 3.9c.7 1 1.5 1.6 2.6 1.6H15V11l4 3.5-4 3.5v-2.5h-1.2c-1.9 0-3.2-1-4.2-2.5l-2.4-3.9C6.5 8.1 5.7 7.5 4.6 7.5H1zm0 7h3.6c1.1 0 1.9-.6 2.6-1.6l.5-.8 1.2 1.6-.1.2c-1 1.5-2.3 2.6-4.2 2.6H1z" />,
  "corner-down-right": <path d="M3 2v9a2 2 0 0 0 2 2h9.17l-3.58 3.59L12 18l6-6-6-6-1.41 1.41L14.17 11H5V2z" />,
  article: <path d="M5 1a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm0 3h5v1H5zm0 2h5v1H5zm0 2h5v1H5zm10 7.5H5v-1h10zm0-2H5v-1h10zm0-2H5v-1h10zm0-2H5v-1h10zm0-2.5h-4V4h4z" />,
  star: <path d="M20 7h-7L10 0 7 7H0l5.46 5.47-1.64 7 6.18-3.7 6.18 3.73-1.63-7zm-10 6.9-3.76 2.27 1-4.28L4 8.62h4.3L10 4.6l1.7 4h4.3l-3.24 3.25 1 4.28z" />,
  "star-filled": <path d="M20 7h-7L10 0 7 7H0l5.46 5.47-1.64 7 6.18-3.7 6.18 3.73-1.63-7z" />,
  language: <path d="M20 18h-1.44a.6.6 0 0 1-.4-.12.8.8 0 0 1-.23-.31L17 15h-5l-1 2.54a.8.8 0 0 1-.22.3.6.6 0 0 1-.4.14H9l4.55-11.47h1.89zm-3.53-4.31L14.89 9.5a12 12 0 0 1-.39-1.24q-.09.37-.19.69l-.19.56-1.58 4.19zm-6.3-1.58a13.4 13.4 0 0 1-2.91-1.41 11.46 11.46 0 0 0 2.81-5.37H12V4H7.31a4 4 0 0 0-.2-.56C6.87 2.79 6.6 2 6.6 2l-1.47.5s.4.89.6 1.5H0v1.33h2.15A11.23 11.23 0 0 0 5 10.7a17.2 17.2 0 0 1-5 2.1q.56.82.87 1.38a23.3 23.3 0 0 0 5.22-2.51 15.6 15.6 0 0 0 3.56 1.77zM3.63 5.33h4.91a8.1 8.1 0 0 1-2.45 4.45 9.1 9.1 0 0 1-2.46-4.45" />,
};

export function Icon({ name, size = 14, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" focusable="false" className={className}>
      {PATHS[name]}
    </svg>
  );
}
