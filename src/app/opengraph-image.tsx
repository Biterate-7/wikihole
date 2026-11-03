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
          background: "#ffffff",
          color: "#202122",
          fontFamily: "serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 40 }}>
          <div style={{ width: 56, height: 56, borderRadius: 56, border: "5px solid #54595d", background: "#eaecf0" }} />
          WIKIHOLE
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 72, lineHeight: 1.1, borderBottom: "2px solid #a2a9b1", paddingBottom: 16 }}>
            The internet&rsquo;s deepest rabbit holes
          </div>
          <div style={{ fontSize: 30, color: "#54595d", fontFamily: "sans-serif" }}>
            Obscure, technically deep Wikipedia articles, ranked and ready to read.
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 24, color: "#3366cc", fontFamily: "sans-serif" }}>
          Computer science · Mathematics · Physics · Engineering · Biology · Economics
        </div>
      </div>
    ),
    size,
  );
}
