import type { PageTab } from "@/components/layout/PageShell";

type DiscoverPage = "discover" | "recommended" | "explore";

/** The tabs shared by the discovery pages, in Vector's namespace and view rows. */
export function discoverTabs(current: DiscoverPage): { left: PageTab[]; right: PageTab[] } {
  const self = current === "discover" ? "/discover" : `/discover/${current}`;
  return {
    left: [
      { label: "Discover", href: "/discover", selected: current === "discover" },
      { label: "Recommended", href: "/discover/recommended", selected: current === "recommended", title: "Articles people genuinely recommend" },
      { label: "Explore", href: "/discover/explore", selected: current === "explore", title: "A catalogue of Wikipedia itself" },
      { label: "Ranking", href: "#ranking", title: "How this page is ranked" },
    ],
    right: [
      { label: "Read", href: self, selected: true },
      { label: "Topics", href: "/topics" },
      { label: "Random", href: "/random" },
    ],
  };
}
