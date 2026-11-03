# WikiHole

**The internet's deepest rabbit holes.** A discovery engine for obscure, technically deep Wikipedia articles: a ranked live feed, a focused reader, and Rabbit Hole navigation that follows real links between articles.

Everything shown comes live from Wikipedia through the official MediaWiki APIs. Nothing is hardcoded or invented: the ranking uses only Wikipedia metadata, every related-article connection cites its source, and optional AI analysis is verified against the article text before it is shown.

## Features

- **Interface**: every page uses one encyclopedia skin modelled on Wikipedia's Vector 2022: a header with the puzzle-globe logo, typeahead search and language button; a pinnable left sidebar (main menu, or an article's contents); Read/View tabs; and a pinnable right Tools column. Sidebars can be hidden and restored (remembered per browser) and fold into dropdowns below 1120px; phones get a compact header, a search overlay and article-first layout.
- **Main Page** (`/`): composed like Wikipedia's Main Page. A welcome banner with live counts, "From today's featured discovery" and "Did you know ..." (green), topic areas, your latest trail and dated discoveries (blue), and a purple languages box with the live WebGL puzzle globe, the ten largest editions arranged around it (each with its live article count), a search field with an inline edition selector, and the "Explore Wikihole in your language" menu.
- **Languages**: 62 Wikipedia editions. The active edition drives search, the reader, related articles and saved/history entries, persists in a cookie between visits, and can be changed from the globe, the search field, the language menu or the header picker. English articles keep their `/wiki/<Title>` URLs; other editions live at `/<lang>/wiki/<Title>`.
- **Discover feed** (`/discover`, formerly `/`; old `/?topic=…` links redirect): random samples from curated Wikipedia categories, passed through a quality gate, ranked by a transparent model, diversified, and de-duplicated across the session. Infinite scroll, ranking presets (Balanced, Deep, Obscure), topic filters, refresh, and loading, empty and error states. Each entry shows its score breakdown.
- **Reader** (`/wiki/<Title>`): Wikipedia's parsed HTML transformed server-side into an allow-listed document model and rendered as a Wikipedia-style article: serif title and section headings, Article/Rabbit hole and Read/View on Wikipedia/View history tabs, a save star, a floated infobox, thumbnails, wikitables, references, a terminology and equations navbox and a categories box. It has a scroll-spied, collapsible contents sidebar, KaTeX math, tables, figures, galleries, references, infobox facts, key concepts, terminology quoted in context, an equations index, reading progress, and source and revision links. The lead streams first and the body after it.
- **Rabbit Hole**: related articles from See also, links in the introduction, links in the body, shared categories and CirrusSearch text similarity, each labelled with its source. A breadcrumb trail tracks depth, back navigation unwinds it, and articles already on your trail are left out.
- **Topics** (`/topics`, `/topics/<slug>`): 7 groups and 40 collections, each defined by real Wikipedia categories (checked against the live API by a test).
- **Search**: a debounced header and inline combobox (keyboard navigation, Enter to open, Escape to close, `/` or Ctrl/Cmd+K), plus a full results page with highlighted snippets, suggestions and pagination.
- **Hacker News** (`/hackernews`, `/hackernews/<id>`): technical and intellectually interesting Hacker News submissions, each turned into a rabbit hole of Wikipedia articles. Hacker News finds the topics; Wikipedia explains them. Each submission gets a short grounded explanation, its primary article, related articles grouped by relation (core concepts, prerequisites, history, descendants, adjacent), an interactive knowledge graph with four exploration depths, and a transparent list of what was extracted and how it matched. The original submission and its discussion stay one click away. See [Hacker News discovery](#hacker-news-discovery).
- **Random** (`/random`): a uniformly random Wikipedia sample combined with random topical samples, run through the same gate and ranking. It shows how many candidates were rejected and why. "Another discovery" is instant because a few are queued in advance; press `N`.
- **Saved & history** (`/saved`): saved articles, reading history and exploration trails, stored in `localStorage` with schema validation. It survives corrupted data and storage failures.
- **Optional AI analysis**: on demand in the reader. Every claim must include a verbatim quote that the server finds in the article, and suggested reading must be an article the source actually links to. Anything else is discarded. The analysis is clearly labelled as AI-generated. Without a key the feature is hidden and everything else still works.

## Architecture

- **Next.js 16 (App Router) + React 19 + TypeScript (strict)**, CSS Modules with Codex-derived design tokens (`src/app/globals.css`), no UI framework.
- **Runtime dependencies:** `zod` (validates every API response and request body), `node-html-parser` (server-side article transformation), `katex` (math), `@anthropic-ai/sdk` (optional AI).
- Server components render articles and initial feeds. Client components handle only the interactive parts (feed controls, search, trail, saved state).

```
src/lib/i18n/        languages.ts (edition registry, formatting, validation)
src/lib/wikipedia/   http.ts (UA, timeouts, retries, Retry-After, concurrency, per-edition endpoints) · api.ts (typed endpoints, caching) · titles.ts
src/lib/content/     parse.ts (HTML → allow-listed AST) · math.ts (KaTeX) · concepts.ts (key concepts, terms, equations)
src/lib/discovery/   topics.ts (taxonomy) · score.ts (features + quality gate) · select.ts (diversity) · engine.ts (feed, random, related) · config.ts (weights)
src/lib/ai/          config.ts · insights.ts (structured output + verification) · grounding.ts
src/lib/storage/     store.ts (validated, failure-tolerant storage) · collections.ts (saved, history, trails)
src/lib/hackernews/  client.ts (Firebase API) · normalization.ts · ingestion.ts · ranking.ts · service.ts (queue, persistence, queries)
src/lib/discovery/   entity-extraction.ts · topic-classification.ts · relationship-engine.ts · rabbit-hole-builder.ts · quality-scoring.ts · graph-layout.ts
src/lib/wikipedia/   article-resolution.ts (entity → validated article) · extraction.ts (where an article links: definition, infobox, sections)
src/lib/server/      http.ts (rate limiting, errors) · persistence.ts (durable JSON documents)
src/components/layout/ PageShell (three-column frame, tabs) · SiteHeader · MainMenu · Portlet · pinning (hide/restore sidebars)
src/components/home/ Portal (Main Page) · LanguageRing (globe + featured editions)
src/components/i18n/ LanguageProvider · SearchLanguageSelect · LanguageMenu · EditionNotice
src/app/api/         feed · random · search · insights · languages · health · hackernews · hackernews/[id]
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

### Languages

`src/lib/i18n/languages.ts` is the single source of truth: code, native name, English name, text direction, number-formatting locale and the portal's word for "articles". Adding an edition is one entry there; the selectors, routes (`/<code>/wiki/<Title>`), API endpoints (`https://<code>.wikipedia.org/w/api.php`) and validation all derive from it. Codes from cookies, query strings and request bodies are validated against the registry before any URL is built.

Every Wikipedia call takes the edition explicitly and caches are keyed per edition (titles and page ids are only unique within one wiki). Article counts come live from each edition's siteinfo statistics and are never estimated: an edition that cannot be reached shows no count. The parser recognises the localised appendix headings and namespaces of the featured editions, so See also, references and `Kategorie:`-style links are handled correctly.

The homepage globe is generated by `scripts/generate-globe.mjs` (deterministic; `node scripts/generate-globe.mjs` rewrites `public/wikihole-globe.svg`).

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

## Hacker News discovery

Hacker News is a discovery source; Wikipedia remains the knowledge source. Nothing is hardcoded: submissions come from the official [Hacker News API](https://github.com/HackerNews/API), articles and links from Wikipedia.

1. **Ingestion.** The Top, Best, Show HN, Ask HN and New lists are read from `hacker-news.firebaseio.com/v0` and de-duplicated across lists (a story keeps every list it appears in). Each item is fetched once (cached, 12 concurrent requests, timeouts, exponential backoff) and normalised: plain-text title and body, category (story, Ask/Show/Tell/Launch HN), domain, trailing year, and the discussion URL kept for attribution. Deleted, dead, job and poll items are dropped.
2. **Pre-ranking.** A cheap score from the title, body and domain decides what is worth processing. Career advice, hiring, promotion and general news are penalised or filtered; research and source-code domains, older material and cues such as papers, internals and explanations are rewarded. Popularity is a minor, log-scaled, capped signal.
3. **Entity extraction.** Deterministic and source-grounded: every candidate is a phrase that appears in the title, the post, or (only when raised by two commenters) the first comments. A small phrase grammar accepts names (acronyms, internal capitals, alphanumeric names), names with a head noun ("Linux kernel"), and technical noun phrases ("write-ahead logging"); verbs, adverbs, URLs and fragments of names are excluded. Common abbreviations expand to search queries ("CRDT"), and contained terms are kept as fallbacks ("memory safety" inside "memory safety guarantees").
4. **Article resolution.** Exact titles are looked up in one batched metadata query (redirects are how Wikipedia records alternative names); unresolved entities are searched, one CirrusSearch query at a time. Every candidate article is validated rather than taking the first hit: title agreement (exact, inflection, redirect, acronym), qualifier fit ("Rust (programming language)" vs "Rust (band)"), context similarity, agreement between the submission's and the article's disciplines (judged without the entity's own name, so the iron-oxide "Rust" cannot claim to be about programming), and article quality. A common word whose exact article lies outside the submission's main discipline also gets a qualified search ("Transformer" → "Transformer (deep learning)"). Disambiguation pages, lists, dates and generic link targets are never destinations. Matches collapse by page, and resolutions (including failures) are cached.
5. **Rabbit hole.** The primary article and the next two are parsed, and where they link becomes typed, explained relations: the defining sentence (prerequisite), the introduction (core concept), infobox rows such as "Influenced by" or "Paradigms", History and Legacy sections (historical, descendant), Applications, and See also. Levels: **1** articles named in the submission, **2** prerequisites and core concepts, **3** deeper technical and historical connections, **4** See also entries outside the submission's discipline and CirrusSearch-similar articles, the latter kept only if a real link ties them to the graph. Finally one `prop=links&pltitles=` query returns which graph articles link to which, so every cross-edge is a real Wikipedia link. Every edge's explanation names the place in Wikipedia it comes from.
6. **Quality and final ranking.** A rabbit hole is complete only if its primary article matched with confidence of at least 0.65 and it reaches at least 6 articles with a quality score of at least 45 (coverage, match confidence, depth, interlinking, article quality, technicality). Weaker holes are kept out of the feed (still viewable directly, clearly labelled) and retried later. The final score is `22% technical depth + 16% novelty + 12% topic relevance + 12% entity richness + 14% Wikipedia coverage + 14% connections + 10% engagement`, configurable with `HN_RANKING_WEIGHTS`.

**Processing and limits.** Submissions are processed once per builder version; later ingestions only refresh points and comments. Builds run in a bounded queue: two at a time for a first visit (which waits up to about 12 s, then the page refreshes itself as more holes are ready), one at a time in the background after responses (Next.js `after`) and at least 30 s apart, at most 8 builds per 10 minutes (each costs roughly 15–25 Wikipedia requests, almost all cached afterwards). Background work pauses while the Wikipedia client is cooling down after a rate limit, so it never starves search or the reader; builds interrupted that way are requeued without using a retry. Failed builds retry with exponential backoff. Any Hacker News story id can be opened at `/hackernews/<id>`; it is built on demand.

**Persistence.** Processed submissions and rabbit holes are stored as one validated JSON document (`hackernews.json`), written atomically and debounced, in `WIKIHOLE_DATA_DIR` (default `.data/`, gitignored). On a read-only filesystem it falls back to the OS temp directory, then to memory; storage failures never break a request.

## Environment variables

All variables are optional. See [`.env.example`](.env.example).

| Variable | Purpose |
| --- | --- |
| `WIKIMEDIA_USER_AGENT` | **Strongly recommended.** Identifies your deployment to Wikimedia, e.g. `WikiHole/1.0 (https://your.site; you@example.org)`. Without contact information Wikimedia limits requests to 10 per minute. |
| `WIKIPEDIA_API_URL`, `WIKIPEDIA_REST_URL` | Override the endpoints (another language edition, or a test double). |
| `AI_API_KEY` (or `ANTHROPIC_API_KEY`) | Enables AI analysis. Server-side only. |
| `AI_PROVIDER` | `anthropic` (the only supported provider). |
| `AI_MODEL` | Claude model id. Default `claude-opus-5-5`. |
| `DISCOVERY_WEIGHTS` | JSON object of relative weights, e.g. `{"obscurity":30}`. |
| `HN_RANKING_WEIGHTS` | JSON object of relative Hacker News ranking weights (`technical`, `novelty`, `relevance`, `entities`, `coverage`, `connections`, `engagement`). |
| `WIKIHOLE_DATA_DIR` | Directory for server-side data (processed Hacker News rabbit holes). Default `.data/`; `:memory:` disables disk storage. |
| `HACKER_NEWS_API_URL` | Override the Hacker News API base URL (default `https://hacker-news.firebaseio.com/v0`). |
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
```

The test suites cover:

- **Unit:** parser (real fixtures), math, concepts, ranking, persistence, search component, AI grounding; Hacker News normalisation and ranking, entity extraction, topic classification, link evidence, relationship typing, rabbit-hole quality, graph layout, and the Hacker News UI (feed states, cards, graph interaction, exploration view).
- **Integration:** HTTP client behaviour, API layer, engine, route handlers; the Hacker News client (lists, items, deleted and missing items, retries, failures), ingestion, entity resolution (exact, redirect, disambiguation, unrelated exact titles, nonexistent, de-duplication, list pages, caching), the rabbit-hole builder on a real parsed article, the service (filtering, no reprocessing, metadata refresh, failed and rate-limited builds, on-demand builds), routes and durable storage.
- **Live:** taxonomy categories exist, feed text matches Wikipedia's own intros, search, parsing, random filtering; Hacker News lists and items, well-known entity resolutions, and a complete rabbit hole built from live data.
- **Languages:** registry, count formatting, paths, localised parsing, per-edition API endpoints and caches, `/api/languages`, the provider, globe, language menu and search box (unit + integration); the full portal → search → reader → related → trail journey in German, persistence, the menu and legacy redirects (end-to-end).
- **End-to-end:** homepage portal, Discover feed, search, reading, Rabbit Hole, random, saved, failure handling, responsiveness at 1440, 1280, 1024, 768 and 390 px, console errors, keyboard focus; the Hacker News feed, opening a rabbit hole, Wikipedia links (checked against Wikipedia), the graph and depth control, unknown items, and mobile layout.

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
- Saved articles and history live in the browser. There is no account sync.
- Hacker News entity extraction is deterministic. It reads the title, post and first comments, not the linked page, so a terse title that names nothing ("I quit") produces no rabbit hole by design. It reads English only, and rabbit holes are built from English Wikipedia whatever edition is selected.
- Link evidence comes from the three main articles; links made through redirects are not seen by the link-matrix query, so a few real connections can be missing (never invented).
- The Hacker News store is a single JSON document per server instance. On serverless platforms without a writable disk it lives in the temp directory or memory, so cold instances rebuild; a shared database would be the next step at scale.
- Search, the reader, related articles and saved/history work in every supported edition. Discover, Topics and Random are built on English Wikipedia's category taxonomy and ranking vocabulary, so they always show English articles; with another edition active they say so and offer a switch back to English.
- Interface text (labels, buttons) is English in every edition; article content and search are in the chosen language.
- Localised appendix headings and namespaces are recognised for the ten featured editions. In other editions "See also" is not singled out, so related articles come from links, shared categories and text similarity.
- The first time the language menu opens on a cold server instance, counts for all 62 editions are fetched (3 at a time); they are warmed in the background after the homepage renders and cached for 12 hours.
