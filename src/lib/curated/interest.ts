/**
 * How promising an article looks from Wikipedia's own signals alone, used to
 * explore the catalogue beyond what anyone recommended. It measures quality and
 * how readers treat the article, never its subject. Pure, used by the pipeline.
 */

const CLASS_VALUE: Record<string, number> = { fa: 1, fl: 0.7, a: 0.9, ga: 0.85, b: 0.6, c: 0.4, list: 0.2, start: 0.2, stub: 0 };

export interface InterestInput {
  bytes: number;
  assessment: string | null;
  sources: string[];
  monthlyClicks: number | null;
  inboundPages: number | null;
  externalShare: number | null;
}

const saturate = (value: number, scale: number) => 1 - Math.exp(-value / scale);

export function interestScore(input: InterestInput): number {
  const quality = input.sources.includes("featured") ? 1 : input.sources.includes("good") ? 0.85 : (CLASS_VALUE[input.assessment?.toLowerCase() ?? ""] ?? 0.25);
  const depth = saturate(input.bytes, 30000);
  // Readers reaching it from many different articles means it connects ideas.
  const connected = saturate(input.inboundPages ?? 0, 15);
  // Quiet articles get the credit here; quality above keeps thin ones from winning.
  const clicks = input.monthlyClicks ?? 0;
  const obscurity = 1 - Math.min(1, Math.log10(Math.max(10, clicks)) / 6);
  const unusual = input.sources.includes("unusual") ? 1 : 0;
  return Math.round(100 * (0.35 * quality + 0.25 * depth + 0.15 * connected + 0.15 * obscurity * quality + 0.1 * unusual) * 10) / 10;
}

/** Page types that are navigation rather than reading. */
export function isExplorable(title: string, bytes: number, disambiguation: boolean): boolean {
  if (disambiguation || bytes < 4000) return false;
  return !/^(List|Lists|Index|Outline|Timeline|Glossary) of |^\d{1,4}( BC| AD)?$|^(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}$|\(disambiguation\)$/.test(title);
}
