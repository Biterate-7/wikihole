import { describe, expect, it } from "vitest";
import { diffPlainText, MAX_DIFF_ROWS, parseCompareBody } from "@/lib/wikipedia/diff";
import { parseEditSummary, summariseActivity } from "@/lib/wikipedia/revisions";
import type { Revision } from "@/lib/wikipedia/types";

const lineno = `<tr><td colspan="2" class="diff-lineno">Line 475:</td><td colspan="2" class="diff-lineno">Line 1,480:</td></tr>`;
const context = `<tr><td class="diff-marker"></td><td class="diff-context diff-side-deleted"><div>Same &amp; unchanged</div></td><td class="diff-marker"></td><td class="diff-context diff-side-added"><div>Same &amp; unchanged</div></td></tr>`;
const changed = `<tr><td class="diff-marker" data-marker="−"></td><td class="diff-deletedline diff-side-deleted"><div>The <del class="diffchange diffchange-inline">old</del> word</div></td><td class="diff-marker" data-marker="+"></td><td class="diff-addedline diff-side-added"><div>The <ins class="diffchange diffchange-inline">newer</ins> word</div></td></tr>`;
const added = `<tr><td colspan="2" class="diff-side-deleted"></td><td class="diff-marker" data-marker="+"></td><td class="diff-addedline diff-side-added"><div>A whole new line</div></td></tr>`;
const removed = `<tr><td class="diff-marker" data-marker="−"></td><td class="diff-deletedline diff-side-deleted"><div>Gone</div></td><td colspan="2" class="diff-side-added"></td></tr>`;

describe("parseCompareBody", () => {
  it("reads line markers, context and decoded text", () => {
    const { rows } = parseCompareBody(lineno + context);
    expect(rows[0]).toEqual({ k: "lines", from: 475, to: 1480 });
    expect(rows[1]).toEqual({ k: "context", text: "Same & unchanged" });
  });

  it("keeps exactly the words the edit marked as changed", () => {
    const { rows, charsAdded, charsRemoved } = parseCompareBody(changed);
    expect(rows).toEqual([
      {
        k: "change",
        removed: [
          { text: "The ", changed: false },
          { text: "old", changed: true },
          { text: " word", changed: false },
        ],
        added: [
          { text: "The ", changed: false },
          { text: "newer", changed: true },
          { text: " word", changed: false },
        ],
      },
    ]);
    expect(charsRemoved).toBe(3);
    expect(charsAdded).toBe(5);
  });

  it("counts a whole line when the other side is empty", () => {
    const { rows, charsAdded, charsRemoved } = parseCompareBody(added + removed);
    expect(rows[0]).toMatchObject({ k: "change", removed: null });
    expect(rows[1]).toMatchObject({ k: "change", added: null });
    expect(charsAdded).toBe("A whole new line".length);
    expect(charsRemoved).toBe("Gone".length);
  });

  it("an empty body means no differences, not an error", () => {
    expect(parseCompareBody("")).toEqual({ rows: [], charsAdded: 0, charsRemoved: 0, truncated: false });
  });

  it("drops markup a diff might contain, keeping it as text", () => {
    const { rows } = parseCompareBody(`<tr><td class="diff-context"><div>&lt;script&gt;alert(1)&lt;/script&gt;</div></td></tr>`);
    expect(rows[0]).toEqual({ k: "context", text: "<script>alert(1)</script>" });
  });

  it("truncates very long diffs but still counts the whole edit", () => {
    const { rows, truncated, charsAdded } = parseCompareBody(added.repeat(MAX_DIFF_ROWS + 5));
    expect(rows).toHaveLength(MAX_DIFF_ROWS);
    expect(truncated).toBe(true);
    expect(charsAdded).toBe("A whole new line".length * (MAX_DIFF_ROWS + 5));
  });
});

describe("diffPlainText", () => {
  it("marks removed and added lines for the model", () => {
    expect(diffPlainText(parseCompareBody(context + changed).rows)).toBe("  Same & unchanged\n- The old word\n+ The newer word");
  });
});

describe("parseEditSummary", () => {
  it("separates the section marker from the summary", () => {
    expect(parseEditSummary("/* History */ fixed a date")).toEqual({ section: "History", text: "fixed a date" });
  });

  it("handles a section with no text, and text with no section", () => {
    expect(parseEditSummary("/* General references */")).toEqual({ section: "General references", text: "" });
    expect(parseEditSummary("copyedit")).toEqual({ text: "copyedit" });
  });

  it("flattens wikilinks", () => {
    expect(parseEditSummary("Reverted edit by [[Special:Contributions/Ann|Ann]] ([[User talk:Ann|talk]]) to [[Foo]]")).toEqual({
      text: "Reverted edit by Ann (talk) to Foo",
    });
  });

  it("returns null when there is no summary, never invented text", () => {
    expect(parseEditSummary(undefined)).toBeNull();
    expect(parseEditSummary("")).toBeNull();
  });
});

describe("summariseActivity", () => {
  const now = Date.parse("2026-11-04T00:00:00Z");
  const revision = (id: number, daysAgo: number, sizeDelta: number | null, name = "Ann"): Revision => ({
    id,
    parentId: id - 1,
    timestamp: new Date(now - daysAgo * 86400000).toISOString(),
    contributor: { kind: "registered", name },
    summary: null,
    summaryHidden: false,
    size: 100,
    sizeDelta,
    minor: false,
    reverted: false,
  });

  it("totals only the edits inside the window", () => {
    const activity = summariseActivity({ revisions: [revision(4, 1, 50), revision(3, 2, -20, "Bo"), revision(2, 40, 999)], olderFrom: 1 }, now);
    expect(activity).toMatchObject({ edits: 2, complete: true, contributors: 2, bytesAdded: 50, bytesRemoved: 20 });
  });

  it("says when the fetched edits do not reach back to the start of the window", () => {
    expect(summariseActivity({ revisions: [revision(2, 1, 5), revision(1, 2, 5)], olderFrom: 0 }, now).complete).toBe(false);
  });

  it("knows the count is exact once it reaches the article's first revision", () => {
    expect(summariseActivity({ revisions: [revision(1, 2, 5)] }, now).complete).toBe(true);
  });

  it("counts anonymous editors separately rather than as one person", () => {
    const anon = (id: number) => ({ ...revision(id, 1, 1), contributor: { kind: "anonymous" as const } });
    expect(summariseActivity({ revisions: [anon(2), anon(1)] }, now).contributors).toBe(2);
  });
});
