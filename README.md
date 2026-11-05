# WikiHole

**The internet's deepest rabbit holes.** A discovery engine for obscure, technically deep Wikipedia articles: a ranked live feed, a focused reader, and Rabbit Hole navigation that follows real links between articles.

Everything shown comes live from Wikipedia through the official MediaWiki APIs. Nothing is hardcoded or invented: the ranking uses only Wikipedia metadata, every related-article connection cites its source, and optional AI analysis is verified against the article text before it is shown.

## Features

- **Interface**: every page uses one encyclopedia skin modelled on Wikipedia's Vector 2022: a header with the puzzle-globe logo, typeahead search and language button; a pinnable left sidebar (main menu, or an article's contents); Read/View tabs; and a pinnable right Tools column. Sidebars can be hidden and restored (remembered per browser) and fold into dropdowns below 1120px; phones get a compact header, a search overlay and article-first layout.
- **Main Page** (`/`): composed like Wikipedia's Main Page. A welcome banner with live counts, "From today's featured discovery" and "Did you know ..." (green), topic areas, your latest trail and dated discoveries (blue), and a purple languages box with the live WebGL puzzle globe, the ten largest editions arranged around it (each with its live article count), a search field with an inline edition selector, and the "Explore Wikihole in your language" menu.
- **Languages**: 62 Wikipedia editions. The active edition drives search, the reader, related articles and saved/history entries, persists in a cookie between visits, and can be changed from the globe, the search field, the language menu or the header picker. English articles keep their `/wiki/<Title>` URLs; other editions live at `/<lang>/wiki/<Title>`.
- **Discover feed** (`/discover`, formerly `/`; old `/?topic=…` links redirect): random samples from curated Wikipedia categories, passed through a quality gate, ranked by a transparent model, diversified, and de-duplicated across the session. Infinite scroll, ranking presets (Balanced, Deep, Obscure), topic filters, refresh, and loading, empty and error states. Each entry shows its score breakdown.
- **Recommended** (`/discover/recommended`): Wikipedia articles people genuinely recommend to each other, mined from public discussions. Collections: Most recommended, Hidden gems, Recently recommended, Evergreen and Rising, plus From your reading, built from this browser's own history. Each entry states its counts and links to what was actually said. See [docs/discovery-pipeline.md](docs/discovery-pipeline.md) and, for coverage, quality and limits, [docs/discovery-audit.md](docs/discovery-audit.md).
- **Explore Wikipedia** (`/discover/explore`): a structured catalogue of Wikipedia itself, including articles nobody has recommended, filterable by text, area and how much they are read.
- **Reader** (`/wiki/<Title>`): Wikipedia's parsed HTML transformed server-side into an allow-listed document model and rendered as a Wikipedia-style article: serif title and section headings, Article/Rabbit hole and Read/View on Wikipedia/View history tabs, a save star, a floated infobox, thumbnails, wikitables, references, a terminology and equations navbox and a categories box. It has a scroll-spied, collapsible contents sidebar, KaTeX math, tables, figures, galleries, references, infobox facts, key concepts, terminology quoted in context, an equations index, reading progress, and source and revision links. The lead streams first and the body after it.
- **Reading aids**: the contents stay in view and track the section being read (a slim sticky bar takes over on narrow screens), and section links scroll smoothly. The tools column reports the creation date, edit and contributor counts, recent activity and last edit, all from Wikimedia and left out when unavailable. The article's own typography and layout match the original design.
- **Revision history** (`/history/<Title>`): a Recent changes section on every article, plus a full history page with real diffs from Wikimedia's compare API. Added text is green, removed text is red, and each revision links to its record on Wikipedia. Revisions can be stepped through or picked for comparison.
- **Contextual explanations** (need an AI key): a few specialised terms get a dotted underline, chosen from the article's own links and definitions using Wikipedia's metadata. Hovering, tapping or tabbing to one opens a small popover with an explanation in context at Simple, Standard or Advanced level, a simpler restatement, a way to go deeper, and a link to the term's article. Selecting a passage offers Explain, Summarise, Simplify and Explore connections; long sections offer a summary beside their heading; a diff can be described in words. Generated text is always labelled, and explanations are cached on the server and in the browser. Without a key, popovers show Wikipedia's own description and selections offer the passage's links.
- **Rabbit Hole**: related articles from See also, links in the introduction, links in the body, shared categories and CirrusSearch text similarity, each labelled with its source. A breadcrumb trail tracks depth, back navigation unwinds it, and articles already on your trail are left out.
- **Topics** (`/topics`, `/topics/<slug>`): 7 groups and 40 collections, each defined by real Wikipedia categories (checked against the live API by a test).
- **Search**: a debounced header and inline combobox (keyboard navigation, Enter to open, Escape to close, `/` or Ctrl/Cmd+K), plus a full results page with highlighted snippets, suggestions and pagination.
- **Random** (`/random`): a uniformly random Wikipedia sample combined with random topical samples, run through the same gate and ranking. It shows how many candidates were rejected and why. "Another discovery" is instant because a few are queued in advance; press `N`.
- **Saved & history** (`/saved`): saved articles, reading history and exploration trails, stored in `localStorage` with schema validation. It survives corrupted data and storage failures.
- **Optional AI analysis**: on demand in the reader. Every claim must include a verbatim quote that the server finds in the article, and suggested reading must be an article the source actually links to. Anything else is discarded. The analysis is clearly labelled as AI-generated. Without a key the feature is hidden and everything else still works.

## Architecture

- **Next.js 16 (App Router) + React 19 + TypeScript (strict)**, CSS Modules with Codex-derived design tokens (`src/app/globals.css`), no UI framework.
- **Runtime dependencies:** `zod` (validates every API response and request body), `node-html-parser` (server-side article transformation), `katex` (math), `@anthropic-ai/sdk` (optional AI).
- Server components render articles and initial feeds. Client components handle only the interactive parts (feed controls, search, trail, saved state).

```
src/lib/i18n/        languages.ts (edition registry, formatting, validation)
src/lib/wikipedia/   http.ts (UA, timeouts, retries, Retry-After, concurrency, per-edition endpoints) · api.ts (typed endpoints, caching) · revisions.ts (history, counts, compare) · diff.ts (compare HTML → diff model) · titles.ts
src/lib/content/     parse.ts (HTML → allow-listed AST) · math.ts (KaTeX) · concepts.ts (key concepts, terms, equations) · terms.ts (which terms the reader marks)
src/lib/discovery/   topics.ts (taxonomy) · score.ts (features + quality gate) · select.ts (diversity) · engine.ts (feed, random, related) · config.ts (weights)
src/lib/ai/          config.ts · client.ts · insights.ts (structured output + verification) · explain.ts (terms, passages, sections, diffs; cached and verified) · grounding.ts
src/lib/storage/     store.ts (validated, failure-tolerant storage) · collections.ts (saved, history, trails)
src/components/article/ ReadingLayer (TermLayer, SelectionLayer) · SectionSummary · Toc (contents, section bar) · ArticleMetadata · RecentChanges
src/components/history/ HistoryRoute · DiffView · DiffExplain
src/components/layout/ PageShell (three-column frame, tabs) · SiteHeader · MainMenu · Portlet · pinning (hide/restore sidebars)
src/components/home/ Portal (Main Page) · LanguageRing (globe + featured editions)
src/components/i18n/ LanguageProvider · SearchLanguageSelect · LanguageMenu · EditionNotice
src/lib/curated/     links.ts (URL canonicalisation) · rank.ts (recommendation model, collections) · interest.ts · store.ts (snapshot reader) · service.ts (joins snapshot and live metadata)
src/components/curated/ RecommendedFeed · ExploreFeed · CuratedItem · CuratedTools
src/app/api/         feed · random · search · insights · explain · terms · languages · health · curated · contextual
pipeline/            offline ingestion, classification, catalogue, statistics and export (never runs during a page load)
data/snapshot/       the published discovery datasets; data/labels/ reviewed classifier labels
```

### Wikipedia integration

| Need | Endpoint |
| --- | --- |
| Candidate sampling | `action=query&list=search&srsearch=incategory:A\|B…&srsort=random` |
| Metadata (description, intro extract, thumbnail, WikiProject assessment, 14-day pageviews, categories, last edit, disambiguation) | `action=query&prop=info\|pageprops\|pageimages\|description\|extracts\|pageassessments\|pageviews\|categories\|revisions`, 20 titles per request, `continue` followed |
| Article content | `action=parse&prop=text\|categories\|displaytitle\|revid` (the lead is fetched separately with `section=0` so it can stream first) |
| Typeahead / full search | `generator=search` / `list=search` with snippets, totals and suggestions |
| Uniform random | `list=random` |
| Similar articles | `list=search&srsearch=morelike:"Title"` |
| Summaries (page metadata) | REST `GET /page/summary/{title}` |
| Edition sizes (portal counts) | `action=query&meta=siteinfo&siprop=statistics`, per edition, cached 12 h |
| Lifetime edit and contributor counts (Wikimedia stops counting at a limit, shown as `30,000+`) | core REST `GET /page/{title}/history/counts/{edits,editors}`, cached 1 h |
| Recent edits, history pages | `action=query&prop=revisions&rvprop=ids\|timestamp\|user\|size\|comment\|flags\|tags`, cached 5 min |
| Creation date | `action=query&prop=revisions&rvdir=newer&rvlimit=1`, cached 7 days |
| Revision comparison | `action=compare&prop=diff\|rel\|ids\|title\|user\|comment\|size\|timestamp`, parsed into a structured model, cached 24 h |

### Languages

`src/lib/i18n/languages.ts` is the single source of truth: code, native name, English name, text direction, number-formatting locale and the portal's word for "articles". Adding an edition is one entry there; the selectors, routes (`/<code>/wiki/<Title>`), API endpoints (`https://<code>.wikipedia.org/w/api.php`) and validation all derive from it. Codes from cookies, query strings and request bodies are validated against the registry before any URL is built.

Every Wikipedia call takes the edition explicitly and caches are keyed per edition (titles and page ids are only unique within one wiki). Article counts come live from each edition's siteinfo statistics and are never estimated: an edition that cannot be reached shows no count. The parser recognises the localised appendix headings and namespaces of the featured editions, so See also, references and `Kategorie:`-style links are handled correctly.

The homepage globe is generated by `scripts/generate-globe.mjs` (deterministic; `node scripts/generate-globe.mjs` rewrites `public/wikihole-globe.svg`).

The favicon and app icons are the Wikipedia puzzle globe, cut from `scripts/assets/wikipedia-globe-source.png` by `scripts/generate-icons.mjs` (`node scripts/generate-icons.mjs` rewrites `src/app/favicon.ico`, `src/app/icon1-3.png`, `src/app/apple-icon.png` and `public/icons/*`; Next.js turns the files in `src/app` into the `<link>` tags, and `src/app/manifest.ts` lists the install icons).

The client follows the [Wikimedia rate-limit guidance](https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits): a User-Agent with contact information (without it Wikimedia allows only 10 requests per minute), at most 3 concurrent requests (searches limited separately), 8–15 s timeouts, bounded retries with backoff, and `Retry-After` honoured. A long `Retry-After` puts the client into a cooldown instead of retrying. Responses are cached in memory (TTL + LRU, with in-flight de-duplication), and candidate pools are cached per subtopic for 20 minutes, so repeat visitors cost almost no API calls. Failed or malformed responses become typed errors and are never replaced with made-up data.

Article HTML never reaches the browser. The parser keeps only known structures (paragraphs, headings, lists, definition lists, tables, figures, quotes, code, math, references). It drops scripts, styles, attributes, navboxes and maintenance templates, and accepts images only from Wikimedia hosts. The only `dangerouslySetInnerHTML` is KaTeX output, which we generate from the article's TeX source with `trust: false`.

### Discovery model

`score = 25% technical + 20% quality + 20% depth + 15% obscurity + 10% diversity + 10% exploration`. These are the defaults; they can be overridden with `DISCOVERY_WEIGHTS`, and the presets reshape them.

- **Technical relevance:** domain vocabulary in the title, description, categories and intro.
- **Quality:** WikiProject assessment class (FA … Stub) and article length.
- **Depth:** density of formal concepts (theorems, models, algorithms), symbols, and curiosity cues (paradox, unsolved, counterintuitive).
- **Obscurity:** low 14-day pageviews, multiplied by quality, so a thin page that is rarely read never outranks a substantial one.
- **Diversity:** distance from clusters already picked in the batch, plus a hard per-cluster cap.
- **Exploration:** strength of the link to the current topic or article.

The hard gate rejects disambiguation pages, lists, date and number pages, stubs, biographies, entertainment, sports, places, organisations and non-technical pages. Successive batches exclude everything seen this session, and a small amount of ranking noise keeps refreshes from repeating.

## Environment variables

All variables are optional. See [`.env.example`](.env.example).

| Variable | Purpose |
| --- | --- |
| `WIKIMEDIA_USER_AGENT` | **Strongly recommended.** Identifies your deployment to Wikimedia, e.g. `WikiHole/1.0 (https://your.site; you@example.org)`. Without contact information Wikimedia limits requests to 10 per minute. |
| `WIKIPEDIA_API_URL`, `WIKIPEDIA_REST_URL` | Override the endpoints (another language edition, or a test double). |
| `AI_API_KEY` (or `ANTHROPIC_API_KEY`) | Enables AI analysis and contextual explanations. Server-side only. |
| `AI_PROVIDER` | `anthropic` (the only supported provider). |
| `AI_MODEL` | Claude model id. Default `claude-opus-5-5`. |
| `DISCOVERY_WEIGHTS` | JSON object of relative weights, e.g. `{"obscurity":30}`. |
| `WIKIHOLE_SNAPSHOT_DIR` | Where the app reads the discovery snapshot. Defaults to `data/snapshot`. |
| `WIKIHOLE_PIPELINE_USER_AGENT` | How the offline pipeline identifies itself to sources. |
| `AI_CLASSIFIER_MODEL` | Model for `npm run pipeline -- classify:ai`. Default `claude-opus-5-5`. |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin for metadata and Open Graph (on Vercel the deployment URL is used by default). |

## Running locally

Requires Node 20.9+.

```bash
npm install
cp .env.example .env.local   # then set WIKIMEDIA_USER_AGENT
npm run dev                  # http://localhost:3000
```

## Quality checks

```bash
npm run typecheck    # TypeScript
npm run lint         # ESLint (next/core-web-vitals + typescript)
npm test             # unit + integration tests (Vitest, hermetic, mocked fetch)
npm run test:live    # integration tests against live Wikipedia
npx playwright install chromium
npm run test:e2e     # production build + Playwright scenarios against live Wikipedia
npm run build        # production build
npm run test:visual  # after a build: pixel-compare core pages with the pre-change baseline
npm run pipeline -- report  # what the discovery pipeline read, decided and failed at
```

The test suites cover:

- **Unit:** parser (real fixtures), math, concepts, ranking, persistence, search component, AI grounding.
- **Integration:** HTTP client behaviour, API layer, engine, route handlers.
- **Live:** taxonomy categories exist, feed text matches Wikipedia's own intros, search, parsing, random filtering.
- **Languages:** registry, count formatting, paths, localised parsing, per-edition API endpoints and caches, `/api/languages`, the provider, globe, language menu and search box (unit + integration); the full portal → search → reader → related → trail journey in German, persistence, the menu and legacy redirects (end-to-end).
- **End-to-end:** homepage portal, Discover feed, search, reading, Rabbit Hole, random, saved, failure handling, responsiveness at 1440, 1280, 1024, 768 and 390 px, console errors, keyboard focus.
- **Reading experience:** metadata against Wikimedia's own numbers, revision comparison, section navigation, term marks, popovers and selection tools by mouse, keyboard and touch, and overflow at four widths across article types (`tests/e2e/reading.spec.ts`). The AI flows run against a local stand-in for the API, which exercises the interface and grounding checks but not the quality of a real model's writing:

  ```bash
  node tests/support/stub-anthropic.mjs 4599 &
  ANTHROPIC_BASE_URL=http://localhost:4599 AI_API_KEY=stub npm run start -- --port 3101 &
  E2E_AI=1 E2E_PORT=3101 npx playwright test tests/e2e/reading.spec.ts
  ```

## Deploying to Vercel

1. Push the repository to GitHub, GitLab or Bitbucket.
2. In Vercel, choose **Add New → Project**, import the repository, and keep the detected **Next.js** preset. Build command `next build`, output handled automatically.
3. Under **Settings → Environment Variables**, set `WIKIMEDIA_USER_AGENT` (with your contact) and, optionally, `AI_API_KEY`, `AI_MODEL` and `NEXT_PUBLIC_SITE_URL`.
4. Deploy. Afterwards, open `/api/health`. It should report `userAgentConfigured: true`, and `ai: true` if a key is set.

Or from the CLI: `npm i -g vercel && vercel` (first deploy), then `vercel --prod`.

## Limitations

- Caches and rate limiting are in memory, per server instance. On serverless platforms a cold instance starts with empty candidate pools: the first feed takes a few seconds, later ones are fast. A shared cache (e.g. Redis) would help at scale.
- All server traffic shares one Wikimedia rate-limit identity (about 200 requests per minute with a compliant User-Agent). Very high traffic would need Wikimedia Enterprise or more caching.
- Reading-time estimates in feeds come from search word counts or wikitext length, so they are approximate.
- Saved articles and history live in the browser. There is no account sync. From your reading sends up to eight recently read titles to the server to build its answer; they are not stored or logged.
- The discovery snapshot is as fresh as the last pipeline run. Reddit and Lobsters are not among its sources, and Explore's text filter covers only the published part of the catalogue; the search box covers all of Wikipedia. [docs/discovery-pipeline.md](docs/discovery-pipeline.md) has the details.
- Explanations are cached in memory per server instance, so a cold instance generates them again. Hovering a marked term for half a second counts as asking, which costs a model call the first time; `/api/explain` is limited to 30 requests a minute per client.
- Wikipedia reports a revision's net size change only. Added and removed characters per edit appear on the comparison page, where they are counted from the diff, and are approximate for edits that move text.
- Comparisons show wikitext, as Wikipedia's own diffs do. Rendered comparisons are not available.
- Search, the reader, related articles and saved/history work in every supported edition. Discover, Topics and Random are built on English Wikipedia's category taxonomy and ranking vocabulary, so they always show English articles; with another edition active they say so and offer a switch back to English.
- Interface text (labels, buttons) is English in every edition; article content and search are in the chosen language.
- Localised appendix headings and namespaces are recognised for the ten featured editions. In other editions "See also" is not singled out, so related articles come from links, shared categories and text similarity.
- The first time the language menu opens on a cold server instance, counts for all 62 editions are fetched (3 at a time); they are warmed in the background after the homepage renders and cached for 12 hours.
