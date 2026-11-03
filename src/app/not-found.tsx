import Link from "next/link";
import { PageShell } from "@/components/layout/PageShell";
import { SiteTools } from "@/components/layout/SiteTools";
import styles from "./pages.module.css";

export default function NotFound() {
  return (
    <PageShell title="Page not found" tools={<SiteTools />}>
      <div className={styles.noArticle}>
        <p>
          <b>This hole goes nowhere.</b> The page you were looking for does not exist.
        </p>
        <p>
          Go to the <Link href="/">Main Page</Link>, take a <Link href="/random">random article</Link>, or browse the{" "}
          <Link href="/topics">topics</Link>.
        </p>
      </div>
    </PageShell>
  );
}
