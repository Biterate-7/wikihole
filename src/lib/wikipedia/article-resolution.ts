import "server-only";
import { TtlCache } from "@/lib/cache";
import { isNoiseTitle } from "@/lib/content/concepts";
import type { EntityCandidate } from "@/lib/discovery/entity-extraction";
import { DATE_TITLE, GEOGRAPHY_CATEGORY, LIST_TITLE, NUMBER_TITLE, ORGANIZATION_CATEGORY, BIOGRAPHY_CATEGORY } from "@/lib/discovery/lexicon";
import { extractFeatures, lengthScore } from "@/lib/discovery/score";
import { classifyDisciplines, technicalTermCount, type DisciplineId } from "@/lib/discovery/topic-classification";
import { getPagesMetaMap, searchCandidates } from "./api";
import { normalizeTitle } from "./titles";
import type { PageMeta, SearchHit } from "./types";

/**
 * Entity → Wikipedia article resolution. For each extracted phrase we look
 * up the exact title (following redirects, which is how Wikipedia records
 * alternative names), fall back to CirrusSearch, and then validate every
 * candidate article instead of trusting the first hit:
 *
 * - name agreement: exact, singular/plural, redirect (alternative name),
 *   acronym, or token overlap with the title stripped of its qualifier;
 * - qualifier fit: "Rust (programming language)" vs "Rust (band)";
 * - context: bag-of-words similarity between the submission and the
 *   article's description, intro and categories, plus agreement between
 *   their disciplines;
 * - article quality: length and WikiProject assessment.
 *
 * Disambiguation pages, lists, dates and generic link targets are never
 * accepted as destinations.
 */

export type ResolutionMethod = "exact" | "alias" | "redirect" | "search" | "fallback";

export type EntityKind =
  | "programming-language"
  | "software"
  | "technology"
  | "algorithm"
  | "mathematics"
  | "science"
  | "company"
  | "organization"
  | "person"
  | "event"
  | "research"
  | "place"
  | "concept";

export interface ResolvedEntity {
  /** Surface form from the submission. */
  entity: string;
  key: string;
  /** Phrase that actually matched (an abbreviation expansion or a contained fallback). */
  matched: string;
  title: string;
  pageId: number;
  confidence: number;
  method: ResolutionMethod;
  salience: number;
  source: EntityCandidate["source"];
  kind: EntityKind;
  meta: PageMeta;
  /** Evidence for the match, in plain language. */
  reasons: string[];
  /** Other surface forms that resolved to the same article. */
  aliases: string[];
}

export interface UnresolvedEntity {
  entity: string;
  reason: "no-article" | "low-confidence" | "disambiguation-only" | "rejected-page";
  /** Best candidate considered, if any, for transparency. */
  closest?: { title: string; confidence: number };
}

export interface ResolutionContext {
  /** Submission text used for disambiguation. */
  text: string;
  disciplines: DisciplineId[];
}

export const RESOLUTION_MODEL = {
  /** Minimum confidence for an entity to count as resolved. */
  accept: 0.58,
  /** CirrusSearch requests allowed per submission. */
  maxSearches: 8,
  searchLimit: 7,
} as const;

/* ------------------------------------------------------------------------ */
/* Text utilities                                                            */
/* ------------------------------------------------------------------------ */

const BAG_STOP = new Set(
  "the and for with from that this which into onto over under about also used uses using such their there these those than then when where what were was are is been being have has had its it's not but can may one two other more most many some any all each new first known called often been between within during based".split(" "),
);

function stem(word: string): string {
  const w = word.replace(/(?:'s|s)$/, "");
  return w.length > 7 ? w.slice(0, 7) : w;
}

export function bag(text: string, exclude: Set<string> = new Set()): Map<string, number> {
  const out = new Map<string, number>();
  for (const raw of text.toLowerCase().match(/[a-z][a-z0-9+#-]{2,}/g) ?? []) {
    if (BAG_STOP.has(raw)) continue;
    const s = stem(raw);
    if (exclude.has(s)) continue;
    out.set(s, (out.get(s) ?? 0) + 1);
  }
  return out;
}

export function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, v] of a) {
    na += v * v;
    const w = b.get(k);
    if (w) dot += v * w;
  }
  for (const v of b.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim();

export function baseTitle(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

export function qualifierOf(title: string): string | undefined {
  return /\(([^)]*)\)\s*$/.exec(title)?.[1];
}

const singular = (s: string) => s.replace(/ies$/, "y").replace(/(?<=[a-z]{3})s$/, "");

function initials(title: string): string {
  return title
    .split(/\s+/)
    .filter((w) => w && !["of", "and", "the", "for", "in", "on", "a"].includes(w.toLowerCase()))
    .map((w) => w[0]?.toLowerCase() ?? "")
    .join("");
}

/** Agreement between a surface name and an article title (qualifier removed), 0..1. */
export function nameAgreement(name: string, title: string): { score: number; reason: string } {
  const n = norm(name);
  const base = baseTitle(title);
  const b = norm(base);
  if (!n || !b) return { score: 0, reason: "empty" };
  if (n === b) return { score: 1, reason: "exact title" };
  if (singular(n) === singular(b) || n.replace(/ /g, "") === b.replace(/ /g, "")) return { score: 0.96, reason: "same title (inflection or spacing)" };
  const compact = singular(n.replace(/ /g, ""));
  if (compact.length >= 2 && compact.length <= 8 && !n.includes(" ") && initials(base) === compact) {
    return { score: 0.88, reason: `“${name}” abbreviates the title` };
  }
  const nt = new Set(n.split(" ").map(stem));
  const bt = new Set(b.split(" ").map(stem));
  const shared = [...nt].filter((t) => bt.has(t)).length;
  const jaccard = shared / (nt.size + bt.size - shared);
  if (shared === nt.size && bt.size <= nt.size + 1) return { score: 0.6 + 0.3 * jaccard, reason: "title extends the name" };
  if (jaccard >= 0.5) return { score: 0.45 + 0.35 * jaccard, reason: "titles overlap" };
  return { score: jaccard * 0.6, reason: "weak title overlap" };
}

const OFFTOPIC_QUALIFIER =
  /\b(film|band|album|song|single|novel|tv series|television|character|footballer|singer|rapper|musician|actor|actress|given name|surname|name|ship|horse|river|village|town|city|magazine|newspaper|play|opera|painting|video game|comics|manga|anime|wrestler|politician|cricketer|racehorse|ep|mythology|deity|plant|fungus|beetle|bird|fish|genus|moth|butterfly|grape|cocktail)\b/i;

/* ------------------------------------------------------------------------ */
/* Classification of resolved articles                                       */
/* ------------------------------------------------------------------------ */

export function entityKind(meta: PageMeta): EntityKind {
  const d = (meta.description ?? "").toLowerCase();
  const cats = meta.categories.join(" | ").toLowerCase();
  if (meta.categories.some((c) => BIOGRAPHY_CATEGORY.test(c)) || /\b(scientist|engineer|mathematician|physicist|programmer|entrepreneur|businessman|businesswoman|inventor|researcher|cryptographer|philosopher|economist|writer|author|astronomer|chemist|biologist|investor|executive|hacker|pioneer)\b/.test(d) && /\b(american|british|english|german|french|finnish|dutch|swiss|canadian|indian|chinese|japanese|russian|soviet|israeli|italian|swedish|danish|norwegian|polish|hungarian|australian|austrian|belgian|irish|scottish|korean|taiwanese|brazilian|spanish|greek|born)\b|\(\d{4}/.test(d)) {
    return "person";
  }
  if (/programming language|query language|markup language|scripting language/.test(d) || /\bprogramming languages\b/.test(cats)) return "programming-language";
  if (/\b(company|corporation|manufacturer|conglomerate|startup|firm|subsidiary|retailer)\b/.test(d) || meta.categories.some((c) => ORGANIZATION_CATEGORY.test(c) && /compan|corporat/i.test(c))) return "company";
  if (/\b(organization|organisation|agency|foundation|institute|university|laboratory|consortium|non-profit|nonprofit|standards body)\b/.test(d)) return "organization";
  if (/\b(algorithm|data structure|sorting|search procedure|heuristic)\b/.test(d) || /\balgorithms\b|\bdata structures\b/.test(cats)) return "algorithm";
  if (/\b(software|operating system|web browser|browser engine|database|library|framework|text editor|compiler|kernel|application|app|video game engine|file system|interpreter|toolkit|package manager|version control)\b/.test(d)) return "software";
  if (/\b(theorem|conjecture|lemma|mathematical|equation|branch of mathematics|number|function|algebraic|geometric|topological|in mathematics|statistic)\b/.test(d) || /\btheorems\b|\bconjectures\b/.test(cats)) return "mathematics";
  if (/\b(war|battle|disaster|incident|accident|attack|crisis|outage|breach|mission|launch|expedition|affair|scandal|trial|event|revolution)\b/.test(d)) return "event";
  if (/\b(paper|study|experiment|research project|survey)\b/.test(d)) return "research";
  if (/\b(physics|physical|chemical|biological|quantum|particle|phenomenon|effect|force|element|molecule|protein|species|disease|cell|star|planet|galaxy|telescope|spacecraft)\b/.test(d)) return "science";
  if (meta.categories.some((c) => GEOGRAPHY_CATEGORY.test(c)) || /\b(city|town|village|island|county|province|region|municipality|commune|country) (in|of|on)\b|^(country|city|town|island)\b/.test(d)) return "place";
  if (/\b(technology|protocol|standard|format|architecture|technique|method|hardware|processor|microprocessor|computer|device|machine|instruction set|interface|network|chip|circuit|cipher|encryption)\b/.test(d)) return "technology";
  return "concept";
}

/** Pages that should never be a rabbit-hole destination. */
export function unusablePage(meta: PageMeta): string | null {
  if (meta.disambiguation) return "disambiguation page";
  if (LIST_TITLE.test(meta.title)) return "list page";
  if (DATE_TITLE.test(meta.title) || NUMBER_TITLE.test(meta.title)) return "date or number page";
  if (isNoiseTitle(meta.title)) return "too generic";
  if (!meta.extract || meta.extract.length < 40) return "no introduction";
  return null;
}

/* ------------------------------------------------------------------------ */
/* Scoring                                                                   */
/* ------------------------------------------------------------------------ */

interface Assessment {
  confidence: number;
  reasons: string[];
  /** The article belongs to the submission's main discipline. */
  sharesTop?: boolean;
}

interface PreparedContext {
  disciplines: DisciplineId[];
  text: string;
}

/**
 * Confidence that `meta` is the article an entity refers to. `lookup` tells
 * how the article was reached (exact title, redirect from the name, search).
 */
export function assessCandidate(
  name: string,
  meta: PageMeta,
  context: PreparedContext,
  lookup: { redirectedFrom?: string; caseExact?: boolean } = {},
): Assessment {
  const reasons: string[] = [];
  const unusable = unusablePage(meta);
  if (unusable) return { confidence: 0, reasons: [`Rejected: ${unusable}`] };

  let { score: nameScore, reason: nameReason } = nameAgreement(name, meta.title);
  if (lookup.redirectedFrom && nameScore < 0.9) {
    nameScore = 0.9;
    nameReason = `Wikipedia redirects “${lookup.redirectedFrom}” here (alternative name)`;
  }
  reasons.push(nameReason.charAt(0).toUpperCase() + nameReason.slice(1));
  if (nameScore < 0.35) return { confidence: nameScore * 0.3, reasons: [...reasons, "Title does not match the entity"] };

  const own = new Set(norm(name).split(" ").map(stem));
  const contextBag = bag(context.text, own);
  const articleText = `${meta.description ?? ""} ${meta.description ?? ""} ${meta.extract ?? ""} ${meta.categories.join(" ")} ${qualifierOf(meta.title) ?? ""}`;
  const articleBag = bag(articleText, own);
  const informative = [...contextBag.keys()].length >= 4;

  // The entity's own name must not vote: the iron-oxide article "Rust" mentions "rust" throughout,
  // which is also a programming-language term.
  const ownWords = norm(name).split(" ").filter((w) => w.length > 1);
  const withoutName = (text: string) =>
    // norm() leaves only [a-z0-9+#], so "+" is the one character to escape.
    ownWords.reduce((t, w) => t.replace(new RegExp(`\\b${w.replace(/\+/g, "\\+")}\\w*`, "gi"), " "), text);
  const articleDisciplines = classifyDisciplines([
    { text: withoutName(`${meta.description ?? ""} ${qualifierOf(meta.title) ?? ""}`), weight: 2 },
    { text: withoutName(meta.categories.join(" ")), weight: 1 },
    { text: withoutName(meta.extract ?? ""), weight: 1 },
  ]).map((d) => d.id);
  // Sharing the submission's main discipline counts fully; its second or third, partly.
  const shared = context.disciplines.slice(0, 3).filter((d) => articleDisciplines.slice(0, 4).includes(d));
  const rankWeight = [1, 0.7, 0.5];
  const agreement = context.disciplines.length
    ? Math.max(0, ...shared.map((d) => rankWeight[context.disciplines.indexOf(d)] ?? 0))
    : 0.4;
  const techPrior = extractFeatures(meta).technical;

  // Prior: does the article sit in the submission's disciplines, and is it technical? Short titles give
  // cosine similarity little to work with, so the prior can carry a match; shared vocabulary only adds.
  const prior = 0.35 * Math.min(1, agreement) + 0.45 * techPrior + (lookup.caseExact ? 0.2 : 0);
  let fit = prior * 0.95;
  if (informative) {
    const sim = cosine(contextBag, articleBag);
    fit = Math.max(fit, 0.55 * Math.min(1, sim * 3) + 0.3 * Math.min(1, agreement) + 0.15 * techPrior);
    if (sim > 0.08) reasons.push(`Shares vocabulary with the submission (similarity ${sim.toFixed(2)})`);
  }
  if (shared.length) reasons.push(`Same discipline: ${shared.join(", ")}`);

  const qualifier = qualifierOf(meta.title);
  if (qualifier) {
    if (OFFTOPIC_QUALIFIER.test(qualifier)) {
      fit -= 0.35;
      reasons.push(`Qualifier “${qualifier}” is off-topic`);
    } else {
      const qualifierDisciplines = classifyDisciplines([{ text: qualifier, weight: 1 }]).map((d) => d.id);
      if (qualifierDisciplines.some((d) => context.disciplines.includes(d))) {
        fit += 0.12;
        reasons.push(`Qualifier “${qualifier}” fits the submission`);
      } else if (technicalTermCount(qualifier) > 0) {
        fit += 0.05;
      }
    }
  }
  fit = Math.max(0, Math.min(1, fit));

  const assessed = meta.assessment === "FA" || meta.assessment === "GA" || meta.assessment === "A" || meta.assessment === "B";
  const stub = meta.assessment === "Stub" || meta.length < 2500;
  const quality = stub ? 0.8 : 0.88 + 0.08 * lengthScore(meta.length) + (assessed ? 0.04 : 0);
  if (stub) reasons.push("Short article (stub)");

  const confidence = Math.round(nameScore * (0.3 + 0.7 * fit) * quality * 1000) / 1000;
  return { confidence, reasons, sharesTop: context.disciplines.length > 0 && articleDisciplines.slice(0, 4).includes(context.disciplines[0]) };
}

/* ------------------------------------------------------------------------ */
/* Resolution                                                                */
/* ------------------------------------------------------------------------ */

const HINT: Partial<Record<DisciplineId, string>> = {
  ai: "machine learning",
  "programming-languages": "programming language",
  systems: "computing",
  data: "database",
  security: "computer security",
  hardware: "computer",
  theory: "computer science",
  mathematics: "mathematics",
  physics: "physics",
  biology: "biology",
  space: "spaceflight",
  "open-source": "software",
  history: "history",
  philosophy: "philosophy",
  economics: "economics",
};

interface Best {
  meta: PageMeta;
  confidence: number;
  reasons: string[];
  method: ResolutionMethod;
  matched: string;
  sharesTop?: boolean;
}

const isAcronymName = (name: string) => /^[A-Z0-9+#-]{2,}s?$/.test(name);

const resolutionCache = new TtlCache<{ title: string; method: ResolutionMethod; matched: string } | "missing">(3000, 12 * 60 * 60 * 1000);
/** Entities that were searched and still did not resolve: not searched again for a while. */
const unresolvedCache = new TtlCache<UnresolvedEntity>(3000, 2 * 60 * 60 * 1000);

function cacheKey(candidate: EntityCandidate, context: ResolutionContext): string {
  return `${candidate.key}|${context.disciplines.slice(0, 2).join(",")}`;
}

function consider(best: Best | null, next: Best): Best {
  if (!best) return next;
  if (next.confidence > best.confidence + 1e-6) return next;
  return best;
}

/**
 * Resolves extracted candidates to validated Wikipedia articles. Requests are
 * batched: one metadata query covers every exact-title lookup, searches run
 * only for entities that did not resolve exactly (at most
 * RESOLUTION_MODEL.maxSearches), and their hits share metadata batches.
 */
export async function resolveEntities(
  candidates: EntityCandidate[],
  context: ResolutionContext,
): Promise<{ resolved: ResolvedEntity[]; unresolved: UnresolvedEntity[] }> {
  const prepared: PreparedContext = { disciplines: context.disciplines, text: context.text };
  const best = new Map<string, Best | null>();
  const sawDisambiguation = new Set<string>();
  const missing = new Set<string>();
  const knownUnresolved = new Map<string, UnresolvedEntity>();

  // 1. Exact titles (and abbreviation expansions, and cached resolutions) in one batch.
  const exactNames = new Map<string, { candidate: EntityCandidate; method: ResolutionMethod; matched: string }>();
  for (const candidate of candidates) {
    best.set(candidate.key, null);
    const cached = resolutionCache.get(cacheKey(candidate, context));
    if (cached === "missing") {
      missing.add(candidate.key);
      continue;
    }
    const negative = unresolvedCache.get(cacheKey(candidate, context));
    if (negative) {
      knownUnresolved.set(candidate.key, negative);
      continue;
    }
    if (cached) exactNames.set(cached.title, { candidate, method: cached.method, matched: cached.matched });
    exactNames.set(candidate.name, { candidate, method: "exact", matched: candidate.name });
    for (const query of candidate.queries) exactNames.set(query, { candidate, method: "alias", matched: query });
  }
  const exactMetas = await getPagesMetaMap([...exactNames.keys()]);
  for (const [name, { candidate, method, matched }] of exactNames) {
    const meta = exactMetas.get(normalizeTitle(name));
    if (!meta) continue;
    if (meta.disambiguation) {
      sawDisambiguation.add(candidate.key);
      continue;
    }
    const redirected = meta.title.toLowerCase() !== name.toLowerCase() && method !== "alias" ? name : undefined;
    const assessment = assessCandidate(method === "alias" ? meta.title : candidate.name, meta, prepared, {
      redirectedFrom: redirected,
      caseExact: meta.title === name,
    });
    best.set(
      candidate.key,
      consider(best.get(candidate.key) ?? null, {
        meta,
        confidence: assessment.confidence,
        reasons: method === "alias" ? [`Expanded “${candidate.name}” to “${matched}”`, ...assessment.reasons] : assessment.reasons,
        method: redirected ? "redirect" : method,
        matched,
        sharesTop: assessment.sharesTop,
      }),
    );
  }

  // 2. Search for the most salient entities that did not resolve exactly.
  const needsSearch = candidates
    .filter((c) => !missing.has(c.key) && !knownUnresolved.has(c.key) && (best.get(c.key)?.confidence ?? 0) < RESOLUTION_MODEL.accept)
    .sort((a, b) => b.salience - a.salience);
  const queries: Array<{ candidate: EntityCandidate; query: string }> = [];
  for (const candidate of needsSearch) {
    if (queries.length >= RESOLUTION_MODEL.maxSearches) break;
    queries.push({ candidate, query: candidate.queries[0] ?? candidate.name });
  }
  // A second, discipline-qualified query for ambiguous names ("Rust" → "Rust programming language").
  const hint = context.disciplines.map((d) => HINT[d]).find(Boolean);
  if (hint) {
    for (const candidate of needsSearch) {
      if (queries.length >= RESOLUTION_MODEL.maxSearches) break;
      if (sawDisambiguation.has(candidate.key) || best.get(candidate.key)) queries.push({ candidate, query: `${candidate.name} ${hint}` });
    }
    // A common word can pass on its exact title yet mean something else here: "Transformer" (electrical)
    // in a submission about machine learning. If the exact match is outside the submission's main
    // discipline, also look for a qualified article and let validation choose.
    const topHint = HINT[context.disciplines[0]];
    for (const candidate of candidates) {
      if (queries.length >= RESOLUTION_MODEL.maxSearches || !topHint) break;
      const exact = best.get(candidate.key);
      if (exact && exact.confidence >= RESOLUTION_MODEL.accept && !exact.sharesTop && !candidate.name.includes(" ") && !isAcronymName(candidate.name)) {
        queries.push({ candidate, query: `${candidate.name} ${topHint}` });
      }
    }
  }
  // One search at a time: CirrusSearch has its own, stricter rate limit, and the shared search slots
  // should stay free for people typing in the search box.
  const searchResults: Array<PromiseSettledResult<SearchHit[]>> = [];
  for (const { query } of queries) {
    try {
      searchResults.push({ status: "fulfilled", value: await searchCandidates(query, { limit: RESOLUTION_MODEL.searchLimit }) });
    } catch (reason) {
      searchResults.push({ status: "rejected", reason });
    }
  }
  const hitTitles = new Set<string>();
  searchResults.forEach((r) => {
    if (r.status === "fulfilled") r.value.forEach((hit) => hitTitles.add(hit.title));
  });
  const hitMetas = hitTitles.size ? await getPagesMetaMap([...hitTitles]) : new Map<string, PageMeta | null>();
  searchResults.forEach((result, i) => {
    if (result.status !== "fulfilled") return;
    const { candidate, query } = queries[i];
    result.value.forEach((hit, rank) => {
      const meta = hitMetas.get(hit.title);
      if (!meta) return;
      const name = candidate.queries.length && query === candidate.queries[0] ? candidate.queries[0] : candidate.name;
      const assessment = assessCandidate(name, meta, prepared);
      // Search rank is weak evidence; it breaks near-ties without overriding validation.
      const confidence = Math.max(0, assessment.confidence - rank * 0.004);
      best.set(candidate.key, consider(best.get(candidate.key) ?? null, { meta, confidence, reasons: [`Found by searching “${query}”`, ...assessment.reasons], method: "search", matched: name }));
    });
    if (result.value.length === 0 && !best.get(candidate.key)) missing.add(candidate.key);
  });

  // 3. Fallbacks: shorter phrases contained in unresolved ones ("database" for "database architecture").
  const fallbackNames = new Map<string, EntityCandidate>();
  for (const candidate of candidates) {
    if ((best.get(candidate.key)?.confidence ?? 0) >= RESOLUTION_MODEL.accept) continue;
    if (knownUnresolved.has(candidate.key)) continue;
    for (const fallback of candidate.fallbacks.slice(0, 2)) fallbackNames.set(fallback, candidate);
  }
  if (fallbackNames.size) {
    const metas = await getPagesMetaMap([...fallbackNames.keys()]);
    for (const [name, candidate] of fallbackNames) {
      const meta = metas.get(normalizeTitle(name));
      if (!meta || meta.disambiguation) continue;
      const assessment = assessCandidate(name, meta, prepared, { caseExact: meta.title === name });
      best.set(
        candidate.key,
        consider(best.get(candidate.key) ?? null, {
          meta,
          confidence: assessment.confidence * 0.92,
          reasons: [`Matched the contained term “${name}”`, ...assessment.reasons],
          method: "fallback",
          matched: name,
        }),
      );
    }
  }

  // 4. Accept, de-duplicate by page (redirects and aliases collapse), and explain the rest.
  const byPage = new Map<number, ResolvedEntity>();
  const unresolved: UnresolvedEntity[] = [];
  const searched = new Set(queries.map((q) => q.candidate.key));
  for (const candidate of candidates) {
    const known = knownUnresolved.get(candidate.key);
    if (known) {
      unresolved.push({ ...known, entity: candidate.name });
      continue;
    }
    const choice = best.get(candidate.key);
    if (!choice || choice.confidence < RESOLUTION_MODEL.accept) {
      if (missing.has(candidate.key) && !choice) {
        resolutionCache.set(cacheKey(candidate, context), "missing");
        unresolved.push({ entity: candidate.name, reason: "no-article" });
      } else {
        const entry: UnresolvedEntity = {
          entity: candidate.name,
          reason: choice ? "low-confidence" : sawDisambiguation.has(candidate.key) ? "disambiguation-only" : "no-article",
          ...(choice ? { closest: { title: choice.meta.title, confidence: choice.confidence } } : {}),
        };
        // Only a searched entity counts as settled; one skipped for budget may resolve next time.
        if (searched.has(candidate.key)) unresolvedCache.set(cacheKey(candidate, context), entry);
        unresolved.push(entry);
      }
      continue;
    }
    resolutionCache.set(cacheKey(candidate, context), { title: choice.meta.title, method: choice.method, matched: choice.matched });
    const existing = byPage.get(choice.meta.pageId);
    const entry: ResolvedEntity = {
      entity: candidate.name,
      key: candidate.key,
      matched: choice.matched,
      title: choice.meta.title,
      pageId: choice.meta.pageId,
      confidence: choice.confidence,
      method: choice.method,
      salience: candidate.salience,
      source: candidate.source,
      kind: entityKind(choice.meta),
      meta: choice.meta,
      reasons: [...new Set(choice.reasons)].slice(0, 5),
      aliases: [],
    };
    if (!existing) byPage.set(entry.pageId, entry);
    else {
      const [keep, other] = existing.salience * existing.confidence >= entry.salience * entry.confidence ? [existing, entry] : [entry, existing];
      byPage.set(entry.pageId, { ...keep, salience: Math.max(keep.salience, other.salience), aliases: [...new Set([...keep.aliases, ...other.aliases, other.entity])] });
    }
  }
  const resolved = [...byPage.values()].sort((a, b) => b.salience * b.confidence - a.salience * a.confidence);
  return { resolved, unresolved };
}

/** Exposed for tests. */
export function __clearResolutionCache(): void {
  resolutionCache.clear();
  unresolvedCache.clear();
}
