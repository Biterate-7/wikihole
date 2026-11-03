import Link from "next/link";
import { SearchLanguageSelect } from "@/components/i18n/SearchLanguageSelect";
import { SearchDialog } from "@/components/search/SearchDialog";
import { NavLinks } from "./NavLinks";
import styles from "./layout.module.css";

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`${styles.wordmark} ${className ?? ""}`}>
      <span className={styles.mark} aria-hidden="true" />
      WIKIHOLE
    </span>
  );
}

export function SiteHeader() {
  return (
    <header className={styles.header}>
      <nav className={`container ${styles.headerInner}`} aria-label="Main">
        <Link href="/" className={styles.brand} aria-label="WikiHole home">
          <Wordmark />
        </Link>
        <div className={styles.headerRight}>
          <NavLinks />
          <SearchLanguageSelect variant="header" />
          <SearchDialog />
        </div>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.footerInner}`}>
        <div className={styles.footerBrand}>
          <Wordmark />
          <p>The internet&rsquo;s deepest rabbit holes.</p>
        </div>
        <p className={styles.footerNote}>
          Article text and media come live from{" "}
          <a href="https://www.wikipedia.org/" rel="noopener noreferrer" target="_blank">
            Wikipedia
          </a>{" "}
          via the official MediaWiki API, and are available under the{" "}
          <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="license noopener noreferrer" target="_blank">
            Creative Commons Attribution-ShareAlike 4.0 License
          </a>
          . Each article links to its source and revision. WikiHole is an independent project, not affiliated with the
          Wikimedia Foundation.
        </p>
        <ul className={styles.footerLinks}>
          <li>
            <Link href="/discover#ranking">How ranking works</Link>
          </li>
          <li>
            <Link href="/topics">All topics</Link>
          </li>
          <li>
            <Link href="/saved?tab=history">Reading history</Link>
          </li>
        </ul>
      </div>
    </footer>
  );
}
