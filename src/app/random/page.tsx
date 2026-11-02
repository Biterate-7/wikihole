import type { Metadata } from "next";
import { RandomDiscovery } from "@/components/random/RandomDiscovery";
import styles from "../pages.module.css";

export const metadata: Metadata = {
  title: "Random discovery",
  description: "A random Wikipedia article that is actually worth reading: sampled, filtered and ranked.",
};

export default function RandomPage() {
  return (
    <div className="container">
      <header className={styles.pageHead}>
        <p className="label">Random</p>
        <h1 className={styles.pageTitle}>Something you didn&rsquo;t know existed.</h1>
        <p className={styles.pageSub}>
          Not Special:Random. Each draw mixes truly random Wikipedia pages with random samples from technical categories,
          rejects stubs, lists and trivia, and picks among the strongest survivors.
        </p>
      </header>
      <RandomDiscovery />
    </div>
  );
}
