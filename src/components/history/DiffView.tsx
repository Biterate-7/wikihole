import Link from "next/link";
import { DiffExplain } from "@/components/history/DiffExplain";
import { formatDateTime, formatDelta } from "@/lib/format";
import { historyPath } from "@/lib/wikipedia/titles";
import type { DiffRow, DiffRun, RevisionComparison, RevisionSide } from "@/lib/wikipedia/types";
import { ContributorName, SummaryText } from "./RevisionParts";
import styles from "./history.module.css";

function Line({ runs, Mark }: { runs: DiffRun[]; Mark: "ins" | "del" }) {
  if (runs.length === 0) return <>&nbsp;</>;
  return (
    <>
      {runs.map((run, i) => (run.changed ? <Mark key={i}>{run.text}</Mark> : <span key={i}>{run.text}</span>))}
    </>
  );
}

function Row({ row }: { row: DiffRow }) {
  switch (row.k) {
    case "lines":
      return (
        <div className={styles.diffLines}>
          <span>{row.from !== null ? `Line ${row.from.toLocaleString("en-US")}` : ""}</span>
          <span>{row.to !== null ? `Line ${row.to.toLocaleString("en-US")}` : ""}</span>
        </div>
      );
    case "context":
      return <div className={styles.diffContext}>{row.text || " "}</div>;
    case "change":
      return (
        <div className={styles.diffChange}>
          {row.removed ? (
            <div className={styles.diffRemoved} data-testid="diff-removed">
              <span className={styles.diffMarker} aria-label="Removed">
                −
              </span>
              <div className={styles.diffText}>
                <Line runs={row.removed} Mark="del" />
              </div>
            </div>
          ) : (
            <div className={styles.diffBlank} />
          )}
          {row.added ? (
            <div className={styles.diffAdded} data-testid="diff-added">
              <span className={styles.diffMarker} aria-label="Added">
                +
              </span>
              <div className={styles.diffText}>
                <Line runs={row.added} Mark="ins" />
              </div>
            </div>
          ) : (
            <div className={styles.diffBlank} />
          )}
        </div>
      );
  }
}

function SideHeading({
  side,
  label,
  step,
}: {
  side: RevisionSide;
  label: string;
  step?: React.ReactNode;
}) {
  return (
    <div className={styles.side}>
      <p className={styles.sideLabel}>{label}</p>
      <p className={styles.sideTime}>
        <time dateTime={side.timestamp}>{formatDateTime(side.timestamp) ?? `Revision ${side.id}`}</time>
      </p>
      <p>
        <ContributorName contributor={side.contributor} />
        {side.size !== undefined ? <span className={styles.muted}> · {side.size.toLocaleString("en-US")} bytes</span> : null}
      </p>
      <p className={styles.sideSummary}>
        <SummaryText summary={side.summary} hidden={side.summaryHidden} />
      </p>
      {step ? <p className={styles.sideStep}>{step}</p> : null}
    </div>
  );
}

/**
 * A real comparison from Wikimedia's compare API. Everything in green and red
 * is the revisions' own wikitext; the only generated text on the page is the
 * separately labelled explanation, which appears only if asked for.
 */
export function DiffView({ comparison, lang, aiEnabled }: { comparison: RevisionComparison; lang: string; aiEnabled: boolean }) {
  const { title, from, to, rows, olderId, newerId, charsAdded, charsRemoved, truncated } = comparison;
  const net = from && from.size !== undefined && to.size !== undefined ? to.size - from.size : null;
  const hasChanges = rows.some((row) => row.k === "change");

  return (
    <section className={styles.compare} aria-labelledby="compare-heading" data-testid="revision-compare">
      <h2 id="compare-heading" className={styles.compareHeading}>
        {from ? "Difference between revisions" : "First revision of this article"}
      </h2>
      <p className={styles.provenanceNote} data-testid="diff-provenance">
        Actual wikitext changes, as reported by Wikimedia&rsquo;s compare API.
      </p>

      <div className={styles.sides}>
        {from ? (
          <SideHeading
            side={from}
            label="Older revision"
            step={
              olderId !== undefined ? (
                <Link href={historyPath(title, lang, { from: olderId, to: from.id })} prefetch={false} data-testid="older-edit">
                  ← Older edit
                </Link>
              ) : (
                <span className={styles.muted}>This is the first revision</span>
              )
            }
          />
        ) : null}
        <SideHeading
          side={to}
          label={from ? "Newer revision" : "Revision"}
          step={
            newerId !== undefined ? (
              <Link href={historyPath(title, lang, { from: to.id, to: newerId })} prefetch={false} data-testid="newer-edit">
                Newer edit →
              </Link>
            ) : (
              <span className={styles.muted}>Latest revision</span>
            )
          }
        />
      </div>

      {from ? (
        <p className={styles.diffStats}>
          <span className={styles.sizeUp}>{formatDelta(charsAdded)}</span> <span className={styles.sizeDown}>{formatDelta(-charsRemoved)}</span> characters changed
          {net !== null ? <span className={styles.muted}> · page size {formatDelta(net)} bytes</span> : null}
        </p>
      ) : null}

      {aiEnabled && from && hasChanges ? <DiffExplain title={title} lang={lang} from={from.id} to={to.id} /> : null}

      {!from ? (
        <p className={styles.diffNote}>There is no earlier revision to compare this one with.</p>
      ) : hasChanges ? (
        <div className={styles.diff} data-testid="diff-table" lang={lang}>
          <div className={styles.diffColumns} aria-hidden="true">
            <span>Removed</span>
            <span>Added</span>
          </div>
          {rows.map((row, i) => (
            <Row key={i} row={row} />
          ))}
        </div>
      ) : (
        <p className={styles.diffNote}>These two revisions have the same text.</p>
      )}
      {truncated ? (
        <p className={styles.diffNote}>This diff is very long, so only the start is shown.</p>
      ) : null}
    </section>
  );
}

export function DiffSkeleton() {
  return (
    <div aria-hidden="true" className={styles.compare}>
      <div className="skeleton" style={{ width: 240, height: 20, marginBottom: 14 }} />
      {[94, 100, 88, 97].map((w, i) => (
        <div key={i} className="skeleton" style={{ width: `${w}%`, height: 14, marginBottom: 10 }} />
      ))}
    </div>
  );
}
