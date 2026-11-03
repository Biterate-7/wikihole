import { describe, expect, it } from "vitest";
import { buildRabbitHole } from "@/lib/discovery/rabbit-hole-builder";
import { extractEntities } from "@/lib/discovery/entity-extraction";
import { getItem, getStoryIds } from "@/lib/hackernews/client";
import { discoverSubmissions } from "@/lib/hackernews/ingestion";
import { prescore } from "@/lib/hackernews/ranking";
import { resolveEntities } from "@/lib/wikipedia/article-resolution";
import { submission } from "../support/hn";

/**
 * Hits the real Hacker News and Wikipedia APIs. Run with `npm run test:live`.
 * Assertions are structural (real data changes daily) except for a few
 * well-known, stable resolutions.
 */
const live = process.env.LIVE_WIKIPEDIA === "1";

describe.skipIf(!live)("live Hacker News integration", { timeout: 120000 }, () => {
  it("reads every story list and item metadata", async () => {
    for (const list of ["top", "best", "new", "ask", "show"] as const) {
      const ids = await getStoryIds(list);
      expect(ids.length, list).toBeGreaterThan(10);
    }
    const [id] = await getStoryIds("top");
    const item = await getItem(id);
    expect(item).toMatchObject({ id, type: expect.stringMatching(/story|job|poll/) });
    expect(await getItem(1)).toMatchObject({ id: 1, title: "Y Combinator" });
  });

  it("discovers and normalises real submissions", async () => {
    const { submissions } = await discoverSubmissions([{ list: "top", take: 15 }, { list: "show", take: 5 }]);
    expect(submissions.length).toBeGreaterThan(8);
    for (const s of submissions) {
      expect(s.hnUrl).toBe(`https://news.ycombinator.com/item?id=${s.id}`);
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.time).toBeGreaterThan(Date.UTC(2007, 0, 1));
    }
  });

  it("resolves well-known entities to the right articles", async () => {
    const cases: Array<[string, string]> = [
      ["Rust's memory safety guarantees, explained", "Rust (programming language)"],
      ["Implementing CRDTs with write-ahead logging in Postgres", "PostgreSQL"],
      ["I turned DOOM into a Transformer with NumPy", "Transformer (deep learning)"],
      ["How the Antikythera mechanism computed eclipses", "Antikythera mechanism"],
    ];
    for (const [subject, expected] of cases) {
      const extraction = extractEntities({ subject });
      const { resolved } = await resolveEntities(extraction.candidates, { text: extraction.context, disciplines: extraction.disciplines.map((d) => d.id) });
      expect(resolved.map((r) => r.title), subject).toContain(expected);
    }
  });

  it("builds a connected rabbit hole from Wikipedia", async () => {
    const s = submission({ title: "Implementing CRDTs with write-ahead logging in Postgres" });
    const extraction = extractEntities({ subject: s.subject });
    const hole = await buildRabbitHole({ submission: s, prescore: prescore(s, extraction.disciplines, extraction.candidates.length) });
    expect(hole.quality.status).toBe("complete");
    expect(hole.nodes.filter((n) => n.level > 0).length).toBeGreaterThanOrEqual(10);
    expect(hole.edges.filter((e) => !e.structural).length).toBeGreaterThan(5);
    for (const e of hole.edges) expect(e.explanation.length).toBeGreaterThan(15);
  });
});
