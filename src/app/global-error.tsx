"use client";

/** Last-resort boundary when the root layout itself fails. Inline styles only. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#ffffff", color: "#202122", fontFamily: "sans-serif" }}>
        <main style={{ maxWidth: 720, margin: "12vh auto", padding: "0 24px" }}>
          <p style={{ fontFamily: "Georgia, serif", fontVariant: "small-caps", fontSize: 22, margin: 0 }}>Wikihole</p>
          <h1 style={{ fontFamily: "'Linux Libertine', Georgia, serif", fontWeight: 400, fontSize: 28.8, borderBottom: "1px solid #a2a9b1" }}>
            Something went wrong.
          </h1>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 8,
              padding: "6px 12px",
              background: "#f8f9fa",
              color: "#202122",
              border: "1px solid #a2a9b1",
              borderRadius: 2,
              fontWeight: 700,
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
