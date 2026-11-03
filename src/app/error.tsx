"use client";

import Link from "next/link";
import { useEffect } from "react";
import { PageShell } from "@/components/layout/PageShell";
import { StateMessage } from "@/components/ui/StateMessage";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <PageShell title="Something broke on the way down">
      <StateMessage
        kind="error"
        title="This page failed to render."
        action={
          <>
            <button type="button" className="btn" onClick={reset}>
              Try again
            </button>
            <Link className="btn" href="/">
              Main Page
            </Link>
          </>
        }
      >
        It is usually a temporary problem reaching Wikipedia.{error.digest ? ` Reference: ${error.digest}.` : ""}
      </StateMessage>
    </PageShell>
  );
}
