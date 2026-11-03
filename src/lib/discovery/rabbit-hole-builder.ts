import "server-only";
import { fetchArticleDocument } from "@/lib/article";
import type { ArticleDocument } from "@/lib/content/types";
import { disciplineRelevance, finalScore, type Prescore } from "@/lib/hackernews/ranking";
import type { Submission } from "@/lib/hackernews/types";
import { getLinksBetween, getMoreLike, getPagesMetaMap, type LinkPair } from "@/lib/wikipedia/api";
import { entityKind, resolveEntities, unusablePage, type ResolvedEntity } from "@/lib/wikipedia/article-resolution";
import { linkEvidence, type LinkEvidence } from "@/lib/wikipedia/extraction";
import { wikipediaUrl } from "@/lib/wikipedia/titles";
import type { PageMeta } from "@/lib/wikipedia/types";
import { extractEntities } from "./entity-extraction";
import type { EdgeEvidence, Exploration, ExplorationLevel, ExtractedEntity, HoleEdge, HoleNode, NodeKind, RelationKind } from "./hole-types";
import { scoreRabbitHole } from "./quality-scoring";
import { edgeId, linkEdges, strongestRelation, type Relation } from "./relationship-engine";
import { extractFeatures, readingMinutes, rejectReason, type Features } from "./score";
import { classifyDisciplines, type DisciplineId } from "./topic-classification";

/**
 * Builds a rabbit hole for one submission:
 *
 * 1. extract candidate entities from the title, body and top comments;
 * 2. resolve them to validated Wikipedia articles (level 1);
 * 3. parse the main articles and turn where they link (definition, intro,
 *    infobox, History/Legacy sections, See also) into typed relations,
 *    which introduce levels 2 and 3;
 * 4. add level 4 from See also entries outside the submission's discipline
 *    and from CirrusSearch similarity, kept only when a real link ties them
 *    to the graph;
 * 5. query the links between every article in the graph so cross-links are
 *    real Wikipedia links, then score the result.
 *
 * Every node and edge traces back to Wikipedia; nothing is invented to make
 * the graph look connected.
 */

export const BUILDER_VERSION = 1;

export const BUILDER_LIMITS = {
  level1: 7,
  /** Articles parsed in full for structural evidence. */
  documents: 3,
  level2: 8,
  level3: 9,
  level3PerKind: 3,
  level4: 4,
  /** Titles whose metadata is fetched when choosing levels 2–4. */
  evidenceTitles: 60,
} as const;

const clamp = (n: number) => Math.min(1, Math.max(0, n));
const nodeId = (pageId: number) => `p${pageId}`;
const quote = (s: string) => `“${s}”`;

function articleNode(meta: PageMeta, fields: Omit<HoleNode, "id" | "pageId" | "title" | "kind" | "url">): HoleNode {
  return {
    id: nodeId(meta.pageId),
    pageId: meta.pageId,
    title: meta.title,
    kind: entityKind(meta) as NodeKind,
    url: wikipediaUrl(meta.title),
    ...(meta.description ? { description: meta.description } : {}),
    ...(meta.extract ? { extract: meta.extract } : {}),
    ...(meta.thumbnail ? { thumbnail: meta.thumbnail } : {}),
    ...(meta.assessment ? { assessment: meta.assessment } : {}),
    readingMinutes: readingMinutes(meta),
    ...fields,
  };
}

function mentionEdge(entity: ResolvedEntity): HoleEdge {
  const where =
    entity.source === "title" ? "Named in the submission title" : entity.source === "text" ? "Mentioned in the submission text" : entity.source === "comments" ? "Raised by several commenters" : "Identified in the submission";
  let how = "";
  if (entity.method === "alias") how = ` ${quote(entity.entity)} expands to ${quote(entity.matched)}.`;
  else if (entity.method === "redirect") how = ` Wikipedia redirects ${quote(entity.matched)} to ${quote(entity.title)}.`;
  else if (entity.method === "fallback") how = ` Matched through the contained term ${quote(entity.matched)}.`;
  else if (entity.method === "search") how = " Found by searching Wikipedia and validated against the submission.";
  return {
    id: edgeId("root", nodeId(entity.pageId), "mention"),
    source: "root",
    target: nodeId(entity.pageId),
    kind: "direct",
    label: entity.source === "title" ? "In the title" : entity.source === "text" ? "In the post" : "In the discussion",
    explanation: `${where} as ${quote(entity.entity)}.${how}`,
    evidence: "submission",
    structural: true,
  };
}

function relationEdge(sourceId: string, targetId: string, relation: Relation, structural: boolean): HoleEdge {
  return {
    id: edgeId(sourceId, targetId, relation.kind),
    source: sourceId,
    target: targetId,
    kind: relation.kind,
    label: relation.label,
    explanation: relation.explanation,
    evidence: relation.evidence,
    ...(relation.detail ? { detail: relation.detail } : {}),
    structural,
  };
}

const NON_CONCEPT: NodeKind[] = ["person", "company", "organization", "place"];

interface Candidate {
  title: string;
  /** Strongest relation per source document. */
  relations: Array<{ sourceId: string; sourceTitle: string; relation: Relation }>;
}

interface Scored {
  meta: PageMeta;
  features: Features;
  relation: Relation;
  sourceId: string;
  support: number;
  score: number;
  level: Exclude<ExplorationLevel, 1>;
  similarRank?: number;
}

function topDiscipline(meta: PageMeta): DisciplineId | undefined {
  return classifyDisciplines([
    { text: `${meta.description ?? ""} ${meta.title}`, weight: 2 },
    { text: meta.categories.join(" "), weight: 1 },
  ])[0]?.id;
}

export interface BuildInput {
  submission: Submission;
  /** Plain text of the top comments, for context and corroboration. */
  comments?: string[];
  prescore: Prescore;
}

export async function buildRabbitHole({ submission, comments = [], prescore }: BuildInput): Promise<Exploration> {
  const extraction = extractEntities({ subject: submission.subject, text: submission.text, comments, domain: submission.domain });
  const disciplineIds = extraction.disciplines.map((d) => d.id);
  const { resolved, unresolved } = extraction.candidates.length
    ? await resolveEntities(extraction.candidates, { text: extraction.context, disciplines: disciplineIds })
    : { resolved: [], unresolved: [] };

  const entities: ExtractedEntity[] = [
    ...resolved.flatMap((r) => [r.entity, ...r.aliases].map((surface, i): ExtractedEntity => ({
      entity: surface,
      source: i === 0 ? r.source : (extraction.candidates.find((c) => c.name === surface)?.source ?? r.source),
      status: "resolved",
      title: r.title,
      confidence: r.confidence,
      method: r.method,
      kind: r.kind as NodeKind,
      reasons: r.reasons,
    }))),
    ...unresolved.map((u): ExtractedEntity => ({
      entity: u.entity,
      source: extraction.candidates.find((c) => c.name === u.entity)?.source ?? "title",
      status: "unresolved",
      reasons: [],
      reason: u.reason,
      ...(u.closest ? { closest: u.closest } : {}),
    })),
  ];

  const root: HoleNode = {
    id: "root",
    title: submission.title,
    level: 0,
    kind: "submission",
    role: "submission",
    url: submission.url ?? submission.hnUrl,
    relevance: 1,
  };
  const nodes: HoleNode[] = [root];
  const edges: HoleEdge[] = [];
  const features = new Map<string, Features>();
  const byPage = new Map<number, HoleNode>();
  const addNode = (node: HoleNode, f: Features) => {
    nodes.push(node);
    features.set(node.id, f);
    if (node.pageId) byPage.set(node.pageId, node);
  };
  const hasEdge = (a: string, b: string) => edges.some((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a));

  // Level 1: the resolved entities, primary first.
  const level1 = resolved.filter((r) => r.kind !== "place").slice(0, BUILDER_LIMITS.level1);
  // The primary article is what the submission is about: named in the title, specific and technical.
  // A broad everyday article ("Marketplace") or one mentioned only in passing should not lead the hole.
  const SOURCE_FACTOR = { title: 1, text: 0.75, comments: 0.6, ai: 0.8 } as const;
  const primaryScore = (r: ResolvedEntity) =>
    r.salience * r.confidence * SOURCE_FACTOR[r.source] * (0.45 + 0.55 * extractFeatures(r.meta).technical) * (r.method === "fallback" ? 0.8 : 1);
  const primary =
    [...level1].filter((r) => !NON_CONCEPT.includes(r.kind as NodeKind)).sort((a, b) => primaryScore(b) - primaryScore(a))[0] ?? level1[0];
  const ordered = primary ? [primary, ...level1.filter((r) => r !== primary)] : [];
  for (const entity of ordered) {
    addNode(
      articleNode(entity.meta, {
        level: 1,
        role: entity === primary ? "primary" : "direct",
        parent: "root",
        relevance: Math.round(clamp(0.55 * entity.salience + 0.45 * entity.confidence) * 100) / 100,
        confidence: entity.confidence,
        mentionedAs: [entity.entity, ...entity.aliases],
      }),
      extractFeatures(entity.meta),
    );
    edges.push(mentionEdge(entity));
  }

  if (primary) {
    // Structural evidence from the main articles.
    const documentTargets = ordered.slice(0, BUILDER_LIMITS.documents);
    const documents = await Promise.allSettled(documentTargets.map((e) => fetchArticleDocument(e.title)));
    const loaded: Array<{ node: HoleNode; doc: ArticleDocument }> = [];
    documents.forEach((result, i) => {
      if (result.status === "fulfilled") loaded.push({ node: byPage.get(documentTargets[i].pageId)!, doc: result.value });
    });

    const level1Titles = new Map(ordered.map((e) => [e.title.toLowerCase(), byPage.get(e.pageId)!]));
    const candidates = new Map<string, Candidate>();
    for (const { node, doc } of loaded) {
      const grouped = new Map<string, LinkEvidence[]>();
      for (const item of linkEvidence(doc)) grouped.set(item.title, [...(grouped.get(item.title) ?? []), item]);
      for (const [title, items] of grouped) {
        const relation = strongestRelation(node.title, items);
        if (!relation) continue;
        const known = level1Titles.get(title.toLowerCase());
        if (known) {
          if (known.id !== node.id && !hasEdge(node.id, known.id)) edges.push(relationEdge(node.id, known.id, relation, false));
          continue;
        }
        const entry = candidates.get(title) ?? { title, relations: [] };
        entry.relations.push({ sourceId: node.id, sourceTitle: node.title, relation });
        candidates.set(title, entry);
      }
    }

    const priority = (c: Candidate) => Math.max(...c.relations.map((r) => r.relation.strength)) + 0.15 * (c.relations.length - 1);
    const shortlist = [...candidates.values()].sort((a, b) => priority(b) - priority(a)).slice(0, BUILDER_LIMITS.evidenceTitles);
    const similar = await getMoreLike(primary.title, 10).catch(() => []);
    const similarTitles = similar.map((h) => h.title).filter((t) => !level1Titles.has(t.toLowerCase()) && !candidates.has(t));
    const metas = await getPagesMetaMap([...shortlist.map((c) => c.title), ...similarTitles]).catch(() => new Map<string, PageMeta | null>());

    const submissionDisciplines = new Set(disciplineIds.slice(0, 2));
    const eligible = (meta: PageMeta | null | undefined): meta is PageMeta => {
      if (!meta || byPage.has(meta.pageId) || unusablePage(meta)) return false;
      return !rejectReason(meta, extractFeatures(meta), { strict: false });
    };

    const scoredByPage = new Map<number, Scored>();
    for (const candidate of shortlist) {
      const meta = metas.get(candidate.title);
      if (!eligible(meta)) continue;
      const kind = entityKind(meta);
      const best = candidate.relations.reduce((a, b) => (b.relation.strength > a.relation.strength ? b : a));
      if (kind === "place") continue;
      if (NON_CONCEPT.includes(kind as NodeKind) && best.relation.kind !== "historical") continue;
      const f = extractFeatures(meta);
      const support = new Set(candidate.relations.map((r) => r.sourceId)).size;
      let level = best.relation.level;
      // See also entries outside the submission's own disciplines are the unexpected-but-sourced connections.
      if (best.relation.kind === "adjacent" && submissionDisciplines.size) {
        const discipline = topDiscipline(meta);
        if (discipline && !submissionDisciplines.has(discipline)) level = 4;
      }
      const score = best.relation.strength * (0.55 + 0.25 * f.quality + 0.2 * f.technical) * f.penalty + 0.12 * (support - 1);
      const existing = scoredByPage.get(meta.pageId);
      if (!existing || existing.score < score) {
        scoredByPage.set(meta.pageId, { meta, features: f, relation: best.relation, sourceId: best.sourceId, support, score, level });
      }
    }

    const pick = (level: 2 | 3, limit: number, perKind?: number): Scored[] => {
      const pool = [...scoredByPage.values()].filter((s) => s.level === level).sort((a, b) => b.score - a.score);
      const out: Scored[] = [];
      const counts = new Map<RelationKind, number>();
      for (const s of pool) {
        if (out.length >= limit) break;
        if (perKind && (counts.get(s.relation.kind) ?? 0) >= perKind) continue;
        out.push(s);
        counts.set(s.relation.kind, (counts.get(s.relation.kind) ?? 0) + 1);
      }
      for (const s of pool) if (out.length < limit && !out.includes(s)) out.push(s);
      return out;
    };

    const relevanceOf = (s: Scored, base: number) => Math.round(clamp(base * (0.5 + 0.5 * s.relation.strength) * (0.7 + 0.3 * s.features.quality)) * 100) / 100;
    for (const [level, chosen, base] of [
      [2, pick(2, BUILDER_LIMITS.level2), 0.8],
      [3, pick(3, BUILDER_LIMITS.level3, BUILDER_LIMITS.level3PerKind), 0.62],
    ] as const) {
      for (const s of chosen) {
        if (byPage.has(s.meta.pageId)) continue;
        const node = articleNode(s.meta, { level, role: s.relation.kind, parent: s.sourceId, relevance: relevanceOf(s, base) });
        addNode(node, s.features);
        edges.push(relationEdge(s.sourceId, node.id, s.relation, true));
      }
    }

    // Level 4 candidates: cross-discipline See also entries and similar articles.
    const seeAlsoFour = [...scoredByPage.values()].filter((s) => s.level === 4).sort((a, b) => b.score - a.score);
    const similarFour: Scored[] = [];
    similar.forEach((hit, rank) => {
      const meta = metas.get(hit.title);
      if (!eligible(meta) || scoredByPage.has(meta.pageId)) return;
      const kind = entityKind(meta);
      if (NON_CONCEPT.includes(kind as NodeKind)) return;
      const f = extractFeatures(meta);
      if (f.technical < 0.2) return;
      similarFour.push({
        meta,
        features: f,
        relation: {
          kind: "adjacent",
          label: "Similar text",
          explanation: "",
          evidence: "similar-text",
          strength: 0.55 - rank * 0.02,
          level: 4,
        },
        sourceId: byPage.get(primary.pageId)!.id,
        support: 1,
        score: (0.55 - rank * 0.02) * (0.6 + 0.4 * f.quality),
        level: 4,
        similarRank: rank,
      });
    });

    const pending = [...seeAlsoFour.slice(0, 4), ...similarFour.slice(0, 6)].filter((s) => !byPage.has(s.meta.pageId));
    const graphTitles = nodes.filter((n) => n.pageId).map((n) => n.title);
    const pairs: LinkPair[] = await getLinksBetween([...graphTitles, ...pending.map((s) => s.meta.title)]).catch(() => []);
    const idByTitle = new Map(nodes.filter((n) => n.pageId).map((n) => [n.title, n.id]));

    let added = 0;
    for (const s of pending) {
      if (added >= BUILDER_LIMITS.level4 || byPage.has(s.meta.pageId)) continue;
      const title = s.meta.title;
      const link = pairs.find((p) => (p.from === title && idByTitle.has(p.to)) || (p.to === title && idByTitle.has(p.from)));
      let relation = s.relation;
      let parent = s.sourceId;
      if (s.relation.evidence === "similar-text") {
        // Text similarity alone is not a relation: require a real link into the graph.
        if (!link) continue;
        const other = link.from === title ? link.to : link.from;
        parent = idByTitle.get(other)!;
        const linkPhrase = link.from === title ? `${quote(title)} links to ${quote(other)}` : `${quote(other)} links to ${quote(title)}`;
        relation = {
          ...s.relation,
          explanation: `Wikipedia's text-similarity search pairs ${quote(primary.title)} with ${quote(title)}, and ${linkPhrase}.`,
          evidence: "similar-text" as EdgeEvidence,
        };
      } else {
        relation = { ...s.relation, label: "Across disciplines", explanation: `${s.relation.explanation} It sits outside the submission's main discipline.` };
      }
      const node = articleNode(s.meta, { level: 4, role: "adjacent", parent, relevance: Math.round(clamp(0.45 * (0.6 + 0.4 * s.features.quality)) * 100) / 100 });
      addNode(node, s.features);
      idByTitle.set(title, node.id);
      edges.push(relationEdge(parent, node.id, relation, true));
      added++;
    }

    edges.push(...linkEdges(pairs, idByTitle, edges));
  }

  const articleNodes = nodes.filter((n) => n.level > 0);
  const quality = scoreRabbitHole({
    nodes,
    edges,
    articleQuality: new Map(articleNodes.map((n) => [n.id, features.get(n.id)?.quality ?? 0])),
    technical: new Map(articleNodes.map((n) => [n.id, features.get(n.id)?.technical ?? 0])),
  });
  const level1Nodes = articleNodes.filter((n) => n.level === 1);
  const obscurity = level1Nodes.length ? level1Nodes.reduce((s, n) => s + (features.get(n.id)?.obscurity ?? 0), 0) / level1Nodes.length : 0;
  const titlesWhere = (predicate: (n: HoleNode) => boolean, limit = 6) => articleNodes.filter(predicate).slice(0, limit).map((n) => n.title);
  const primaryNode = articleNodes.find((n) => n.role === "primary");

  // Disciplines grounded in the resolved articles as well as the submission text.
  const grounded = classifyDisciplines([
    { text: submission.subject, weight: 3 },
    { text: submission.text ?? "", weight: 1 },
    { text: level1Nodes.map((n) => `${n.title} ${n.description ?? ""}`).join(" "), weight: 2 },
    { text: articleNodes.filter((n) => n.level === 2).map((n) => n.description ?? "").join(" "), weight: 1 },
  ]);
  const disciplines = grounded.slice(0, 3).map(({ id, label }) => ({ id, label }));
  const relevance = Math.round(disciplineRelevance(grounded.slice(0, 4)) * 100) / 100;

  return {
    version: BUILDER_VERSION,
    submission,
    builtAt: Date.now(),
    summary: {
      ...(primaryNode ? { primary: { title: primaryNode.title, ...(primaryNode.description ? { description: primaryNode.description } : {}), lead: primaryNode.extract ?? "" } } : {}),
      secondary: titlesWhere((n) => n.level === 1 && n.role !== "primary"),
      prerequisites: titlesWhere((n) => n.role === "prerequisite"),
      historical: titlesWhere((n) => n.role === "historical"),
      descendants: titlesWhere((n) => n.role === "descendant"),
      adjacent: titlesWhere((n) => n.level === 4 || n.role === "adjacent"),
      disciplines,
    },
    nodes,
    edges,
    entities,
    quality,
    score: finalScore(prescore, { resolvedEntities: level1Nodes.length, quality, obscurity, relevance }),
    metrics: { resolvedEntities: level1Nodes.length, obscurity: Math.round(obscurity * 100) / 100, relevance },
  };
}
