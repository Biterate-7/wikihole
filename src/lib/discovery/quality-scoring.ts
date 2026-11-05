import type { HoleEdge, HoleNode, HoleQuality, QualityComponent } from "./hole-types";

/**
 * Quality of a generated rabbit hole. A hole is shown as complete only if it
 * is anchored by a confidently resolved article and leads somewhere: a single
 * weak or irrelevant match is kept back as insufficient, however popular the
 * submission was.
 */

export const QUALITY_MODEL = {
  weights: { coverage: 25, confidence: 20, depth: 15, connectivity: 15, articles: 15, technical: 10 } satisfies Record<QualityComponent, number>,
  /** Minimum score for a complete hole. */
  minScore: 45,
  /** Minimum resolution confidence of the primary article. */
  minPrimaryConfidence: 0.65,
  /** Minimum number of Wikipedia articles in a complete hole. */
  minArticles: 6,
} as const;

const clamp = (n: number) => Math.min(1, Math.max(0, n));
const saturate = (n: number, scale: number) => 1 - Math.exp(-n / scale);

export interface QualityInput {
  nodes: HoleNode[];
  edges: HoleEdge[];
  /** Article quality (0..1) by node id, from the discovery scorer. */
  articleQuality: Map<string, number>;
  /** Technical relevance (0..1) by node id. */
  technical: Map<string, number>;
}

export function scoreRabbitHole({ nodes, edges, articleQuality, technical }: QualityInput): HoleQuality {
  const articles = nodes.filter((n) => n.level > 0);
  const direct = articles.filter((n) => n.level === 1);
  const primary = articles.find((n) => n.role === "primary");
  const deeper = articles.filter((n) => n.level > 1);
  const notes: string[] = [];

  const coverage = clamp(0.6 * saturate(direct.length, 1.6) + 0.4 * saturate(deeper.length, 6));
  const confidences = direct.map((n) => n.confidence ?? 0);
  const confidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;
  const levels = new Set(articles.map((n) => n.level)).size;
  const depth = levels / 4;
  const crossLinks = edges.filter((e) => !e.structural).length;
  const connectivity = articles.length ? clamp(saturate(crossLinks / articles.length, 0.6)) : 0;
  const mean = (map: Map<string, number>) => (articles.length ? articles.reduce((s, n) => s + (map.get(n.id) ?? 0), 0) / articles.length : 0);
  const articlesScore = mean(articleQuality);
  const technicalScore = mean(technical);

  const components: Record<QualityComponent, number> = {
    coverage,
    confidence,
    depth,
    connectivity,
    articles: articlesScore,
    technical: technicalScore,
  };
  const weights = QUALITY_MODEL.weights;
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let score = 0;
  for (const key of Object.keys(weights) as QualityComponent[]) score += (weights[key] / total) * components[key];
  score = Math.round(score * 1000) / 10;

  if (!primary) notes.push("No article could be confidently matched to the submission.");
  else if ((primary.confidence ?? 0) < QUALITY_MODEL.minPrimaryConfidence) notes.push(`The best match, “${primary.title}”, is too uncertain.`);
  if (articles.length < QUALITY_MODEL.minArticles) notes.push(`Only ${articles.length} Wikipedia article${articles.length === 1 ? "" : "s"} could be connected.`);
  if (direct.length < 2 && deeper.length < 5) notes.push("Too few connections lead beyond the first article.");
  if (score < QUALITY_MODEL.minScore) notes.push(`Quality score ${score} is below the threshold of ${QUALITY_MODEL.minScore}.`);

  const complete =
    Boolean(primary) &&
    (primary?.confidence ?? 0) >= QUALITY_MODEL.minPrimaryConfidence &&
    articles.length >= QUALITY_MODEL.minArticles &&
    (direct.length >= 2 || deeper.length >= 5) &&
    score >= QUALITY_MODEL.minScore;

  return {
    score,
    status: complete ? "complete" : "insufficient",
    components: Object.fromEntries(Object.entries(components).map(([k, v]) => [k, Math.round(v * 100) / 100])) as Record<QualityComponent, number>,
    notes: complete ? [] : notes,
  };
}
