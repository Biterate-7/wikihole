"use client";

import { usePathname } from "next/navigation";

/** The homepage portal has its own masthead and footer; site chrome appears everywhere else. */
export function HideOnPortal({ children }: { children: React.ReactNode }) {
  return usePathname() === "/" ? null : children;
}
