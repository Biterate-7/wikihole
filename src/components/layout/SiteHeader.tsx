import Link from "next/link";
import { SearchLanguageSelect } from "@/components/i18n/SearchLanguageSelect";
import { SITE_SEARCH_ID, SearchBox } from "@/components/search/SearchBox";
import { SearchDialog } from "@/components/search/SearchDialog";
import { Dropdown } from "./Chrome";
import { MainMenu } from "./MainMenu";
import { UserLinks } from "./UserLinks";
import styles from "./layout.module.css";

/** Wikihole's logo: the puzzle globe beside the small-caps wordmark and tagline. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`${styles.logo} ${className ?? ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.logoIcon} src="/wikihole-globe.svg" width={50} height={50} alt="" />
      <span className={styles.logoText}>
        <span className={styles.wordmark}>Wikihole</span>
        <span className={styles.tagline}>Deeper into Wikipedia</span>
      </span>
    </span>
  );
}

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path fill="currentColor" d="M1 3v2h18V3zm0 8h18V9H1zm0 6h18v-2H1z" />
    </svg>
  );
}

export function SiteHeader() {
  return (
    <header className={styles.header}>
      <div className={styles.headerStart}>
        <Dropdown label="Main menu" icon={<MenuIcon />} hideLabel className={styles.menuToggle} panelClassName={styles.menuPanel}>
          <MainMenu place="dropdown" />
        </Dropdown>
        <Link href="/" className={styles.brand} aria-label="WikiHole main page">
          <Wordmark />
        </Link>
      </div>
      <div className={styles.headerSearch}>
        <SearchBox variant="header" inputId={SITE_SEARCH_ID} />
      </div>
      <nav className={styles.headerEnd} aria-label="Personal tools">
        <SearchDialog />
        <SearchLanguageSelect variant="header" />
        <UserLinks />
      </nav>
    </header>
  );
}

const FOOTER_LINKS = [
  { href: "/discover#ranking", label: "How ranking works" },
  { href: "/topics", label: "All topics" },
  { href: "/saved?tab=history", label: "Reading history" },
  { href: "/random", label: "Random article" },
];

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <ul className={styles.footerInfo}>
        <li>
          Article text and media come live from{" "}
          <a href="https://www.wikipedia.org/" rel="noopener noreferrer" target="_blank">
            Wikipedia
          </a>{" "}
          via the official MediaWiki API and are available under the{" "}
          <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="license noopener noreferrer" target="_blank">
            Creative Commons Attribution-ShareAlike 4.0 License
          </a>
          ; additional terms may apply. Each article links to its source and revision.
        </li>
        <li>WikiHole is an independent project and is not affiliated with the Wikimedia Foundation.</li>
      </ul>
      <ul className={styles.footerPlaces}>
        {FOOTER_LINKS.map((link) => (
          <li key={link.href}>
            <Link href={link.href} prefetch={false}>
              {link.label}
            </Link>
          </li>
        ))}
        <li>
          <a href="https://www.mediawiki.org/wiki/API:Main_page" rel="noopener noreferrer" target="_blank">
            MediaWiki API
          </a>
        </li>
      </ul>
    </footer>
  );
}
