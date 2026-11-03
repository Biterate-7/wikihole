import Link from "next/link";
import { PageShell } from "@/components/layout/PageShell";
import { SearchBox } from "@/components/search/SearchBox";
import { SiteTools } from "@/components/layout/SiteTools";
import styles from "@/app/pages.module.css";

export default function ArticleNotFound() {
  return (
    <PageShell
      title="Article not found"
      tabs={{ left: [{ label: "Article", href: "#", selected: true }], right: [{ label: "Read", href: "#", selected: true }] }}
      tools={<SiteTools />}
    >
      <div className={styles.noArticle}>
        <p>
          <b>There is no Wikipedia article with that title.</b>
        </p>
        <p>
          It may have been renamed, merged or deleted, or the link was mistyped. Search for it instead, or take a{" "}
          <Link href="/random">random discovery</Link>.
        </p>
      </div>
      <div className={styles.searchForm}>
        <SearchBox variant="hero" />
      </div>
    </PageShell>
  );
}
