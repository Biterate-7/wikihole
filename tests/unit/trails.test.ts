import { describe, expect, it } from "vitest";
import type { ArticleDocument, Block, Inline } from "@/lib/content/types";
import { CURATED_TRAILS, FEATURED_TRAIL_ID } from "@/lib/trails/curated";
import { linkingSentence } from "@/lib/trails/evidence";
import { type TrailProposal, verifyProposals } from "@/lib/trails/generate";
import { MAX_STOPS, MIN_STOPS, curatedTrail, curatedTrailsFeaturedFirst, featuredTrail, titleKey, trailProblems, trailsFrom } from "@/lib/trails/graph";
import { trailPath, trailsFromPath } from "@/lib/trails/paths";
import { resolveTrail, trailTitles } from "@/lib/trails/resolve";
import type { TrailDefinition } from "@/lib/trails/types";
import type { PageMeta } from "@/lib/wikipedia/types";

const meta = (title: string, overrides: Partial<PageMeta> = {}): PageMeta => ({
  pageId: [...title].reduce((n, c) => n * 31 + c.charCodeAt(0), 7) >>> 0,
  title,
  length: 10000,
  disambiguation: false,
  recentViews: null,
  categories: [],
  ...overrides,
});

describe("curated trails", () => {
  it("are all well formed: 3–6 articles, one explanation per step, no repeats", () => {
    for (const trail of CURATED_TRAILS) {
      expect(trailProblems(trail), trail.id).toEqual([]);
      expect(trail.origin).toBe("curated");
      expect(trail.titles.length).toBeGreaterThanOrEqual(MIN_STOPS);
      expect(trail.titles.length).toBeLessThanOrEqual(MAX_STOPS);
    }
  });

  it("have unique ids, and the featured one is Apollo 11 → ARPANET", () => {
    expect(new Set(CURATED_TRAILS.map((t) => t.id)).size).toBe(CURATED_TRAILS.length);
    expect(featuredTrail().id).toBe(FEATURED_TRAIL_ID);
    expect(featuredTrail().titles[0]).toBe("Apollo 11");
    expect(featuredTrail().titles.at(-1)).toBe("ARPANET");
    expect(curatedTrailsFeaturedFirst()[0].id).toBe(FEATURED_TRAIL_ID);
    expect(curatedTrailsFeaturedFirst()).toHaveLength(CURATED_TRAILS.length);
  });

  it("describe each step between two articles once, the same way wherever it appears", () => {
    const steps = new Map<string, string>();
    for (const trail of CURATED_TRAILS) {
      trail.titles.slice(0, -1).forEach((from, i) => {
        const key = `${titleKey(from)}→${titleKey(trail.titles[i + 1])}`;
        const summary = trail.connections[i].summary;
        if (steps.has(key)) expect(summary, key).toBe(steps.get(key));
        steps.set(key, summary);
      });
    }
  });

  it("keep explanations short enough to read at a glance", () => {
    for (const trail of CURATED_TRAILS) {
      for (const c of trail.connections) {
        expect(c.summary.length, c.summary).toBeLessThanOrEqual(90);
        expect(c.detail.length, c.detail).toBeLessThanOrEqual(260);
        // An explanation that only repeats its summary would add nothing when expanded.
        expect(c.detail).not.toBe(c.summary);
      }
      expect(trail.payoff.length).toBeLessThanOrEqual(200);
    }
  });

  it("reject structural problems", () => {
    const base: TrailDefinition = featuredTrail();
    expect(trailProblems({ ...base, titles: ["A", "B"], connections: base.connections.slice(0, 1) })).toContain("needs at least 3 articles");
    expect(trailProblems({ ...base, titles: ["A", "B", "a"], connections: base.connections.slice(0, 2) })).toContain("repeats “a”");
    expect(trailProblems({ ...base, connections: base.connections.slice(1) })).toContain("needs one connection between each pair of articles");
    expect(trailProblems({ ...base, payoff: " " })).toContain("has no payoff");
  });
});

describe("trailsFrom", () => {
  it("offers every curated destination from a shared start, the featured trail first", () => {
    const trails = trailsFrom("Apollo 11");
    expect(trails.map((t) => t.titles.at(-1))).toEqual(["ARPANET", "V-2 rocket", "Microwave oven"]);
    expect(trails[0].id).toBe(FEATURED_TRAIL_ID);
  });

  it("starts part-way along a trail, keeping the hand-written steps", () => {
    const [trail] = trailsFrom("Space Race");
    expect(trail.titles).toEqual(["Space Race", "Sputnik crisis", "DARPA", "ARPANET"]);
    expect(trail.connections).toEqual(curatedTrail(FEATURED_TRAIL_ID)!.connections.slice(1));
    expect(trail.payoff).toBe(curatedTrail(FEATURED_TRAIL_ID)!.payoff);
    expect(trailProblems(trail)).toEqual([]);
  });

  it("joins trails where one ends and another begins", () => {
    const trails = trailsFrom("Raytheon");
    expect(trails).toHaveLength(1);
    expect(trails[0].titles).toEqual(["Raytheon", "Microwave oven", "Percy Spencer", "Cavity magnetron", "Tizard Mission"]);
    expect(trails[0].payoff).toBe(curatedTrail("microwave-to-tizard-mission")!.payoff);
  });

  it("is case- and underscore-insensitive and never repeats an article", () => {
    expect(trailsFrom("apollo_11")).toHaveLength(3);
    for (const start of new Set(CURATED_TRAILS.flatMap((t) => t.titles))) {
      for (const trail of trailsFrom(start)) {
        expect(new Set(trail.titles.map(titleKey)).size, trail.id).toBe(trail.titles.length);
        expect(trail.titles.length).toBeLessThanOrEqual(MAX_STOPS);
        expect(new Set(trailsFrom(start).map((t) => t.id)).size).toBe(trailsFrom(start).length);
      }
    }
  });

  it("finds nothing where no trail continues for two steps", () => {
    expect(trailsFrom("Ada Lovelace")).toEqual([]); // one step from the end of its trail
    expect(trailsFrom("ARPANET")).toEqual([]);
    expect(trailsFrom("Cold War")).toEqual([]);
  });
});

describe("resolveTrail", () => {
  const trail = curatedTrail("coffee-to-lloyds")!;

  it("adds Wikipedia's descriptions and thumbnails, following redirects to the canonical title", () => {
    const metas = new Map<string, PageMeta | null>([
      ["Coffee", meta("Coffee", { description: "Brewed drink", thumbnail: { src: "https://upload.wikimedia.org/c.jpg", width: 60, height: 40 } })],
      ["Coffeehouse", meta("Coffeehouse")],
      ["Lloyd's Coffee House", meta("Lloyd's Coffee House", { description: "Coffee house in London" })],
      ["Lloyd's of London", meta("Lloyd's of London")],
    ]);
    const resolved = resolveTrail(trail, metas, (t) => t === "Coffee");
    expect(resolved.stops.map((s) => s.status)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(resolved.stops[0]).toMatchObject({ description: "Brewed drink", startable: true, thumbnail: { width: 60 } });
    expect(resolved.stops[1].thumbnail).toBeUndefined();
    expect(resolved.stops[1].description).toBeUndefined();
    expect(resolved.connections).toBe(trail.connections);
    expect(resolved.payoff).toBe(trail.payoff);
  });

  it("marks articles Wikipedia does not have, and keeps titles when the lookup failed", () => {
    const metas = new Map<string, PageMeta | null>([["Coffee", meta("Coffee")], ["Coffeehouse", null]]);
    const resolved = resolveTrail(trail, metas, () => true);
    expect(resolved.stops.map((s) => s.status)).toEqual(["ok", "missing", "unknown", "unknown"]);
    expect(resolved.stops[1].startable).toBe(false);
    const offline = resolveTrail(trail, null);
    expect(offline.stops.map((s) => [s.title, s.status, s.startable])).toEqual(trail.titles.map((t) => [t, "unknown", false]));
  });

  it("collects every title once for one batched request", () => {
    const titles = trailTitles(CURATED_TRAILS);
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles).toContain("Apollo 11");
  });
});

describe("paths", () => {
  it("builds query-string routes", () => {
    expect(trailsFromPath("Lloyd's of London")).toBe("/connections?from=Lloyd's_of_London");
    expect(trailsFromPath("C++ & you")).toBe("/connections?from=C%2B%2B_%26_you");
    expect(trailPath("coffee-to-lloyds")).toBe("/connections?trail=coffee-to-lloyds");
  });
});

/* ---------- Evidence and verification of generated trails ---------- */

const text = (v: string): Inline => ({ k: "text", v });
const link = (to: string, anchor = to): Inline => ({ k: "link", to, c: [text(anchor)] });

function doc(title: string, lead: Block[], sections: ArticleDocument["sections"] = []): ArticleDocument {
  return {
    title,
    displayTitle: title,
    pageId: meta(title).pageId,
    revId: 1,
    lead,
    sections,
    references: [],
    infobox: [{ label: "Related", value: [link("Infobox only")] }],
    categories: [],
    links: [],
    seeAlso: [],
    stats: { words: 0, equations: 0, tables: 0, figures: 0, references: 0 },
  };
}

describe("linkingSentence", () => {
  const article = doc(
    "Tea",
    [{ k: "p", c: [text("Tea is a drink. It reached Europe through the "), link("Dutch East India Company", "Dutch traders"), text(" in 1610. It is popular.")] }],
    [
      { id: "a", title: "History", kind: "content", headings: [], blocks: [{ k: "list", ordered: false, items: [{ c: [text("Tea was taxed by the "), link("Tea Act"), text(".")], sub: [] }] }] },
      { id: "b", title: "See also", kind: "see-also", headings: [], blocks: [{ k: "p", c: [link("Coffee")] }] },
    ],
  );

  it("quotes the sentence of running text that contains the link", () => {
    expect(linkingSentence(article, "Dutch East India Company")).toBe("It reached Europe through the Dutch traders in 1610.");
    expect(linkingSentence(article, "dutch_East India Company")).toBe("It reached Europe through the Dutch traders in 1610.");
    expect(linkingSentence(article, "Tea Act")).toBe("Tea was taxed by the Tea Act.");
  });

  it("accepts any of several spellings, for links through redirects", () => {
    expect(linkingSentence(article, ["Tea Act of 1773", "Tea Act"])).toBe("Tea was taxed by the Tea Act.");
  });

  it("ignores See also lists, infoboxes and articles that are not linked", () => {
    expect(linkingSentence(article, "Coffee")).toBeNull();
    expect(linkingSentence(article, "Infobox only")).toBeNull();
    expect(linkingSentence(article, "Boston Tea Party")).toBeNull();
  });
});

describe("verifyProposals", () => {
  const start = doc("Tea", [{ k: "p", c: [text("Tea was carried by "), link("Clipper"), text(" ships.")] }]);
  const docs: Record<string, ArticleDocument> = {
    Clipper: doc("Clipper", [{ k: "p", c: [text("The fastest clipper was the "), link("Cutty Sark"), text(".")] }]),
    "Cutty Sark": doc("Cutty Sark", [{ k: "p", c: [text("Her name comes from the poem "), link("Tam o' Shanter (poem)", "Tam o' Shanter"), text(".")] }]),
  };
  const metas = new Map<string, PageMeta | null>([
    ["Clipper", meta("Clipper")],
    ["Cutty Sark", meta("Cutty Sark")],
    ["Tam o' Shanter (poem)", meta("Tam o' Shanter (poem)")],
    ["Mercury", meta("Mercury", { disambiguation: true })],
    ["Imaginary ship", null],
  ]);
  const deps = {
    metas: async (titles: string[]) => new Map(titles.map((t) => [t, metas.get(t) ?? null] as const)),
    doc: async (title: string) => docs[title] ?? null,
  };
  const step = (title: string) => ({ title, summary: `Leads to ${title}.`, detail: `Facts about ${title}.` });
  const proposal = (titles: string[]): TrailProposal => ({ steps: titles.map(step), payoff: "A tea clipper leads to a Burns poem." });

  it("keeps a trail whose every step links in the text, quoting Wikipedia for each", async () => {
    const { trails, rejected } = await verifyProposals(start, [proposal(["Clipper", "Cutty Sark", "Tam o' Shanter (poem)"])], deps);
    expect(rejected).toBe(0);
    expect(trails).toHaveLength(1);
    expect(trails[0]).toMatchObject({ origin: "generated", titles: ["Tea", "Clipper", "Cutty Sark", "Tam o' Shanter (poem)"] });
    expect(trails[0].connections.map((c) => c.evidence)).toEqual([
      { quote: "Tea was carried by Clipper ships.", source: "Tea" },
      { quote: "The fastest clipper was the Cutty Sark.", source: "Clipper" },
      { quote: "Her name comes from the poem Tam o' Shanter.", source: "Cutty Sark" },
    ]);
  });

  it("drops a trail with any step that is invented, a disambiguation page, unlinked, repeated or too short", async () => {
    const { trails, rejected } = await verifyProposals(
      start,
      [
        proposal(["Clipper", "Imaginary ship", "Cutty Sark"]),
        proposal(["Clipper", "Mercury", "Cutty Sark"]),
        proposal(["Cutty Sark", "Tam o' Shanter (poem)"]), // Tea does not link to Cutty Sark
        proposal(["Clipper", "Cutty Sark", "Clipper"]),
        proposal(["Clipper"]),
        { ...proposal(["Clipper", "Cutty Sark"]), steps: [step("Clipper"), { ...step("Cutty Sark"), summary: " " }] },
      ],
      deps,
    );
    expect(trails).toEqual([]);
    expect(rejected).toBe(6);
  });

  it("drops duplicates and loads each article once", async () => {
    let loads = 0;
    const counting = { ...deps, doc: async (t: string) => (loads++, docs[t] ?? null) };
    const good = proposal(["Clipper", "Cutty Sark", "Tam o' Shanter (poem)"]);
    const { trails, rejected } = await verifyProposals(start, [good, good], counting);
    expect(trails).toHaveLength(1);
    expect(rejected).toBe(1);
    expect(loads).toBe(2);
  });
});
