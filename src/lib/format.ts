import type { AssessmentClass } from "@/lib/wikipedia/types";

export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function formatDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : dateFormat.format(date);
}

export function formatRelative(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return dateFormat.format(new Date(timestamp));
}

export const ASSESSMENT_LABELS: Partial<Record<AssessmentClass, string>> = {
  FA: "Featured article",
  GA: "Good article",
  A: "A-class",
  B: "B-class",
  C: "C-class",
  Start: "Start-class",
};

/** Badge text for quality classes worth surfacing (we do not advertise C/Start). */
export function assessmentBadge(cls: AssessmentClass | undefined): string | null {
  if (cls === "FA" || cls === "GA" || cls === "A" || cls === "B") return cls;
  return null;
}

/** First sentences of a text, up to roughly `max` characters. */
export function leadSentences(text: string, max = 260): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const sentences = clean.split(/(?<=[.!?])\s+(?=[A-Z0-9("'])/);
  let out = "";
  for (const s of sentences) {
    if (out && out.length + s.length + 1 > max) break;
    out = out ? `${out} ${s}` : s;
  }
  if (out.length > max * 1.4) out = `${out.slice(0, max).replace(/\s+\S*$/, "")}…`;
  return out;
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
