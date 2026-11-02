import { ImageResponse } from "next/og";

export const alt = "WikiHole: the internet's deepest rabbit holes";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "#080808",
          color: "#eeeeee",
          fontFamily: "serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 28, letterSpacing: 10, fontFamily: "monospace" }}>
          <div style={{ width: 30, height: 30, borderRadius: 30, border: "4px solid #eeeeee" }} />
          WIKIHOLE
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 76, lineHeight: 1.05 }}>The internet&rsquo;s deepest rabbit holes.</div>
          <div style={{ fontSize: 30, color: "#a8a8a8", fontFamily: "sans-serif" }}>
            Obscure, technically deep Wikipedia articles, ranked and ready to read.
          </div>
        </div>
        <div style={{ display: "flex", borderTop: "1px solid #2a2a2a", paddingTop: 22, fontSize: 22, color: "#7d7d7d", fontFamily: "monospace" }}>
          COMPUTER SCIENCE · MATHEMATICS · PHYSICS · ENGINEERING · BIOLOGY · ECONOMICS
        </div>
      </div>
    ),
    size,
  );
}
