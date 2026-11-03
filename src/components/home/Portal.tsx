import Link from "next/link";
import { after } from "next/server";
import { Suspense } from "react";
import { LanguageMenu } from "@/components/i18n/LanguageMenu";
import { SearchBox } from "@/components/search/SearchBox";
import { FEATURED_LANGUAGES, allLanguages, formatArticleCount, getLanguage } from "@/lib/i18n/languages";
import { getSiteStatistics } from "@/lib/wikipedia/api";
import { LanguageRing, PORTAL_SEARCH_ID } from "./LanguageRing";
import styles from "./home.module.css";

/** Server-side budget for live article counts; the ring renders without them if Wikipedia is slow. */
const COUNTS_TIMEOUT_MS = 3500;
let menuCountsWarmed = false;

/** Warms the cache for the full language menu once per server instance, after the response is sent. */
function warmMenuCounts(): void {
  if (menuCountsWarmed) return;
  menuCountsWarmed = true;
  after(() => Promise.allSettled(allLanguages().map((l) => getSiteStatistics(l.code))));
}

async function featuredCounts(): Promise<Record<string, string | undefined>> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), COUNTS_TIMEOUT_MS));
  const entries = await Promise.all(
    FEATURED_LANGUAGES.map(async (code) => {
      const stats = await Promise.race([getSiteStatistics(code).catch(() => null), timeout]);
      return [code, stats ? formatArticleCount(stats.articles, getLanguage(code)) : undefined] as const;
    }),
  );
  return Object.fromEntries(entries);
}

async function RingWithCounts() {
  const counts = await featuredCounts();
  warmMenuCounts();
  return <LanguageRing counts={counts} />;
}

const DESTINATIONS = [
  {
    href: "/discover",
    title: "Discover",
    blurb: "Ranked deep articles",
    icon: (
      <>
        <circle cx="16" cy="16" r="12.5" />
        <path d="m20.8 11.2-3.2 6.4-6.4 3.2 3.2-6.4z" />
      </>
    ),
  },
  {
    href: "/topics",
    title: "Topics",
    blurb: "Curated collections",
    icon: (
      <>
        <rect x="4.5" y="4.5" width="9.5" height="9.5" />
        <rect x="18" y="4.5" width="9.5" height="9.5" />
        <rect x="4.5" y="18" width="9.5" height="9.5" />
        <rect x="18" y="18" width="9.5" height="9.5" />
      </>
    ),
  },
  {
    href: "/random",
    title: "Random",
    blurb: "A filtered surprise",
    icon: <path d="M4 9.5h4.5c7.2 0 7.2 13 14.4 13H28M4 22.5h4.5c2.6 0 4.2-1.7 5.6-3.8M24.5 19l3.5 3.5-3.5 3.5M18 13.3c1.3-2 2.8-3.8 4.9-3.8H28M24.5 6 28 9.5 24.5 13" />,
  },
  {
    href: "/saved",
    title: "Saved",
    blurb: "Reading list & trails",
    icon: <path d="M9 4.5h14v23l-7-5.2-7 5.2z" />,
  },
];

/**
 * The homepage: an encyclopedia portal. Wordmark, the featured editions
 * around the globe, search in the active edition, the full language list,
 * and the ways into the rest of WikiHole.
 */
export function Portal() {
  return (
    <div className={styles.portal} data-testid="portal">
      <header className={styles.brand}>
        <h1 className={styles.wordmark}>
          <span className={styles.wordmarkInitial}>W</span>ikihole
        </h1>
        <p className={styles.tagline}>Explore the world&rsquo;s knowledge</p>
      </header>

      <nav className={styles.featured} aria-label="Wikipedia languages">
        <Suspense fallback={<LanguageRing counts={{}} />}>
          <RingWithCounts />
        </Suspense>
      </nav>

      <div className={styles.search}>
        <SearchBox variant="portal" inputId={PORTAL_SEARCH_ID} />
      </div>

      <div className={styles.languages}>
        <LanguageMenu />
      </div>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.about}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/wikihole-globe.svg" width={44} height={44} alt="" className={styles.aboutMark} />
            <p>
              Wikihole is an independent reader for Wikipedia. Article text and media come live from Wikipedia and are
              available under the{" "}
              <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="license noopener noreferrer" target="_blank">
                CC BY-SA 4.0 license
              </a>
              . Not affiliated with the Wikimedia Foundation.
            </p>
          </div>
          <ul className={styles.destinations} aria-label="Explore Wikihole">
            {DESTINATIONS.map((d) => (
              <li key={d.href}>
                <Link href={d.href} className={styles.destination}>
                  <svg
                    className={styles.destinationIcon}
                    width="32"
                    height="32"
                    viewBox="0 0 32 32"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    {d.icon}
                  </svg>
                  <span>
                    <span className={styles.destinationTitle}>{d.title}</span>
                    <span className={styles.destinationBlurb}>{d.blurb}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </footer>
    </div>
  );
}
