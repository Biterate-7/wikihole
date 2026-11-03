import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { SubmissionExplorer } from "@/components/exploration/SubmissionExplorer";
import { StateMessage } from "@/components/ui/StateMessage";
import { getExploration } from "@/lib/hackernews/service";
import { hnItemUrl } from "@/lib/hackernews/normalization";
import { attempt, describeError } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const load = cache((id: number) => attempt(() => getExploration(id)));

function parseId(raw: string): number | null {
  return /^\d{1,10}$/.test(raw) ? Number(raw) : null;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const id = parseId((await params).id);
  if (id === null) return { title: "Hacker News" };
  const result = await load(id);
  if (result.ok && (result.value.status === "complete" || result.value.status === "insufficient")) {
    const { exploration } = result.value;
    return {
      title: exploration.submission.title,
      description: exploration.summary.primary
        ? `A Wikipedia rabbit hole from Hacker News, starting at ${exploration.summary.primary.title}.`
        : "A Wikipedia rabbit hole from a Hacker News submission.",
      robots: result.value.status === "insufficient" ? { index: false } : undefined,
    };
  }
  return { title: "Hacker News", robots: { index: false } };
}

const REJECTED: Record<string, string> = {
  deleted: "This submission was deleted on Hacker News.",
  dead: "This submission is flagged dead on Hacker News.",
  job: "Job postings are not turned into rabbit holes.",
  poll: "Polls are not turned into rabbit holes.",
  untitled: "This item has no title to work from.",
  "off-topic": "This looks like career advice, promotion or general news, which WikiHole leaves out.",
  "low-information": "The submission does not name anything WikiHole can look up.",
};

export default async function ExplorationPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) notFound();
  const result = await load(id);

  const back = (
    <>
      <Link className="btn" href="/hackernews">
        All rabbit holes
      </Link>
      <a className="btn" href={hnItemUrl(id)} target="_blank" rel="noopener noreferrer">
        Open on Hacker News
      </a>
    </>
  );

  if (!result.ok) {
    return (
      <div className="container" style={{ paddingTop: 48 }}>
        <StateMessage kind="error" title="This rabbit hole could not be dug right now." action={back}>
          {describeError(result.error).message}
        </StateMessage>
      </div>
    );
  }

  const value = result.value;
  if (value.status === "notfound") notFound();
  if (value.status === "rejected") {
    return (
      <div className="container" style={{ paddingTop: 48 }}>
        <StateMessage kind="empty" title={value.submission?.title ?? "Not a rabbit hole"} action={back}>
          {REJECTED[value.reason] ?? "This submission is not suitable for a Wikipedia rabbit hole."}
        </StateMessage>
      </div>
    );
  }
  if (value.status === "failed") {
    return (
      <div className="container" style={{ paddingTop: 48 }}>
        <StateMessage kind="error" title={value.submission.title} action={back}>
          The rabbit hole could not be built ({value.error}). It will be retried automatically; try again in a few minutes.
        </StateMessage>
      </div>
    );
  }
  return (
    <div className="container">
      <SubmissionExplorer exploration={value.exploration} status={value.status} />
    </div>
  );
}
