/** Domain types for Hacker News submissions. Shared by server and client. */

/** Feeds of the official Hacker News Firebase API that WikiHole reads. */
export const HN_LISTS = ["top", "best", "new", "ask", "show", "job"] as const;
export type HnList = (typeof HN_LISTS)[number];

/** What kind of submission an item is, derived from its title and type. */
export type SubmissionCategory = "story" | "ask" | "show" | "launch" | "tell" | "job" | "poll";

export interface Submission {
  /** Hacker News item id. */
  id: number;
  /** Title as shown on Hacker News (plain text). */
  title: string;
  /** Title without "Ask HN:", "[pdf]", "(2019)" and similar decorations. */
  subject: string;
  /** External URL, absent for text posts. */
  url?: string;
  /** Host of `url` without "www.". */
  domain?: string;
  author: string;
  score: number;
  comments: number;
  /** Submission time, Unix milliseconds. */
  time: number;
  category: SubmissionCategory;
  /** Discussion page on news.ycombinator.com. */
  hnUrl: string;
  /** Plain-text body (Ask HN, Show HN, text posts), HTML stripped. */
  text?: string;
  /** Year in a trailing "(1987)" marker: HN's convention for older material. */
  year?: number;
  /** Lists the submission was discovered in. */
  lists: HnList[];
  /** Ids of top-level comments, in Hacker News order. */
  kids: number[];
  /** When WikiHole last fetched this item, Unix milliseconds. */
  fetchedAt: number;
}

/** Why a submission was not considered for a rabbit hole. */
export type SubmissionRejectReason = "deleted" | "dead" | "job" | "poll" | "untitled" | "low-information" | "off-topic";
