import { describe, expect, it } from "vitest";
import { extractEntities } from "@/lib/discovery/entity-extraction";
import { classifyDisciplines } from "@/lib/discovery/topic-classification";
import { categoryOf, domainOf, htmlToText, normalizeItem, rejectRawItem, subjectOf } from "@/lib/hackernews/normalization";
import { DEFAULT_HN_WEIGHTS, engagementScore, finalScore, hnWeights, prescore } from "@/lib/hackernews/ranking";
import { HN_COMPONENTS, type HoleQuality } from "@/lib/discovery/hole-types";
import type { Submission } from "@/lib/hackernews/types";
import { submission } from "../support/hn";

function pre(s: Submission) {
  const extraction = extractEntities({ subject: s.subject, text: s.text, domain: s.domain });
  return prescore(s, extraction.disciplines, extraction.candidates.length);
}

describe("normalisation", () => {
  it("normalises a story with source attribution", () => {
    const s = normalizeItem(
      { id: 42, type: "story", by: "dang", time: 1_760_000_000, title: "Show HN: A Lisp in 200 lines of Zig &amp; friends (2019)", url: "https://www.github.com/x/y", score: 87, descendants: 12, kids: [1, 2, 3] },
      ["show", "top"],
      123,
    );
    expect(s).toMatchObject({
      id: 42,
      title: "Show HN: A Lisp in 200 lines of Zig & friends (2019)",
      subject: "A Lisp in 200 lines of Zig & friends",
      year: 2019,
      url: "https://www.github.com/x/y",
      domain: "github.com",
      author: "dang",
      score: 87,
      comments: 12,
      time: 1_760_000_000_000,
      category: "show",
      hnUrl: "https://news.ycombinator.com/item?id=42",
      lists: ["show", "top"],
      kids: [1, 2, 3],
      fetchedAt: 123,
    });
  });

  it("handles text posts without a URL and decodes HTML bodies", () => {
    const s = normalizeItem({
      id: 7,
      type: "story",
      title: "Ask HN: How does io_uring compare to epoll?",
      text: "I&#x27;ve read <a href=\"https://x\">the docs</a>.<p>Second paragraph with <i>emphasis</i> &amp; code.",
    })!;
    expect(s.url).toBeUndefined();
    expect(s.domain).toBeUndefined();
    expect(s.category).toBe("ask");
    expect(s.text).toBe("I've read the docs.\n\nSecond paragraph with emphasis & code.");
    expect(s.author).toBe("unknown");
    expect(s.score).toBe(0);
  });

  it("handles missing text and odd URLs", () => {
    expect(htmlToText(undefined)).toBeUndefined();
    expect(htmlToText("<p> </p>")).toBeUndefined();
    expect(domainOf("javascript:alert(1)")).toBeUndefined();
    expect(domainOf("not a url")).toBeUndefined();
    const s = normalizeItem({ id: 8, type: "story", title: "Plain title", url: "ftp://files.example" })!;
    expect(s.url).toBeUndefined();
  });

  it("rejects deleted, dead, job, poll and untitled items", () => {
    expect(rejectRawItem({ id: 1, deleted: true })).toBe("deleted");
    expect(rejectRawItem({ id: 1, type: "story", title: "x", dead: true })).toBe("dead");
    expect(rejectRawItem({ id: 1, type: "job", title: "We're hiring" })).toBe("job");
    expect(rejectRawItem({ id: 1, type: "poll", title: "Which editor?" })).toBe("poll");
    expect(rejectRawItem({ id: 1, type: "comment", text: "hi" })).toBe("off-topic");
    expect(rejectRawItem({ id: 1, type: "story", title: "  " })).toBe("untitled");
    expect(normalizeItem({ id: 1, deleted: true })).toBeNull();
  });

  it("derives categories and subjects from Hacker News conventions", () => {
    expect(categoryOf({ type: "story", title: "Launch HN: Acme (YC W26)" })).toBe("launch");
    expect(categoryOf({ type: "story", title: "Tell HN: Something" })).toBe("tell");
    expect(categoryOf({ type: "story", title: "Ordinary story" })).toBe("story");
    expect(subjectOf("The Mathematics of Juggling [pdf] (1987)")).toEqual({ subject: "The Mathematics of Juggling", year: 1987 });
    expect(subjectOf("Ask HN: What is a monad?")).toEqual({ subject: "What is a monad?" });
  });
});

describe("relevance ranking", () => {
  it("ranks a niche technical submission above a popular generic one", () => {
    const niche = submission({ title: "Implementing CRDTs with write-ahead logging in Postgres", score: 30, comments: 4, domain: "github.com" });
    const generic = submission({ title: "Why I quit my job at Google", score: 2000, comments: 900 });
    expect(pre(niche).total).toBeGreaterThan(pre(generic).total);
  });

  it("filters job postings, career advice and promotion", () => {
    expect(pre(submission({ title: "Acme is hiring", category: "job" })).reject).toBe("job");
    const career = pre(submission({ title: "Ask HN: How do you deal with burnout at your job? Should I quit?", category: "ask" }));
    expect(career.penalty).toBeLessThan(0.5);
    expect(career.reject).not.toBeNull();
    const promo = pre(submission({ title: "Black Friday sale: 50% off our webinar on productivity tips" }));
    expect(promo.reject).not.toBeNull();
  });

  it("rewards research sources, older material and novelty cues", () => {
    const paper = pre(submission({ title: "A proof of the halting problem, explained", domain: "arxiv.org" }));
    const plain = pre(submission({ title: "A proof of the halting problem, explained", domain: "example.org" }));
    expect(paper.components.technical).toBeGreaterThan(plain.components.technical);
    const old = pre(submission({ title: "The design of the Unix operating system (1974)", year: 1974 }));
    expect(old.signals.join(" ")).toMatch(/Older material \(1974\)/);
    expect(old.components.novelty).toBeGreaterThan(0.4);
  });

  it("treats engagement as a capped, secondary signal", () => {
    expect(engagementScore({ score: 0, comments: 0 })).toBe(0);
    expect(engagementScore({ score: 100_000, comments: 100_000 })).toBe(1);
    const weights = hnWeights("");
    expect(weights.engagement).toBeLessThan(weights.technical);
    expect(weights.engagement).toBeLessThan(weights.coverage);
  });

  it("supports configurable weights via HN_RANKING_WEIGHTS", () => {
    const sum = HN_COMPONENTS.reduce((s, k) => s + hnWeights("")[k], 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(hnWeights("")).toEqual(hnWeights("{bad json"));
    const onlyEngagement = hnWeights(JSON.stringify(Object.fromEntries(HN_COMPONENTS.map((k) => [k, k === "engagement" ? 1 : 0]))));
    expect(onlyEngagement.engagement).toBe(1);
    expect(DEFAULT_HN_WEIGHTS.engagement).toBe(10);
  });

  it("ranks useful rabbit holes above weak ones in the final score", () => {
    const s = submission({ title: "Implementing CRDTs with write-ahead logging in Postgres" });
    const p = pre(s);
    const quality = (v: number): HoleQuality => ({
      score: v * 100,
      status: v > 0.5 ? "complete" : "insufficient",
      components: { coverage: v, confidence: v, depth: v, connectivity: v, articles: v, technical: v },
      notes: [],
    });
    const strong = finalScore(p, { resolvedEntities: 3, quality: quality(0.85), obscurity: 0.5, relevance: 0.9 });
    const weak = finalScore(p, { resolvedEntities: 1, quality: quality(0.2), obscurity: 0.5, relevance: 0.9 });
    expect(strong.total).toBeGreaterThan(weak.total);
    // Grounded relevance lifts a submission whose title has no technical vocabulary.
    const grounded = finalScore(p, { resolvedEntities: 3, quality: quality(0.85), obscurity: 0.5, relevance: 1 });
    expect(grounded.components.relevance).toBe(1);
  });
});

describe("topic classification", () => {
  it("classifies technical and scientific texts", () => {
    expect(classifyDisciplines([{ text: "A borrow checker for a new systems programming language compiler", weight: 1 }])[0].id).toBe("programming-languages");
    expect(classifyDisciplines([{ text: "Physicists observe quantum entanglement between top quarks", weight: 1 }])[0].id).toBe("physics");
    expect(classifyDisciplines([{ text: "Fine-tuning a large language model with reinforcement learning", weight: 1 }])[0].id).toBe("ai");
    expect(classifyDisciplines([{ text: "My favourite recipes for summer", weight: 1 }])).toEqual([]);
  });
});
