import { describe, expect, it } from "vitest";
import { classifyHeuristically, type MentionInput } from "../../pipeline/classify/heuristic";
import { parseRobots } from "../../pipeline/http";
import { extractLinks } from "../../pipeline/text";
import { interestScore, isExplorable } from "@/lib/curated/interest";
import { findWikipediaUrls, parseWikipediaUrl } from "@/lib/curated/links";
import { collectionRank, countEvidence, DISCUSSION_CAP, effectiveWeight, recommendationScore, type CollectionInput, type QualifyingMention } from "@/lib/curated/rank";

describe("parseWikipediaUrl", () => {
  it("reduces the spellings of a link to one reference", () => {
    const expected = { lang: "en", title: "Turing machine" };
    for (const url of [
      "https://en.wikipedia.org/wiki/Turing_machine",
      "http://en.wikipedia.org/wiki/Turing_machine",
      "https://en.m.wikipedia.org/wiki/Turing_machine",
      "https://en.wikipedia.org/wiki/Turing%20machine",
      "en.wikipedia.org/wiki/Turing_machine",
      "https://en.wikipedia.org/wiki/Turing_machine.",
      "https://en.wikipedia.org/w/index.php?title=Turing_machine",
      "https://wikipedia.org/wiki/Turing_machine",
    ]) {
      expect(parseWikipediaUrl(url), url).toEqual(expected);
    }
  });

  it("keeps fragments, parentheses and editions", () => {
    expect(parseWikipediaUrl("https://en.wikipedia.org/wiki/Mercury_(planet)#Orbit")).toEqual({ lang: "en", title: "Mercury (planet)", fragment: "Orbit" });
    expect(parseWikipediaUrl("https://en.wikipedia.org/wiki/Mercury_(planet))")).toEqual({ lang: "en", title: "Mercury (planet)" });
    expect(parseWikipediaUrl("https://de.m.wikipedia.org/wiki/Turingmaschine")).toEqual({ lang: "de", title: "Turingmaschine" });
    expect(parseWikipediaUrl("https://en.wikipedia.org/wiki/Caf%C3%A9")).toEqual({ lang: "en", title: "Café" });
  });

  it("rejects what is not an article", () => {
    for (const url of [
      "https://en.wikipedia.org/wiki/Main_Page",
      "https://en.wikipedia.org/wiki/Wikipedia:Unusual_articles",
      "https://en.wikipedia.org/wiki/Special:Random",
      "https://en.wikipedia.org/wiki/Talk:Turing_machine",
      "https://en.wikipedia.org/wiki/File:Foo.png",
      "https://en.wikipedia.org/w/index.php?title=Foo&action=history",
      "https://en.wikipedia.org/w/index.php?title=Foo&diff=123",
      "https://commons.wikimedia.org/wiki/Foo",
      "https://notwikipedia.org/wiki/Foo",
      "https://en.wikipedia.org/wiki/Turing_mach...",
      "https://www.wikipedia.org/",
      "not a url",
    ]) {
      expect(parseWikipediaUrl(url), url).toBeNull();
    }
  });

  it("finds bare URLs in plain text", () => {
    expect(findWikipediaUrls("see https://en.wikipedia.org/wiki/Foo and https://example.com")).toEqual(["https://en.wikipedia.org/wiki/Foo"]);
  });
});

describe("extractLinks", () => {
  it("reads Hacker News comment markup, including escaped hrefs", () => {
    const links = extractLinks(
      'It&#x27;s worth a read: <a href="https:&#x2F;&#x2F;en.wikipedia.org&#x2F;wiki&#x2F;Great_Stink" rel="nofollow">https:&#x2F;&#x2F;en.wikipedia.org&#x2F;wiki&#x2F;Great_Stink</a><p>Second paragraph.',
    );
    expect(links).toHaveLength(1);
    expect(links[0].reference.title).toBe("Great Stink");
    expect(links[0].context).toContain("It's worth a read: [[Great Stink]]");
    expect(links[0].excerpt).toContain("[[Great Stink]]");
  });

  it("counts one article once and keeps each distinct link", () => {
    const html = '<a href="https://en.wikipedia.org/wiki/A">a</a> and <a href="https://en.wikipedia.org/wiki/A#x">again</a> and <a href="https://en.wikipedia.org/wiki/B">b</a>';
    const links = extractLinks(html);
    expect(links.map((l) => l.reference.title)).toEqual(["A", "B"]);
    expect(links[0].linksInText).toBe(2);
  });

  it("ignores other sites but notes them in context", () => {
    const links = extractLinks('<a href="https://example.com/x">x</a> <a href="https://en.wikipedia.org/wiki/A">a</a>');
    expect(links).toHaveLength(1);
    expect(links[0].context).toContain("[link]");
    expect(extractLinks('<a href="https://example.com/x">x</a>')).toEqual([]);
  });

  it("keeps excerpts short", () => {
    const long = `${"word ".repeat(200)}<a href="https://en.wikipedia.org/wiki/A">a</a>${" more".repeat(200)}`;
    expect(extractLinks(long)[0].excerpt.length).toBeLessThanOrEqual(244);
  });
});

describe("classifyHeuristically", () => {
  const comment = (context: string, overrides: Partial<MentionInput> = {}): MentionInput => ({
    kind: "comment",
    source: "hackernews",
    context,
    title: "Foo",
    discussionTitle: "Some thread",
    points: null,
    linksInText: 1,
    wordsInText: 30,
    ...overrides,
  });

  it.each([
    ["The Wikipedia article on this is fascinating: [[Foo]]"],
    ["This is one of my favorite Wikipedia articles: [[Foo]]"],
    ["Highly recommend reading about it: [[Foo]]"],
    ["[[Foo]] is a fun read!"],
    ["Worth reading: [[Foo]]"],
    ["Go read the wikipedia page: [[Foo]]"],
  ])("counts a genuine recommendation: %s", (context) => {
    expect(classifyHeuristically(comment(context)).label).toBe("recommendation");
  });

  it.each([
    ["According to [[Foo]] the boiling point is 100C.", "citation"],
    ["The term comes from [[Foo]] [1]", "citation"],
    ["[[Foo]]", "casual"],
    ["Sure, like [[Foo]] maybe, but who cares.", "citation"],
    ["Fun fact, this reminds me of [[Foo]]", "interesting"],
    ["The Wikipedia article is completely wrong: [[Foo]]", "criticism"],
  ])("does not count %s", (context, label) => {
    expect(classifyHeuristically(comment(context)).label).toBe(label);
  });

  it("does not take praise of another work as praise of the page", () => {
    expect(classifyHeuristically(comment("I recommend reading his book on this [[Foo]]")).label).not.toBe("recommendation");
    expect(classifyHeuristically(comment("It is a great read. [[Foo]]", { articleDescription: "1995 novel by Neal Stephenson" })).label).not.toBe("recommendation");
    expect(classifyHeuristically(comment("It's an interesting read [1] and more. [1] [[Foo]]")).label).not.toBe("recommendation");
  });

  it("respects negation", () => {
    expect(classifyHeuristically(comment("Not worth reading: [[Foo]]")).label).not.toBe("recommendation");
    expect(classifyHeuristically(comment("I wouldn't recommend reading [[Foo]]")).label).not.toBe("recommendation");
  });

  it("trusts threads that ask for articles", () => {
    expect(classifyHeuristically(comment("[[Foo]]", { discussionTitle: "Ask HN: What's your favorite Wikipedia article?" })).label).toBe("recommendation");
  });

  it("requires readers' endorsement of a submission", () => {
    const submission = (points: number | null, title = "Foo"): MentionInput => ({ ...comment("Submitted [[Foo]]"), kind: "submission", points, discussionTitle: title });
    expect(classifyHeuristically(submission(120)).label).toBe("recommendation");
    expect(classifyHeuristically(submission(5)).label).toBe("interesting");
    expect(classifyHeuristically(submission(1)).label).toBe("casual");
    expect(classifyHeuristically(submission(900, "Lynn Conway has died")).label).toBe("casual");
  });

  it("flags spam", () => {
    expect(classifyHeuristically(comment("Buy now with this promo code [[Foo]]")).label).toBe("spam");
  });
});

describe("ranking", () => {
  const at = (year: number, month = 0) => Date.UTC(year, month, 15) / 1000;
  const NOW = at(2026, 10);
  const mention = (discussionId: string, authorHash: string | null, time: number, community = "HN"): QualifyingMention => ({ discussionId, authorHash, at: time, community });

  it("caps one viral thread", () => {
    const viral = Array.from({ length: 50 }, (_, i) => mention("d1", `a${i}`, at(2020)));
    expect(effectiveWeight(viral)).toBe(DISCUSSION_CAP);
  });

  it("discounts one person repeating themselves", () => {
    const repeated = Array.from({ length: 4 }, (_, i) => mention(`d${i}`, "same", at(2010 + i)));
    expect(effectiveWeight(repeated)).toBeCloseTo(1 + 1 / 2 + 1 / 3 + 1 / 4);
    const independent = Array.from({ length: 4 }, (_, i) => mention(`d${i}`, `a${i}`, at(2010 + i)));
    expect(effectiveWeight(independent)).toBe(4);
  });

  it("ranks sustained independent recommendation above a viral spike", () => {
    const sustained = countEvidence(Array.from({ length: 6 }, (_, i) => mention(`d${i}`, `a${i}`, at(2012 + i * 2))), NOW);
    const spike = countEvidence(Array.from({ length: 60 }, (_, i) => mention("d1", `b${i}`, at(2025))), NOW);
    expect(recommendationScore(sustained)).toBeGreaterThan(recommendationScore(spike));
  });

  it("counts what it says it counts", () => {
    const counts = countEvidence([mention("d1", "a", at(2015, 1)), mention("d1", "b", at(2015, 1)), mention("d2", "a", at(2026, 5), "Lemmy")], NOW);
    expect(counts).toMatchObject({ qualifying: 3, discussions: 2, recommenders: 2, months: 2, years: 2, communities: 2, recent12m: 1 });
  });

  const input = (mentions: QualifyingMention[], overrides: Partial<CollectionInput> = {}): CollectionInput => ({
    ...countEvidence(mentions, NOW),
    monthlyClicks: 500,
    inCatalogue: true,
    bytes: 20000,
    ...overrides,
  });
  const spread = (n: number, from = 2012) => Array.from({ length: n }, (_, i) => mention(`d${i}`, `a${i}`, at(from + i)));

  it("gates each collection on evidence", () => {
    expect(collectionRank("most", input(spread(5)), NOW)).not.toBeNull();
    expect(collectionRank("most", input(spread(2)), NOW)).toBeNull();

    expect(collectionRank("hidden", input(spread(3)), NOW)).not.toBeNull();
    expect(collectionRank("hidden", input(spread(3), { monthlyClicks: 900000 }), NOW)).toBeNull();
    expect(collectionRank("hidden", input(spread(1)), NOW)).toBeNull();
    expect(collectionRank("hidden", input(spread(3), { bytes: 500 }), NOW)).toBeNull();

    expect(collectionRank("recent", input([mention("d", "a", NOW - 86400)]), NOW)).not.toBeNull();
    expect(collectionRank("recent", input([mention("d", "a", at(2015))]), NOW)).toBeNull();

    expect(collectionRank("evergreen", input(spread(8, 2012)), NOW)).not.toBeNull();
    expect(collectionRank("evergreen", input(spread(5, 2024)), NOW)).toBeNull();

    const rising = [mention("o", "z", at(2015)), ...Array.from({ length: 4 }, (_, i) => mention(`d${i}`, `a${i}`, NOW - (i + 1) * 86400 * 30))];
    expect(collectionRank("rising", input(rising), NOW)).not.toBeNull();
    expect(collectionRank("rising", input(spread(8, 2012)), NOW)).toBeNull();
  });
});

describe("parseRobots", () => {
  it("applies the wildcard group, longest match and crawl delay", () => {
    const rules = parseRobots("User-agent: *\nCrawl-delay: 60\nDisallow: /search/\nAllow: /search/public\nUser-agent: badbot\nDisallow: /");
    expect(rules.crawlDelayMs).toBe(60000);
    expect(rules.allowed("/api/v3/post/list")).toBe(true);
    expect(rules.allowed("/search/x")).toBe(false);
    expect(rules.allowed("/search/public")).toBe(true);
  });

  it("honours a blanket disallow, ignoring groups for other agents", () => {
    expect(parseRobots("User-agent: GoogleBot\nAllow: /\n\nUser-agent: *\nDisallow: /").allowed("/s/abc")).toBe(false);
    expect(parseRobots("").allowed("/anything")).toBe(true);
  });
});

describe("catalogue interest", () => {
  const base = { bytes: 30000, assessment: null, sources: [] as string[], monthlyClicks: 2000, inboundPages: 10, externalShare: 0.5 };

  it("rewards quality and depth, and never lets a thin quiet page win", () => {
    expect(interestScore({ ...base, sources: ["featured"] })).toBeGreaterThan(interestScore(base));
    expect(interestScore({ ...base, bytes: 80000 })).toBeGreaterThan(interestScore({ ...base, bytes: 5000 }));
    expect(interestScore({ ...base, assessment: "Stub", bytes: 2000, monthlyClicks: 10, inboundPages: 0 })).toBeLessThan(interestScore({ ...base, assessment: "GA", monthlyClicks: 50000 }));
  });

  it("filters navigation pages", () => {
    expect(isExplorable("Great Stink", 30000, false)).toBe(true);
    expect(isExplorable("List of paradoxes", 30000, false)).toBe(false);
    expect(isExplorable("Mercury", 30000, true)).toBe(false);
    expect(isExplorable("1984", 30000, false)).toBe(false);
    expect(isExplorable("Stubby", 900, false)).toBe(false);
  });
});
