"use client";

/** Last-resort boundary when the root layout itself fails. Inline styles only. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#080808", color: "#eeeeee", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ maxWidth: 640, margin: "15vh auto", padding: "0 24px" }}>
          <p style={{ fontFamily: "monospace", fontSize: 12, letterSpacing: "0.2em", color: "#7d7d7d" }}>WIKIHOLE</p>
          <h1 style={{ fontFamily: "Georgia, serif", fontWeight: 400, fontSize: 32 }}>Something went wrong.</h1>
          <button
            type="button"
            onClick={reset}
            style={{ marginTop: 16, padding: "8px 14px", background: "transparent", color: "#eeeeee", border: "1px solid #3a3a3a" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
