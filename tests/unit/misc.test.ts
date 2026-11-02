import { afterEach, describe, expect, it, vi } from "vitest";
import { isAiEnabled } from "@/lib/ai/config";
import { isGrounded, normalizeForMatch } from "@/lib/ai/grounding";
import { verifyInsights } from "@/lib/ai/insights";
import { TtlCache } from "@/lib/cache";
import { isLineArt, normalizeMediaUrl } from "@/lib/content/media";
import { parseArticle } from "@/lib/content/parse";
import { formatCount, leadSentences } from "@/lib/format";
import { cleanExtract } from "@/lib/wikipedia/text";
import {
  articlePath,
  isArticleNamespace,
  isValidTitle,
  normalizeTitle,
  slugFromTitle,
  titleFromSlug,
  titleFromWikiHref,
} from "@/lib/wikipedia/titles";
import { loadParseFixture } from "../support/fixtures";

describe("titles", () => {
  it("round-trips titles through URL slugs", () => {
    for (const t of ["Halting problem", "Gödel's incompleteness theorems", "TCP/IP", "C++", "100% (song)", "Raft (algorithm)"]) {
      const path = articlePath(t);
      const segments = path.replace(/^\/wiki\//, "").split("/");
      expect(titleFromSlug(segments)).toBe(t);
    }
    expect(slugFromTitle("Raft (algorithm)")).toBe("Raft_(algorithm)");
  });

  it("normalises and validates", () => {
    expect(normalizeTitle("halting_problem ")).toBe("Halting problem");
    expect(isValidTitle("A|B")).toBe(false);
    expect(isValidTitle("x".repeat(256))).toBe(false);
    expect(titleFromSlug(["%3Cscript%3E"])).toBeNull();
    expect(isArticleNamespace("File:X.png")).toBe(false);
    expect(isArticleNamespace("Star Wars: Episode IV")).toBe(true);
  });

  it("parses MediaWiki hrefs", () => {
    expect(titleFromWikiHref("/wiki/Turing_machine#History")).toEqual({ title: "Turing machine", fragment: "History" });
    expect(titleFromWikiHref("https://example.org/wiki/X")).toBeNull();
  });
});

describe("media URLs", () => {
  it("allows only Wikimedia https hosts", () => {
    expect(normalizeMediaUrl("//upload.wikimedia.org/a.jpg")).toBe("https://upload.wikimedia.org/a.jpg");
    expect(normalizeMediaUrl("http://upload.wikimedia.org/a.jpg")).toBeNull();
    expect(normalizeMediaUrl("https://evil.example/a.jpg")).toBeNull();
    expect(normalizeMediaUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeMediaUrl(undefined)).toBeNull();
  });

  it("detects SVG-derived line art", () => {
    expect(isLineArt("https://thumb.wikimedia.org/x/Diagram.svg/330px-Diagram.svg.png")).toBe(true);
    expect(isLineArt("https://thumb.wikimedia.org/x/Photo.jpg/330px-Photo.jpg")).toBe(false);
  });
});

describe("TtlCache", () => {
  afterEach(() => vi.useRealTimers());

  it("expires entries and evicts least recently used", () => {
    vi.useFakeTimers();
    const cache = new TtlCache<number>(2, 1000);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    vi.advanceTimersByTime(1001);
    expect(cache.get("a")).toBeUndefined();
  });

  it("de-duplicates concurrent loads and does not cache failures", async () => {
    const cache = new TtlCache<number>(10, 1000);
    const load = vi.fn(async () => 42);
    const [a, b] = await Promise.all([cache.getOrLoad("k", load), cache.getOrLoad("k", load)]);
    expect([a, b]).toEqual([42, 42]);
    expect(load).toHaveBeenCalledTimes(1);
    await expect(cache.getOrLoad("bad", async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(await cache.getOrLoad("bad", async () => 7)).toBe(7);
  });
});

describe("extract cleaning", () => {
  it("strips TeX annotations that TextExtracts leaves in plain text", () => {
    expect(cleanExtract("The parallel operator ‖ {\\displaystyle \\|} (pronounced \"parallel\") is a binary operation.")).toBe(
      'The parallel operator ‖ (pronounced "parallel") is a binary operation.',
    );
    expect(cleanExtract("Let x {\\displaystyle x^{2}+{\\frac {1}{2}}} be real.")).toBe("Let x be real.");
    expect(cleanExtract("   ")).toBeUndefined();
    expect(cleanExtract(undefined)).toBeUndefined();
  });
});

describe("formatting", () => {
  it("formats counts and lead sentences", () => {
    expect(formatCount(950)).toBe("950");
    expect(formatCount(1500)).toBe("1.5k");
    expect(formatCount(25000)).toBe("25k");
    expect(leadSentences("One. Two. Three.", 9)).toBe("One. Two.");
  });
});

describe("AI grounding", () => {
  const doc = parseArticle(loadParseFixture("halting_problem"));
  const source = "Alan Turing proved in 1937 that the halting problem is undecidable, meaning that no general algorithm exists.";

  it("matches verbatim quotes regardless of case, whitespace and typography", () => {
    const normalized = normalizeForMatch(source);
    expect(isGrounded("Alan Turing proved in 1937 that the halting problem", normalized)).toBe(true);
    expect(isGrounded("“alan  turing proved in 1937”", normalized)).toBe(true);
    expect(isGrounded("Turing proved it in 1936", normalized)).toBe(false);
    expect(isGrounded("halting problem", normalized)).toBe(false); // too short to count as evidence
  });

  it("drops ungrounded claims and read-next titles not linked from the article", () => {
    const result = verifyInsights(
      {
        complexity: 7.4,
        complexityRationale: "Requires computability background.",
        whyInteresting: [
          { point: "A real result", evidence: "Alan Turing proved in 1937 that the halting problem is undecidable" },
          { point: "Invented", evidence: "Turing won a Nobel prize for the halting problem in 1950" },
        ],
        prerequisites: [{ concept: "Turing machine", evidence: "Alan Turing proved in 1937 that the halting problem" }],
        keyIdeas: [],
        terms: [],
        readNext: [
          { title: "Turing machine", reason: "Foundational" },
          { title: "Made-up article", reason: "Fabricated" },
        ],
      },
      doc,
      source,
      "test-model",
    );
    expect(result.complexity).toBe(5);
    expect(result.whyInteresting).toHaveLength(1);
    expect(result.prerequisites[0].linked).toBe("Turing machine");
    expect(result.readNext.map((r) => r.title)).toEqual(["Turing machine"]);
    expect(result.rejected).toBe(2);
  });

  it("is disabled without credentials", () => {
    vi.stubEnv("AI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(isAiEnabled()).toBe(false);
    vi.stubEnv("AI_API_KEY", "sk-test");
    vi.stubEnv("AI_PROVIDER", "unknown");
    expect(isAiEnabled()).toBe(false);
    vi.stubEnv("AI_PROVIDER", "anthropic");
    expect(isAiEnabled()).toBe(true);
    vi.unstubAllEnvs();
  });
});
