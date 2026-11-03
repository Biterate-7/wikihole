import type { Metadata } from "next";
import { PageShell, SiteSub } from "@/components/layout/PageShell";
import { SiteTools } from "@/components/layout/SiteTools";
import { RandomDiscovery } from "@/components/random/RandomDiscovery";
import { EditionNotice } from "@/components/i18n/EditionNotice";
import styles from "../pages.module.css";

export const metadata: Metadata = {
  title: "Random discovery",
  description: "A random Wikipedia article that is actually worth reading: sampled, filtered and ranked.",
};

export default function RandomPage() {
  return (
    <PageShell
      title="Random article"
      tabs={{
        left: [{ label: "Random article", href: "/random", selected: true }],
        right: [
          { label: "Read", href: "/random", selected: true },
          { label: "Discover", href: "/discover" },
        ],
      }}
      tools={<SiteTools />}
    >
      <SiteSub>Something you didn&rsquo;t know existed</SiteSub>
      <p className={styles.intro}>
        Not Special:Random. Each draw mixes truly random Wikipedia pages with random samples from technical categories,
        rejects stubs, lists and trivia, and picks among the strongest survivors.
      </p>
      <EditionNotice feature="Random discovery" />
      <RandomDiscovery />
    </PageShell>
  );
}
