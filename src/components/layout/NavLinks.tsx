"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { savedStore } from "@/lib/storage/collections";
import { useHydrated, useStore } from "@/lib/storage/hooks";
import styles from "./layout.module.css";

const LINKS = [
  { href: "/", label: "Discover", match: (p: string) => p === "/" },
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
            <Link href={link.href} className={styles.navLink} aria-current={current ? "page" : undefined}>
              {link.label}
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
