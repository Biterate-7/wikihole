/**
 * The decision stage: turns the rules' verdict, any model verdict and any review
 * into the one label that counts. It prefers leaving a mention undecided to
 * counting a doubtful one: only `recommendation` feeds the statistics, and
 * `needs-review` is reported but never counted.
 */

export const AUTO_ACCEPT = 0.85;
export const LLM_MIN_CONFIDENCE = 0.7;
/** Below this many labelled examples a rule has no measured precision. */
export const MIN_CALIBRATION_SAMPLES = 15;

export interface RuleCalibration {
  checked: number;
  confirmed: number;
  /** Laplace-smoothed precision, so small samples stay humble. */
  precision: number;
}

export type Calibration = Record<string, RuleCalibration>;

export const calibrationKey = (kind: string, reason: string | null) => `${kind}|${reason ?? ""}`;

export function calibrate(rows: Array<{ kind: string; reason: string | null; truth: string }>): Calibration {
  const counts = new Map<string, { checked: number; confirmed: number }>();
  for (const row of rows) {
    const key = calibrationKey(row.kind, row.reason);
    const entry = counts.get(key) ?? { checked: 0, confirmed: 0 };
    entry.checked++;
    if (row.truth === "recommendation") entry.confirmed++;
    counts.set(key, entry);
  }
  return Object.fromEntries([...counts].map(([key, { checked, confirmed }]) => [key, { checked, confirmed, precision: (confirmed + 1) / (checked + 2) }]));
}

export interface DecisionInput {
  kind: string;
  label: string | null;
  reason: string | null;
  classifier: string | null;
  review: string | null;
  llm_label: string | null;
  llm_confidence: number | null;
  llm_model: string | null;
}

export interface Decision {
  label: string | null;
  confidence: number | null;
  decidedBy: string | null;
}

export function decide(input: DecisionInput, calibration: Calibration): Decision {
  if (input.review) return { label: input.review, confidence: 1, decidedBy: "review" };
  if (input.llm_label) {
    const confidence = input.llm_confidence ?? 0;
    if (input.llm_label === "recommendation" && confidence < LLM_MIN_CONFIDENCE) return { label: "needs-review", confidence, decidedBy: input.llm_model };
    return { label: input.llm_label, confidence, decidedBy: input.llm_model };
  }
  if (input.label !== "recommendation") return { label: input.label, confidence: null, decidedBy: input.classifier };
  const measured = calibration[calibrationKey(input.kind, input.reason)];
  if (!measured || measured.checked < MIN_CALIBRATION_SAMPLES) return { label: "needs-review", confidence: measured?.precision ?? null, decidedBy: input.classifier };
  return measured.precision >= AUTO_ACCEPT
    ? { label: "recommendation", confidence: measured.precision, decidedBy: input.classifier }
    : { label: "needs-review", confidence: measured.precision, decidedBy: input.classifier };
}
