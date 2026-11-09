import Link from "next/link";
import { Suspense } from "react";
import { TrailExplorer } from "@/components/trails/TrailExplorer";
import { curatedTrailsFeaturedFirst } from "@/lib/trails/graph";
import { CONNECTIONS_PATH } from "@/lib/trails/paths";
import { resolveTrail } from "@/lib/trails/resolve";
import { canStartTrail, resolveTrails } from "@/lib/trails/service";
import styles from "./home.module.css";

async function ResolvedExplorer() {
  return <TrailExplorer trails={await resolveTrails(curatedTrailsFeaturedFirst())} headingLevel={3} />;
}

/**
 * The Main Page's lead feature: one complete trail, interactive in place.
 * The trail and its explanations are known without Wikipedia, so they render
 * at once; descriptions and thumbnails stream in after.
 */
export function UnexpectedConnections() {
  const placeholder = curatedTrailsFeaturedFirst().map((t) => resolveTrail(t, null, canStartTrail));
  return (
    <section className={styles.connections} aria-labelledby="connections-heading" data-testid="unexpected-connections">
      <div className={styles.connectionsIntro}>
        <h2 id="connections-heading" className={styles.connectionsH2}>
          Go down a rabbit hole. Find something unexpected.
        </h2>
        <p className={styles.connectionsText}>
          Follow the connections between seemingly unrelated ideas and discover where curiosity takes you.
        </p>
        <p className={styles.connectionsMore}>
          <Link href={CONNECTIONS_PATH}>All trails</Link> · <Link href={`${CONNECTIONS_PATH}#trail-from`}>Start from any article</Link>
        </p>
      </div>
      <div className={styles.connectionsTrail}>
        <Suspense fallback={<TrailExplorer trails={placeholder} headingLevel={3} loading />}>
          <ResolvedExplorer />
        </Suspense>
      </div>
    </section>
  );
}
