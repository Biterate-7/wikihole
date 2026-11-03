import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractEntities, type EntityCandidate } from "@/lib/discovery/entity-extraction";
import { prescore } from "@/lib/hackernews/ranking";
import { submission } from "../support/hn";
import { seed, stats, universe } from "../support/fake-wikipedia";

vi.mock("@/lib/wikipedia/api", async () => (await import("../support/fake-wikipedia")).api);
vi.mock("@/lib/article", async () => (await import("../support/fake-wikipedia")).article);

const { resolveEntities, __clearResolutionCache } = await import("@/lib/wikipedia/article-resolution");
const { buildRabbitHole } = await import("@/lib/discovery/rabbit-hole-builder");

function candidate(name: string, extra: Partial<EntityCandidate> = {}): EntityCandidate {
  return { name, key: name.toLowerCase(), queries: [], fallbacks: [], source: "title", salience: 0.7, mentions: 1, signals: [], proper: true, technical: true, ...extra };
}

async function resolve(subject: string, candidates?: EntityCandidate[]) {
  const extraction = extractEntities({ subject });
  return resolveEntities(candidates ?? extraction.candidates, { text: extraction.context, disciplines: extraction.disciplines.map((d) => d.id) });
}

beforeEach(() => {
  seed();
  __clearResolutionCache();
});

describe("Wikipedia article resolution", () => {
  it("resolves exact article matches", async () => {
    const { resolved } = await resolve("Memory safety in systems programming languages", [candidate("Memory safety", { proper: false })]);
    expect(resolved[0]).toMatchObject({ title: "Memory safety", method: "exact" });
    expect(resolved[0].confidence).toBeGreaterThan(0.58);
  });

  it("resolves alternative names through redirects", async () => {
    const { resolved } = await resolve("Implementing write-ahead logging in Postgres", [candidate("Postgres")]);
    expect(resolved[0]).toMatchObject({ title: "PostgreSQL", method: "redirect" });
    expect(resolved[0].reasons.join(" ")).toMatch(/redirects “Postgres”/);
  });

  it("never stops at a disambiguation page: it searches and validates the qualified article", async () => {
    const { resolved } = await resolve("Mercury: a logic programming language with a strong type system", [candidate("Mercury")]);
    expect(resolved[0].title).toBe("Mercury (programming language)");
    expect(resolved[0].meta.disambiguation).toBe(false);
  });

  it("does not pick an unrelated exact title over the article the context means", async () => {
    const { resolved } = await resolve("Rust's memory safety guarantees, explained");
    const titles = resolved.map((r) => r.title);
    expect(titles).toContain("Rust (programming language)");
    expect(titles).not.toContain("Rust");
    expect(titles).toContain("Memory safety");
  });

  it("reports nonexistent articles as unresolved", async () => {
    const { resolved, unresolved } = await resolve("Florbnitz is great", [candidate("Florbnitz")]);
    expect(resolved).toEqual([]);
    expect(unresolved).toEqual([expect.objectContaining({ entity: "Florbnitz", reason: "no-article" })]);
  });

  it("de-duplicates entities that resolve to the same article", async () => {
    const { resolved } = await resolve("Postgres vs PostgreSQL naming", [candidate("Postgres"), candidate("PostgreSQL", { salience: 0.5 })]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].title).toBe("PostgreSQL");
    expect(resolved[0].aliases).toHaveLength(1);
  });

  it("rejects list pages and validates content", async () => {
    const { resolved, unresolved } = await resolve("Programming languages", [candidate("List of programming languages")]);
    expect(resolved).toEqual([]);
    expect(unresolved[0].entity).toBe("List of programming languages");
  });

  it("batches lookups and caches resolutions", async () => {
    await resolve("Rust's memory safety guarantees, explained");
    const first = { meta: stats.metaCalls, searches: stats.searches };
    expect(first.searches).toBeLessThanOrEqual(8);
    await resolve("Rust's memory safety guarantees, explained");
    expect(stats.searches).toBe(first.searches);
  });
});

describe("rabbit-hole builder", () => {
  const build = async (title: string, extra = {}) => {
    const s = submission({ title, ...extra });
    const extraction = extractEntities({ subject: s.subject });
    return buildRabbitHole({ submission: s, prescore: prescore(s, extraction.disciplines, extraction.candidates.length) });
  };

  it("turns a technical submission into an explorable, sourced knowledge graph", async () => {
    const hole = await build("Raft: how consensus and leader election work");
    const primary = hole.nodes.find((n) => n.role === "primary");
    expect(primary?.title).toBe("Raft (algorithm)");
    expect(hole.quality.status).toBe("complete");

    const ids = new Set(hole.nodes.map((n) => n.id));
    const pageIds = hole.nodes.filter((n) => n.pageId).map((n) => n.pageId);
    expect(new Set(pageIds).size).toBe(pageIds.length);
    for (const node of hole.nodes.filter((n) => n.level > 0)) {
      const intro = hole.edges.find((e) => e.structural && e.target === node.id);
      expect(intro, `${node.title} has an introducing edge`).toBeDefined();
      expect(ids.has(intro!.source)).toBe(true);
      expect(intro!.explanation.length).toBeGreaterThan(20);
      expect(node.url).toMatch(/^https:\/\/en\.wikipedia\.org\/wiki\//);
      expect(universe.has(node.title)).toBe(true);
    }
    const levels = new Set(hole.nodes.map((n) => n.level));
    expect(levels.has(1) && levels.has(2) && levels.has(3)).toBe(true);
    // Distinguishes relation types, each explained by where it comes from.
    const kinds = new Set(hole.edges.map((e) => e.kind));
    expect(kinds.has("prerequisite")).toBe(true);
    expect(hole.edges.filter((e) => e.kind === "prerequisite").every((e) => /opening sentence|infobox/.test(e.explanation))).toBe(true);
    // Cross-links are real links between articles in the graph.
    const cross = hole.edges.filter((e) => !e.structural);
    expect(cross.length).toBeGreaterThan(0);
    expect(cross.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
    expect(hole.entities.some((e) => e.status === "resolved" && e.title === "Raft (algorithm)")).toBe(true);
    expect(hole.summary.primary?.title).toBe("Raft (algorithm)");
  });

  it("keeps a submission with no resolvable entities out of the completed feed", async () => {
    const hole = await build("Some thoughts on florbnitz quux");
    expect(hole.quality.status).toBe("insufficient");
    expect(hole.nodes.filter((n) => n.level > 0)).toEqual([]);
    expect(hole.quality.notes.length).toBeGreaterThan(0);
  });

  it("degrades gracefully when the article body cannot be loaded", async () => {
    const hole = await build("Rust's memory safety guarantees, explained");
    // No fixture document exists for these articles: level 1 is kept, nothing is invented beyond it.
    expect(hole.nodes.filter((n) => n.level === 1).map((n) => n.title)).toEqual(expect.arrayContaining(["Rust (programming language)", "Memory safety"]));
    expect(hole.nodes.filter((n) => n.level > 1)).toEqual([]);
    expect(hole.quality.status).toBe("insufficient");
  });
});
