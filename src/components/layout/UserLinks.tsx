"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { savedStore } from "@/lib/storage/collections";
import { useHydrated, useStore } from "@/lib/storage/hooks";
import styles from "./layout.module.css";

/** Header utility links: the reader's library, like Wikipedia's watchlist and contributions. */
export function UserLinks() {
  const pathname = usePathname();
  const saved = useStore(savedStore);
  const hydrated = useHydrated();
  return (
    <ul className={styles.userLinks}>
      <li>
        <Link href="/saved" aria-current={pathname === "/saved" ? "page" : undefined} prefetch={false}>
          Saved
          {hydrated && saved.length > 0 ? (
            <span className={styles.count} aria-label={`${saved.length} saved`}>
              {saved.length}
            </span>
          ) : null}
        </Link>
      </li>
      <li>
        <Link href="/saved?tab=history" prefetch={false}>
          History
        </Link>
      </li>
    </ul>
  );
}
