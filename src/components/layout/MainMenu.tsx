"use client";

import { usePathname } from "next/navigation";
import { GROUPS } from "@/lib/discovery/topics";
import { savedStore } from "@/lib/storage/collections";
import { useHydrated, useStore } from "@/lib/storage/hooks";
import { PinnableHeader } from "./Chrome";
import { Portlet } from "./Portlet";
import styles from "./layout.module.css";

const NAVIGATION = [
  { href: "/", label: "Main page", match: (p: string) => p === "/" },
  { href: "/discover", label: "Discover", match: (p: string) => p.startsWith("/discover") },
  { href: "/hackernews", label: "Hacker News", match: (p: string) => p.startsWith("/hackernews") },
  { href: "/topics", label: "Topics", match: (p: string) => p === "/topics" },
  { href: "/random", label: "Random article", match: (p: string) => p.startsWith("/random") },
  { href: "/search", label: "Search", match: (p: string) => p.startsWith("/search") },
];

/**
 * The main menu: site navigation, the reader's library and the topic areas.
 * Pinned in the left sidebar on index pages, and in the header's ☰ dropdown
 * everywhere (articles pin their contents there instead).
 */
export function MainMenu({ place }: { place: "sidebar" | "dropdown" }) {
  const pathname = usePathname();
  const saved = useStore(savedStore);
  const hydrated = useHydrated();
  const count = hydrated && saved.length > 0 ? saved.length : 0;

  return (
    <nav className={styles.mainMenu} aria-label={place === "sidebar" ? "Main menu" : "Site menu"}>
      <PinnableHeader label="Main menu" panel="main-menu" place={place} />
      <Portlet
        id={`${place}-navigation`}
        items={NAVIGATION.map((item) => ({ href: item.href, label: item.label, current: item.match(pathname) }))}
      />
      <Portlet
        id={`${place}-library`}
        heading="Your library"
        items={[
          {
            href: "/saved",
            label: count ? (
              <>
                Saved articles <span className={styles.menuCount}>({count})</span>
              </>
            ) : (
              "Saved articles"
            ),
            current: pathname.startsWith("/saved"),
          },
          { href: "/saved?tab=history", label: "Recent discoveries" },
          { href: "/saved?tab=trails", label: "Rabbit-hole trails" },
        ]}
      />
      <Portlet
        id={`${place}-topics`}
        heading="Topic areas"
        items={GROUPS.map((g) => ({ href: `/topics/${g.id}`, label: g.label, current: pathname === `/topics/${g.id}` }))}
      />
    </nav>
  );
}
