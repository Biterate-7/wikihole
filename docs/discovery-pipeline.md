# The discovery pipeline

WikiHole's discovery pages read a small published snapshot in `data/snapshot`. Everything in it is built offline by the pipeline in `pipeline/`. Nothing here runs during a page load.

```
 SOURCES                         WORKING STORE (data/work, gitignored)            SNAPSHOT (data/snapshot, committed)
 Hacker News  ┐                  mentions ── what people said, with provenance    recommended.json.gz  articles, counts, evidence, collections
 Lemmy        ├─ ingest ───────▶ titles ──── canonical article for each link ───▶ provenance.json.gz   every qualifying source link
 Tildes       │                  article_stats ─ counts per article               related.json.gz      co-recommended and reader-path links
 Essays       ┘                                                                   catalogue.json.gz    Wikipedia knowledge dataset
                                 catalogue ─ what Wikipedia contains              meta.json            coverage, deciders, totals
 Wikimedia dumps + Action API ─▶ edges ───── how readers move between articles
```

The human dataset and the Wikipedia knowledge dataset stay in separate tables and separate files, joined only by page id.

## Commands

Requires Node 22.18 or later (the pipeline uses `node:sqlite`). Set `WIKIHOLE_PIPELINE_USER_AGENT` to identify your own deployment to Wikimedia and the other sources; it defaults to a User-Agent naming this repository.

| Step | Command | Cost and speed |
| --- | --- | --- |
| Ingest Hacker News | `npm run pipeline -- ingest:hn` | About 1 request per second. A full history took about 25 minutes; updates take seconds. |
| Ingest Lemmy | `npm run pipeline -- ingest:lemmy --max-pages=40` | One request per minute, the crawl delay lemmy.world asks for. |
| Ingest Tildes | `npm run pipeline -- ingest:tildes --max-topics=600` | One request per 3 seconds. |
| Ingest essays | `npm run pipeline -- ingest:essays` | A few requests. Sources are listed in `pipeline/sources/essays.ts`. |
| Load Wikipedia | `npm run pipeline -- catalogue:pages`, `catalogue:props`, `catalogue:clickstream --month=2026-10` | Needs the dumps below in `data/work/dumps`. |
| Canonicalise titles | `npm run pipeline -- resolve` | Catalogue first, then the API for redirects and anything else, about 3 requests per second. |
| Classify | `npm run pipeline -- classify` | Local rules plus stored reviews. Free. |
| Classify with a model | `npm run pipeline -- classify:ai --limit=1000` | Needs `AI_API_KEY`. Spends money. See below. |
| Update statistics | `npm run pipeline -- stats` | Only articles whose mentions changed. |
| Enrich the catalogue | `npm run pipeline -- catalogue:enrich`, `catalogue:wikidata` | About 3 requests per second; resumes where it stopped. |
| Publish | `npm run pipeline -- export` | Rewrites `data/snapshot`. Commit the result and deploy. |
| Inspect | `npm run pipeline -- trace "Great Stink"` | Prints every mention of an article with its label and link. |

Dumps, from <https://dumps.wikimedia.org>: `enwiki-latest-page.sql.gz` (2.4 GB), `enwiki-latest-page_props.sql.gz` (484 MB), `clickstream-enwiki-YYYY-MM.tsv.gz` (468 MB). The working store takes a few GB of disk.

### Updating

```bash
npm run pipeline -- ingest:hn
npm run pipeline -- ingest:lemmy --max-pages=2
npm run pipeline -- classify
npm run pipeline -- resolve
npm run pipeline -- stats
npm run pipeline -- export
```

Each ingester keeps a cursor, so this fetches only what is new. Upserts are keyed on source item, lang and title, so re-running never double counts. `stats` recomputes only articles listed in `dirty_titles`. Any step can be interrupted and re-run.

## Sources

| Source | Status | Why |
| --- | --- | --- |
| Hacker News | Ingested | Official Algolia API, no key. By far the richest source. |
| Lemmy `!wikipedia@lemmy.world` | Ingested | Public API, at the crawl delay its robots.txt requests. The community exists to share interesting Wikipedia articles. |
| Tildes | Partial | robots.txt welcomes informational scrapers at a reasonable rate. No API, so topics come from its search. |
| Essays and forum threads | Partial | A short list of pages written to recommend articles, each read before being listed. |
| Reddit | Not ingested | Public endpoints return 403, robots.txt disallows everything, and the Data API needs Reddit's approval. Needs credentials from you. |
| Lobsters | Not ingested | robots.txt disallows general crawlers and sets `ai-input=no`. Its JSON endpoints answer, but we do not read what it asks us not to. |

Comments on these sites belong to their authors. The snapshot keeps only a short excerpt (at most 240 characters) and always links to the original. Usernames are never stored: distinct people are counted with a keyed hash whose key stays in the working store.

## Classification

Each mention gets one of six labels: `recommendation`, `interesting`, `citation`, `casual`, `criticism`, `spam`. **Only `recommendation` feeds the statistics.**

1. `pipeline/classify/heuristic.ts`: free, deterministic, strict rules that read the words next to the link. Praise for another work ("I recommend his book [[Foo]]") or an article about a book, film or game does not count. A submission counts when at least 10 readers' points say others valued it, and news of a death never does.
2. `pipeline/classify/ai.ts`: Claude through the Message Batches API, over the mentions where the rules saw any positive signal. Run it when a key is available. Its verdicts replace the rules' and are recorded with the model's id.
3. `data/labels/reviewed.jsonl`: reviewed labels. They outrank everything and live in the repository, so they survive a rebuild.

`meta.json` and the Recommended page's tools column state exactly which deciders produced the published numbers.

## Ranking

`src/lib/curated/rank.ts`, inspired by HackerTube's approach of mining what people recommend:

- **Independent weight:** a person's k-th recommendation of an article counts 1/k, and any one discussion counts for at most 2. A viral thread and a single enthusiast are both capped.
- **Score (0 to 100):** 50% independent weight, 25% distinct months, 15% distinct years, 10% more than one community. All saturate, and points or vote totals are deliberately not an input.

| Collection | Evidence required | Order |
| --- | --- | --- |
| Most recommended | At least 3 discussions, 3 people and 3 months | Score |
| Hidden gems | At least 2 discussions and 2 people, under 15,000 visits a month, at least 4 kB | Score, discounted by traffic |
| Recently recommended | A qualifying recommendation in the last 180 days | Newest first |
| Evergreen | At least 4 distinct years, 5 months, spanning 5 or more years | Score |
| Rising | At least 2 in the last year, and at least double the earlier yearly rate | Momentum |

## The catalogue

A full scan loads every main-namespace, non-redirect article from the page dump, with its Wikidata item, short description and disambiguation flag from page_props, and its monthly arrivals, external share and inbound articles from the clickstream. That is the only part that covers all of Wikipedia.

Deep metadata costs one API request per 50 articles, so it covers a selected set: everything people recommended, featured and good articles, Wikipedia's Unusual articles, and a stable sample of substantial articles. It adds incoming links, ORES article topics, categories, assessment class and last revision. Wikidata `instance of` labels are fetched only for recommended articles. `prop=cirrusdoc` is documented as internal to CirrusSearch and may change; responses are schema-checked, so a change would stop enrichment rather than corrupt data.

**Not scanned:** the full internal link graph (`pagelinks`, 7 GB) and the full category graph (`categorylinks`, 2.5 GB). Clickstream edges stand in for relationships, covering only links readers clicked at least 10 times in the month.

## Deploying

The app reads `data/snapshot` with `fs` at request time, and `next.config.ts` includes it in serverless bundles. If the directory is missing, the pages say the dataset has not been built. `WIKIHOLE_SNAPSHOT_DIR` points the app elsewhere.

## Visual regression

`tests/visual` holds the pre-change screenshots of every core page. `npm run build && npm run test:visual` renders the same pages from recorded Wikimedia responses with seeded randomness, so any pixel difference comes from the code. Two runs of the unchanged app differed by 0.0000%. The recording in `tests/visual/.recording` is gitignored; create one with `node tests/visual/capture.mjs tests/visual/out/record --record`.
