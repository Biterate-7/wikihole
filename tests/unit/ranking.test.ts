import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS, normalizeWeights, weightsFor } from "@/lib/discovery/config";
import {
  classifyGroup,
  combine,
  extractFeatures,
  readingMinutes,
  rejectReason,
  sourcedDate,
  topCategories,
} from "@/lib/discovery/score";
import { clusterKey, selectDiverse, type Scored } from "@/lib/discovery/select";
import { GROUPS, SUBTOPICS, resolveTopic } from "@/lib/discovery/topics";
import { SCORE_COMPONENTS } from "@/lib/discovery/types";
import { meta } from "../support/meta";

describe("configurable weights", () => {
  it("normalises the default weights to sum to 1", () => {
    const w = weightsFor("balanced", "");
    const sum = SCORE_COMPONENTS.reduce((s, k) => s + w[k], 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(w.technical).toBeCloseTo(DEFAULT_WEIGHTS.technical / 100, 10);
  });

  it("applies presets and env overrides, ignoring invalid JSON", () => {
    expect(weightsFor("obscure", "").obscurity).toBeGreaterThan(weightsFor("balanced", "").obscurity);
    expect(weightsFor("deep", "").depth).toBeGreaterThan(weightsFor("balanced", "").depth);
    const overridden = weightsFor("balanced", JSON.stringify({ technical: 100, quality: 0, depth: 0, obscurity: 0, diversity: 0, exploration: 0 }));
    expect(overridden.technical).toBe(1);
    expect(weightsFor("balanced", "{not json")).toEqual(weightsFor("balanced", ""));
    expect(weightsFor("balanced", JSON.stringify({ technical: -5 }))).toEqual(weightsFor("balanced", ""));
    expect(normalizeWeights({ technical: 0, quality: 0, depth: 0, obscurity: 0, diversity: 0, exploration: 0 }).technical).toBe(0);
  });
});

describe("quality gate", () => {
  const gate = (m = meta()) => rejectReason(m, extractFeatures(m));

  it("accepts a substantial technical article", () => {
    expect(gate()).toBeNull();
  });

  it.each([
    ["disambiguation", meta({ disambiguation: true })],
    ["list", meta({ title: "List of cryptographers" })],
    ["list", meta({ assessment: "List" })],
    ["date", meta({ title: "1936" })],
    ["date", meta({ title: "16843 (number)" })],
    ["stub", meta({ assessment: "Stub" })],
    ["stub", meta({ length: 3000 })],
    ["biography", meta({ categories: ["1912 births", "1954 deaths", "Computability theorists"] })],
    ["biography", meta({ categories: ["Living people", "Cryptographers"] })],
    ["sports", meta({ categories: ["Association football clubs"] })],
    ["entertainment", meta({ categories: ["2014 films", "Films about mathematics"] })],
    ["entertainment", meta({ categories: ["Video games about artificial intelligence"] })],
    ["geography", meta({ categories: ["Villages in Kent"] })],
    ["missing-extract", meta({ extract: undefined })],
    [
      "non-technical",
      meta({ description: "Breed of dog", extract: "The beagle is a breed of small scent hound, similar in appearance to the much larger foxhound, used for hunting.", categories: ["Dog breeds originating in England"] }),
    ],
  ])("rejects %s", (reason, m) => {
    expect(gate(m)).toBe(reason);
  });

  it("does not confuse technical categories with excluded ones", () => {
    expect(gate(meta({ categories: ["Thin films", "Semiconductor device fabrication"] }))).toBeNull();
    expect(gate(meta({ categories: ["Frequency bands", "Radio spectrum"] }))).toBeNull();
    expect(gate(meta({ categories: ["Neutron stars", "Exotic matter"] }))).toBeNull();
    expect(gate(meta({ categories: ["Television technology", "Signal processing"] }))).toBeNull();
  });

  it("is lenient in non-strict mode (used for Rabbit Hole relations)", () => {
    const bio = meta({ categories: ["1912 births", "Computability theorists"] });
    expect(rejectReason(bio, extractFeatures(bio), { strict: false })).toBeNull();
    const dis = meta({ disambiguation: true });
    expect(rejectReason(dis, extractFeatures(dis), { strict: false })).toBe("disambiguation");
  });
});

describe("features", () => {
  it("scores technical depth from real vocabulary", () => {
    const technical = extractFeatures(meta());
    const plain = extractFeatures(
      meta({ description: "Village in England", extract: "Ashford is a small village with a church and a pub.", categories: ["Villages"] }),
    );
    expect(technical.technical).toBeGreaterThan(0.6);
    expect(plain.technical).toBeLessThan(0.3);
    expect(technical.depth).toBeGreaterThan(plain.depth);
  });

  it("rewards assessed quality and length", () => {
    const fa = extractFeatures(meta({ assessment: "FA", length: 90000 }));
    const start = extractFeatures(meta({ assessment: "Start", length: 7000 }));
    expect(fa.quality).toBeGreaterThan(start.quality);
    expect(fa.signals).toContain("Featured article");
  });

  it("never lets obscurity outrank quality for thin articles", () => {
    const rareThin = extractFeatures(meta({ recentViews: 5, assessment: "Start", length: 6500 }));
    const rareSolid = extractFeatures(meta({ recentViews: 5, assessment: "GA", length: 60000 }));
    const popular = extractFeatures(meta({ recentViews: 200000, assessment: "GA", length: 60000 }));
    expect(rareSolid.obscurity).toBeGreaterThan(rareThin.obscurity);
    expect(rareThin.obscurity).toBeLessThan(0.75);
    expect(popular.obscurity).toBe(0);
    expect(extractFeatures(meta({ recentViews: null })).obscurity).toBe(0.5);
  });

  it("penalises biographies and product pages without rejecting them in relations", () => {
    expect(extractFeatures(meta({ categories: ["1912 births"] })).penalty).toBeLessThan(1);
    expect(extractFeatures(meta({ description: "Software" })).penalty).toBeLessThan(1);
    expect(extractFeatures(meta()).penalty).toBe(1);
  });

  it("classifies articles into topic groups", () => {
    expect(classifyGroup(meta())).toBe("computer-science");
    expect(
      classifyGroup(meta({ description: "Particle in physics", extract: "The neutrino is a fermion that interacts via the weak force and gravity; quantum field theory describes it.", categories: ["Leptons", "Neutrinos"] })),
    ).toBe("physics");
  });

  it("derives dates only from categories", () => {
    expect(sourcedDate(["Computability theory", "1936 introductions"])).toEqual({ label: "Introduced", year: "1936", sourceCategory: "1936 introductions" });
    expect(sourcedDate(["Computer-related introductions in 1975"])?.year).toBe("1975");
    expect(sourcedDate(["Programming languages created in 1972"])).toMatchObject({ label: "Created", year: "1972" });
    expect(sourcedDate(["Graph theory"])).toBeUndefined();
  });

  it("estimates reading time from word count or length", () => {
    expect(readingMinutes(meta({ wordCount: 2300 }))).toBe(10);
    expect(readingMinutes(meta({ wordCount: undefined, length: 27600 }))).toBe(10);
    expect(readingMinutes(meta({ wordCount: 10 }))).toBe(1);
  });

  it("filters maintenance categories from display", () => {
    expect(topCategories(["Articles with short description", "1936 introductions", "Graph theory"])).toEqual(["Graph theory"]);
  });

  it("combines components with weights into a 0-100 score", () => {
    const f = { ...extractFeatures(meta()), technical: 1, quality: 1, depth: 1, obscurity: 1, penalty: 1 };
    expect(combine(f, 1, 1, weightsFor("balanced", "")).total).toBeCloseTo(100, 5);
  });
});

describe("diversity-aware selection", () => {
  const scored = (subtopic: string, n: number, quality: number): Scored[] =>
    Array.from({ length: n }, () => {
      const m = meta();
      return { candidate: { meta: m, subtopic, exploration: 1 }, features: { ...extractFeatures(m), quality } };
    });

  it("never returns duplicates and respects the limit", () => {
    const pool = [...scored("algorithms", 10, 0.9), ...scored("topology", 10, 0.5)];
    const picked = selectDiverse(pool, weightsFor("balanced", ""), { limit: 12 });
    expect(picked).toHaveLength(12);
    expect(new Set(picked.map((p) => p.pageId)).size).toBe(12);
  });

  it("caps each cluster so one subject cannot dominate", () => {
    const pool = [...scored("algorithms", 10, 1), ...scored("topology", 3, 0.2), ...scored("genetics", 3, 0.2)];
    const picked = selectDiverse(pool, weightsFor("balanced", ""), { limit: 9, maxPerCluster: 3 });
    const counts = new Map<string, number>();
    for (const p of picked) counts.set(p.subtopic!, (counts.get(p.subtopic!) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBe(3);
    expect(counts.size).toBe(3);
  });

  it("relaxes the cap rather than returning too few items", () => {
    const pool = scored("algorithms", 6, 1);
    expect(selectDiverse(pool, weightsFor("balanced", ""), { limit: 6, maxPerCluster: 2 })).toHaveLength(6);
  });

  it("is deterministic without noise and varies with noise", () => {
    const pool = [...scored("algorithms", 15, 0.6), ...scored("topology", 15, 0.6)];
    const w = weightsFor("balanced", "");
    const a = selectDiverse(pool, w, { limit: 8 }).map((p) => p.pageId);
    expect(selectDiverse(pool, w, { limit: 8 }).map((p) => p.pageId)).toEqual(a);
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const noisy = selectDiverse(pool, w, { limit: 8, noise: 30, random: rand }).map((p) => p.pageId);
    expect(noisy).not.toEqual(a);
  });

  it("uses subtopic as the cluster key", () => {
    expect(clusterKey(scored("algorithms", 1, 1)[0])).toBe("algorithms");
  });
});

describe("topic taxonomy", () => {
  it("has unique slugs and every group references real subtopics", () => {
    for (const g of GROUPS) for (const s of g.subtopics) expect(SUBTOPICS[s], s).toBeDefined();
    for (const [slug, sub] of Object.entries(SUBTOPICS)) {
      expect(sub.slug).toBe(slug);
      expect(sub.categories.length).toBeGreaterThanOrEqual(4);
    }
    expect(new Set(GROUPS.map((g) => g.id)).size).toBe(GROUPS.length);
  });

  it("covers the collections required by the product brief", () => {
    for (const slug of ["algorithms", "distributed-systems", "cryptography", "number-theory", "topology", "quantum-mechanics", "cosmology", "aerospace", "control-theory", "neuroscience", "genetics", "mechanism-design", "behavioral-economics"]) {
      expect(SUBTOPICS[slug], slug).toBeDefined();
    }
  });

  it("resolves groups and subtopics, and rejects unknown slugs", () => {
    expect(resolveTopic("mathematics")?.kind).toBe("group");
    expect(resolveTopic("game-theory")?.subtopics).toHaveLength(1);
    expect(resolveTopic("nonsense")).toBeNull();
    expect(resolveTopic(null)).toBeNull();
  });
});
