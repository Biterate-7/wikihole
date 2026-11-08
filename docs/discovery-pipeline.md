# The discovery pipeline

WikiHole's discovery pages read two small published datasets in `data/snapshot`. Everything in them is built offline by the pipeline in `pipeline/`. Nothing here runs during a page load.

```
 HUMAN DATASET                                                     published to data/snapshot/human
   Lemmy, Tildes, essays                                             recommended.json.gz   articles, counts, evidence, collections
     └─ ingest ─▶ data/work/human.db                                 provenance.json.gz    every qualifying source link
                    mentions, titles, article_stats                  related.json.gz       recommended in the same threads
                    └─ rules ▶ labels ▶ LLM review ▶ decide ▶ stats  meta.json             coverage and classifier quality

 KNOWLEDGE DATASET                                                 published to data/snapshot/catalogue
   Wikimedia dumps, Action API, Wikidata                             entries.json.gz       enriched articles, with Wikipedia-only ranking
     └─ load ─▶ data/work/catalogue.db                               paths.json.gz         where readers really go next
                    catalogue, edges, targets                        meta.json             scan coverage and enrichment quality
```

The two stores are separate files with separate ingestion, ranking and quality metrics. They touch in exactly two places, both through Wikipedia page ids: the `connect` command tells the catalogue which pages the human dataset wants detailed, and the human export asks the catalogue for a page's size and traffic to decide Hidden gems. The app joins them by page id for display.

## Commands

Requires Node 22.18 or later (the pipeline uses `node:sqlite`). Set `WIKIHOLE_PIPELINE_USER_AGENT` to identify your own deployment; it defaults to a User-Agent naming this repository. Every run is appended to `data/work/runs.jsonl` with its requests, retries, failures and outcome.

### Human dataset

| Step | Command | Cost and speed |
| --- | --- | --- |
| Ingest Lemmy | `npm run pipeline -- ingest:lemmy --max-pages=120` | One request per minute, the crawl delay lemmy.world asks for. The API refuses pages past 100, so the walk goes newest first to that limit, then oldest first until it meets what it has read. |
| Ingest Tildes | `npm run pipeline -- ingest:tildes --max-topics=600` | One request per 3 seconds. |
| Ingest essays | `npm run pipeline -- ingest:essays` | A few requests. Sources are listed in `pipeline/sources/essays.ts`. |
| Canonicalise titles | `npm run pipeline -- resolve` | Catalogue first, then the API for redirects and anything else, about 3 requests per second. |
| Classify | `npm run pipeline -- classify` | Rules, label files, calibration and decisions. Free. |
| LLM review | `npm run pipeline -- classify:ai --queue=ambiguous --limit=1000` | Needs `AI_API_KEY`. Spends money. See below. |
| Update statistics | `npm run pipeline -- stats` | Only articles whose decisions changed. |
| Publish | `npm run pipeline -- export:human` | Rewrites `data/snapshot/human`. |

### Knowledge dataset

| Step | Command | Cost and speed |
| --- | --- | --- |
| Full scan | `npm run pipeline -- catalogue:pages --dump-date=YYYY-MM-DD`, `catalogue:props`, `catalogue:clickstream --month=2026-10` | Offline, from the dumps below in `data/work/dumps`. About 25 minutes in all. |
| Connect | `npm run pipeline -- connect` | Records which page ids the human dataset wants detailed. |
| Enrich | `npm run pipeline -- catalogue:enrich`, `catalogue:wikidata` | About 3 requests per second, 50 articles each. Resumes where it stopped. |
| Reader paths for new targets | `npm run pipeline -- catalogue:clickstream --edges-only` | About 5 minutes. |
| Publish | `npm run pipeline -- export:catalogue` | Rewrites `data/snapshot/catalogue`. |

Dumps, from <https://dumps.wikimedia.org>: `enwiki-latest-page.sql.gz` (2.4 GB), `enwiki-latest-page_props.sql.gz` (484 MB), `clickstream-enwiki-YYYY-MM.tsv.gz` (468 MB). The working stores take about 1.3 GB.

### Inspecting

| Command | What it does |
| --- | --- |
| `npm run pipeline -- report` | Coverage, failures, decisions and queues, written to `data/snapshot/pipeline-report.json`. |
| `npm run pipeline -- verify` | Checks the snapshot against the store and live Wikipedia, written to `data/snapshot/verification.json`. |
| `npm run pipeline -- trace "Great Stink"` | Every mention of an article with its decision and link. |
| `npm run pipeline -- classify:queue --queue=ambiguous` | What is waiting for review. |
| `npm run pipeline -- eval:sheet` | A CSV of the evaluation set for a person to check. |

### Updating

```bash
npm run pipeline -- ingest:lemmy --max-pages=2
npm run pipeline -- classify
npm run pipeline -- resolve
npm run pipeline -- stats
npm run pipeline -- export:human
```

Each ingester keeps a cursor, so this fetches only what is new. Upserts are keyed on source item, lang and title, so re-running never double counts. `stats` recomputes only articles whose decided labels changed. Any step can be interrupted and re-run.

## Sources

| Source | Status | Why |
| --- | --- | --- |
| Lemmy `!wikipedia@lemmy.world` | See the report | Public API, at the crawl delay its robots.txt requests. Posts only, not comments. |
| Tildes | Partial | robots.txt welcomes informational scrapers at a reasonable rate. No API, so only topics its search returns for "wikipedia". |
| Essays and forum threads | Partial | A short list of pages written to recommend articles, each read before being listed. |
| Reddit | Not ingested | Public endpoints return 403, robots.txt disallows everything, and the Data API needs Reddit's approval. Needs credentials from you. |
| Lobsters | Not ingested | robots.txt disallows general crawlers and sets `ai-input=no`. Its JSON endpoints answer, but we do not read what it asks us not to. |

Comments on these sites belong to their authors. The snapshot keeps only a short excerpt (at most 240 characters) and always links to the original. Usernames are never stored: distinct people are counted with a keyed hash whose key stays in the working store.

## Classification

Each mention gets one of six labels: `recommendation`, `interesting`, `citation`, `casual`, `criticism`, `spam`, or stays `needs-review`. **Only `recommendation` feeds the statistics.** The pipeline prefers leaving a mention undecided to counting a doubtful one.

1. **Rules** (`pipeline/classify/heuristic.ts`). Free and deterministic. They read the words next to the link and propose a label and a reason. Praise for another work ("I recommend his book [[Foo]]"), an article about a book, film or game, or a headline unrelated to the article never passes as praise of the page.
2. **Labels** (`data/labels/`). They outrank the rules and live in the repository, so they survive a rebuild.
   - `reviewed.jsonl`: the development set, used to tune and calibrate.
   - `eval.jsonl`: the held-out evaluation set, drawn blind and never used to tune or calibrate.
   - `llm-review.jsonl`: the LLM stage's verdicts.
3. **Calibration** (`data/labels/calibration.json`). Each rule's precision is measured from labelled rows, smoothed so small samples stay humble. This is the confidence score. A rule's verdict counts automatically only with at least 15 labelled examples and precision of at least 0.85. Everything else becomes `needs-review`.
4. **LLM review** (`pipeline/classify/ai.ts`). Claude reads two queues through the Message Batches API: `ambiguous` (what the rules counted without enough measured precision) and `recall` (what they passed over despite a positive signal). A model recommendation with confidence below 0.7 goes back to `needs-review`. The held-out set is never queued.
5. **Decision** (`pipeline/classify/decide.ts`). Review outranks model, model outranks rules, and the deciding stage is recorded on every mention and published with its evidence.

### How well it works

`npm run pipeline -- export:human` measures the rules on the held-out set, stratified by what the rules said so that recall can be estimated, with 95% Wilson intervals, and publishes the result in `data/snapshot/human/meta.json`. The current numbers are in [discovery-audit.md](discovery-audit.md).

**The limit of these numbers:** the evaluation labels were written by Claude, the same model that did the LLM review. They can measure the rules independently, but they cannot measure the LLM stage independently. `eval:sheet` exports them for a person to check, and that is the honest next step.

## Ranking

### Human dataset

`src/lib/curated/rank.ts`:

- **Independent weight:** a person's k-th recommendation of an article counts 1/k, any one discussion counts for at most 2, and a shared, upvoted link counts half of someone saying so in words. A viral thread and a single enthusiast are both capped.
- **Score (0 to 100):** 50% independent weight, 25% distinct months, 15% distinct years, 10% more than one community. All saturate, and points or vote totals are deliberately not an input.
- **Focus:** the score is multiplied by a factor falling from 1 to 0.6 as an article's recommendations become a small share of all its mentions. This is what separates recommended from merely well known. An article that is cited constantly but rarely recommended does not lead anything.

| Collection | Evidence required | Order |
| --- | --- | --- |
| Most recommended | At least 3 discussions, 3 people and 3 months | Score |
| Hidden gems | At least 2 discussions and 2 people, under 15,000 visits a month, at least 4 kB | Score, discounted by traffic |
| Recently recommended | A qualifying recommendation in the last 180 days | Newest first |
| Evergreen | At least 4 distinct years, 5 months, spanning 5 or more years | Score |
| Rising | At least 2 in the last year, and at least double the earlier yearly rate | Momentum |

### Knowledge dataset

`src/lib/curated/interest.ts`. Promise is measured from Wikipedia alone: quality class, length, how many articles send readers here, and how little it is read. It knows nothing about recommendations.

## The catalogue

A complete scan loads every main-namespace, non-redirect article from the page dump, with its Wikidata item, short description and disambiguation flag from page_props, and its monthly arrivals, external share and inbound articles from the clickstream. That is the only part that covers all of Wikipedia.

Deep metadata costs one API request per 50 articles, so it covers a selected set: featured and good articles, Wikipedia's Unusual articles, a stable sample of substantial articles, and pages the human dataset asked about. It adds incoming links, ORES article topics, categories, assessment class and last revision. Wikidata `instance of` labels are fetched only for requested pages. `prop=cirrusdoc` is documented as internal to CirrusSearch and may change; responses are schema-checked, so a change would stop enrichment rather than corrupt data.

**Not scanned:** the full internal link graph (`pagelinks`, 7 GB) and the full category graph (`categorylinks`, 2.5 GB). Clickstream edges stand in for relationships, covering only links readers clicked at least 10 times in the month. Only the enriched part of the catalogue is published; the complete table stays in `data/work/catalogue.db`.

## Deploying

The app reads `data/snapshot` with `fs` at request time, and `next.config.ts` includes it in serverless bundles. If a dataset is missing, its page says it has not been built. `WIKIHOLE_SNAPSHOT_DIR` points the app elsewhere.

## Visual regression

`tests/visual/baseline` holds the screenshots of every core page taken before this work began. `npm run build && npm run test:visual` renders the same pages from recorded Wikimedia responses with seeded randomness, so any pixel difference comes from the code. Two runs of the unchanged app differed by 0.0000%. Long article sections skip painting off screen, so they are blank in those captures: `VISUAL_PAINT_ALL=1 node tests/visual/capture.mjs <dir>` paints them, and `node tests/visual/aligned.mjs <a.png> <b.png>` compares two such captures after lining up their rows, so content that only moved is not reported as changed. The recording in `tests/visual/.recording` is gitignored; create one with `node tests/visual/capture.mjs tests/visual/out/record --record`.
