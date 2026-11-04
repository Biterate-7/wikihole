import "server-only";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { CatalogueEntry, RecommendedArticle, RecommendedSnapshot, RelatedLink, SnapshotMeta } from "./types";

/**
 * Read-only access to the published snapshot in data/snapshot. Each file loads
 * once per server instance, on first use. A missing or unreadable file means an
 * empty dataset, and the pages say so: nothing here ever invents data.
 */

const SNAPSHOT_DIR = process.env.WIKIHOLE_SNAPSHOT_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), "data", "snapshot");

function readGz<T>(name: string): T | null {
  try {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(SNAPSHOT_DIR, name))).toString("utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error(`[wikihole] could not read ${name}`, error);
    return null;
  }
}

function once<T>(load: () => T): () => T {
  let loaded = false;
  let value: T;
  return () => {
    if (!loaded) {
      value = load();
      loaded = true;
    }
    return value;
  };
}

export const getMeta = once((): SnapshotMeta | null => {
  try {
    return JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, "meta.json"), "utf8")) as SnapshotMeta;
  } catch {
    return null;
  }
});

export const getRecommended = once(() => {
  const snapshot = readGz<RecommendedSnapshot>("recommended.json.gz");
  const articles = snapshot?.articles ?? [];
  return {
    collections: snapshot?.collections ?? null,
    byId: new Map<number, RecommendedArticle>(articles.map((article) => [article.id, article])),
    byTitle: new Map<string, RecommendedArticle>(articles.map((article) => [article.title, article])),
  };
});

export const getCatalogue = once(() => {
  const entries = readGz<CatalogueEntry[]>("catalogue.json.gz") ?? [];
  return { entries, byId: new Map<number, CatalogueEntry>(entries.map((entry) => [entry.id, entry])) };
});

export const getRelatedLinks = once(() => readGz<Record<number, RelatedLink[]>>("related.json.gz") ?? {});

/** All qualifying source links for one article: [url, unix time, community, decided by]. */
export const getProvenance = once(() => {
  const rows = readGz<Array<[number, string, number, string, string]>>("provenance.json.gz") ?? [];
  const byPage = new Map<number, Array<[string, number, string, string]>>();
  for (const [page, url, at, community, decidedBy] of rows) {
    const list = byPage.get(page);
    if (list) list.push([url, at, community, decidedBy]);
    else byPage.set(page, [[url, at, community, decidedBy]]);
  }
  return byPage;
});
