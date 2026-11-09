import type { Metadata } from "next";
import Link from "next/link";
import { EditionNotice } from "@/components/i18n/EditionNotice";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { PageShell, SiteSub } from "@/components/layout/PageShell";
import { SiteTools } from "@/components/layout/SiteTools";
import { GeneratedTrails } from "@/components/trails/GeneratedTrails";
import { TrailExplorer } from "@/components/trails/TrailExplorer";
import trailStyles from "@/components/trails/trails.module.css";
import { StateMessage } from "@/components/ui/StateMessage";
import { isAiEnabled } from "@/lib/ai/config";
import { requestLanguage } from "@/lib/i18n/server";
import { attempt } from "@/lib/server/http";
import { curatedTrail, curatedTrailsFeaturedFirst, trailsFrom } from "@/lib/trails/graph";
import { CONNECTIONS_PATH, trailPath } from "@/lib/trails/paths";
import { TRAIL_LANGUAGE, resolveTrails } from "@/lib/trails/service";
import type { ResolvedTrail, TrailDefinition } from "@/lib/trails/types";
import { getPageMeta } from "@/lib/wikipedia/api";
import { articlePath, isArticleNamespace, isValidTitle, normalizeTitle } from "@/lib/wikipedia/titles";
import styles from "../pages.module.css";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function param(params: Record<string, string | string[] | undefined>, key: string): string | null {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function requestedTitle(raw: string | null): string | null {
  if (!raw) return null;
  const title = normalizeTitle(raw);
  return isValidTitle(title) && isArticleNamespace(title) ? title : null;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const from = requestedTitle(param(await searchParams, "from"));
  return {
    title: from ? `Unexpected connections from ${from}` : "Unexpected connections",
    description: "Trails from an ordinary Wikipedia article to a surprising one, with the reason for every step.",
  };
}

/** Puts `first` at the front of the curated pool, without repeating any trail. */
function pool(first: TrailDefinition[]): TrailDefinition[] {
  const ids = new Set(first.map((t) => t.id));
  return [...first, ...curatedTrailsFeaturedFirst().filter((t) => !ids.has(t.id))];
}

type View =
  | { kind: "trails"; trails: ResolvedTrail[]; notice?: React.ReactNode }
  | { kind: "generate"; title: string; others: ResolvedTrail[] }
  | { kind: "none"; notice: React.ReactNode };

async function chooseView(params: Record<string, string | string[] | undefined>): Promise<View> {
  const rawFrom = param(params, "from");
  const trailId = param(params, "trail");

  if (rawFrom !== null) {
    const from = requestedTitle(rawFrom);
    if (!from) {
      return {
        kind: "none",
        notice: <StateMessage kind="empty" title="That is not an article title">Try one of the trails below.</StateMessage>,
      };
    }
    const meta = await attempt(() => getPageMeta(from, TRAIL_LANGUAGE));
    if (meta.ok && meta.value === null) {
      return {
        kind: "none",
        notice: (
          <StateMessage kind="empty" title={`Wikipedia has no article called “${from}”`}>
            Check the spelling, or try one of the trails below.
          </StateMessage>
        ),
      };
    }
    const title = meta.ok && meta.value ? meta.value.title : from;
    const found = trailsFrom(title);
    if (found.length) return { kind: "trails", trails: await resolveTrails(pool(found)) };
    // Generation needs the article itself; if Wikipedia could not be reached, say so instead of guessing.
    if (isAiEnabled() && meta.ok) return { kind: "generate", title, others: await resolveTrails(pool([])) };
    return {
      kind: "none",
      notice: (
        <StateMessage kind="empty" title={`No trail starts from ${title} yet`}>
          {meta.ok
            ? "No hand-written trail passes through this article. "
            : "Wikipedia could not be reached to look this article up. "}
          Read{" "}
          <Link href={articlePath(title)} prefetch={false}>
            {title}
          </Link>{" "}
          and follow its Rabbit hole, or try one of the trails below.
        </StateMessage>
      ),
    };
  }

  if (trailId !== null) {
    const trail = curatedTrail(trailId);
    if (trail) return { kind: "trails", trails: await resolveTrails(pool([trail])) };
    return {
      kind: "trails",
      trails: await resolveTrails(pool([])),
      notice: <StateMessage kind="empty" title="That trail does not exist">Here is another one instead.</StateMessage>,
    };
  }

  return { kind: "trails", trails: await resolveTrails(pool([])) };
}

function StartForm({ value }: { value?: string }) {
  return (
    <form action={CONNECTIONS_PATH} method="get" className={trailStyles.startForm} role="search" aria-label="Start a trail">
      <label htmlFor="trail-from" className={trailStyles.startLabel}>
        Start from an article
      </label>
      <div className={trailStyles.startRow}>
        <input
          id="trail-from"
          name="from"
          type="text"
          className={trailStyles.startInput}
          defaultValue={value}
          placeholder="e.g. Pencil, Coffee, Apollo 11"
          autoComplete="off"
          maxLength={255}
          required
        />
        <button type="submit" className="btn">
          Find a trail
        </button>
      </div>
    </form>
  );
}

function TrailIndex() {
  const trails = curatedTrailsFeaturedFirst();
  return (
    <section aria-labelledby="all-trails">
      <h2 id="all-trails" className={styles.h2}>
        All trails
      </h2>
      <ul className={trailStyles.index}>
        {trails.map((t) => (
          <li key={t.id}>
            <Link href={trailPath(t.id)} prefetch={false}>
              {t.titles[0]} → {t.titles[t.titles.length - 1]}
            </Link>{" "}
            <span className={styles.muted}>({t.titles.length} articles)</span>
          </li>
        ))}
      </ul>
      <h2 className={styles.h2}>How trails are made</h2>
      <p className={trailStyles.method}>
        Every step follows a link that exists in the earlier article on Wikipedia, and every explanation restates what
        the articles themselves say: no step is a guess. Trails are written by hand and checked against Wikipedia
        automatically.
        {isAiEnabled()
          ? " From an article no trail passes through, an AI proposes trails; only those whose every step links in Wikipedia’s own text are shown, with that text quoted."
          : ""}
      </p>
    </section>
  );
}

/** Unexpected Connections: trails from an ordinary article to a surprising one. */
export default async function ConnectionsPage({ searchParams }: Props) {
  const params = await searchParams;
  const view = await chooseView(params);
  const from = param(params, "from") ?? undefined;
  return (
    <LanguageProvider initialLang={await requestLanguage()}>
      <PageShell
        title="Unexpected connections"
        tabs={{
          left: [{ label: "Unexpected connections", href: CONNECTIONS_PATH, selected: true }],
          right: [
            { label: "Read", href: CONNECTIONS_PATH, selected: true },
            { label: "Discover", href: "/discover" },
          ],
        }}
        tools={<SiteTools />}
      >
        <SiteSub>Discover connections between things you never knew were connected</SiteSub>
        <p className={styles.intro}>
          Each trail starts somewhere ordinary and ends somewhere you would not expect. Every step says why one article
          leads to the next.
        </p>
        <EditionNotice feature="Unexpected connections" source="English Wikipedia" />
        <StartForm value={from?.replace(/_/g, " ")} />
        <div className={trailStyles.pageExplorer}>
          {view.kind === "trails" ? (
            <>
              {view.notice}
              {/* Keyed so that moving to another trail or start (same route, new query) starts fresh. */}
              <TrailExplorer key={view.trails.map((t) => t.id).join(",")} trails={view.trails} />
            </>
          ) : view.kind === "generate" ? (
            <GeneratedTrails key={view.title} title={view.title} others={view.others} />
          ) : (
            view.notice
          )}
        </div>
        <TrailIndex />
      </PageShell>
    </LanguageProvider>
  );
}
