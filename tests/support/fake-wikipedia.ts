import { vi } from "vitest";
import { parseArticle } from "@/lib/content/parse";
import type { ArticleDocument } from "@/lib/content/types";
import type { LinkPair } from "@/lib/wikipedia/api";
import { WikipediaError } from "@/lib/wikipedia/http";
import { normalizeTitle } from "@/lib/wikipedia/titles";
import type { PageMeta, SearchHit } from "@/lib/wikipedia/types";
import { loadParseFixture } from "./fixtures";
import { meta } from "./meta";

/**
 * A small fake Wikipedia for pipeline tests: page metadata with redirects and
 * disambiguation pages, a word-matching search, the link matrix, and real
 * parsed articles from fixtures. Use with
 * `vi.mock("@/lib/wikipedia/api", async () => (await import("../support/fake-wikipedia")).api)`.
 */

// State lives on globalThis so module re-imports (vi.resetModules) share one fake Wikipedia.
const shared = globalThis as typeof globalThis & {
  __fakeWikipedia?: {
    universe: Map<string, PageMeta>;
    redirects: Map<string, string>;
    documents: Map<string, ArticleDocument>;
    stats: { metaCalls: number; searches: number; linkCalls: number; documentLoads: number; fail: boolean; rateLimited: boolean };
  };
};
shared.__fakeWikipedia ??= {
  universe: new Map(),
  redirects: new Map(),
  documents: new Map(),
  stats: { metaCalls: 0, searches: 0, linkCalls: 0, documentLoads: 0, fail: false, rateLimited: false },
};
export const { universe, redirects, documents, stats } = shared.__fakeWikipedia;

let pageId = 1;
export function addPage(overrides: Partial<PageMeta> & { title: string }): PageMeta {
  const page = meta({ pageId: pageId++, ...overrides });
  universe.set(page.title, page);
  return page;
}

const tech = (description: string, extract: string, categories: string[], extra: Partial<PageMeta> = {}) => ({ description, extract, categories, ...extra });

export function seed(): void {
  universe.clear();
  redirects.clear();
  documents.clear();
  Object.assign(stats, { metaCalls: 0, searches: 0, linkCalls: 0, documentLoads: 0, fail: false, rateLimited: false });
  pageId = 1;

  addPage({ title: "Rust", ...tech("Iron oxide formed by corrosion", "Rust is an iron oxide, a usually reddish-brown oxide formed by the reaction of iron and oxygen in the presence of water or air moisture.", ["Corrosion", "Iron compounds"]), recentViews: 40000, assessment: "B" });
  addPage({ title: "Rust (programming language)", ...tech("General-purpose programming language", "Rust is a general-purpose programming language emphasizing performance, type safety, and concurrency. It enforces memory safety, meaning that all references point to valid memory, without a garbage collector.", ["Programming languages", "Systems programming languages", "Concurrent programming languages"]) });
  addPage({ title: "Memory safety", ...tech("State of being protected from memory access bugs", "Memory safety is the state of being protected from various software bugs and security vulnerabilities when dealing with memory access, such as buffer overflows and dangling pointers. Most high-level programming languages are memory-safe; systems languages such as C are not.", ["Software bugs", "Computer security", "Programming language concepts"]) });
  addPage({ title: "PostgreSQL", ...tech("Relational database management system", "PostgreSQL, also known as Postgres, is a free and open-source relational database management system emphasizing extensibility and SQL compliance. It supports transactions with ACID properties.", ["Relational database management systems", "Free database management systems"]) });
  redirects.set("Postgres", "PostgreSQL");
  addPage({ title: "Mercury", disambiguation: true, description: "Topics referred to by the same term", extract: "Mercury may refer to: Mercury (planet), Mercury (element), Mercury (programming language).", categories: ["Disambiguation pages"] });
  addPage({ title: "Mercury (programming language)", ...tech("Logic programming language", "Mercury is a functional logic programming language made for real-world uses. It has a strong type system and a compiler that produces efficient code.", ["Logic programming languages", "Functional languages"]) });
  addPage({ title: "List of programming languages", ...tech("Wikimedia list article", "This is an alphabetical list of notable programming languages.", ["Lists of programming languages"]) });
  addPage({ title: "Raft", disambiguation: true, description: "Topics referred to by the same term", extract: "Raft may refer to: Raft, a flat structure for support or transportation over water; Raft (algorithm).", categories: ["Disambiguation pages"] });

  // The Raft article from a real fixture, and every article it links to.
  const raft = parseArticle(loadParseFixture("raft_algorithm"));
  documents.set(raft.title, raft);
  addPage({ title: raft.title, ...tech("Consensus algorithm", "Raft is a consensus algorithm designed as an alternative to the Paxos family of algorithms. It is meant to be more understandable than Paxos by means of separation of logic, and it is formally proven safe.", ["Distributed algorithms", "Fault-tolerant computer systems"]), length: 30000 });
  for (const link of raft.links.slice(0, 60)) {
    if (universe.has(link.title)) continue;
    addPage({ title: link.title, ...tech(`Concept in distributed computing`, `${link.title} is a concept in distributed computing related to consensus, replication and fault tolerance in computer networks and algorithms.`, ["Distributed computing", "Fault-tolerant computer systems"]) });
  }
  for (const title of raft.seeAlso) {
    if (!universe.has(title)) addPage({ title, ...tech("Distributed algorithm", `${title} is an algorithm for consensus in distributed computing systems.`, ["Distributed algorithms"]) });
  }
}

function resolve(title: string): string {
  const normalized = normalizeTitle(title);
  return redirects.get(normalized) ?? normalized;
}

export const api = {
  getPagesMetaMap: vi.fn(async (titles: string[]): Promise<Map<string, PageMeta | null>> => {
    stats.metaCalls++;
    if (stats.fail) throw Object.assign(new Error("Wikipedia is down"), { name: "WikipediaError" });
    if (stats.rateLimited) throw new WikipediaError("Wikipedia is rate limiting requests", "ratelimited", 429);
    return new Map(titles.map((t) => [normalizeTitle(t), universe.get(resolve(t)) ?? null]));
  }),
  searchCandidates: vi.fn(async (query: string): Promise<SearchHit[]> => {
    stats.searches++;
    const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    return [...universe.values()]
      .filter((m) => {
        const text = `${m.title} ${m.description ?? ""}`.toLowerCase();
        return words.length > 0 && words.every((w) => text.includes(w));
      })
      .slice(0, 7)
      .map((m) => ({ pageId: m.pageId, title: m.title, size: m.length, wordCount: 2000 }));
  }),
  getMoreLike: vi.fn(async (title: string): Promise<SearchHit[]> => {
    const doc = documents.get(title);
    return (doc?.seeAlso ?? []).flatMap((t) => {
      const m = universe.get(t);
      return m ? [{ pageId: m.pageId, title: m.title, size: m.length, wordCount: 1000 }] : [];
    });
  }),
  getLinksBetween: vi.fn(async (titles: string[]): Promise<LinkPair[]> => {
    stats.linkCalls++;
    const set = new Set(titles);
    const pairs: LinkPair[] = [];
    for (const from of titles) {
      const doc = documents.get(from);
      for (const link of doc?.links ?? []) if (set.has(link.title)) pairs.push({ from, to: link.title });
      for (const to of doc?.seeAlso ?? []) if (set.has(to)) pairs.push({ from, to });
    }
    // Articles linked from Raft link back to it, as real articles tend to.
    for (const to of titles) if (to !== "Raft (algorithm)" && set.has("Raft (algorithm)") && pairs.some((p) => p.to === to)) pairs.push({ from: to, to: "Raft (algorithm)" });
    return pairs;
  }),
};

export const article = {
  fetchArticleDocument: vi.fn(async (title: string): Promise<ArticleDocument> => {
    stats.documentLoads++;
    const doc = documents.get(title);
    if (!doc) throw Object.assign(new Error("not found"), { name: "WikipediaError" });
    return doc;
  }),
};
