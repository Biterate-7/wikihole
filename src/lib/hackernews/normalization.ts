import { parse as parseHtml } from "node-html-parser";
import type { RawItem } from "./client";
import type { HnList, Submission, SubmissionCategory, SubmissionRejectReason } from "./types";

/**
 * Converts raw Hacker News items into WikiHole submissions: plain-text titles
 * and bodies, a category derived from Hacker News conventions, the external
 * domain, and the discussion URL kept for attribution.
 */

export const HN_ITEM_URL = "https://news.ycombinator.com/item?id=";

export function hnItemUrl(id: number): string {
  return `${HN_ITEM_URL}${id}`;
}

const PREFIX = /^(ask|show|tell|launch)\s+hn\s*[:\-–—]\s*/i;
const DECORATION = /\s*[[(](?:pdf|video|audio|slides|paper|book|podcast|html|txt|gif|png|ps)[\])]\s*/gi;
const YEAR = /\s*\((?:c\.\s*)?(1[5-9]\d\d|20\d\d)\)\s*$/;

/** Decodes the handful of HTML entities that appear in API titles. */
function decodeEntities(text: string): string {
  return parseHtml(`<p>${text.replace(/</g, "&lt;")}</p>`).text;
}

/** Plain text of an HTML comment or post body, paragraphs separated by newlines. */
export function htmlToText(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const withBreaks = html.replace(/<p>/gi, "\n\n<p>").replace(/<br\s*\/?>/gi, "\n");
  const text = parseHtml(withBreaks)
    .text.replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || undefined;
}

export function domainOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return parsed.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return undefined;
  }
}

export function categoryOf(item: Pick<RawItem, "type" | "title">): SubmissionCategory {
  if (item.type === "job") return "job";
  if (item.type === "poll") return "poll";
  const prefix = PREFIX.exec(item.title ?? "")?.[1]?.toLowerCase();
  if (prefix === "ask" || prefix === "show" || prefix === "tell" || prefix === "launch") return prefix;
  return "story";
}

/** Title without Hacker News prefixes, media markers and the trailing year. */
export function subjectOf(title: string): { subject: string; year?: number } {
  let subject = title.replace(PREFIX, "");
  const year = YEAR.exec(subject)?.[1];
  subject = subject.replace(YEAR, "").replace(DECORATION, " ").replace(/\s+/g, " ").trim();
  return { subject, ...(year ? { year: Number(year) } : {}) };
}

export function rejectRawItem(item: RawItem): SubmissionRejectReason | null {
  if (item.deleted) return "deleted";
  if (item.dead) return "dead";
  if (item.type === "job") return "job";
  if (item.type === "poll") return "poll";
  if (item.type !== "story" && item.type !== undefined) return "off-topic";
  if (!item.title?.trim()) return "untitled";
  return null;
}

/** Normalises a story; returns null for items that are not usable submissions. */
export function normalizeItem(item: RawItem, lists: HnList[] = [], now = Date.now()): Submission | null {
  if (rejectRawItem(item)) return null;
  const title = decodeEntities(item.title ?? "").replace(/\s+/g, " ").trim();
  const { subject, year } = subjectOf(title);
  const domain = domainOf(item.url);
  const text = htmlToText(item.text);
  return {
    id: item.id,
    title,
    subject: subject || title,
    ...(item.url && domain ? { url: item.url, domain } : {}),
    author: item.by ?? "unknown",
    score: Math.max(0, item.score ?? 0),
    comments: Math.max(0, item.descendants ?? 0),
    time: (item.time ?? 0) * 1000,
    category: categoryOf(item),
    hnUrl: hnItemUrl(item.id),
    ...(text ? { text: text.slice(0, 6000) } : {}),
    ...(year ? { year } : {}),
    lists,
    kids: (item.kids ?? []).slice(0, 30),
    fetchedAt: now,
  };
}
