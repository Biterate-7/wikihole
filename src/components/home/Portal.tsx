import Link from "next/link";
import { after } from "next/server";
import { Suspense, cache } from "react";
import { LanguageMenu } from "@/components/i18n/LanguageMenu";
import { SearchBox } from "@/components/search/SearchBox";
import { ThumbImage } from "@/components/ui/ThumbImage";
import { getFeed } from "@/lib/discovery/engine";
import { GROUPS, SUBTOPICS } from "@/lib/discovery/topics";
import type { Discovery } from "@/lib/discovery/types";
import { formatCount, leadSentences } from "@/lib/format";
import { FEATURED_LANGUAGES, allLanguages, formatArticleCount, getLanguage } from "@/lib/i18n/languages";
import { attempt, describeError } from "@/lib/server/http";
import { getSiteStatistics } from "@/lib/wikipedia/api";
import { articlePath } from "@/lib/wikipedia/titles";
import { PAGEVIEW_DAYS } from "@/lib/wikipedia/types";
import { ContinueExploring } from "./ContinueExploring";
import { LanguageRing, PORTAL_SEARCH_ID } from "./LanguageRing";
import { UnexpectedConnections } from "./UnexpectedConnections";
import styles from "./home.module.css";

/** Server-side budget for live article counts; the page renders without them if Wikipedia is slow. */
const COUNTS_TIMEOUT_MS = 3500;
let menuCountsWarmed = false;

/** Warms the cache for the full language menu once per server instance, after the response is sent. */
function warmMenuCounts(): void {
  if (menuCountsWarmed) return;
  menuCountsWarmed = true;
  after(() => Promise.allSettled(allLanguages().map((l) => getSiteStatistics(l.code))));
}

function withTimeout<T>(promise: Promise<T>): Promise<T | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), COUNTS_TIMEOUT_MS));
  return Promise.race([promise.catch(() => null), timeout]);
}

async function featuredCounts(): Promise<Record<string, string | undefined>> {
  const entries = await Promise.all(
    FEATURED_LANGUAGES.map(async (code) => {
      const stats = await withTimeout(getSiteStatistics(code));
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

/** One ranked sample per request, shared by every Main Page section that shows discoveries. */
const homeFeed = cache(() => attempt(() => getFeed({ limit: 16 })));

const COLLECTIONS = Object.keys(SUBTOPICS).length;

async function WelcomeCount({ lang }: { lang: string }) {
  const language = getLanguage(lang);
  const stats = await withTimeout(getSiteStatistics(lang));
  return (
    <>
      <Link href="/topics">{COLLECTIONS} collections</Link> · <a href="#languages">{allLanguages().length} languages</a>
      {stats ? (
        <>
          {" "}
          · {stats.articles.toLocaleString("en-US")} articles in {language.englishName}
        </>
      ) : null}
    </>
  );
}

function FeedUnavailable({ error }: { error: unknown }) {
  return (
    <p className={styles.unavailable}>
      Discoveries could not be loaded from Wikipedia right now ({describeError(error).message}) Try the{" "}
      <Link href="/random">random article</Link> or <Link href="/topics">browse the topics</Link>.
    </p>
  );
}

async function FeaturedDiscovery() {
  const feed = await homeFeed();
  if (!feed.ok) return <FeedUnavailable error={feed.error} />;
  const [featured, ...rest] = feed.value.items;
  if (!featured) return <p className={styles.unavailable}>No discovery passed the quality gate in this sample.</p>;
  const href = articlePath(featured.title);
  return (
    <div className={styles.featured} data-testid="featured-discovery">
      {featured.thumbnail ? (
        <Link href={href} className={styles.featuredImage} tabIndex={-1} aria-hidden="true">
          <ThumbImage thumbnail={featured.thumbnail} size={100} />
        </Link>
      ) : null}
      <p>
        <b>
          <Link href={href}>{featured.title}</Link>
        </b>
        {featured.description ? <> ({featured.description})</> : null}: {leadSentences(featured.extract, 640)} (
        <b>
          <Link href={href}>Full article...</Link>
        </b>
        )
      </p>
      {rest.length ? (
        <p className={styles.recently}>
          Also discovered:{" "}
          {rest.slice(0, 3).map((item, i) => (
            <span key={item.pageId}>
              {i ? " · " : ""}
              <Link href={articlePath(item.title)}>{item.title}</Link>
            </span>
          ))}
        </p>
      ) : null}
      <p className={styles.boxFooter}>
        <Link href="/discover">Discover feed</Link> · <Link href="/discover?mode=obscure">Most obscure</Link> ·{" "}
        <b>
          <Link href="/discover?mode=deep">More deep articles</Link>
        </b>
      </p>
    </div>
  );
}

/** "... that X ...?" built only from Wikipedia's own metadata: the short description and pageviews. */
function DidYouKnowItem({ item }: { item: Discovery }) {
  const link = (
    <b>
      <Link href={articlePath(item.title)}>{item.title}</Link>
    </b>
  );
  const description = item.description ? item.description.charAt(0).toLowerCase() + item.description.slice(1) : null;
  if (item.recentViews !== null) {
    return (
      <li>
        ... that {link}
        {description ? `, ${/^(a|an|the) /i.test(description) ? "" : "a "}${description},` : ""} was read only{" "}
        {formatCount(item.recentViews)} times on Wikipedia in the past {PAGEVIEW_DAYS} days?
      </li>
    );
  }
  return (
    <li>
      ... that {link} is {description ? `${/^(a|an|the) /i.test(description) ? "" : "a "}${description}` : "waiting to be read"}?
    </li>
  );
}

async function DidYouKnow() {
  const feed = await homeFeed();
  if (!feed.ok) return null;
  const items = feed.value.items.slice(4, 10);
  if (items.length === 0) return null;
  return (
    <>
      <ul className={styles.dyk}>
        {items.map((item) => (
          <DidYouKnowItem key={item.pageId} item={item} />
        ))}
      </ul>
      <p className={styles.boxFooter}>
        <Link href="/random">Random article</Link> · <b>
          <Link href="/discover">More discoveries</Link>
        </b>
      </p>
    </>
  );
}

/** "On this day"-style list: discoveries whose Wikipedia categories date them. */
async function FromTheArchives() {
  const feed = await homeFeed();
  if (!feed.ok) return null;
  const dated = feed.value.items
    .filter((item) => item.date)
    .sort((a, b) => Number(a.date!.year) - Number(b.date!.year))
    .slice(0, 6);
  if (dated.length === 0) return null;
  return (
    <>
      <h2 className={`${styles.mpH2} ${styles.blueH2}`}>Through the years</h2>
      <ul className={styles.otd}>
        {dated.map((item) => (
          <li key={item.pageId}>
            <b>{item.date!.year}</b> – <Link href={articlePath(item.title)}>{item.title}</Link>
            {item.description ? `: ${item.description}` : ""}{" "}
            <span className={styles.sourced} title={`From Wikipedia category “${item.date!.sourceCategory}”`}>
              ({item.date!.label.toLowerCase()})
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function SectionSkeleton({ lines = 5 }: { lines?: number }) {
  return (
    <div aria-hidden="true" className={styles.skeleton}>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${[96, 100, 88, 94, 70, 84][i % 6]}%`, height: 14, marginBottom: 10 }} />
      ))}
    </div>
  );
}

const OTHER_AREAS = [
  { href: "/connections", title: "Unexpected connections", text: "Trails from an ordinary article to a surprising one, with the reason for every step." },
  { href: "/discover", title: "Discover", text: "A live, ranked stream of obscure and technically deep articles." },
  { href: "/topics", title: "Topics", text: `${GROUPS.length} topic areas and ${COLLECTIONS} collections defined by Wikipedia categories.` },
  { href: "/random", title: "Random article", text: "A random article that passed the quality gate, not Special:Random." },
  { href: "/search", title: "Search", text: "Full-text search with snippets in any supported language." },
  { href: "/saved", title: "Saved articles", text: "Your reading list, stored only in this browser." },
  { href: "/saved?tab=trails", title: "Rabbit-hole trails", text: "Every path you followed from one article to the next." },
];

const SOURCES = [
  { title: "Wikipedia", text: "Article text, images and links" },
  { href: "https://www.wikidata.org/", title: "Wikidata", text: "Item identifiers" },
  { href: "https://commons.wikimedia.org/", title: "Wikimedia Commons", text: "Media files" },
  { href: "https://www.mediawiki.org/wiki/API:Main_page", title: "MediaWiki API", text: "Search, metadata and parsing" },
  { href: "https://wikimedia.org/api/rest_v1/", title: "Wikimedia REST API", text: "Summaries and pageviews" },
];

/**
 * The homepage, composed as Wikipedia's Main Page: the welcome banner, the
 * green and blue boxes (today's featured discovery, did you know, topics,
 * your trail), the purple languages box with the puzzle globe, and the
 * other areas of Wikihole.
 */
export function Portal({ lang }: { lang: string }) {
  return (
    <div className={styles.mainPage} data-testid="portal">
      <div className={styles.welcome}>
        <div className={styles.welcomeTitle}>
          Welcome to <Link href="/discover">Wikihole</Link>,
        </div>
        <div className={styles.welcomeText}>
          the <Link href="/topics">curated</Link> rabbit hole of the encyclopedia that <Link href="/random">anyone can fall into</Link>.
        </div>
        <div className={styles.welcomeCount}>
          <Suspense
            fallback={
              <>
                <Link href="/topics">{COLLECTIONS} collections</Link> · <a href="#languages">{allLanguages().length} languages</a>
              </>
            }
          >
            <WelcomeCount lang={lang} />
          </Suspense>
        </div>
      </div>

      <UnexpectedConnections />

      <div className={styles.upper}>
        <div className={`${styles.column} ${styles.green}`}>
          <h2 className={`${styles.mpH2} ${styles.greenH2}`}>From today&rsquo;s featured discovery</h2>
          <Suspense fallback={<SectionSkeleton lines={8} />}>
            <FeaturedDiscovery />
          </Suspense>
          <h2 className={`${styles.mpH2} ${styles.greenH2}`}>Did you know ...</h2>
          <Suspense fallback={<SectionSkeleton lines={6} />}>
            <DidYouKnow />
          </Suspense>
        </div>

        <div className={`${styles.column} ${styles.blue}`}>
          <h2 className={`${styles.mpH2} ${styles.blueH2}`}>Explore by topic</h2>
          <ul className={styles.topics}>
            {GROUPS.map((group) => (
              <li key={group.id}>
                <b>
                  <Link href={`/topics/${group.id}`}>{group.label}</Link>
                </b>
                :{" "}
                {group.subtopics.map((slug, i) => (
                  <span key={slug}>
                    {i ? " · " : ""}
                    <Link href={`/topics/${slug}`}>{SUBTOPICS[slug].label}</Link>
                  </span>
                ))}
              </li>
            ))}
          </ul>
          <p className={styles.boxFooter}>
            <b>
              <Link href="/topics">All topics</Link>
            </b>
          </p>
          <h2 className={`${styles.mpH2} ${styles.blueH2}`}>Continue exploring</h2>
          <ContinueExploring />
          <Suspense fallback={null}>
            <FromTheArchives />
          </Suspense>
        </div>
      </div>

      <div className={`${styles.lower} ${styles.purple}`} id="languages">
        <h2 className={`${styles.mpH2} ${styles.purpleH2}`}>Wikihole in your language</h2>
        <p className={styles.lowerIntro}>
          Search and the reader work in every edition below. Choose one around the globe, or drag the globe to turn it.
        </p>
        <nav className={styles.ringWrap} aria-label="Wikipedia languages">
          <Suspense fallback={<LanguageRing counts={{}} />}>
            <RingWithCounts />
          </Suspense>
        </nav>
        <div className={styles.portalSearch}>
          <SearchBox variant="portal" inputId={PORTAL_SEARCH_ID} />
        </div>
        <div className={styles.languages}>
          <LanguageMenu />
        </div>
      </div>

      <h2 className={styles.plainH2}>Other areas of Wikihole</h2>
      <ul className={styles.areas}>
        {OTHER_AREAS.map((area) => (
          <li key={area.href}>
            <b>
              <Link href={area.href}>{area.title}</Link>
            </b>{" "}
            – {area.text}
          </li>
        ))}
      </ul>

      <h2 className={styles.plainH2}>Wikihole&rsquo;s sources</h2>
      <p className={styles.sourcesIntro}>
        Everything on Wikihole comes live from the Wikimedia projects through their public APIs. Nothing is invented:
      </p>
      <ul className={styles.sources}>
        {SOURCES.map((s) => (
          <li key={s.title}>
            {s.href ? (
              <a href={s.href} target="_blank" rel="noopener noreferrer">
                <b>{s.title}</b>
              </a>
            ) : (
              <b>{s.title}</b>
            )}
            <span>{s.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
