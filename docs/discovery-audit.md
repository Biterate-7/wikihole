# Discovery audit

What was assessed, what was built, what it actually covers, and what it does not. Figures are from the run of 4 November 2026 and can be regenerated with `npm run pipeline -- report`, which writes `data/snapshot/pipeline-report.json`. How to run the pipeline is in [discovery-pipeline.md](discovery-pipeline.md).

## Status of each dataset

| Dataset | Status | Coverage |
| --- | --- | --- |
| Wikipedia page scan | **Complete** | 7,249,474 articles from 66,384,916 page rows, dump dated 2026-10-08. Wikipedia's live count at the time of the scan was 7,259,112, so articles created after the dump are absent. |
| Wikipedia page properties | **Complete** | 17,727,673 properties read: 7,243,673 articles with a Wikidata item, 6,815,872 with a short description, 380,672 disambiguation pages. |
| Reader clickstream | **Complete for one month** | October 2026: 32,180,666 rows, click data for 4,840,195 articles. Wikimedia omits pairs seen fewer than 10 times. |
| Deep article metadata | **Partial by design** | 104,455 of the 7.2 million enriched, from 104,500 selected: 7,037 featured, 45,311 good, 7,179 unusual, 40,000 sampled, 9,206 requested by the human dataset. 45 returned no document. |
| Wikidata `instance of` | **Partial by design** | Fetched for the 9,199 requested pages that have a Wikidata item; 6,950 returned a type. |
| Full link and category graphs | **Not scanned** | `pagelinks` (7 GB) and `categorylinks` (2.5 GB). Clickstream edges stand in, covering only links readers clicked at least 10 times in the month. |
| Hacker News | **Complete** | Everything the official Algolia API returns for wikipedia.org, February 2007 to 4 November 2026. |
| Lemmy `!wikipedia@lemmy.world` | **Complete for posts** | The walk reached the community's first post: 5,345 of its 5,548 posts link to Wikipedia. Its 15,228 comments were not read. |
| Tildes | **Partial** | Only topics its search returns for "wikipedia": 104 submissions and 365 comment mentions. |
| Essays and forum threads | **Partial** | Three hand-read pages. Not a survey of the web. |
| Reddit | **Not available** | See below. Needs credentials from you. |
| Lobsters | **Not read** | Its robots.txt asks not to be. |

So Wikipedia has been comprehensively scanned for titles, Wikidata items, descriptions and click traffic. It has not been comprehensively scanned for links, categories, topics or quality classes.

## Architecture assessment

Before this work WikiHole was a stateless Next.js app: server components fetched from Wikimedia on demand, with in-memory caches, and saved articles and history lived in the browser. That is sound for reading, but it has nowhere to keep a dataset, and nothing expensive can happen during a page load.

The addition keeps that shape. A separate offline program in `pipeline/` builds two SQLite working stores (gitignored, about 1.9 GB) and publishes small read-only snapshots (18 MB, in `data/snapshot`). The app reads only those snapshots. No account, database server or new runtime service was introduced, and reading history stays in the browser. From your reading sends up to eight recent titles to the server for one answer; they are not stored.

Datasets stay separate as you asked. `data/work/human.db` and `data/work/catalogue.db` have their own ingestion, ranking, quality metrics and published folders. They touch in two places only, both by Wikipedia page id: `connect` tells the catalogue which pages to detail, and the human export asks the catalogue for a page's size and traffic to judge Hidden gems.

## Existing discovery assessment

The original Discover feed scores candidates from Wikipedia's own signals: domain vocabulary, assessment class, length, formal-concept density, pageview obscurity and diversity. It is good at surfacing substantial technical articles. It has no evidence that any person found an article worth reading, and its hard gate rejects lists, biographies and places, which are many of the articles people most often recommend.

It was kept unchanged. Its related-article lists now also use two connected signals, shown only with their source: articles recommended in the same discussions, and where readers really go next.

## Source feasibility

The approach of mining what people recommend rather than what is popular follows [HackerTube](https://karpathy.bearblog.dev/hacker-tube).

| Source | Access | Decision |
| --- | --- | --- |
| Hacker News | Official Algolia API, no key | Used. By far the richest source. |
| Lemmy | Public API. robots.txt asks for a 60-second crawl delay, which was honoured. The API refuses pages past 100, so the walk also runs oldest first. | Used, posts only. Reading comments would mean one request a minute per post. |
| Tildes | No API. robots.txt welcomes informational scrapers at a reasonable rate. | Used at one request per 3 seconds, search results only. |
| Reddit | Public endpoints returned 403, robots.txt disallows all crawlers, and the Data API needs Reddit's approval. Third-party reports say new access is closed; I could not verify that. | Not attempted further. No access was bypassed. |
| Lobsters | JSON endpoints answer, but robots.txt disallows general crawlers and sets `ai-input=no`. | Not read. |
| Wikimedia | Dumps and APIs, with a compliant User-Agent. | Used. `prop=cirrusdoc` is documented as internal and may change; responses are schema-checked, so a change stops enrichment rather than corrupting it. |

Comments keep at most a 240-character excerpt and always link to the original. Usernames are never stored: distinct people are counted with a keyed hash whose key stays in the working store.

## Dataset structure

**Human** (`data/snapshot/human`, 1 MB): `recommended.json.gz` (9,137 articles with counts, score, timeline, evidence and collection membership), `provenance.json.gz` (11,302 qualifying source links), `related.json.gz` and `meta.json` (coverage and classifier quality).

**Catalogue** (`data/snapshot/catalogue`, 18 MB): `entries.json.gz` (103,383 enriched articles with Wikipedia-only ranking; lists, disambiguation pages and very short pages are left out), `paths.json.gz` (reader paths for 107,404 articles) and `meta.json`. The complete 7.2-million-row table stays in the working store and is not published.

## Recommendation quality

### Results

| Measure | Count |
| --- | --- |
| Mentions of Wikipedia links read | 707,026 |
| Qualifying recommendations | 11,386 (1,332 in words, 10,054 shared and upvoted) |
| Articles with at least one | 9,137 |
| Discussions they come from | 11,137 |
| Decided by rules / LLM review / labels | 9,740 / 1,390 / 256 |
| Everything else | 375,923 casual, 279,237 citation, 39,823 interesting, 488 criticism, 116 spam |
| Undecided, and so not counted | 53 |

The 11,302 published links are the 11,386 qualifying mentions less non-English pages (15), titles that no longer resolve to an article (68) and posts that linked one article under two titles (2).

Collections: Most recommended 413, Hidden gems 956, Recently recommended 860, Evergreen 78, Rising 55.

### Measured precision

From `eval.jsonl`: 350 mentions drawn blind and stratified by what the rules said, never used to tune or calibrate. Intervals are 95% Wilson.

| Measure | Result | Interval |
| --- | --- | --- |
| Comment rules alone | 55 of 80 = **69%** | 58–78% |
| Submission rules | 40 of 40 = **100%** | 91–100% |
| What calibration would accept automatically, all kinds | 61 of 62 = **98%** | 91–99.7% |
| The same, comments only | 8 of 9 | 57–98%. Too few to rely on. |
| Estimated comment recall | **about 77%** | Very wide. It rests on 1 recommendation in 200 rejected rows. |

The 98% is mostly submissions (38 of 38) and essays (15 of 15), so it does not show that comments reach that level. This is why rule output alone no longer decides comments. A rule counts automatically only with at least 15 labelled examples and a measured precision of at least 0.85, and everything else went to LLM review. In the published catalogue **no comment counts on the rules alone**: of the 1,235 that count, 1,098 were decided by LLM review and 137 by labels. The rules alone decide only submissions (9,740 of the 10,054).

### Limits of these numbers

- **The evaluation labels are Claude's, not a person's.** I labelled the set blind, with the same model that did the LLM review. It measures the rules independently but cannot measure the LLM stage, and every counted comment passed through that stage or those labels. So **I cannot give you a measured precision for comments in the final catalogue**. The 66–69% rule figure is no longer what decides them, but its replacement has not been independently checked. `npm run pipeline -- eval:sheet` exports a CSV for a person to check, and that is the most useful next step.
- **The LLM review ran inside this session, not through the Batch API.** 2,173 verdicts were recorded as `claude-opus-5-5`, because no API key was available. `pipeline/classify/ai.ts` implements the batch path and has only been exercised against a stub.
- **About 24,600 comments are unreviewed.** The rules marked them "interesting" and they do not count. This is the main recall gap, and it is the queue an API key would clear.
- **Most of the catalogue is shared links, not words.** 10,054 of the 11,386 are submissions with at least 10 points, or posts in a community that exists to share articles. That is an endorsement, and is weighted at half of someone saying why.
- **Comments on Lemmy and on Tildes topics outside the search are not read.** Reddit's absence likely matters most.

### Recommended versus merely mentioned

The published counts keep these apart. The most mentioned articles barely appear as recommended:

| Article | Recommendations | Other mentions |
| --- | --- | --- |
| Betteridge's law of headlines | 3 | 996 |
| Jevons paradox | 9 | 575 |
| Goodhart's law | 3 | 526 |
| Poe's law | 1 | 442 |

Most recommended is instead led by List of lists of lists, Timeline of the far future, the Buffalo sentence, List of common misconceptions and List of inventors killed by their own invention. Every entry links to its sources. `npm run pipeline -- trace "Great Stink"` lists every mention of an article with its decision.

## Pipeline failures

Everything below is in `data/work/runs.jsonl`, and is summarised in the report. HTTP counters were added partway, so the first walks of Hacker News and Tildes have none.

| Run | Failure | Cause and resolution | Data lost |
| --- | --- | --- | --- |
| `catalogue:pages`, `catalogue:props` | 0 rows parsed | Parser expected many rows per line; current dumps have one. Fixed, tested against real rows, re-run. | None |
| `ingest:tildes`, `ingest:lemmy` | Database locked | A long statistics transaction. It now commits in batches. Resumed from cursors. | None |
| `ingest:lemmy` | HTTP 408 | Not treated as retryable. Fixed, resumed. | None |
| `ingest:lemmy` | HTTP 400 at page 101 | The API refuses pages past 100. It now walks oldest first from there, which reached the remaining 546 posts. | None |
| `catalogue:enrich` | Timeout, at 50,000 of about 100,000 | The timeout covers reading the body, which was not retried. The computer may also have been asleep. It now retries, and resumed from its checkpoint. | None |
| `catalogue:wikidata` | Schema error, twice | The schema assumed every property held an object. It now reads only `instance of`. | None |

Totals recorded across instrumented runs: 2,214 enrichment requests and 376 Wikidata requests, all HTTP 200; 61 Lemmy requests, with one 400. 2,403 English titles no longer exist and 2,083 are disambiguation pages; their 4,068 mentions are unusable and do not count.

`verify` compared the snapshot with the store and live sources. All 11 checks passed: 9,137 articles unique, 11,302 source links unique, 103,383 catalogue rows unique, 500 sampled articles recounted from stored mentions, all collections within their gates, 300 sampled page ids live with their published titles, and 60 sampled source comments still online and linking to the article. An earlier run caught one article renamed since the dump, so titles do drift; a later sample of 300 did not include it. It also caught the two double-counted posts above, which were fixed.

## Cost

| Item | Cost |
| --- | --- |
| Wikimedia, Hacker News, Lemmy and Tildes | Free. Time only: Hacker News about 25 minutes, the page scan about 25 minutes, enrichment about 90 minutes at 3 requests a second, Lemmy about 2 hours at its crawl delay. |
| Disk | About 4.9 GB while building, of which 3.4 GB are dumps. 18 MB published. |
| Hosting | No new service. The snapshot ships with the app. |
| Clearing the 24,600 recall candidates | **An estimate, not a measurement:** about $60 at Claude Opus 5.5 batch rates, at about $0.0025 a mention. Check current pricing before running. Cheaper models would cost less but were not evaluated, and using one is your decision. |
| Weekly update | Seconds to minutes of requests, plus any LLM review of new ambiguous mentions. |

## Interface differences from the original

Compared against the 16 baseline screenshots, rendered from recorded Wikimedia responses with seeded randomness. Unchanged code differed by 0.0000% between runs.

**Identical, 0.0000%:** home, saved, search, topics, topic group and Discover on mobile, 11 of the 16.

**Different:** Discover on desktop 0.05%. Articles: English desktop 6.4%, English mobile 11.1%, German desktop 8.4%, German mobile 13.3%. Those percentages are large because the changes below alter the page height, so everything after them is compared against different content.

Every remaining difference, and why it stays:

| Where | Difference | Reason |
| --- | --- | --- |
| Discover, desktop (0.05%) | Recommended and Explore links in the right-hand tabs | The new pages have to be reachable. Only that tab row changes, and on mobile they fold into Tools. |
| Article | Dotted underline under a few terms | PR #7's inline explanations. |
| Article, end | A Recent changes section, with a Contents entry and a Tools link | PR #7's revision history. This changes the page height. |
| Article, English | The lead's "Cite error" list is gone | A bug fix from PR #7. The original printed broken references in the article's opening. |
| Article, German | The lead's duplicate reference list is gone | The same fix. The References section still lists them. |
| Article, Tools | Created, History facts, and Recommended by people when there is evidence | PR #7's facts and the human dataset. Adds rows to the rail, not the article. |
| Article, Rabbit hole | "Recommended N times" beside a related article, when true | The human dataset. Can wrap to a second line on narrow screens. |

Content below those removals moves up, and at the new position reference marks and a few floated figures land up to a few pixels differently because of rounding. Lines wrap around floats as before.

**PR #7 changes I reversed, because they restyled the original rather than adding a feature:** text limited to 44rem, different body size and line height, a separate font stack, smaller contents, heading spacing, the opening paragraph moved above the infobox on mobile, the description line under the title, full-width landscape images on mobile, and bold "(Top)" at the top of the page.

**A decision worth checking:** PR #7 placed the history facts in a line under the title. That moved the whole article down by 22px on desktop and 60px on mobile, so I moved them into the Tools column's "This article" section. All the facts and links remain, but on mobile they are now one tap away, in Tools. If you prefer PR #7's placement, it is a small change.

**A blind spot closed:** long sections skip painting when off screen, so the baselines are blank in the middle of each article, about 7,600 rows on the English desktop capture. To cover it, I rebuilt the commit before PR #7, painted every section in both builds and compared them after aligning rows (`tests/visual/aligned.mjs`). The bands I inspected were the differences above. This is a build-to-build comparison, not one against your screenshots, and I inspected samples rather than every band.

## Validation

Final run, on the published snapshot and a production build.

| Check | Result |
| --- | --- |
| Typecheck, lint | Clean |
| Unit and integration | 312 passed, 4 skipped (the skipped ones need live Wikipedia and ran separately) |
| Live Wikipedia | 4 passed |
| Production build | Succeeded |
| End to end, against live Wikipedia | 82 passed, 1 flaky, 10 skipped (the skipped ones need a model and ran separately) |
| Reading experience with a stub model | 41 passed, 3 skipped (these only apply with no model) |
| Desktop and mobile visual comparison | As above |
| Pipeline `verify` | 11 of 11 checks passed |

**The flaky test:** "shows Wikimedia's own numbers" failed once and passed on retry, and failed the same way in each earlier full run. I logged the traffic: after about 250 requests the server gets HTTP 429 with a 12-second `Retry-After`, and during that cooldown the next page shows "Wikipedia is rate limiting us right now". Which test it hits depends on timing, and other tests failed this way at higher concurrency. This is the app's existing behaviour, and it could reach real users on a cold server under heavy traffic.

**Not covered:** inline explanations ran only against the stub, never a real model, because no API key was available. Run locally with a compliant `WIKIMEDIA_USER_AGENT`; without one, Wikimedia allows 10 requests a minute and 39 end-to-end tests fail.

## Implementation plan, and what is left

Done: both pipelines, the classifier stages and evaluation, ranking and collections, Recommended and Explore, Contextual Discovery through related articles and From your reading, PR #7's integration and the visual harness. Random Discovery and the original Discover are unchanged.

What would most improve this, in order:

1. **A person checks the evaluation sheet.** This is the only way to measure the final catalogue's precision independently.
2. **An API key for the recall queue**, about 24,600 comments. It needs your decision on cost and model.
3. **Reddit access**, if you have or can get approved credentials.
4. **Lemmy comments and more Tildes**, which only need time.
5. **`pagelinks` and `categorylinks`**, if Explore should go beyond the enriched set.
