import { describe, expect, it } from "vitest";
import { parseArticle } from "@/lib/content/parse";
import { extractEntities } from "@/lib/discovery/entity-extraction";
import { layoutGraph, truncateLabel } from "@/lib/discovery/graph-layout";
import type { HoleEdge, HoleNode } from "@/lib/discovery/hole-types";
import { scoreRabbitHole } from "@/lib/discovery/quality-scoring";
import { linkEdges, relationFromEvidence, strongestRelation } from "@/lib/discovery/relationship-engine";
import { definitionLinks, linkEvidence } from "@/lib/wikipedia/extraction";
import { loadParseFixture } from "../support/fixtures";

const names = (subject: string, extra: { text?: string; comments?: string[]; domain?: string } = {}) =>
  extractEntities({ subject, ...extra }).candidates.map((c) => c.name);

describe("entity extraction", () => {
  it("extracts technologies, languages and concepts from technical submissions", () => {
    expect(names("Implementing CRDTs with write-ahead logging in Postgres")).toEqual(expect.arrayContaining(["CRDTs", "Postgres", "write-ahead logging"]));
    expect(names("Show HN: I built a Lisp interpreter in 200 lines of Zig")).toEqual(expect.arrayContaining(["Zig", "Lisp"]));
    expect(names("Linus Torvalds on the future of the Linux kernel")).toEqual(expect.arrayContaining(["Linux kernel", "Linus Torvalds"]));
    expect(names("Ladybird browser engine passes Acid3")).toEqual(expect.arrayContaining(["Acid3", "Ladybird"]));
  });

  it("extracts entities from scientific submissions", () => {
    const found = names("Physicists observe quantum entanglement between top quarks at the LHC");
    expect(found).toEqual(expect.arrayContaining(["LHC", "quantum entanglement", "top quarks"]));
    expect(names("How the Antikythera mechanism computed eclipses")).toContain("Antikythera mechanism");
  });

  it("avoids irrelevant words, verbs, fragments of names and HN boilerplate", () => {
    const found = names("Show HN: Ladybird browser engine passes Acid3");
    expect(found).not.toContain("Show HN");
    expect(found.some((n) => /passes/.test(n))).toBe(false);
    const torvalds = names("Linus Torvalds on the future of the Linux kernel");
    expect(torvalds).not.toContain("Torvalds");
    expect(torvalds).not.toContain("future");
    expect(names("Ask HN: How do you deal with burnout at your job?")).toEqual([]);
    expect(names("Show HN: I built a Lisp interpreter in 200 lines of Zig").some((n) => /lines/.test(n))).toBe(false);
  });

  it("ignores URLs and sentence-initial words in post bodies", () => {
    const found = names("Show HN: OmniDiff", {
      text: "Nowadays everyone diffs. Code at https://github.com/someone/omnidiff and docs on example.com/docs. Written in Rust.",
    });
    expect(found).toContain("Rust");
    expect(found.some((n) => /https|github|Nowadays|example/i.test(n))).toBe(false);
  });

  it("uses comments only as corroboration (two commenters)", () => {
    const once = names("A tiny database", { comments: ["Have you looked at SQLite?", "Nice work."] });
    expect(once).not.toContain("SQLite");
    const twice = names("A tiny database", { comments: ["Have you looked at SQLite?", "SQLite does this already."] });
    expect(twice).toContain("SQLite");
  });

  it("keeps contained terms as fallbacks and expands abbreviations", () => {
    const { candidates } = extractEntities({ subject: "Rust's memory safety guarantees, explained" });
    const phrase = candidates.find((c) => c.name === "memory safety guarantees");
    expect(phrase?.fallbacks).toContain("memory safety");
    const crdt = extractEntities({ subject: "CRDTs in practice" }).candidates.find((c) => c.name === "CRDTs");
    expect(crdt?.queries).toEqual(["Conflict-free replicated data type"]);
  });

  it("classifies the submission's disciplines", () => {
    const { disciplines } = extractEntities({ subject: "A borrow checker for Zig" });
    expect(disciplines[0].id).toBe("programming-languages");
  });
});

describe("structural link evidence", () => {
  const raft = parseArticle(loadParseFixture("raft_algorithm"));
  const enigma = parseArticle(loadParseFixture("enigma_machine"));

  it("finds the links in the defining sentence", () => {
    const links = definitionLinks(raft);
    expect(links.length).toBeGreaterThan(0);
    expect(links).toEqual(expect.arrayContaining([expect.stringMatching(/consensus/i)]));
  });

  it("locates links by intro, infobox, history sections and See also", () => {
    const evidence = linkEvidence(enigma);
    const kinds = new Set(evidence.map((e) => e.kind));
    expect(kinds.has("definition")).toBe(true);
    expect(kinds.has("lead")).toBe(true);
    expect(kinds.has("history-section")).toBe(true);
    expect(evidence.every((e) => e.title !== enigma.title)).toBe(true);
    expect(evidence.some((e) => /English$/.test(e.title))).toBe(false);
    const history = evidence.find((e) => e.kind === "history-section");
    expect(history?.detail).toBeTruthy();
  });
});

describe("relationship engine", () => {
  it("types relations by where the link appears, and explains them", () => {
    const def = relationFromEvidence("Raft (algorithm)", { title: "Consensus (computer science)", kind: "definition", position: 0 });
    expect(def.kind).toBe("prerequisite");
    expect(def.explanation).toContain("opening sentence");
    const influenced = relationFromEvidence("Rust", { title: "Zig", kind: "infobox", detail: "Influenced", position: 0 });
    expect(influenced.kind).toBe("descendant");
    const influencedBy = relationFromEvidence("Rust", { title: "OCaml", kind: "infobox", detail: "Influenced by", position: 0 });
    expect(influencedBy.kind).toBe("historical");
    expect(influencedBy.explanation).toContain("“Influenced by”");
    const history = relationFromEvidence("Enigma machine", { title: "Arthur Scherbius", kind: "history-section", detail: "History", position: 1 });
    expect(history.kind).toBe("historical");
    expect(history.level).toBe(3);
    const seeAlso = relationFromEvidence("Enigma machine", { title: "Lorenz cipher", kind: "see-also", position: 0 });
    expect(seeAlso.kind).toBe("adjacent");
    const best = strongestRelation("A", [
      { title: "B", kind: "section", detail: "Usage", position: 4 },
      { title: "B", kind: "definition", position: 0 },
    ]);
    expect(best?.kind).toBe("prerequisite");
  });

  it("adds link edges only between graph articles, once per pair, without duplicating explained edges", () => {
    const ids = new Map([
      ["A", "p1"],
      ["B", "p2"],
      ["C", "p3"],
    ]);
    const existing: HoleEdge[] = [{ id: "e", source: "p1", target: "p2", kind: "direct", label: "", explanation: "", evidence: "lead", structural: true }];
    const edges = linkEdges(
      [
        { from: "A", to: "B" },
        { from: "B", to: "C" },
        { from: "C", to: "B" },
        { from: "A", to: "Elsewhere" },
      ],
      ids,
      existing,
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: "p2", target: "p3", label: "Linked both ways", evidence: "link", structural: false });
    expect(edges[0].explanation).toContain("link to each other");
  });
});

function node(id: string, level: 0 | 1 | 2 | 3 | 4, parent?: string, extra: Partial<HoleNode> = {}): HoleNode {
  return { id, title: `Article ${id}`, level, kind: level === 0 ? "submission" : "concept", role: level === 0 ? "submission" : level === 1 ? "direct" : "prerequisite", relevance: 0.5, ...(parent ? { parent } : {}), ...extra };
}

function tree(articles: number, confidence: number): { nodes: HoleNode[]; edges: HoleEdge[] } {
  const nodes: HoleNode[] = [node("root", 0), node("p0", 1, "root", { role: "primary", confidence })];
  for (let i = 1; i < articles; i++) nodes.push(node(`p${i}`, i < 3 ? 1 : i < 7 ? 2 : 3, i < 3 ? "root" : "p0", i < 3 ? { confidence } : {}));
  const edges: HoleEdge[] = nodes
    .filter((n) => n.parent)
    .map((n) => ({ id: `${n.parent}>${n.id}`, source: n.parent!, target: n.id, kind: "direct", label: "", explanation: "x", evidence: "lead", structural: true }));
  for (let i = 2; i < articles; i++) edges.push({ id: `x${i}`, source: `p${i - 1}`, target: `p${i}`, kind: "direct", label: "", explanation: "x", evidence: "link", structural: false });
  return { nodes, edges };
}

describe("rabbit-hole quality", () => {
  const maps = (nodes: HoleNode[], v: number) => new Map(nodes.map((n) => [n.id, v]));

  it("marks a rich, confident, interlinked hole complete", () => {
    const { nodes, edges } = tree(12, 0.85);
    const q = scoreRabbitHole({ nodes, edges, articleQuality: maps(nodes, 0.7), technical: maps(nodes, 0.8) });
    expect(q.status).toBe("complete");
    expect(q.score).toBeGreaterThan(50);
    expect(q.notes).toEqual([]);
  });

  it("keeps a single weak match out of the feed", () => {
    const { nodes, edges } = tree(1, 0.6);
    const q = scoreRabbitHole({ nodes, edges, articleQuality: maps(nodes, 0.3), technical: maps(nodes, 0.2) });
    expect(q.status).toBe("insufficient");
    expect(q.notes.join(" ")).toMatch(/too uncertain|Only 1 Wikipedia article/);
  });

  it("ranks the rich hole above the weak one", () => {
    const rich = tree(12, 0.85);
    const weak = tree(3, 0.62);
    const a = scoreRabbitHole({ ...rich, articleQuality: maps(rich.nodes, 0.7), technical: maps(rich.nodes, 0.8) });
    const b = scoreRabbitHole({ ...weak, articleQuality: maps(weak.nodes, 0.4), technical: maps(weak.nodes, 0.4) });
    expect(a.score).toBeGreaterThan(b.score);
  });
});

describe("graph layout", () => {
  it("places every visible node with finite coordinates on its level's ring", () => {
    const { nodes, edges } = tree(12, 0.8);
    const layout = layoutGraph(nodes, edges, 4);
    expect(layout.nodes).toHaveLength(nodes.length);
    for (const p of layout.nodes) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      const r = Math.hypot(p.x, p.y);
      if (p.node.level === 0) expect(r).toBe(0);
      else expect(r).toBeGreaterThan(100);
    }
    const { width, height } = layout.viewBox;
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  it("filters by depth and drops edges to hidden nodes", () => {
    const { nodes, edges } = tree(12, 0.8);
    const layout = layoutGraph(nodes, edges, 1);
    expect(layout.nodes.every((p) => p.node.level <= 1)).toBe(true);
    const visible = new Set(layout.nodes.map((p) => p.node.id));
    expect(layout.edges.every((e) => visible.has(e.source) && visible.has(e.target))).toBe(true);
  });

  it("attaches orphans to the root and truncates long labels", () => {
    const nodes = [node("root", 0), node("p1", 1, "root"), node("p9", 2, "missing")];
    expect(layoutGraph(nodes, [], 4).nodes).toHaveLength(3);
    expect(truncateLabel("A very long article title that keeps going and going")).toMatch(/…$/);
  });
});
