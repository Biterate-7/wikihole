import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import type { CatalogueEntry, RecommendedArticle, RecommendedSnapshot, RelatedLink } from "@/lib/curated/types";

/**
 * A tiny snapshot for tests only, written to a temporary directory and selected
 * through WIKIHOLE_SNAPSHOT_DIR. It is never read by the app in normal use.
 */

export function recommended(id: number, title: string, overrides: Partial<RecommendedArticle> = {}): RecommendedArticle {
  return {
    id,
    title,
    qualifying: 4,
    inWords: 3,
    discussions: 3,
    recommenders: 3,
    months: 3,
    years: 3,
    communities: ["Hacker News"],
    firstAt: Date.UTC(2015, 0, 1) / 1000,
    lastAt: Date.UTC(2025, 0, 1) / 1000,
    recent12m: 0,
    otherMentions: 2,
    criticism: 0,
    score: 40,
    timeline: [
      [2015, 2],
      [2025, 2],
    ],
    evidence: [
      {
        url: `https://news.ycombinator.com/item?id=${id}`,
        discussionUrl: `https://news.ycombinator.com/item?id=${id + 1}`,
        discussionTitle: "A thread",
        community: "Hacker News",
        kind: "comment",
        at: Date.UTC(2025, 0, 1) / 1000,
        excerpt: `The Wikipedia article on [[${title}]] is great.`,
        reason: "praises the Wikipedia page",
        decidedBy: "heuristic-test",
      },
    ],
    ...overrides,
  };
}

export function catalogueEntry(id: number, title: string, overrides: Partial<CatalogueEntry> = {}): CatalogueEntry {
  return { id, title, description: `About ${title}`, bytes: 30000, monthlyClicks: 900, sources: ["sample"], interest: 50, topics: ["STEM.Physics"], ...overrides };
}

export function writeSnapshot(data: {
  snapshot: RecommendedSnapshot;
  catalogue: CatalogueEntry[];
  related?: Record<number, RelatedLink[]>;
  paths?: Record<number, RelatedLink[]>;
  provenance?: Array<[number, string, number, string, string]>;
}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wikihole-snapshot-"));
  const write = (name: string, value: unknown) => fs.writeFileSync(path.join(dir, name), zlib.gzipSync(JSON.stringify(value)));
  fs.mkdirSync(path.join(dir, "human"));
  fs.mkdirSync(path.join(dir, "catalogue"));
  write("human/recommended.json.gz", data.snapshot);
  write("human/related.json.gz", data.related ?? {});
  write("human/provenance.json.gz", data.provenance ?? []);
  write("catalogue/entries.json.gz", data.catalogue);
  write("catalogue/paths.json.gz", data.paths ?? {});
  return dir;
}
