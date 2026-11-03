import type { Submission } from "@/lib/hackernews/types";

let nextId = 40_000_000;

/** Builds a realistic normalised Hacker News submission for tests. */
export function submission(overrides: Partial<Submission> = {}): Submission {
  const id = overrides.id ?? nextId++;
  const title = overrides.title ?? "A new consensus algorithm for distributed databases";
  return {
    id,
    title,
    subject: overrides.subject ?? title.replace(/^(Ask|Show|Tell|Launch) HN:\s*/i, ""),
    author: "pg",
    score: 120,
    comments: 45,
    time: Date.UTC(2026, 9, 30, 12),
    category: "story",
    hnUrl: `https://news.ycombinator.com/item?id=${id}`,
    lists: ["top"],
    kids: [],
    fetchedAt: Date.UTC(2026, 9, 30, 13),
    url: "https://example.org/post",
    domain: "example.org",
    ...overrides,
  };
}
