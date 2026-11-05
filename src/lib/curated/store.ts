import "server-only";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { CatalogueEntry, CatalogueMeta, HumanMeta, RecommendedArticle, RecommendedSnapshot, RelatedLink } from "./types";

/**
 * Read-only access to the two published datasets, data/snapshot/human and
 * data/snapshot/catalogue. They share nothing but page ids. Each file loads
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

function readMeta<T>(name: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, name), "utf8")) as T;
  } catch {
    return null;
  }
}

export const getHumanMeta = once(() => readMeta<HumanMeta>("human/meta.json"));
export const getCatalogueMeta = once(() => readMeta<CatalogueMeta>("catalogue/meta.json"));

export const getRecommended = once(() => {
  const snapshot = readGz<RecommendedSnapshot>("human/recommended.json.gz");
  const articles = snapshot?.articles ?? [];
  return {
    collections: snapshot?.collections ?? null,
    byId: new Map<number, RecommendedArticle>(articles.map((article) => [article.id, article])),
    byTitle: new Map<string, RecommendedArticle>(articles.map((article) => [article.title, article])),
  };
});

export const getCatalogue = once(() => {
  const entries = readGz<CatalogueEntry[]>("catalogue/entries.json.gz") ?? [];
  return { entries, byId: new Map<number, CatalogueEntry>(entries.map((entry) => [entry.id, entry])) };
});

/** Connections from both datasets for one page: threads it shared, then paths readers took. */
export const getRelatedLinks = once(() => {
  const coRecommended = readGz<Record<number, RelatedLink[]>>("human/related.json.gz") ?? {};
  const paths = readGz<Record<number, RelatedLink[]>>("catalogue/paths.json.gz") ?? {};
  return (pageId: number): RelatedLink[] => {
    const links = [...(coRecommended[pageId] ?? [])];
    for (const link of paths[pageId] ?? []) {
      if (links.length >= 8) break;
      if (!links.some((known) => known.id === link.id)) links.push(link);
    }
    return links;
  };
});

/** All qualifying source links for one article: [url, unix time, community, decided by]. */
export const getProvenance = once(() => {
  const rows = readGz<Array<[number, string, number, string, string]>>("human/provenance.json.gz") ?? [];
  const byPage = new Map<number, Array<[string, number, string, string]>>();
  for (const [page, url, at, community, decidedBy] of rows) {
    const list = byPage.get(page);
    if (list) list.push([url, at, community, decidedBy]);
    else byPage.set(page, [[url, at, community, decidedBy]]);
  }
  return byPage;
});
