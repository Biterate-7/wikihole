import type { PageTab } from "@/components/layout/PageShell";

type DiscoverPage = "discover" | "recommended" | "explore";

const RECOMMENDED: PageTab = { label: "Recommended", href: "/discover/recommended", title: "Articles people genuinely recommend" };
const EXPLORE: PageTab = { label: "Explore", href: "/discover/explore", title: "A catalogue of Wikipedia itself" };
const DISCOVER: PageTab = { label: "Discover", href: "/discover" };
const TOPICS: PageTab = { label: "Topics", href: "/topics" };
const RANDOM: PageTab = { label: "Random", href: "/random" };

/**
 * The tabs shared by the discovery pages. Other pages go in the view tabs, like
 * Topics and Random, because those fold into the tools menu on narrow screens:
 * namespace tabs would wrap and move everything below them.
 */
export function discoverTabs(current: DiscoverPage): { left: PageTab[]; right: PageTab[] } {
  switch (current) {
    case "discover":
      return {
        left: [
          { label: "Discover", href: "/discover", selected: true },
          { label: "Ranking", href: "#ranking", title: "How this feed is ranked" },
        ],
        right: [{ label: "Read", href: "/discover", selected: true }, TOPICS, RANDOM, RECOMMENDED, EXPLORE],
      };
    case "recommended":
      return {
        left: [
          { label: "Recommended", href: "/discover/recommended", selected: true },
          { label: "Ranking", href: "#ranking", title: "How recommendations count" },
        ],
        right: [{ label: "Read", href: "/discover/recommended", selected: true }, DISCOVER, EXPLORE, TOPICS, RANDOM],
      };
    case "explore":
      return {
        left: [
          { label: "Explore", href: "/discover/explore", selected: true },
          { label: "Coverage", href: "#ranking", title: "What this catalogue covers" },
        ],
        right: [{ label: "Read", href: "/discover/explore", selected: true }, DISCOVER, RECOMMENDED, TOPICS, RANDOM],
      };
  }
}
