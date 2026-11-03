"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { savedStore } from "@/lib/storage/collections";
import { useHydrated, useStore } from "@/lib/storage/hooks";
import styles from "./layout.module.css";

const LINKS: Array<{ href: string; label: string; short?: string; match: (p: string) => boolean }> = [
  { href: "/discover", label: "Discover", match: (p: string) => p.startsWith("/discover") },
  { href: "/hackernews", label: "Hacker News", short: "HN", match: (p: string) => p.startsWith("/hackernews") },
  { href: "/topics", label: "Topics", match: (p: string) => p.startsWith("/topics") },
  { href: "/random", label: "Random", match: (p: string) => p.startsWith("/random") },
  { href: "/saved", label: "Saved", match: (p: string) => p.startsWith("/saved") },
];

export function NavLinks() {
  const pathname = usePathname();
  const saved = useStore(savedStore);
  const hydrated = useHydrated();
  return (
    <ul className={styles.nav}>
      {LINKS.map((link) => {
        const current = link.match(pathname);
        return (
          <li key={link.href}>
            <Link
              href={link.href}
              className={styles.navLink}
              aria-current={current ? "page" : undefined}
              aria-label={link.short ? link.label : undefined}
            >
              {link.short ? (
                <>
                  <span className={styles.longLabel}>{link.label}</span>
                  <span className={styles.shortLabel} aria-hidden="true">
                    {link.short}
                  </span>
                </>
              ) : (
                link.label
              )}
              {link.href === "/saved" && hydrated && saved.length > 0 ? (
                <span className={styles.count} aria-label={`${saved.length} saved`}>
                  {saved.length}
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
